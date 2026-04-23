#!/usr/bin/env python3
"""
Generate Stage 0-3 quiz questions for the 3 demo clips using Azure GPT-5.4.

输入: practice-v2-demo-data.json（含 3 条 clip 的 transcript）
输出:
  1. practice-v2-demo-questions-v2.json   — 前端可用的题目数据
  2. tmp/questions-v2-audit.md            — 人工校对表

约束（PRD v2.2 §4.6）:
  Stage × Distractor Type 映射（优先建议，不硬约束）:
    Stage 0 不设 distractor_type
    Stage 1 Gist      → P3 / P7
    Stage 2 Decode    → P2 / P4 / P5
    Stage 3 Deep      → P1 / P4 / P6
  单题 2 个干扰项尽量分属不同 type。

踩坑提醒:
  - 用 curl subprocess（Python 3.9 SSL 问题）
  - GPT-5.4 用 max_completion_tokens
"""
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_PATH = ROOT / "practice-v2-demo-data.json"
OUT_JSON = ROOT / "practice-v2-demo-questions-v2.json"
AUDIT_MD = ROOT / "tmp" / "questions-v2-audit.md"

# ── Env ──
def load_env():
    env_path = ROOT / ".env"
    if not env_path.exists():
        print(f"[FATAL] {env_path} not found", file=sys.stderr)
        sys.exit(1)
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip())

load_env()
GPT_ENDPOINT   = os.environ["AZURE_OPENAI_ENDPOINT"]
GPT_KEY        = os.environ["AZURE_OPENAI_API_KEY"]
GPT_DEPLOYMENT = os.environ["AZURE_OPENAI_DEPLOYMENT"]
GPT_APIVER     = os.environ["AZURE_OPENAI_API_VERSION"]

CLIP_TYPES = ["叙事", "观点", "信息"]  # 按 clip 顺序
CONTENT_TYPE_EN = {"叙事": "narrative", "观点": "opinion", "信息": "informational"}

DISTRACTOR_DEFS = """\
P1 Phonological confusion   音近陷阱
  · 使用条件：原文某词在听音上容易跟另一个常见词混淆 → 干扰项用那个易混词。
  · 示例：原文 "thirty" → 干扰项 "thirteen"；原文 "bull market" → 干扰项 "bear market"；原文 "accept" → 干扰项 "except"；原文 "desert" → 干扰项 "dessert"；原文 "affect" → 干扰项 "effect"。
  · 注意：单纯字形相近而读音不近（如 through/thorough）不算 P1。

P2 Lexical overlap          词面重叠
  · 使用条件：干扰项含原文里出现过的关键词（名词/动词/数字），但整体语义不对。
  · 示例：原文 "I used to live in Paris, now London"，干扰项 "Paris"（挂回原问题 Where does he live?）。

P3 Paraphrase mismatch      同义改写错位
  · 使用条件：正确项是原文句义的 paraphrase（用不同词表达同义）；干扰项用原文"字面词"但不是答案。
  · 示例：原文 "I didn't enjoy my work much" → 正确项 "low job satisfaction"，干扰项 "enjoyed the job"。

P4 Negation / contradiction 否定 / 修正陷阱
  · ⚠️ 严格使用条件：必须原文里有显性的**否定/修正触发词**（not / no / but / however / actually / rather / instead / on the contrary / in fact）导致说话人的结论被反转；干扰项是被反转前的内容。
  · 示例：原文 "I thought it was at 3, but actually it's at 5" → 干扰项 "3"（被 but actually 否定前的内容）。
  · ❌ 不允许：仅因为"干扰项跟原文结论相反"就标 P4。如果原文没有显性否定/修正词触发，请考虑用 P7（推断错误）或 P6（细节错配）。

P5 Referent confusion       指代 / 归属错误
  · 使用条件：存在多个说话人 / 多个实体 / 多个时间节点，干扰项把 A 的话挂到 B 头上、或把第一次事件误认为第二次。
  · 示例：对话里 Anna 说 "I love tennis"，Bob 说 "me too"；问 "Who originally loved tennis?" 干扰项 "Bob"。

P6 Detail swap              细节错配
  · 使用条件：原文有具体的**数字 / 时间 / 地点 / 人名 / 数量**，干扰项把这些具体细节互换或替换为原文没有的细节。
  · 示例：原文 "arrived Monday, left Friday" → 干扰项颠倒成 "arrived Friday, left Monday"。

P7 Inference error          推断偏差
  · 使用条件：正确项需要基于语境做**态度/立场/隐含义/结论**推断；干扰项是字面合理但推断错误的内容。
  · 示例：原文 "Well, I suppose it was... OK"（迟疑 + 限定语气）→ 正确项 "not impressed"；干扰项 "enjoyed"（字面被 "OK" 诱导）。\
"""

STAGE_TYPE_MAP = """\
Stage 0 预测   → 不设 distractor_type（探测话题熟悉度，不是 comprehension test）
Stage 1 Gist   → 优先 P3 · P7      （top-down 主旨/推断）
Stage 2 Decode → 优先 P2 · P4 · P5 （bottom-up 关键词/转折/指代）
Stage 3 Deep   → 优先 P1 · P4 · P6 （辨音/转折/细节）\
"""


def call_gpt(messages, temperature=0.3, max_tokens=4000, attempt=0):
    url = (f"{GPT_ENDPOINT}/openai/deployments/{GPT_DEPLOYMENT}"
           f"/chat/completions?api-version={GPT_APIVER}")
    payload = json.dumps({
        "messages": messages,
        "temperature": temperature,
        "max_completion_tokens": max_tokens,
    })
    for a in range(3):
        try:
            r = subprocess.run([
                "curl", "-s", "-X", "POST", url,
                "-H", f"api-key: {GPT_KEY}",
                "-H", "Content-Type: application/json",
                "-d", payload,
                "--connect-timeout", "15",
                "--max-time", "180",
            ], capture_output=True, text=True, timeout=200)
            if r.returncode != 0:
                print(f"  [warn] curl 失败 (try {a+1}/3): {r.stderr[:200]}", file=sys.stderr)
                time.sleep(5); continue
            data = json.loads(r.stdout)
            if "error" in data:
                print(f"  [warn] API 错误 (try {a+1}/3): {data['error'].get('message','')[:240]}", file=sys.stderr)
                time.sleep(5); continue
            return data["choices"][0]["message"]["content"]
        except Exception as e:
            print(f"  [warn] 调用异常 (try {a+1}/3): {e}", file=sys.stderr)
            time.sleep(5)
    return None


def _strip_trailing_commas(s):
    """Remove trailing commas before ] or } (JSON5-ish tolerance)."""
    return re.sub(r",(\s*[\]\}])", r"\1", s)


def parse_json_from_response(text):
    """GPT 有时在 JSON 前后包 ```json 栅栏或加解释文字；尽量容错"""
    if not text:
        return None
    # Strip code fences
    m = re.search(r"```(?:json)?\s*(.+?)```", text, flags=re.DOTALL)
    if m:
        text = m.group(1).strip()
    # Try raw parse first, then with trailing-comma stripping
    for candidate in (text, _strip_trailing_commas(text)):
        try:
            return json.loads(candidate)
        except Exception:
            pass
    # Attempt to extract outermost {...} or [...]
    for open_ch, close_ch in [("{", "}"), ("[", "]")]:
        start = text.find(open_ch)
        if start < 0: continue
        depth = 0
        for i in range(start, len(text)):
            if text[i] == open_ch: depth += 1
            elif text[i] == close_ch:
                depth -= 1
                if depth == 0:
                    chunk = text[start:i+1]
                    for candidate in (chunk, _strip_trailing_commas(chunk)):
                        try:
                            return json.loads(candidate)
                        except Exception:
                            pass
                    break
    return None


def build_prompt(clip, clip_type_zh, idx):
    """Build the per-clip prompt."""
    transcript_en = "\n".join(f"[{i}] {ln['en']}" for i, ln in enumerate(clip["lines"]))
    transcript_zh = "\n".join(f"[{i}] {ln['zh']}" for i, ln in enumerate(clip["lines"]))
    ctype_en = CONTENT_TYPE_EN[clip_type_zh]

    system = f"""你是 Flipod 英语听力训练产品的题目设计专家，遵循 Cambridge English / IELTS 听力测试的题目设计传统和 Vandergrift 元认知听力循环（MPC）理论。

# 核心任务
为下面这条 {clip_type_zh}类播客 clip 设计恰好 7 道题：
  - 1 道 Stage 0 预测题
  - 1 道 Stage 1 主旨题（中文题干）
  - 2 道 Stage 2 细节/态度题
  - 3 道 Stage 3 深听题（其中至少 1 道是"听觉专项"，考**辨音（P1）** 或 数字/细节识别）

# 7 类 distractor（干扰项）分类定义 — 严格按下面的"使用条件"判定
{DISTRACTOR_DEFS}

# Stage × Type 映射（优先建议）
{STAGE_TYPE_MAP}

# 硬约束（必须满足，违反则输出会被拒绝）
1. **题目数量恰好 7 道**（见上方结构）
2. **3 选 1 格式**：每题恰好 3 个选项、1 个正确
3. **干扰项必须来自原文或原文明显改写** — 不允许完全虚构。选项内容的词/细节要能在 transcript 里找到对应痕迹
4. **单题的 2 个干扰项必须分属不同 distractor_type**（硬约束，不能两个都同一类）
5. **Stage 0 预测题**：只基于标题 + 关键词（不给 transcript），3 选 1。不设 distractor_type、不设 explanation
6. **⚠️ 禁止元问题（硬约束）**：题目必须直接考察原文**内容理解**（说话人说了什么 / 细节 / 意图 / 态度 / 含义）。**严禁以下题型**：
   - "哪个词是干扰项 / 音近词 / 同音词"（词源学元问题）
   - "原文中 X 容易与哪个词混淆"（让用户做词汇学题）
   - "下列哪个单词的发音跟 X 相近"（元层面，不考内容）
   - "哪个 distractor_type / 哪类陷阱"（产品元信息问用户）
   - "下列选项哪个不属于文中提到的内容" / "Which X is NOT mentioned"（NOT-mentioned 反题变种）
7. **Stage 3 至少 1 道 P1 题的正确写法**：题干考察"说话人 X 说了什么 / 做了什么 / 提到了什么"——这是**内容题**；选项里 1 个是原文实词、另 1 个是跟原文词**发音接近**但意思不同的词，让用户听原文**靠耳朵辨音**选对。
   - ✅ 正确示范：题干 "How does the system learn?" + 选项 "By accessing data"（原文）/ "By assessing data"（P1 音近） / "By generating data"（P3）— 考察用户是否听清原文的 "accessing"。
   - ❌ 错误示范：题干 "Which word sounds like 'control'?" — 这是元问题。
   - 优先从 transcript 里找已有的"易混音词对"：数字（thirty/thirteen）、动词（accept/except, affect/effect）、名词（bull/bear, desert/dessert）等。
8. **P4 标注严格规则**：必须原文里有显性否定/修正触发词（not / no / but / however / actually / rather / instead / on the contrary / in fact）支撑。没有显性触发词但想标对立，请标 P7（推断偏差）或 P6（细节错配）
9. **Stage 3 禁止出现 "Which X is NOT mentioned" 这种反题**（NOT-mentioned 是硬约束 6 的一部分）
10. **explanation 三段式**（Stage 1-3 必须有，Stage 0 不要）:
    - `source`: 原文英文证据（用 反引号 标出关键字；可用 ... 省略）+ 可选中文翻译
    - `why_correct`: 1-2 句，说清从原文怎么推出正确选项
    - `why_wrong[]`: 每个错误选项一条，带 `option_idx`（0-based，对应 options 数组的下标，不是正确答案）、`reason`、`distractor_type`

# 偏离许可
Stage × Type 映射是"优先建议"。如内容本身不适合推荐 type，**允许偏离**，但要在该题加 `stage_type_fit: "deviated"` 并在 `reason` 里说明为什么内容不适合推荐 type。
（注意：硬约束 1-9 不能偏离）

# 输出格式（严格 JSON，不要任何解释文字）
{{
  "clip_idx": {idx},
  "content_type": "{ctype_en}",
  "questions": [
    {{
      "stage": 0, "lang": "zh", "noFeedback": true, "topic_tag": "<人物叙事/观点评论/新闻信息/...>",
      "question": "...",
      "options": ["A", "B", "C"],
      "answer": <0-2>
    }},
    {{
      "stage": 1, "lang": "zh",
      "question": "这段的主旨最接近：",
      "options": ["A", "B", "C"],
      "answer": <0-2>,
      "stage_type_fit": "matched",
      "explanation": {{
        "source": "...",
        "why_correct": "...",
        "why_wrong": [
          {{"option_idx": <int>, "reason": "...", "distractor_type": "P?"}},
          {{"option_idx": <int>, "reason": "...", "distractor_type": "P?"}}
        ]
      }}
    }},
    ...
  ]
}}
"""

    user = f"""# Clip 信息
- 标题: {clip.get("title", "(no title)")}
- 类型: {clip_type_zh} ({ctype_en})
- 关键词: {", ".join(clip.get("keywords", []))}
- 时长: {clip.get("duration_sec", "?")} 秒
- 来源: {clip.get("source", {}).get("podcast", "")} · {clip.get("source", {}).get("episode", "")}

# Transcript (English, 按句编号)
{transcript_en}

# Transcript (中文翻译，按句对齐)
{transcript_zh}

---

现在严格按 system 里的输出格式生成 6-7 道题。只输出 JSON，不要前后解释。
"""
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def validate_questions(qset, clip_idx):
    """Returns (hard_errors, soft_warnings).
       hard_errors trigger a regenerate; soft_warnings just annotate."""
    hard = []
    soft = []
    qs = qset.get("questions", [])
    stages = [q.get("stage") for q in qs]
    # Hard: 7 questions total
    if len(qs) != 7:
        hard.append(f"clip {clip_idx}: 期望 7 题，实际 {len(qs)}")
    if stages.count(0) != 1: hard.append(f"clip {clip_idx}: Stage 0 题数 != 1 (实际 {stages.count(0)})")
    if stages.count(1) != 1: hard.append(f"clip {clip_idx}: Stage 1 题数 != 1 (实际 {stages.count(1)})")
    if stages.count(2) != 2: hard.append(f"clip {clip_idx}: Stage 2 题数 != 2 (实际 {stages.count(2)})")
    if stages.count(3) != 3: hard.append(f"clip {clip_idx}: Stage 3 题数 != 3 (实际 {stages.count(3)})")

    has_p1_in_stage3 = False

    for i, q in enumerate(qs):
        stage = q.get("stage")
        if not isinstance(q.get("options"), list) or len(q["options"]) != 3:
            hard.append(f"clip {clip_idx} Q#{i} (stage={stage}): options 不是 3 个")
        if q.get("answer") not in [0, 1, 2]:
            hard.append(f"clip {clip_idx} Q#{i}: answer 不在 0-2")
        if stage == 0:
            if "explanation" in q:
                soft.append(f"clip {clip_idx} Q#{i}: Stage 0 不应有 explanation")
            continue
        # Stage 2/3: reject meta-questions and NOT-mentioned reversals
        if stage in (2, 3):
            q_raw = q.get("question") or ""
            qtext_upper = q_raw.upper()
            # NOT-mentioned reversals
            not_mentioned_markers = [
                "NOT MENTIONED", "NOT MENTION", "NOT MENTIONE",
                "未提到", "没有提到", "未出现", "没提到"
            ]
            if any(m in qtext_upper if m.isupper() else m in q_raw for m in not_mentioned_markers):
                hard.append(f"clip {clip_idx} Q#{i} (stage={stage}): 禁止 'NOT mentioned' 反题 (题干: {q_raw[:60]})")
            # Meta-question markers (问词源 / 问干扰项本身 / 问音近词本身)
            meta_markers_zh = [
                "音近词", "同音词", "干扰项", "混淆", "发音相近", "哪个词是",
                "哪个选项是", "哪一项是"
            ]
            meta_markers_en_lower = [
                "sounds like", "sounds similar to", "similar in sound",
                "rhymes with", "rhyme with", "same pronunciation",
                "which word is similar", "which word sounds",
                "which is a distractor", "homophone of"
            ]
            q_lower = q_raw.lower()
            hit_meta = False
            for m in meta_markers_zh:
                if m in q_raw: hit_meta = True; break
            if not hit_meta:
                for m in meta_markers_en_lower:
                    if m in q_lower: hit_meta = True; break
            if hit_meta:
                hard.append(f"clip {clip_idx} Q#{i} (stage={stage}): 题目疑似元问题（考词源/音近/干扰项本身），违反硬约束 6 (题干: {q_raw[:80]})")

        ex = q.get("explanation")
        if not ex:
            hard.append(f"clip {clip_idx} Q#{i}: 缺 explanation")
            continue
        for key in ("source", "why_correct", "why_wrong"):
            if key not in ex:
                hard.append(f"clip {clip_idx} Q#{i}: explanation 缺 {key}")
        ww = ex.get("why_wrong", [])
        if not isinstance(ww, list) or len(ww) != 2:
            hard.append(f"clip {clip_idx} Q#{i}: why_wrong 应有 2 条 (实际 {len(ww) if isinstance(ww,list) else '非数组'})")
            continue
        dtypes_in_q = []
        for j, w in enumerate(ww or []):
            if not isinstance(w, dict):
                hard.append(f"clip {clip_idx} Q#{i} why_wrong[{j}]: 不是对象"); continue
            if w.get("option_idx") == q.get("answer"):
                hard.append(f"clip {clip_idx} Q#{i} why_wrong[{j}]: option_idx 指向正确答案")
            dt = w.get("distractor_type")
            if dt not in {"P1","P2","P3","P4","P5","P6","P7"}:
                hard.append(f"clip {clip_idx} Q#{i} why_wrong[{j}]: distractor_type 非法 ({dt})")
            dtypes_in_q.append(dt)
            if stage == 3 and dt == "P1":
                has_p1_in_stage3 = True
        # Hard: distinct types within question
        if len(dtypes_in_q) == 2 and dtypes_in_q[0] == dtypes_in_q[1] and dtypes_in_q[0] is not None:
            hard.append(f"clip {clip_idx} Q#{i} (stage={stage}): 2 个干扰项同属 {dtypes_in_q[0]}（需分属不同 type）")

    if not has_p1_in_stage3:
        hard.append(f"clip {clip_idx}: Stage 3 没有任何题包含 P1 干扰项")

    return hard, soft


def write_audit_md(all_qsets, warns):
    AUDIT_MD.parent.mkdir(parents=True, exist_ok=True)
    lines = ["# Questions v2 · GPT 生成审阅表", ""]
    lines.append(f"生成时间: {time.strftime('%Y-%m-%d %H:%M:%S')}")
    lines.append("")
    if warns:
        lines.append("## ⚠️ Schema 校验警告")
        for w in warns: lines.append(f"- {w}")
        lines.append("")

    # Distractor type tally
    dtally = {k: 0 for k in ["P1","P2","P3","P4","P5","P6","P7"]}
    total = 0
    deviated = 0
    for qset in all_qsets:
        for q in qset.get("questions", []):
            if q.get("stage") == 0: continue
            if q.get("stage_type_fit") == "deviated":
                deviated += 1
            for ww in (q.get("explanation", {}).get("why_wrong") or []):
                dt = ww.get("distractor_type")
                if dt in dtally:
                    dtally[dt] += 1
                    total += 1
    lines.append("## Distractor type 分布（全量）")
    for k, v in dtally.items():
        pct = f"{v*100/total:.1f}%" if total else "—"
        lines.append(f"- {k}: {v} ({pct})")
    lines.append(f"- 总数: {total}")
    lines.append(f"- stage_type_fit=deviated 的题目数: {deviated} / {sum(len(q.get('questions',[])) for q in all_qsets)}")
    lines.append("")

    recommended = {1: {"P3","P7"}, 2: {"P2","P4","P5"}, 3: {"P1","P4","P6"}}

    for qset in all_qsets:
        ci = qset.get("clip_idx", "?")
        lines.append(f"## Clip {ci+1 if isinstance(ci,int) else ci} · {qset.get('content_type','?')}")
        for i, q in enumerate(qset.get("questions", [])):
            stage = q.get("stage")
            lines.append(f"### Stage {stage} · Q#{i}")
            lines.append(f"**题目**: {q.get('question','')}")
            for j, o in enumerate(q.get("options", [])):
                mark = " ✅" if j == q.get("answer") else ""
                lines.append(f"- [{j}] {o}{mark}")
            if stage != 0:
                fit = q.get("stage_type_fit", "matched")
                lines.append(f"- fit: **{fit}**")
                ex = q.get("explanation", {})
                lines.append(f"- source: _{ex.get('source','—')}_")
                lines.append(f"- why_correct: {ex.get('why_correct','—')}")
                for ww in (ex.get("why_wrong") or []):
                    dt = ww.get("distractor_type","?")
                    rec_mark = "✓" if stage in recommended and dt in recommended[stage] else "⚠偏"
                    lines.append(f"  - [{ww.get('option_idx','?')}] **{dt}** {rec_mark}: {ww.get('reason','')}")
            lines.append("")
    AUDIT_MD.write_text("\n".join(lines))
    print(f"[ok] audit → {AUDIT_MD}")


MAX_RETRIES_PER_CLIP = 2


def generate_clip(clip, clip_type_zh, idx):
    """Generate + validate one clip. Retry up to MAX_RETRIES_PER_CLIP times on hard errors."""
    base_msgs = build_prompt(clip, clip_type_zh, idx)
    last_parsed = None
    last_hard = []
    last_soft = []
    for attempt in range(MAX_RETRIES_PER_CLIP + 1):
        msgs = list(base_msgs)
        if attempt > 0 and last_hard:
            retry_msg = "上一次生成违反了以下硬约束，请修正并重新生成。保持原题意但解决所有问题：\n- " + "\n- ".join(last_hard[:20])
            msgs.append({"role": "assistant", "content": "```json\n" + json.dumps(last_parsed, ensure_ascii=False)[:3000] + "\n```" if last_parsed else "(上次无有效 JSON 输出)"})
            msgs.append({"role": "user", "content": retry_msg})
            print(f"  [retry {attempt}] 带上次错误反馈重跑...")
        t0 = time.time()
        resp = call_gpt(msgs, temperature=0.4, max_tokens=5200)
        elapsed = time.time() - t0
        print(f"  attempt {attempt}: GPT 用时 {elapsed:.1f}s, resp len {len(resp) if resp else 0}")
        if not resp:
            last_hard = ["no response"]; continue
        parsed = parse_json_from_response(resp)
        if not parsed:
            debug_path = ROOT / "tmp" / f"raw-clip{idx}-try{attempt}.txt"
            debug_path.parent.mkdir(parents=True, exist_ok=True)
            debug_path.write_text(resp)
            print(f"    [parse fail] dump → {debug_path.name}")
            last_hard = ["JSON parse failed"]; continue
        hard, soft = validate_questions(parsed, idx)
        last_parsed = parsed; last_hard = hard; last_soft = soft
        if not hard:
            print(f"    ✓ 通过硬校验 ({len(soft)} soft warns)")
            return parsed, [], soft
        print(f"    ✗ {len(hard)} hard errors:")
        for h in hard[:6]: print(f"       - {h}")
    return last_parsed, last_hard, last_soft


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", help="逗号分隔的 clip 下标（0-based），仅重跑这些 clip", default=None)
    args = parser.parse_args()

    data = json.loads(DATA_PATH.read_text())
    clips = data["clips"]
    assert len(clips) == 3, f"expected 3 clips, got {len(clips)}"

    # 支持 --only：复用现有 JSON、只重生成指定 clip（保留其他 clip 已通过的题）
    existing = []
    if args.only and OUT_JSON.exists():
        try:
            existing = json.loads(OUT_JSON.read_text())
        except Exception:
            existing = []
    only_set = set(int(x) for x in args.only.split(",")) if args.only else None

    all_qsets = []
    all_hard = []
    all_soft = []
    for idx, clip in enumerate(clips):
        clip_type_zh = CLIP_TYPES[idx]
        if only_set is not None and idx not in only_set:
            # 保留上次的
            prev = next((q for q in existing if q.get("clip_idx") == idx), None)
            if prev:
                print(f"\n== Clip {idx+1} ({clip_type_zh}) — 跳过，保留上次 ==")
                all_qsets.append(prev)
                continue
            else:
                print(f"\n== Clip {idx+1} ({clip_type_zh}) — 上次无数据，跑一遍 ==")
        print(f"\n== Clip {idx+1} ({clip_type_zh}) ==")
        print(f"  title: {clip.get('title','?')[:40]}")
        print(f"  lines: {len(clip.get('lines',[]))}")
        parsed, hard, soft = generate_clip(clip, clip_type_zh, idx)
        if parsed:
            all_qsets.append(parsed)
        all_hard.extend([f"[clip {idx}] {e}" for e in hard])
        all_soft.extend([f"[clip {idx}] {e}" for e in soft])

    OUT_JSON.write_text(json.dumps(all_qsets, ensure_ascii=False, indent=2))
    print(f"\n[ok] {len(all_qsets)}/3 clips → {OUT_JSON}")
    write_audit_md(all_qsets, all_hard + all_soft)
    print(f"\nhard errors 剩余: {len(all_hard)}")
    print(f"soft warnings: {len(all_soft)}")


if __name__ == "__main__":
    main()
