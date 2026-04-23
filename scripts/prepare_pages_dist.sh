#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DIST_DIR="$ROOT_DIR/.cf-pages-dist"

rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"

copy_item() {
  local source="$1"
  local target="$2"
  if [[ ! -e "$source" ]]; then
    echo "Missing required Pages asset: $source" >&2
    exit 1
  fi
  rsync -a "$source" "$target"
}

copy_item "$ROOT_DIR/data.json" "$DIST_DIR/"
copy_item "$ROOT_DIR/clip-manifest.json" "$DIST_DIR/"
copy_item "$ROOT_DIR/clips" "$DIST_DIR/"
copy_item "$ROOT_DIR/functions" "$DIST_DIR/"

echo "Prepared Pages dist at $DIST_DIR"
find "$DIST_DIR" -maxdepth 2 -mindepth 1 | sort | sed "s#^$DIST_DIR#.#"
