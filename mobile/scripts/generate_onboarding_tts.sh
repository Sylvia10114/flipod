#!/usr/bin/env bash

set -euo pipefail

if [[ -z "${ELEVENLABS_API_KEY:-}" ]]; then
  echo "ELEVENLABS_API_KEY is required" >&2
  exit 1
fi

VOICE_ID="${ELEVENLABS_VOICE_ID:-21m00Tcm4TlvDq8ikWAM}"
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="$ROOT_DIR/assets/onboarding_tts"

mkdir -p "$OUT_DIR"

texts=(
  'I like to go to the park with my dog. We play there every day.'
  'Last summer I traveled to a small town near the sea. The local food was delicious and the people were friendly.'
  'The government has introduced new regulations to tackle pollution in major cities. Many residents remain skeptical about whether these measures will be sufficient.'
  'The rapid advancement of surveillance technology raises profound ethical dilemmas. Critics argue that insufficient transparency could undermine fundamental civil liberties.'
)

index=1
for text in "${texts[@]}"; do
  payload=$(printf '%s' "$text" | python3 -c 'import json,sys; print(json.dumps({"text": sys.stdin.read(), "model_id": "eleven_multilingual_v2", "language_code": "en", "voice_settings": {"stability": 0.42, "similarity_boost": 0.82}}))')

  curl -fsSL \
    -X POST "https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=mp3_44100_128" \
    -H "xi-api-key: ${ELEVENLABS_API_KEY}" \
    -H "Content-Type: application/json" \
    -d "$payload" \
    -o "$OUT_DIR/staircase_${index}.mp3"

  index=$((index + 1))
done

echo "Generated onboarding TTS in $OUT_DIR"
