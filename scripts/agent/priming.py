"""Priming generation: picks 2-3 high-difficulty content words per clip and
batch-translates them. Output goes into `clip.priming` and is consumed by the
listen Tab to render a pre-listen visual cue (Task G).

Used by:
- scripts/agent/pipeline.py — runs after CEFR annotation step for new clips
- tools/backfill_priming.py — re-runs over data.json for migrations / prompt
  iteration

Why a shared module: priming criteria are purely educational metadata (same
domain as CEFR), so the algorithm lives next to cefr.py rather than as a
standalone tool. The `tools/backfill_priming.py` orchestrator imports from
here so logic stays single-source.
"""

from __future__ import annotations

import json
import os
import re
import time
from collections import OrderedDict

from .utils import log, call_gpt, strip_markdown_fences

PRIMING_VERSION = "v1.2"
PRIMING_MAX_WORDS = 3
PRIMING_MIN_WORDS = 2
PRIMING_ALLOWED_POS = {"NOUN", "PROPN", "VERB", "ADJ", "ADV"}

# CEFR rank map — priming target level is derived from user level
# (>= user_rank + 1, with a hard A1/A2 exclusion regardless of user level).
_CEFR_RANK = {"A1": 0, "A2": 1, "B1": 2, "B2": 3, "C1": 4, "C2": 5}


def priming_target_levels(user_cefr: str = "B1") -> set[str]:
    """Levels eligible to be picked as priming words for a given user.
    Per B36/B11 fix: "at least one level above the user" and never A1/A2.
    B1 user → {B2, C1, C2}; B2 user → {C1, C2}; C1+ user → {C2}.
    Floor at A2 user means {B1, B2, C1, C2}.
    """
    rank = _CEFR_RANK.get((user_cefr or "").upper(), _CEFR_RANK["B1"])
    return {lvl for lvl, r in _CEFR_RANK.items() if r >= rank + 1 and lvl not in ("A1", "A2")}

# spaCy-loaded once. CLAUDE.md: install via
#   pip install --break-system-packages spacy
#   python3 -m spacy download en_core_web_sm
_SPACY_NLP = None
_SPACY_LOAD_ERROR = None
def _ensure_spacy():
    global _SPACY_NLP, _SPACY_LOAD_ERROR
    if _SPACY_NLP is not None or _SPACY_LOAD_ERROR is not None:
        return _SPACY_NLP
    try:
        import spacy  # type: ignore
        _SPACY_NLP = spacy.load("en_core_web_sm", disable=["ner", "parser"])
        log(f"spaCy en_core_web_sm 已加载 (priming v{PRIMING_VERSION})", "ok")
    except Exception as e:
        _SPACY_LOAD_ERROR = str(e)
        log(f"spaCy 加载失败: {e}", "error")
    return _SPACY_NLP


# Conversational filler / function words that slip past POS filters.
STOPWORDS = {
    "i", "you", "he", "she", "it", "we", "they", "me", "him", "her", "us", "them",
    "my", "your", "his", "its", "our", "their", "this", "that", "these", "those",
    "a", "an", "the", "and", "or", "but", "if", "so", "as", "of", "in", "on", "at",
    "to", "for", "with", "from", "by", "about", "into", "out", "up", "down", "over",
    "under", "between", "through", "during", "without", "around", "against", "along",
    "across", "behind", "below", "above", "near", "off", "be", "do", "have",
    "will", "would", "shall", "should", "can", "could", "may", "might", "must",
    "not", "no", "yes", "okay", "ok", "alright", "well", "very", "much", "just", "like",
    "yeah", "yep", "uh", "um", "hmm", "oh", "ah", "hey", "right", "really",
    "more", "most", "less", "few", "many", "some", "any", "all", "each", "every",
    "here", "there", "now", "then", "today", "tomorrow", "yesterday",
}

# CEFR-J quirk patch: high-frequency content words that CEFR-J sometimes
# tags B2+ but are too common to function as a priming "key word teaser".
# Keep this priming-specific (NOT a CEFR override).
PRIMING_HIGH_FREQ_EXCLUDE = {
    "try", "time", "thing", "way", "year", "day", "week", "month",
    "people", "person", "man", "woman", "child", "kid", "guy", "girl", "boy",
    "house", "home", "place", "work", "job", "use", "find", "want", "look",
    "give", "take", "come", "see", "tell", "ask", "feel", "leave", "call",
    "show", "talk", "play", "run", "live", "happen", "think", "believe",
    "matter", "lot", "kind", "type", "part", "go", "get", "make", "say", "know",
    "long", "short", "high", "low", "old", "young", "good", "bad", "great",
    "real", "true", "wrong", "free", "full", "sure", "next", "last", "first",
    # B36/B11 QA fix 2026-04-17: CEFR-J tags these as B2+ but they're
    # domain-common enough that Chinese learners at B1 already know them
    # from tech UI / news headlines, so they don't earn a "teaser" slot.
    "scroll", "federal", "email", "online", "website", "digital", "mobile",
    "video", "app", "internet", "phone", "click", "button", "page", "user",
    "download", "upload", "update", "screen", "device", "browser",
}


def normalize_for_lookup(word: str) -> str:
    return re.sub(r"[^a-zA-Z']", "", word or "").lower()


def load_cefr_map(wordlist_path: str, overrides_path: str | None = None) -> dict:
    """Merge CEFR-J wordlist + Task C overrides (overrides win).
    Both args are file paths; missing overrides_path is tolerated.
    """
    with open(wordlist_path, "r", encoding="utf-8") as f:
        wl = json.load(f)
    if overrides_path and os.path.exists(overrides_path):
        try:
            with open(overrides_path, "r", encoding="utf-8") as f:
                ov_raw = (json.load(f).get("overrides") or {})
            for k, v in ov_raw.items():
                key = normalize_for_lookup(k)
                if key and v in {"A1", "A2", "B1", "B2", "C1", "C2"}:
                    wl[key] = v
        except Exception as e:
            log(f"priming overrides 加载失败 ({overrides_path}): {e}", "warn")
    return wl


def _translate_words(items: list[dict]) -> dict[str, str]:
    """items: [{word, sentence}]. Returns {word: zh}.
    Goes through call_gpt (curl-subprocess Azure GPT, CLAUDE.md compliant).
    Sentence context disambiguates polysemous words (bank=银行 vs 河岸).
    """
    if not items:
        return {}
    payload = [{"idx": i, "word": w["word"], "ctx": (w.get("sentence") or "")[:120]}
               for i, w in enumerate(items)]
    prompt = (
        f"为下面 {len(payload)} 个英文单词在给定上下文中提供精炼中文释义。\n"
        f"要求：每个释义 2-8 个汉字，不要解释、不要拼音、不要例句；"
        f"如果有多个义项，挑上下文里实际使用的那个义项。\n\n"
        f"返回纯 JSON 数组，每个元素 {{idx, zh}}，按原顺序，no markdown：\n"
        f"{json.dumps(payload, ensure_ascii=False)}"
    )
    raw = call_gpt([{"role": "user", "content": prompt}], temperature=0.2, max_tokens=800)
    out = {w["word"]: "" for w in items}
    if not raw:
        return out
    try:
        text = strip_markdown_fences(raw)
        parsed = json.loads(text)
        if isinstance(parsed, dict):
            for k in ("result", "data", "translations"):
                if isinstance(parsed.get(k), list):
                    parsed = parsed[k]
                    break
        if isinstance(parsed, list):
            for item in parsed:
                idx = item.get("idx")
                zh = (item.get("zh") or "").strip()
                if isinstance(idx, int) and 0 <= idx < len(items):
                    out[items[idx]["word"]] = zh
    except Exception as e:
        log(f"priming 翻译解析失败: {e}", "error")
    return out


def pick_priming_candidates(lines: list[dict], cefr_map: dict,
                             max_words: int = PRIMING_MAX_WORDS,
                             user_cefr: str = "B1") -> list[dict]:
    """spaCy POS+lemma in sentence context, then dedupe by lemma + sort by
    CEFR (highest first) and first appearance.

    Target-level set is derived from user_cefr via priming_target_levels().
    """
    nlp = _ensure_spacy()
    if nlp is None:
        raise RuntimeError(
            f"spaCy en_core_web_sm not available: {_SPACY_LOAD_ERROR}\n"
            "Install: pip install --break-system-packages spacy && "
            "python3 -m spacy download en_core_web_sm"
        )
    target_levels = priming_target_levels(user_cefr)
    lemma_map: "OrderedDict[str, dict]" = OrderedDict()
    sent_idx = 0
    for line in lines or []:
        sent = (line.get("en") or "").strip()
        if not sent:
            continue
        sent_idx += 1
        for tok in nlp(sent):
            if tok.is_space or tok.is_punct:
                continue
            if tok.pos_ not in PRIMING_ALLOWED_POS:
                continue
            lemma = (tok.lemma_ or tok.text).lower().strip()
            if not lemma or len(lemma) < 3:
                continue
            if lemma in STOPWORDS or lemma in PRIMING_HIGH_FREQ_EXCLUDE:
                continue
            surface_clean = normalize_for_lookup(tok.text)
            # Also reject the surface form via the exclusion set — "scrolling"
            # lemmatizes to "scroll" but "scrolls" might pass the lemma check
            # on some spaCy versions.
            if surface_clean in PRIMING_HIGH_FREQ_EXCLUDE:
                continue
            cefr_lemma = cefr_map.get(lemma)
            cefr_surface = cefr_map.get(surface_clean) if surface_clean else None
            cefr = cefr_lemma or cefr_surface
            # Hard A1/A2 exclusion (B36 fix): even if a B1+ user's target_levels
            # would allow it, A1/A2 never qualify as a "priming teaser".
            if cefr in ("A1", "A2"):
                continue
            if cefr not in target_levels:
                continue
            display = lemma if cefr_lemma else (surface_clean or lemma)
            if lemma not in lemma_map:
                lemma_map[lemma] = {
                    "word": display,
                    "lemma": lemma,
                    "cefr": cefr,
                    "pos": tok.pos_,
                    "first_idx": sent_idx,
                    "sentence": sent,
                }
            else:
                cur = _CEFR_RANK.get(lemma_map[lemma]["cefr"], 0)
                new = _CEFR_RANK.get(cefr, 0)
                if new > cur:
                    lemma_map[lemma]["cefr"] = cefr

    # Sort highest CEFR first, then by first appearance.
    return sorted(
        lemma_map.values(),
        key=lambda w: (-_CEFR_RANK.get(w["cefr"], 0), w["first_idx"])
    )[:max_words]


def generate_priming(lines: list[dict], cefr_map: dict,
                     *, max_words: int = PRIMING_MAX_WORDS,
                     user_cefr: str = "B1",
                     dry_run: bool = False) -> dict | None:
    """Public entry point. Returns priming dict or None if not enough
    qualifying B2+ content words exist.

    Args:
        lines: clip lines (each must have 'en' field; word-level data not used)
        cefr_map: merged CEFR-J + overrides {word_lower: level}
        max_words: cap on priming words (default 3)
        dry_run: skip Azure translation, fill placeholders (for selection
                 preview without API cost)
    """
    picked = pick_priming_candidates(lines, cefr_map, max_words=max_words, user_cefr=user_cefr)
    if len(picked) < PRIMING_MIN_WORDS:
        return None
    if dry_run:
        translated = {p["word"]: f"[dry-run]{p['word']}" for p in picked}
    else:
        translated = _translate_words(
            [{"word": p["word"], "sentence": p["sentence"]} for p in picked]
        )
    return {
        "words": [{"word": p["word"], "zh": translated.get(p["word"], ""), "cefr": p["cefr"]}
                  for p in picked],
        "version": PRIMING_VERSION,
        "generatedAt": int(time.time() * 1000),
    }
