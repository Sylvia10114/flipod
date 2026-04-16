#!/usr/bin/env python3
"""
merge_clips.py — Merge approved clips from a batch into the main data.json.

Usage:
    python3 scripts/merge_clips.py \
        --source output/batchN/approved_clips.json \
        --target data.json \
        [--audio-src output/batchN/clips] \
        [--audio-dst clips] \
        [--dry-run]

Behavior:
    1. Reads source approved_clips and target data.json
    2. Assigns new sequential IDs starting from max(existing) + 1
    3. Metadata-first batches merge directly with no audio copy
    4. Legacy audio batches can still copy audio files when --audio-src/--audio-dst are provided
    5. Appends clips to target, auto-backs up before writing
"""

import argparse
import json
import os
import shutil
import sys
from datetime import datetime


def main():
    parser = argparse.ArgumentParser(description="Merge approved clips into data.json")
    parser.add_argument("--source", required=True, help="Path to approved_clips.json")
    parser.add_argument("--target", required=True, help="Path to data.json")
    parser.add_argument("--audio-src", help="Legacy source audio directory")
    parser.add_argument("--audio-dst", help="Legacy destination audio directory")
    parser.add_argument("--dry-run", action="store_true", help="Report without modifying files")
    args = parser.parse_args()

    # ── Read source ────────────────────────────────────────────
    if not os.path.exists(args.source):
        print(f"❌ Source not found: {args.source}")
        sys.exit(1)

    with open(args.source, "r", encoding="utf-8") as f:
        source_data = json.load(f)

    source_clips = source_data.get("clips", [])
    if not source_clips:
        print("ℹ️  Source has no clips. Nothing to merge.")
        sys.exit(0)

    has_legacy_audio = any(clip.get("audio") for clip in source_clips)
    if has_legacy_audio and (not args.audio_src or not args.audio_dst):
        print("❌ Source clips still contain audio fields. 请同时提供 --audio-src 和 --audio-dst。")
        sys.exit(1)

    # ── Pre-check: all source audio files exist (legacy only) ─
    missing_audio = []
    if has_legacy_audio:
        for clip in source_clips:
            audio_field = clip.get("audio", "")
            audio_filename = os.path.basename(audio_field)
            audio_path = os.path.join(args.audio_src, audio_filename)
            if not os.path.exists(audio_path):
                missing_audio.append(audio_path)

        if missing_audio:
            print("❌ Missing source audio files:")
            for p in missing_audio:
                print(f"   {p}")
            sys.exit(1)

    # ── Read target ────────────────────────────────────────────
    if os.path.exists(args.target):
        with open(args.target, "r", encoding="utf-8") as f:
            target_data = json.load(f)
    else:
        target_data = {"clips": []}

    target_clips = target_data.get("clips", [])
    original_count = len(target_clips)

    # Find max existing ID
    max_id = 0
    for clip in target_clips:
        cid = clip.get("id", 0)
        if isinstance(cid, int) and cid > max_id:
            max_id = cid

    next_id = max_id + 1

    # ── Plan merge ─────────────────────────────────────────────
    merge_plan = []
    for clip in source_clips:
        new_id = next_id
        next_id += 1

        item = {
            "old_id": clip.get("id"),
            "new_id": new_id,
            "clip": clip,
        }

        if has_legacy_audio:
            old_audio = os.path.basename(clip.get("audio", ""))
            new_audio_filename = f"clip{new_id}.mp3"
            new_audio_rel = f"clips/{new_audio_filename}"

            src_path = os.path.join(args.audio_src, old_audio)
            dst_path = os.path.join(args.audio_dst, new_audio_filename)
            item.update({
                "src_audio": src_path,
                "dst_audio": dst_path,
                "new_audio_field": new_audio_rel,
            })
        merge_plan.append(item)

    id_range_start = merge_plan[0]["new_id"]
    id_range_end = merge_plan[-1]["new_id"]

    # ── Dry-run report ─────────────────────────────────────────
    print(f"\n{'[DRY RUN] ' if args.dry_run else ''}Merge plan:")
    print(f"  Source: {args.source} ({len(source_clips)} clips)")
    print(f"  Target: {args.target} ({original_count} existing clips)")
    print(f"  New IDs: {id_range_start}-{id_range_end}")
    if has_legacy_audio:
        print(f"  Audio: {args.audio_src}/*.mp3 → {args.audio_dst}/*.mp3 ({len(merge_plan)} files)")
    else:
        print("  Audio: metadata-only merge (no audio files copied)")

    if args.dry_run:
        if has_legacy_audio:
            print("\n  Audio copy plan:")
            for item in merge_plan:
                print(f"    {os.path.basename(item['src_audio'])} → {os.path.basename(item['dst_audio'])}")
        print("\n  No files modified (dry-run).")
        return

    # ── Backup target ──────────────────────────────────────────
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_path = f"{args.target}.backup_{timestamp}"
    if os.path.exists(args.target):
        shutil.copy2(args.target, backup_path)
        print(f"  Backup: {backup_path}")

    # ── Execute merge ──────────────────────────────────────────
    if has_legacy_audio:
        os.makedirs(args.audio_dst, exist_ok=True)
    copied_files = []

    try:
        if has_legacy_audio:
            for item in merge_plan:
                shutil.copy2(item["src_audio"], item["dst_audio"])
                copied_files.append(item["dst_audio"])

        # Update clips and append
        for item in merge_plan:
            clip = dict(item["clip"])
            clip["id"] = item["new_id"]
            if has_legacy_audio:
                clip["audio"] = item["new_audio_field"]
            else:
                clip.pop("audio", None)
            target_clips.append(clip)

        # Write target
        target_data["clips"] = target_clips
        with open(args.target, "w", encoding="utf-8") as f:
            json.dump(target_data, f, ensure_ascii=False, indent=2)

    except Exception as e:
        # Rollback: remove copied audio, restore backup
        print(f"❌ Merge failed: {e}")
        for cf in copied_files:
            try:
                os.remove(cf)
            except OSError:
                pass
        if os.path.exists(backup_path):
            shutil.copy2(backup_path, args.target)
            print(f"  Rolled back to {backup_path}")
        sys.exit(1)

    # ── Post-merge validation ──────────────────────────────────
    final_count = len(target_clips)
    expected = original_count + len(source_clips)

    errors = []
    if final_count != expected:
        errors.append(f"Clip count mismatch: expected {expected}, got {final_count}")

    if has_legacy_audio:
        for item in merge_plan:
            if not os.path.exists(item["dst_audio"]):
                errors.append(f"Audio not found: {item['dst_audio']}")

    if errors:
        print(f"❌ Post-merge validation failed:")
        for err in errors:
            print(f"   {err}")
        # Rollback
        if os.path.exists(backup_path):
            shutil.copy2(backup_path, args.target)
            for cf in copied_files:
                try:
                    os.remove(cf)
                except OSError:
                    pass
            print(f"  Rolled back to {backup_path}")
        sys.exit(1)

    print(f"\n✅ Merged {len(source_clips)} clips (ids {id_range_start}-{id_range_end}) "
          f"from {args.source} into {args.target}")
    if has_legacy_audio:
        print(f"   Audio files: {args.audio_src}/*.mp3 → {args.audio_dst}/*.mp3 ({len(copied_files)} files copied)")
    else:
        print("   Audio files: metadata-only batch, no files copied")
    print(f"   Backup: {backup_path}")


if __name__ == "__main__":
    main()
