#!/usr/bin/env python3
"""
本地测试脚本 — 模拟 /api/rank endpoint 的逻辑。
直接调 Azure GPT，不需要 Cloudflare 环境。

用法:
  python3 test_rank_api.py                    # 默认 B1 用户
  python3 test_rank_api.py --level B2 --interests tech science
  python3 test_rank_api.py --level A2 --listened 0 1 2 --skipped 3
"""

import argparse
import json
import os
import subprocess
import sys

AZURE_ENDPOINT = os.environ.get("AZURE_ENDPOINT", "https://us-east-02-gpt-01.openai.azure.com")
AZURE_API_KEY = os.environ["AZURE_API_KEY"]
GPT_DEPLOYMENT = "gpt-5.4-global-01"
GPT_API_VERSION = "2024-10-21"

CLIP_META = [
    {"id": 0, "title": "穿着巧克力衬衫的70岁老人", "tag": "business", "source": "Planet Money", "duration": 85, "difficulty": "easy"},
    {"id": 1, "title": "她用鼻子诊断了一种病", "tag": "science", "source": "TED Talks Daily", "duration": 72, "difficulty": "easy"},
    {"id": 2, "title": "第一支烟和最后一支烟", "tag": "story", "source": "The Moth", "duration": 76, "difficulty": "easy"},
    {"id": 3, "title": "被债务淹没的体面人生", "tag": "psychology", "source": "Hidden Brain", "duration": 89, "difficulty": "medium"},
    {"id": 4, "title": "他咬了一口，吐了出来", "tag": "science", "source": "Planet Money", "duration": 90, "difficulty": "easy"},
    {"id": 5, "title": "1928年奥运会，女性第一次站上跑道", "tag": "history", "source": "NPR", "duration": 64, "difficulty": "easy"},
    {"id": 6, "title": "波本酒局内幕", "tag": "business", "source": "Freakonomics Radio", "duration": 81, "difficulty": "easy"},
    {"id": 7, "title": "11岁那年的嫉妒", "tag": "story", "source": "This American Life", "duration": 96, "difficulty": "easy"},
    {"id": 8, "title": "波本为何非等不可？", "tag": "business", "source": "Freakonomics Radio", "duration": 93, "difficulty": "medium"},
    {"id": 9, "title": "内容到底怎样才能真正带来收入？", "tag": "business", "source": "Business Storytelling", "duration": 89, "difficulty": "easy"},
    {"id": 10, "title": "AI写内容为什么总像废话？", "tag": "tech", "source": "Business Storytelling", "duration": 115, "difficulty": "medium"},
    {"id": 11, "title": "100年前的怀表变成今天的美国制造腕表", "tag": "business", "source": "Business Storytelling", "duration": 87, "difficulty": "medium"},
    {"id": 12, "title": "没人要的老怀表，为什么成了他们的宝藏？", "tag": "story", "source": "Business Storytelling", "duration": 106, "difficulty": "easy"},
    {"id": 13, "title": "一个新SDK，为什么让他觉得工作方式被彻底改变？", "tag": "tech", "source": "Startup Stories", "duration": 91, "difficulty": "medium"},
    {"id": 14, "title": "检察官为什么和黑帮头目一起吃早餐？", "tag": "history", "source": "History That Doesn't Suck", "duration": 101, "difficulty": "hard"},
    {"id": 15, "title": "新抗生素上市了，公司却还是失败了？", "tag": "story", "source": "BBC Discovery", "duration": 54, "difficulty": "medium"},
    {"id": 16, "title": "美军'靴子落地'伊朗？", "tag": "society", "source": "Stuff They Don't Want You To Know", "duration": 95, "difficulty": "medium"},
    {"id": 17, "title": "你最爱的怪物，竟引出炼金术真相？", "tag": "culture", "source": "Stuff They Don't Want You To Know", "duration": 96, "difficulty": "medium"},
    {"id": 18, "title": "大型强子对撞机，真的把铅变成了金？", "tag": "science", "source": "Stuff They Don't Want You To Know", "duration": 85, "difficulty": "medium"},
    {"id": 19, "title": "一口气听懂本周最重要的AI大新闻", "tag": "tech", "source": "The AI Podcast", "duration": 73, "difficulty": "medium"},
    {"id": 20, "title": "Google这次开源，为什么可能改变AI格局？", "tag": "tech", "source": "The AI Podcast", "duration": 102, "difficulty": "hard"},
    {"id": 21, "title": "强到不能公开？这个AI先被拿去找漏洞", "tag": "tech", "source": "The AI Podcast", "duration": 65, "difficulty": "medium"},
]


def build_prompt(profile):
    available = [c for c in CLIP_META if c["id"] not in (profile.get("listened") or [])]
    clips_text = "\n".join(
        f'  [{c["id"]}] "{c["title"]}" | {c["tag"]} | {c["source"]} | {c["duration"]}s | {c["difficulty"]}'
        for c in available
    )

    return f"""You are the recommendation engine for an AI-native English listening app. Your job is to rank podcast clips for this specific user.

USER PROFILE:
- CEFR level: {profile.get("level", "B1")}
- Interests: {", ".join(profile.get("interests") or []) or "not specified"}
- Clips already listened: {len(profile.get("listened") or [])} clips
- Clips skipped: {json.dumps(profile.get("skipped") or [])}
- Words clicked (looked up): {json.dumps(profile.get("vocab_clicked") or [])}
- Session duration so far: {profile.get("session_duration", 0)}s

AVAILABLE CLIPS:
{clips_text}

RANKING RULES:
1. Prioritize clips matching user interests, but mix in 1-2 clips from other topics every 5 clips to expand their horizons.
2. Match difficulty to CEFR level: A1-A2 → easy, B1 → easy/medium, B2 → medium/hard, C1-C2 → hard.
3. If user skipped clips of a certain topic, reduce that topic's priority.
4. If user clicked many words, they might be struggling — lean toward easier clips.
5. Vary sources — don't serve 3 clips from the same podcast in a row.
6. Keep the first 1-2 clips engaging and accessible to hook the user.

Return a JSON array of objects, each with:
- "id": clip id (number)
- "reason": one sentence in Chinese explaining why this clip is recommended for this user (keep it natural and concise, like "难度适中，换个科学话题放松一下")

Return ONLY the JSON array, no markdown, no explanation. Order from most recommended to least."""


def call_gpt(prompt):
    """Call Azure GPT via curl (same pattern as podcast_agent.py)."""
    url = (f"{AZURE_ENDPOINT}/openai/deployments/{GPT_DEPLOYMENT}"
           f"/chat/completions?api-version={GPT_API_VERSION}")

    body = json.dumps({
        "messages": [{"role": "user", "content": prompt}],
        "max_completion_tokens": 2000,
        "temperature": 0.7,
    })

    result = subprocess.run(
        ["curl", "-s", "-X", "POST", url,
         "-H", "Content-Type: application/json",
         "-H", f"api-key: {AZURE_API_KEY}",
         "-d", body],
        capture_output=True, text=True, timeout=60
    )

    if result.returncode != 0:
        print(f"curl error: {result.stderr}", file=sys.stderr)
        sys.exit(1)

    resp = json.loads(result.stdout)
    if "error" in resp:
        print(f"API error: {json.dumps(resp['error'], indent=2)}", file=sys.stderr)
        sys.exit(1)

    return resp["choices"][0]["message"]["content"]


def main():
    parser = argparse.ArgumentParser(description="Test AI feed ranking")
    parser.add_argument("--level", default="B1", help="CEFR level (default: B1)")
    parser.add_argument("--interests", nargs="*", default=[], help="Interest tags")
    parser.add_argument("--listened", nargs="*", type=int, default=[], help="Already listened clip IDs")
    parser.add_argument("--skipped", nargs="*", type=int, default=[], help="Skipped clip IDs")
    parser.add_argument("--vocab", nargs="*", default=[], help="Words clicked/looked up")
    parser.add_argument("--duration", type=int, default=0, help="Session duration in seconds")
    args = parser.parse_args()

    profile = {
        "level": args.level,
        "interests": args.interests,
        "listened": args.listened,
        "skipped": args.skipped,
        "vocab_clicked": args.vocab,
        "session_duration": args.duration,
    }

    print(f"=== User Profile ===")
    print(f"  Level: {profile['level']}")
    print(f"  Interests: {profile['interests'] or '(none)'}")
    print(f"  Listened: {profile['listened'] or '(none)'}")
    print(f"  Skipped: {profile['skipped'] or '(none)'}")
    print(f"  Vocab clicked: {profile['vocab_clicked'] or '(none)'}")
    print()

    prompt = build_prompt(profile)
    print(f"Calling Azure GPT ({GPT_DEPLOYMENT})...")
    print()

    raw = call_gpt(prompt)

    # Parse
    try:
        feed = json.loads(raw)
    except json.JSONDecodeError:
        import re
        match = re.search(r'\[[\s\S]*\]', raw)
        if match:
            feed = json.loads(match.group())
        else:
            print(f"Failed to parse GPT response:\n{raw}")
            sys.exit(1)

    print(f"=== Recommended Feed ({len(feed)} clips) ===")
    print()
    for i, item in enumerate(feed):
        clip = next((c for c in CLIP_META if c["id"] == item["id"]), None)
        if clip:
            print(f"  {i+1}. [{clip['tag']}] {clip['title']}")
            print(f"     {item['reason']}")
            print()
        else:
            print(f"  {i+1}. [unknown id={item['id']}] {item.get('reason','')}")
            print()


if __name__ == "__main__":
    main()
