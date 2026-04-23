#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-}"
EXPECTED_CLIPS="${2:-}"

if [[ -z "$BASE_URL" ]]; then
  echo "Usage: bash scripts/smoke_api.sh <base-url> [expected-clip-count]" >&2
  echo "Example: bash scripts/smoke_api.sh https://api.flipod.your-domain.com 176" >&2
  exit 1
fi

BASE_URL="${BASE_URL%/}"

echo "== /api/health =="
curl -fsS "$BASE_URL/api/health"
echo
echo

echo "== /api/auth/me (expect 401) =="
AUTH_STATUS="$(curl -sS -o /tmp/flipod_auth_me.out -w "%{http_code}" "$BASE_URL/api/auth/me")"
cat /tmp/flipod_auth_me.out
echo
echo "status=$AUTH_STATUS"
if [[ "$AUTH_STATUS" != "401" ]]; then
  echo "Expected 401 from /api/auth/me" >&2
  exit 1
fi
echo

echo "== data.json / clip-manifest.json =="
python3 - "$BASE_URL" "$EXPECTED_CLIPS" <<'PY'
import json
import subprocess
import sys

base_url = sys.argv[1].rstrip("/")
expected = int(sys.argv[2]) if len(sys.argv) > 2 and sys.argv[2] else None

def count_items(url: str):
    result = subprocess.run(
        ["curl", "-fsS", url],
        capture_output=True,
        text=True,
        check=True,
    )
    payload = json.loads(result.stdout)
    if isinstance(payload, dict):
        if isinstance(payload.get("clips"), list):
            return len(payload["clips"])
        if isinstance(payload.get("items"), list):
            return len(payload["items"])
    if isinstance(payload, list):
        return len(payload)
    raise SystemExit(f"Cannot determine clip count for {url}")

data_count = count_items(f"{base_url}/data.json")
manifest_count = count_items(f"{base_url}/clip-manifest.json")
print(json.dumps({
    "data_count": data_count,
    "manifest_count": manifest_count,
}, ensure_ascii=False))

if expected is not None and (data_count != expected or manifest_count != expected):
    raise SystemExit(
        f"Expected {expected} clips, got data.json={data_count}, clip-manifest.json={manifest_count}"
    )
PY
echo
echo "== sample mp3 =="
MP3_HEADERS_FILE="/tmp/flipod_smoke_clip.headers"
MP3_STATUS="$(
  curl -sS -D "$MP3_HEADERS_FILE" -o /tmp/flipod_smoke_clip.mp3 -w "%{http_code}" \
    "$BASE_URL/clips/clip1.mp3"
)"
cat "$MP3_HEADERS_FILE"
echo "status=$MP3_STATUS"
if [[ ! "$MP3_STATUS" =~ ^2[0-9][0-9]$ ]]; then
  echo "Expected 2xx from sample mp3 endpoint" >&2
  exit 1
fi
if ! grep -qi '^content-type: audio/' "$MP3_HEADERS_FILE"; then
  echo "Expected audio Content-Type from sample mp3 endpoint" >&2
  exit 1
fi
echo "saved=/tmp/flipod_smoke_clip.mp3"
