#!/usr/bin/env python3
"""
Diff old podcast_agent.py vs new agent/ on the SAME episode.

目的：验证 v3 → v4 重构是否引入候选选择上的回归。

跑法（在项目根目录）：
    cd "/path/to/listen demo"
    python tools/diff_old_vs_new.py

会做什么：
1. 下载一个固定的 Planet Money 集（只做一次，缓存到 output/diff_check/）
2. 跑 Whisper 转录（只做一次，结果缓存为 transcript.json）
3. 调用老 agent 的 identify_segments(transcript, episode_info)
4. 调用新 agent 的 select_segments + filter_candidates
5. 输出 Markdown 报告 output/diff_check/diff_report.md，并行展示两边的候选

API 成本估算：
- Whisper：1 次（~$0.30，转录 25-30 分钟的 episode）
- GPT：2 次（老 + 新，~$0.10 共）
- 重跑成本：缓存命中后约 $0.10（仅 GPT 重跑）

老 agent 没有 dry-run 模式，但 identify_segments() 是纯函数，可以单独调用。
"""

import json
import os
import sys
import time
from pathlib import Path

# Ensure project root is importable
PROJECT_ROOT = Path(__file__).resolve().parent.parent
SCRIPTS_DIR = PROJECT_ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

# 固定测试 episode：Planet Money 的 RSS 入口（取最近一集）
TEST_FEED_URL = "https://feeds.npr.org/510289/podcast.xml"
TEST_FEED_NAME = "Planet Money"
TEST_FEED_TIER = "Business"

CACHE_DIR = PROJECT_ROOT / "output" / "diff_check"
CACHE_DIR.mkdir(parents=True, exist_ok=True)


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def get_test_episode():
    """Pick a fixed Planet Money episode (the most recent one). Cache the metadata."""
    meta_path = CACHE_DIR / "episode_meta.json"
    if meta_path.exists():
        log(f"使用缓存的 episode metadata: {meta_path}")
        return json.loads(meta_path.read_text())

    # Use new agent's parse_rss to pick episode
    from agent.rss import parse_rss
    log(f"解析 RSS: {TEST_FEED_URL}")
    episodes = parse_rss(TEST_FEED_URL, TEST_FEED_NAME, episodes_per_feed=1, max_age_days=30)
    if not episodes:
        log("ERROR: 没有找到合格 episode")
        sys.exit(1)
    ep = episodes[0]
    ep["tier"] = TEST_FEED_TIER
    ep["podcast_name"] = TEST_FEED_NAME
    meta_path.write_text(json.dumps(ep, ensure_ascii=False, indent=2))
    return ep


def get_audio(episode):
    """Download episode audio. Cache to output/diff_check/episode.mp3."""
    audio_path = CACHE_DIR / "episode.mp3"
    if audio_path.exists() and audio_path.stat().st_size > 100_000:
        log(f"使用缓存音频: {audio_path} ({audio_path.stat().st_size//1024} KB)")
        episode["local_audio"] = str(audio_path)
        return episode

    from agent.download import download_audio
    log(f"下载音频: {episode['audio_url']}")
    tmp_dir = str(CACHE_DIR)
    # Make agent download to our cache path
    if not download_audio(episode, tmp_dir):
        log("ERROR: 下载失败")
        sys.exit(1)
    # Rename whatever the agent created
    if "local_audio" in episode and Path(episode["local_audio"]).exists():
        Path(episode["local_audio"]).rename(audio_path)
        episode["local_audio"] = str(audio_path)
    return episode


def get_transcript(episode):
    """Run Whisper on episode audio. Cache the result."""
    cache_path = CACHE_DIR / "transcript.json"
    if cache_path.exists():
        log(f"使用缓存转录: {cache_path}")
        return json.loads(cache_path.read_text())

    from agent.transcribe import transcribe_audio
    log(f"运行 Whisper（约 5-10 分钟）...")
    transcript = transcribe_audio(episode["local_audio"])
    if not transcript:
        log("ERROR: Whisper 失败")
        sys.exit(1)
    cache_path.write_text(json.dumps(transcript, ensure_ascii=False))
    log(f"Whisper 完成，缓存到 {cache_path}")
    return transcript


def run_old_agent(transcript, episode):
    """Call the old podcast_agent.identify_segments() in isolation."""
    log("调用老 agent: identify_segments(...)")
    # Old agent imports lots of things, but identify_segments is mostly self-contained
    import podcast_agent as old
    # Old agent expects globals to be set up. Need to init env first.
    if not getattr(old, "WHISPER_API_KEY", None):
        # Old uses module-level globals from os.environ at import time;
        # if loader.py-style ensure_env didn't run, fall back to env directly
        old.GPT_API_KEY = os.environ.get("AZURE_OPENAI_API_KEY", "")
        old.GPT_ENDPOINT = os.environ.get("AZURE_OPENAI_ENDPOINT", "")
        old.GPT_DEPLOYMENT = os.environ.get("AZURE_OPENAI_DEPLOYMENT", "gpt-5-chat-global-01")
        old.GPT_API_VERSION = os.environ.get("AZURE_OPENAI_API_VERSION", "2025-01-01-preview")
    candidates = old.identify_segments(transcript, episode,
                                       clip_duration_min=60, clip_duration_max=120)
    log(f"  老 agent 输出 {len(candidates)} 个候选")
    return candidates


def run_new_agent(transcript, episode):
    """Call the new agent's select_segments + filter_candidates."""
    log("调用新 agent: select_segments + filter_candidates(...)")
    from agent.config import ensure_env
    from agent.segmentation import select_segments
    from agent.filter import filter_candidates
    ensure_env()

    words = transcript.get("words", [])
    duration_minutes = (words[-1]["end"] / 60.0) if words else 0
    candidates = select_segments(transcript, episode["podcast_name"],
                                 episode["tier"], duration_minutes,
                                 candidates_per_episode=6)
    log(f"  LLM 选出 {len(candidates)} 个候选（过滤前）")

    # Attach text for filtering
    for cand in candidates:
        st, et = cand.get("start_time", 0), cand.get("end_time", 0)
        cand_words = [w.get("word", "") for w in words
                      if w.get("start", 0) >= st - 0.1 and w.get("end", 0) <= et + 0.1]
        cand["text"] = " ".join(cand_words)
        cand["duration_sec"] = cand.get("duration_sec", et - st)

    filtered = filter_candidates(candidates, episode["local_audio"],
                                 episode["tier"], clips_per_episode=6)
    log(f"  过滤后剩 {len(filtered)} 个候选")
    return {"raw": candidates, "filtered": filtered}


def fmt_time(t):
    m, s = int(t) // 60, int(t) % 60
    return f"{m:02d}:{s:02d}"


def candidate_summary(cand, transcript=None):
    """One-line summary for diff report."""
    st = cand.get("start_time", 0)
    et = cand.get("end_time", 0)
    dur = et - st
    text = cand.get("text", "") or cand.get("text_preview", "")
    if not text and transcript:
        words = transcript.get("words", [])
        word_text = [w.get("word", "") for w in words
                     if st - 0.1 <= w.get("start", 0) <= et + 0.1]
        text = " ".join(word_text)
    head = " ".join(text.split()[:15])
    tail = " ".join(text.split()[-10:])
    title = cand.get("suggested_title", "")
    hook = cand.get("hook_strength", "?")
    flags = cand.get("soft_flags", [])
    filt = cand.get("filter_result", "")
    return {
        "time_range": f"{fmt_time(st)}–{fmt_time(et)} ({dur:.0f}s)",
        "start_time": st,
        "end_time": et,
        "duration": dur,
        "title": title,
        "hook": hook,
        "flags": flags,
        "filter_result": filt,
        "head": head,
        "tail": tail,
    }


def time_overlap(a_start, a_end, b_start, b_end):
    """Return overlap ratio relative to the shorter of the two."""
    overlap = max(0, min(a_end, b_end) - max(a_start, b_start))
    shorter = min(a_end - a_start, b_end - b_start)
    return overlap / shorter if shorter > 0 else 0


def write_report(episode, old_cands, new_cands, transcript):
    """Write side-by-side diff report."""
    old_summaries = [candidate_summary(c, transcript) for c in old_cands]
    new_raw_summaries = [candidate_summary(c, transcript) for c in new_cands["raw"]]
    new_filt_summaries = [candidate_summary(c, transcript) for c in new_cands["filtered"]]

    # Match candidates by time overlap > 50%
    matches, only_old, only_new = [], list(old_summaries), list(new_filt_summaries)
    for o in old_summaries:
        for n in new_filt_summaries:
            if time_overlap(o["start_time"], o["end_time"],
                            n["start_time"], n["end_time"]) > 0.5:
                matches.append((o, n))
                if o in only_old:
                    only_old.remove(o)
                if n in only_new:
                    only_new.remove(n)
                break

    out = []
    out.append("# Old vs New Agent Diff Report")
    out.append("")
    out.append(f"**Episode**: {episode.get('title', '?')}")
    out.append(f"**Podcast**: {episode.get('podcast_name', '?')} ({episode.get('tier', '?')})")
    out.append(f"**Duration**: {episode.get('duration_minutes', '?')} min")
    out.append("")
    out.append("## 候选数对比")
    out.append("")
    out.append(f"- 老 agent (identify_segments): **{len(old_summaries)}** 个候选")
    out.append(f"- 新 agent LLM 输出 (select_segments): **{len(new_raw_summaries)}** 个候选")
    out.append(f"- 新 agent 过滤后 (filter_candidates): **{len(new_filt_summaries)}** 个候选")
    out.append("")
    out.append("## 时间区间重叠匹配（overlap > 50%）")
    out.append("")
    out.append(f"- 匹配上的：**{len(matches)}** 对")
    out.append(f"- 只老 agent 选了：**{len(only_old)}**")
    out.append(f"- 只新 agent 选了：**{len(only_new)}**")
    out.append("")

    if matches:
        out.append("### ✅ 两边都选的（一致信号）")
        out.append("")
        for o, n in matches:
            out.append(f"#### {o['time_range']} (old) ↔ {n['time_range']} (new)")
            out.append(f"- 老: {o['title']} | hook={o['hook']}")
            out.append(f"- 新: {n['title']} | hook={n['hook']} | flags={n['flags']}")
            out.append(f"- 开头: `{o['head'][:80]}`")
            out.append(f"- 结尾: `{o['tail'][:80]}`")
            out.append("")

    if only_old:
        out.append("### ⚠️ 只老 agent 选了（新 agent 漏选 or 被过滤）")
        out.append("")
        for o in only_old:
            # Find if it appeared in new RAW (LLM picked) but got filtered
            filtered_match = None
            for nr in new_raw_summaries:
                if time_overlap(o["start_time"], o["end_time"],
                                nr["start_time"], nr["end_time"]) > 0.5:
                    filtered_match = nr
                    break
            out.append(f"#### {o['time_range']}: {o['title']}")
            out.append(f"- hook={o['hook']}")
            out.append(f"- 开头: `{o['head'][:100]}`")
            out.append(f"- 结尾: `{o['tail'][:80]}`")
            if filtered_match:
                out.append(f"- ⚠️ 新 agent LLM 也选了（{filtered_match['time_range']}），但被 filter 拦掉：`{filtered_match['filter_result']}`")
            else:
                out.append(f"- ❌ 新 agent LLM 完全没选这个时段")
            out.append("")

    if only_new:
        out.append("### 🆕 只新 agent 选了（v2 prompt 带来的新发现）")
        out.append("")
        for n in only_new:
            out.append(f"#### {n['time_range']}: {n['title']}")
            out.append(f"- hook={n['hook']} | flags={n['flags']}")
            out.append(f"- 开头: `{n['head'][:100]}`")
            out.append(f"- 结尾: `{n['tail'][:80]}`")
            out.append("")

    out.append("## 判断建议")
    out.append("")
    out.append("看下面三个信号，决定是否进 dry-run：")
    out.append("")
    out.append("1. **老 agent 的好候选，新 agent 也选了吗？** 看 ✅ 区域。如果老 agent 选的高 hook 候选在新 agent 里都有匹配，重构没漏掉东西。")
    out.append("2. **新 agent 漏选的，是因为 v2 规则真的更严，还是漏了？** 看 ⚠️ 区域。如果漏选的是开头有 `that's right` / `you said` 之类的，是 v2 规则正确淘汰；如果漏选的看起来质量也不错，是潜在 bug。")
    out.append("3. **新 agent 多选的，是真的好候选吗？** 看 🆕 区域。这是 v2 prompt 带来的红利或者噪音。")

    report_path = CACHE_DIR / "diff_report.md"
    report_path.write_text("\n".join(out))
    log(f"\n✅ 报告写入: {report_path}")
    return report_path


def main():
    log("=== Old vs New Agent Diff Check ===")
    log(f"缓存目录: {CACHE_DIR}")
    log("")

    # Make sure env is loaded
    try:
        from dotenv import load_dotenv
        load_dotenv(PROJECT_ROOT / ".env")
    except ImportError:
        log("注意: 没装 python-dotenv，假设环境变量已 export")

    if not os.environ.get("AZURE_OPENAI_API_KEY"):
        log("ERROR: AZURE_OPENAI_API_KEY 没设置")
        sys.exit(1)

    episode = get_test_episode()
    log(f"Episode: {episode.get('title', '?')}")

    episode = get_audio(episode)
    transcript = get_transcript(episode)

    words = transcript.get("words", [])
    episode["duration_minutes"] = round((words[-1]["end"] / 60.0) if words else 0, 1)

    log("")
    old_cands = run_old_agent(transcript, episode)
    log("")
    new_cands = run_new_agent(transcript, episode)
    log("")
    report_path = write_report(episode, old_cands, new_cands, transcript)
    log(f"\n打开报告: {report_path}")


if __name__ == "__main__":
    main()
