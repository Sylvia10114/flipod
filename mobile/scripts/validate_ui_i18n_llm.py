#!/usr/bin/env python3
"""LLM-assisted QA for UI translations.

Reads mobile/src/i18n/ui-copy.json and asks Azure GPT to review each locale against English.
The goal is not to auto-rewrite translations, but to catch mistranslations, placeholder issues,
and tone/style mismatches before release.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
COPY_PATH = ROOT / "src" / "i18n" / "ui-copy.json"
REPORT_PATH = ROOT / "output" / "i18n-llm-report.json"

GPT_ENDPOINT = os.environ.get("AZURE_OPENAI_ENDPOINT")
GPT_API_KEY = os.environ.get("AZURE_OPENAI_API_KEY")
GPT_DEPLOYMENT = os.environ.get("AZURE_OPENAI_DEPLOYMENT", "gpt-5-chat-global-01")
GPT_API_VERSION = os.environ.get("AZURE_OPENAI_API_VERSION", "2025-01-01-preview")


def require_env() -> None:
    missing = []
    if not GPT_ENDPOINT:
        missing.append("AZURE_OPENAI_ENDPOINT")
    if not GPT_API_KEY:
        missing.append("AZURE_OPENAI_API_KEY")
    if missing:
        print("Missing env:", ", ".join(missing), file=sys.stderr)
        sys.exit(1)


def flatten(node: dict, prefix: str = "") -> dict[str, str]:
    out: dict[str, str] = {}
    for key, value in node.items():
        next_key = f"{prefix}.{key}" if prefix else key
        if isinstance(value, dict):
            out.update(flatten(value, next_key))
        else:
            out[next_key] = str(value)
    return out


def call_gpt(messages: list[dict]) -> str:
    url = (
        f"{GPT_ENDPOINT}/openai/deployments/{GPT_DEPLOYMENT}"
        f"/chat/completions?api-version={GPT_API_VERSION}"
    )
    payload = json.dumps({
        "messages": messages,
        "temperature": 0.1,
        "max_completion_tokens": 2500,
        "response_format": {"type": "json_object"},
    })
    result = subprocess.run(
        [
            "curl", "-s", "-X", "POST", url,
            "-H", f"api-key: {GPT_API_KEY}",
            "-H", "Content-Type: application/json",
            "-d", payload,
            "--connect-timeout", "15",
            "--max-time", "90",
        ],
        capture_output=True,
        text=True,
        timeout=100,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr[:200] or "curl failed")
    data = json.loads(result.stdout)
    if "error" in data:
        raise RuntimeError(data["error"].get("message", "unknown error"))
    return data["choices"][0]["message"]["content"]


def chunk_pairs(items: list[tuple[str, str, str]], size: int = 15) -> list[list[tuple[str, str, str]]]:
    return [items[index:index + size] for index in range(0, len(items), size)]


def main() -> int:
    require_env()
    payload = json.loads(COPY_PATH.read_text())
    english = flatten(payload["english"])
    locales = [locale for locale in payload.keys() if locale != "english"]
    report = {"summary": {}, "issues": []}

    for locale in locales:
        translated = flatten(payload[locale])
        pairs = [(key, english[key], translated.get(key, "")) for key in sorted(english.keys())]
        locale_issues = []
        for batch in chunk_pairs(pairs):
            prompt_rows = [
                {"key": key, "english": source, "translated": target}
                for key, source, target in batch
            ]
            messages = [
                {
                    "role": "system",
                    "content": (
                        "You review UI translations. Return strict JSON with an 'issues' array. "
                        "Only report concrete problems: mistranslation, missing nuance, awkward UI phrasing, "
                        "placeholder risk, or untranslated English. Keep severity one of info|warn|error."
                    ),
                },
                {
                    "role": "user",
                    "content": json.dumps({
                        "target_locale": locale,
                        "items": prompt_rows,
                        "output_schema": {
                            "issues": [
                                {
                                    "key": "string",
                                    "severity": "info|warn|error",
                                    "reason": "short explanation",
                                    "suggestion": "better translation"
                                }
                            ]
                        }
                    }, ensure_ascii=False),
                },
            ]
            try:
                response = json.loads(call_gpt(messages))
            except Exception as exc:
                locale_issues.append({
                    "key": "*batch*",
                    "severity": "error",
                    "reason": f"validation_failed: {exc}",
                    "suggestion": "",
                })
                continue
            locale_issues.extend(response.get("issues", []))

        report["summary"][locale] = {
            "checked_keys": len(english),
            "issue_count": len(locale_issues),
        }
        report["issues"].append({
            "locale": locale,
            "items": locale_issues,
        })

    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(report["summary"], ensure_ascii=False, indent=2))
    print(f"report: {REPORT_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
