#!/usr/bin/env python3
"""Re-tag CEFR levels on all existing clips in data.json.

修复逻辑（按优先级）：
  1. cefr_overrides.json （Flipod 内部手工 override，修 CEFR-J 高估）
  2. cefr_wordlist.json 查表 (CEFR-J + Octanove)
  3. hardcoded 补丁表（~200 高频基础词，强制覆盖 LLM 错标）
  4. 专有名词检测（句中大写开头 + 不在词表/补丁表 → "PN"）
  5. 剩余未命中 → null

用法:
    python3 tools/retag_cefr_all_clips.py
    python3 tools/retag_cefr_all_clips.py --dry-run
    python3 tools/retag_cefr_all_clips.py --data data.json --wordlist scripts/cefr_wordlist.json
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
from collections import Counter
from datetime import datetime
from pathlib import Path

VALID_LEVELS = {"A1", "A2", "B1", "B2", "C1", "C2", "PN"}

# ── Hardcoded 补丁表 ──
# 覆盖高频基础词，防止 LLM fallback 标错
# 来源：Oxford 3000 A1-A2 核心 + 常见英语功能词
PATCH_TABLE: dict[str, str] = {}

_A1_WORDS = [
    # 代词
    "i", "you", "he", "she", "it", "we", "they",
    "me", "him", "her", "us", "them",
    "my", "your", "his", "its", "our", "their",
    "mine", "yours", "hers", "ours", "theirs",
    "myself", "yourself", "himself", "herself", "itself", "ourselves", "themselves",
    "this", "that", "these", "those",
    "who", "what", "which", "where", "when", "how", "why",
    "someone", "something", "somewhere", "anyone", "anything", "anywhere",
    "everyone", "everything", "everywhere", "nobody", "nothing", "nowhere",
    # 冠词 / 限定词
    "a", "an", "the", "some", "any", "no", "every", "each", "all", "both",
    "much", "many", "more", "most", "few", "little", "several", "enough",
    "other", "another",
    # 连词
    "and", "but", "or", "so", "if", "when", "because", "before", "after",
    "while", "until", "since", "than", "as", "that",
    # 介词
    "in", "on", "at", "to", "for", "with", "from", "by", "about", "of",
    "into", "out", "up", "down", "over", "under", "between", "through",
    "during", "without", "around", "against", "along", "across", "behind",
    "below", "above", "near", "off",
    # 助动词 / 情态
    "be", "am", "is", "are", "was", "were", "been", "being",
    "do", "does", "did", "done", "doing",
    "have", "has", "had", "having",
    "will", "would", "shall", "should", "can", "could", "may", "might", "must",
    # 缩写形式
    "it's", "don't", "didn't", "doesn't", "isn't", "aren't", "wasn't", "weren't",
    "won't", "wouldn't", "can't", "couldn't", "shouldn't", "haven't", "hasn't",
    "hadn't", "i'm", "i've", "i'll", "i'd",
    "you're", "you've", "you'll", "you'd",
    "he's", "he'll", "he'd", "she's", "she'll", "she'd",
    "it'll", "it'd",
    "we're", "we've", "we'll", "we'd",
    "they're", "they've", "they'll", "they'd",
    "there's", "there're",
    "that's", "what's", "who's", "here's", "let's",
    # 高频动词
    "go", "goes", "went", "gone", "going",
    "come", "comes", "came", "coming",
    "get", "gets", "got", "gotten", "getting",
    "make", "makes", "made", "making",
    "take", "takes", "took", "taken", "taking",
    "give", "gives", "gave", "given", "giving",
    "know", "knows", "knew", "known", "knowing",
    "think", "thinks", "thought", "thinking",
    "see", "sees", "saw", "seen", "seeing",
    "say", "says", "said", "saying",
    "tell", "tells", "told", "telling",
    "find", "finds", "found", "finding",
    "put", "puts", "putting",
    "use", "uses", "used", "using",
    "want", "wants", "wanted", "wanting",
    "look", "looks", "looked", "looking",
    "call", "calls", "called", "calling",
    "try", "tries", "tried", "trying",
    "ask", "asks", "asked", "asking",
    "need", "needs", "needed", "needing",
    "feel", "feels", "felt", "feeling",
    "leave", "leaves", "left", "leaving",
    "keep", "keeps", "kept", "keeping",
    "let", "lets", "letting",
    "begin", "begins", "began", "begun", "beginning",
    "start", "starts", "started", "starting",
    "show", "shows", "showed", "shown", "showing",
    "hear", "hears", "heard", "hearing",
    "play", "plays", "played", "playing",
    "run", "runs", "ran", "running",
    "move", "moves", "moved", "moving",
    "live", "lives", "lived", "living",
    "believe", "believes", "believed",
    "bring", "brings", "brought", "bringing",
    "happen", "happens", "happened", "happening",
    "write", "writes", "wrote", "written", "writing",
    "sit", "sits", "sat", "sitting",
    "stand", "stands", "stood", "standing",
    "lose", "loses", "lost", "losing",
    "pay", "pays", "paid", "paying",
    "meet", "meets", "met", "meeting",
    "include", "includes", "included", "including",
    "set", "sets", "setting",
    "learn", "learns", "learned", "learning",
    "change", "changes", "changed", "changing",
    "lead", "leads", "led", "leading",
    "understand", "understands", "understood",
    "watch", "watches", "watched", "watching",
    "follow", "follows", "followed", "following",
    "stop", "stops", "stopped", "stopping",
    "speak", "speaks", "spoke", "spoken", "speaking",
    "read", "reads", "reading",
    "spend", "spends", "spent", "spending",
    "grow", "grows", "grew", "grown", "growing",
    "open", "opens", "opened", "opening",
    "walk", "walks", "walked", "walking",
    "win", "wins", "won", "winning",
    "teach", "teaches", "taught", "teaching",
    "buy", "buys", "bought", "buying",
    "send", "sends", "sent", "sending",
    "fall", "falls", "fell", "fallen", "falling",
    "cut", "cuts", "cutting",
    "reach", "reaches", "reached",
    "build", "builds", "built", "building",
    "hold", "holds", "held", "holding",
    "eat", "eats", "ate", "eaten", "eating",
    "drink", "drinks", "drank", "drinking",
    "sleep", "sleeps", "slept", "sleeping",
    "die", "dies", "died", "dying",
    "kill", "kills", "killed", "killing",
    "talk", "talks", "talked", "talking",
    "sing", "sings", "sang", "singing",
    "sell", "sells", "sold", "selling",
    "wait", "waits", "waited", "waiting",
    "help", "helps", "helped", "helping",
    "love", "loves", "loved", "loving",
    "like", "likes", "liked", "liking",
    "work", "works", "worked", "working",
    # 高频名词
    "man", "men", "woman", "women", "child", "children",
    "people", "person", "thing", "things",
    "time", "times", "year", "years", "day", "days",
    "way", "ways", "world", "life", "hand", "hands",
    "part", "parts", "place", "places", "case", "cases",
    "week", "weeks", "month", "months",
    "point", "company", "number", "group",
    "problem", "fact", "money", "house", "home",
    "water", "room", "mother", "father", "family",
    "country", "school", "student", "students",
    "eye", "eyes", "head", "face", "side",
    "night", "morning", "name", "city", "story",
    "word", "words", "food", "door", "car",
    "book", "question", "answer", "game", "idea",
    "end", "line", "friend", "job", "body",
    "hour", "hours", "minute", "minutes", "second", "seconds",
    "age", "air", "area", "art",
    "baby", "back", "bed", "bit", "boy", "girl",
    "brother", "sister", "son", "daughter",
    "business", "class", "color", "course",
    "dog", "cat", "fish", "bird",
    "music", "party", "phone", "picture",
    "power", "price", "reason", "rest",
    "road", "street", "star", "sun", "moon",
    "table", "top", "tree", "war",
    # 高频形容词
    "good", "bad", "great", "big", "small", "little",
    "long", "short", "high", "low",
    "old", "young", "new", "first", "last", "next",
    "right", "wrong", "left",
    "important", "different", "same",
    "large", "early", "late", "hard", "easy",
    "best", "better", "worst", "worse",
    "real", "true", "free", "full", "sure",
    "happy", "nice", "pretty",
    "white", "black", "red", "blue", "green",
    "able", "possible", "whole", "own", "only",
    "certain", "clear", "close", "common",
    "dead", "deep", "dark", "far",
    "final", "fine", "heavy", "hot", "cold",
    "human", "kind", "light", "local",
    "main", "major", "natural", "open", "past",
    "poor", "public", "ready", "simple",
    "single", "special", "strong", "wide",
    # 高频副词
    "not", "also", "very", "often", "just",
    "here", "there", "now", "then", "always", "never",
    "too", "really", "already", "still", "again",
    "maybe", "almost", "ever", "quite", "yet",
    "soon", "today", "together", "away",
    "well", "back", "even", "only", "also",
    "probably", "actually", "exactly", "especially",
    # 其他功能词
    "yes", "no", "not", "very", "much", "just",
    "like", "well", "also", "right", "still",
    "please", "thank", "thanks", "sorry", "okay", "ok",
    "mr", "mrs", "ms",
    "percent", "million", "billion", "hundred", "thousand",
    "zero", "one", "two", "three", "four", "five",
    "six", "seven", "eight", "nine", "ten",
    "eleven", "twelve", "twenty", "thirty", "forty", "fifty",
    "sixty", "seventy", "eighty", "ninety",
]

_A2_WORDS = [
    # 连词 / 副词
    "although", "however", "therefore", "unless", "whether",
    "instead", "besides", "otherwise", "furthermore", "moreover",
    "meanwhile", "nevertheless", "nonetheless",
    "wherever", "whenever", "whatever", "whoever",
    # 常见动词（比 A1 稍难但仍基础）
    "allow", "allows", "allowed", "allowing",
    "appear", "appears", "appeared", "appearing",
    "apply", "applies", "applied", "applying",
    "avoid", "avoids", "avoided", "avoiding",
    "consider", "considers", "considered", "considering",
    "continue", "continues", "continued", "continuing",
    "create", "creates", "created", "creating",
    "decide", "decides", "decided", "deciding",
    "describe", "describes", "described", "describing",
    "develop", "develops", "developed", "developing",
    "discover", "discovers", "discovered", "discovering",
    "discuss", "discusses", "discussed", "discussing",
    "enjoy", "enjoys", "enjoyed", "enjoying",
    "expect", "expects", "expected", "expecting",
    "explain", "explains", "explained", "explaining",
    "express", "expresses", "expressed", "expressing",
    "imagine", "imagines", "imagined", "imagining",
    "improve", "improves", "improved", "improving",
    "increase", "increases", "increased", "increasing",
    "involve", "involves", "involved", "involving",
    "manage", "manages", "managed", "managing",
    "mention", "mentions", "mentioned", "mentioning",
    "offer", "offers", "offered", "offering",
    "prefer", "prefers", "preferred", "preferring",
    "prepare", "prepares", "prepared", "preparing",
    "produce", "produces", "produced", "producing",
    "protect", "protects", "protected", "protecting",
    "provide", "provides", "provided", "providing",
    "receive", "receives", "received", "receiving",
    "reduce", "reduces", "reduced", "reducing",
    "remain", "remains", "remained", "remaining",
    "remember", "remembers", "remembered", "remembering",
    "remove", "removes", "removed", "removing",
    "replace", "replaces", "replaced", "replacing",
    "report", "reports", "reported", "reporting",
    "require", "requires", "required", "requiring",
    "share", "shares", "shared", "sharing",
    "suggest", "suggests", "suggested", "suggesting",
    "support", "supports", "supported", "supporting",
    "suppose", "supposes", "supposed", "supposing",
    "wonder", "wonders", "wondered", "wondering",
    # 常见名词
    "attention", "experience", "government", "information",
    "interest", "market", "material", "matter",
    "member", "moment", "office", "opportunity",
    "period", "population", "position", "practice",
    "president", "process", "product", "program",
    "project", "quality", "relationship", "research",
    "result", "role", "rule", "science",
    "service", "society", "situation", "subject",
    "system", "technology", "test", "theory",
    "type", "value", "difference", "education",
    "energy", "environment", "example", "industry",
    "language", "level", "model", "network",
    "news", "paper", "performance", "plan",
    "police", "policy", "rate", "reality",
    "record", "region", "resource", "risk",
    "security", "series", "space", "stage",
    "standard", "structure", "team", "term",
    "trade", "training", "travel", "trouble",
    "truth", "voice", "nation", "century",
    "culture", "effort", "force", "future",
    "health", "history", "image", "issue",
    "machine", "movement", "nature", "opinion",
    "order", "pattern", "peace", "pressure",
    "profit", "property", "purpose", "scene",
    "section", "sense", "shape", "size",
    "skill", "software", "source", "speech",
    "step", "strategy", "success", "task",
    "tax", "total", "unit", "variety",
    "version", "weapon", "weight",
    # 形容词
    "available", "average", "basic", "brief",
    "cheap", "complete", "complex", "concerned",
    "correct", "current", "dangerous", "direct",
    "effective", "entire", "equal", "essential",
    "exact", "excellent", "extra", "fair",
    "familiar", "famous", "foreign", "former",
    "general", "global", "huge", "independent",
    "individual", "inside", "interesting", "international",
    "legal", "likely", "modern", "necessary",
    "negative", "normal", "obvious", "official",
    "original", "particular", "personal", "physical",
    "pleasant", "positive", "powerful", "present",
    "previous", "private", "professional", "proper",
    "public", "quiet", "recent", "regular",
    "responsible", "rich", "rough", "safe",
    "secret", "serious", "similar", "slow",
    "smooth", "soft", "solid", "standard",
    "strange", "sudden", "terrible", "thick",
    "thin", "tight", "tiny", "tough",
    "traditional", "typical", "unusual", "useful",
    "usual", "various", "wild", "wonderful",
]

for w in _A1_WORDS:
    PATCH_TABLE[w.lower()] = "A1"
for w in _A2_WORDS:
    # 不覆盖已设为 A1 的
    if w.lower() not in PATCH_TABLE:
        PATCH_TABLE[w.lower()] = "A2"


def normalize_word(raw: str) -> str:
    """跟 scripts/agent/cefr.py::get_cefr 一致的归一化。"""
    return re.sub(r"[^a-zA-Z']", "", raw).lower()


def load_overrides(overrides_path: Path) -> dict[str, str]:
    """加载 cefr_overrides.json。返回 {clean_word: level}。
    缺失文件时静默返回空 dict（向后兼容）。
    """
    if not overrides_path.exists():
        return {}
    try:
        data = json.load(open(overrides_path))
        raw = data.get("overrides", {}) or {}
        return {normalize_word(k): v for k, v in raw.items() if v in {"A1", "A2", "B1", "B2", "C1", "C2"}}
    except Exception as e:
        print(f"⚠️  overrides 加载失败 ({overrides_path}): {e}")
        return {}


def is_proper_noun(word: str, word_index: int, line_en: str) -> bool:
    """检测是否为专有名词。
    规则：词在原文中大写开头，且不是句首词。
    """
    if not word or not word[0].isupper():
        return False
    # 句首词不算（句首大写是语法规则）
    if word_index == 0:
        return False
    # 额外检查：在原句中找到该词的位置，确认它不是句首
    # （word_index == 0 已覆盖大多数情况）
    return True


def resolve_cefr(
    word_obj: dict,
    word_index: int,
    line_en: str,
    wordlist: dict[str, str],
    overrides: dict[str, str],
) -> tuple[str | None, str]:
    """返回 (cefr_level, source)。source 用于统计。"""
    raw = word_obj.get("word", "")
    clean = normalize_word(raw)

    if not clean:
        return None, "empty"

    # 纯数字词（70, 2023 等）→ null
    if not re.search(r"[a-zA-Z]", raw):
        return None, "number"

    # 1. overrides（最高优先级）
    ov_level = overrides.get(clean)
    if ov_level:
        return ov_level, "override"

    # 2. cefr_wordlist.json 查表
    wl_level = wordlist.get(clean)
    if wl_level and wl_level in {"A1", "A2", "B1", "B2", "C1", "C2"}:
        return wl_level, "wordlist"

    # 3. hardcoded 补丁表
    patch_level = PATCH_TABLE.get(clean)
    if patch_level:
        return patch_level, "patch"

    # 4. 专有名词检测
    if is_proper_noun(raw, word_index, line_en):
        return "PN", "proper_noun"

    # 5. 未命中 → null
    return None, "fallback_null"


def _infer_clip_difficulty(clip: dict) -> str:
    """复用 scripts/agent/cefr.py::infer_difficulty 的阈值算法。
    Returns one of: 'B1', 'B1+', 'B2', 'B2+', 'C1'.
    """
    counts = {"A1": 0, "A2": 0, "B1": 0, "B2": 0, "C1": 0, "C2": 0}
    total = 0
    for line in clip.get("lines", []):
        for w in line.get("words", []):
            level = w.get("cefr")
            if level in counts:
                counts[level] += 1
                total += 1
    if total == 0:
        return "B1+"
    pct_b2 = counts["B2"] / total * 100
    pct_c1_plus = (counts["C1"] + counts["C2"]) / total * 100
    pct_advanced = (counts["B2"] + counts["C1"] + counts["C2"]) / total * 100
    if pct_c1_plus >= 8:
        return "C1"
    if pct_c1_plus >= 4 or pct_b2 >= 30:
        return "B2+"
    if pct_c1_plus >= 2 or pct_b2 >= 20:
        return "B2"
    if pct_b2 >= 12 or pct_advanced >= 35:
        return "B1+"
    return "B1"


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--data", type=Path, default=Path("data.json"))
    ap.add_argument("--wordlist", type=Path, default=Path("scripts/cefr_wordlist.json"))
    ap.add_argument("--overrides", type=Path, default=Path("cefr_overrides.json"))
    ap.add_argument("--dry-run", action="store_true", help="只打印 diff,不改 data.json")
    ap.add_argument("--update-difficulty", action="store_true",
                    help="同时重算并写回 clip.difficulty。默认只更新词级 cefr，"
                         "因为现有 infer_difficulty 阈值算法可能与历史 difficulty "
                         "标注方式不同，整体左移容易引起误判。先看 dry-run 直方图再决定。")
    args = ap.parse_args()

    if not args.data.exists():
        raise SystemExit(f"找不到 {args.data}")
    if not args.wordlist.exists():
        raise SystemExit(f"找不到 {args.wordlist}")

    wordlist = json.load(open(args.wordlist))
    overrides = load_overrides(args.overrides)
    print(f"词表加载: {len(wordlist)} 词")
    print(f"Overrides 加载: {len(overrides)} 词 ({args.overrides})")
    print(f"补丁表: {len(PATCH_TABLE)} 词")

    data = json.load(open(args.data))
    clips = data.get("clips", data if isinstance(data, list) else [])
    print(f"data.json 加载: {len(clips)} 条 clip")

    # 统计
    total_words = 0
    source_counter = Counter()     # source -> count
    changed = Counter()            # (old_level, new_level) -> count
    patch_fixes = Counter()        # word -> count (被补丁表修正的词)
    override_fixes = Counter()     # word -> count (被 overrides 修正的词)
    pn_detected = Counter()        # word -> count (被标为 PN 的词)
    unchanged = 0

    # 难度直方图统计（用于 PR 描述）
    difficulty_before = Counter()
    difficulty_after = Counter()

    def _diff_label(d):
        if isinstance(d, dict):
            return d.get("level") or "unknown"
        return d or "unknown"

    for clip in clips:
        difficulty_before[_diff_label(clip.get("difficulty"))] += 1
        for line in clip.get("lines", []):
            line_en = line.get("en", "")
            words = line.get("words", [])
            for wi, w in enumerate(words):
                total_words += 1
                old_level = w.get("cefr")
                new_level, source = resolve_cefr(w, wi, line_en, wordlist, overrides)
                source_counter[source] += 1

                # 规范化 old_level
                if old_level not in VALID_LEVELS and old_level is not None:
                    old_level = None

                if old_level == new_level:
                    unchanged += 1
                else:
                    changed[(old_level, new_level)] += 1
                    if source == "patch" and old_level != new_level:
                        patch_fixes[normalize_word(w.get("word", ""))] += 1
                    if source == "override" and old_level != new_level:
                        override_fixes[normalize_word(w.get("word", ""))] += 1
                    if source == "proper_noun":
                        pn_detected[w.get("word", "")] += 1

                if not args.dry_run:
                    w["cefr"] = new_level

        # 重算 clip-level difficulty（保留原算法：基于词级 CEFR 分布）
        # 复用 scripts/agent/cefr.py::infer_difficulty 的阈值
        new_diff = _infer_clip_difficulty(clip)
        difficulty_after[new_diff] += 1
        if not args.dry_run and args.update_difficulty:
            old = clip.get("difficulty")
            if isinstance(old, dict):
                # 保留 dict 形态，仅更新 level 字段
                if old.get("level") != new_diff:
                    old["level"] = new_diff
            elif old != new_diff:
                clip["difficulty"] = new_diff

    total_changed = sum(changed.values())
    print(f"\nRetag 结果 ({'预览' if args.dry_run else '已应用'}):")
    print(f"  总词数: {total_words}")
    print(f"  未变动: {unchanged}")
    print(f"  变动: {total_changed} ({total_changed / total_words * 100:.1f}%)")

    print(f"\n来源统计:")
    for src, cnt in source_counter.most_common():
        print(f"  {src}: {cnt}")

    if changed:
        print(f"\n级别迁移 Top 15:")
        for (old, new), count in changed.most_common(15):
            print(f"  {old} -> {new}: {count}")

    if override_fixes:
        print(f"\nOverrides 修正 ({sum(override_fixes.values())} 次, {len(override_fixes)} 个词):")
        for word, cnt in override_fixes.most_common(60):
            print(f"  {word}: {cnt}")

    if patch_fixes:
        print(f"\n补丁表修正 ({sum(patch_fixes.values())} 次, {len(patch_fixes)} 个词):")
        for word, cnt in patch_fixes.most_common(30):
            print(f"  {word}: {cnt}")

    # Clip-level difficulty 直方图
    levels_order = ["B1", "B1+", "B2", "B2+", "C1", "unknown"]
    write_status = "已写回" if (not args.dry_run and args.update_difficulty) else "预览(未写回)"
    print(f"\nClip-level difficulty 直方图 (before → after, {write_status}):")
    print(f"  {'level':<10} {'before':>8} {'after':>8} {'delta':>8}")
    keys = sorted(set(list(difficulty_before.keys()) + list(difficulty_after.keys())),
                  key=lambda k: levels_order.index(k) if k in levels_order else 99)
    for k in keys:
        b = difficulty_before.get(k, 0)
        a = difficulty_after.get(k, 0)
        delta = a - b
        sign = "+" if delta > 0 else ""
        print(f"  {k:<10} {b:>8} {a:>8} {sign}{delta:>7}")

    if pn_detected:
        print(f"\n专有名词检测 ({sum(pn_detected.values())} 次, {len(pn_detected)} 个词):")
        for word, cnt in pn_detected.most_common(30):
            print(f"  {word}: {cnt}")

    if not args.dry_run:
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_dir = Path("output/backups")
        backup_dir.mkdir(parents=True, exist_ok=True)
        backup = backup_dir / f"{args.data.stem}.bak-{ts}{args.data.suffix}"
        shutil.copy2(args.data, backup)
        print(f"\n原文件已备份: {backup}")

        with open(args.data, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print(f"data.json 已更新")
    else:
        print(f"\ndry-run 模式,未写回 data.json。去掉 --dry-run 后正式执行。")


if __name__ == "__main__":
    main()
