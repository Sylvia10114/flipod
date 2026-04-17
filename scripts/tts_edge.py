#!/usr/bin/env python3
import asyncio
import sys

import edge_tts


async def main() -> int:
    voice = sys.argv[1] if len(sys.argv) > 1 else "en-US-AvaMultilingualNeural"
    text = sys.stdin.read().strip()
    if not text:
        return 1

    communicate = edge_tts.Communicate(text=text, voice=voice)
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            sys.stdout.buffer.write(chunk["data"])
    sys.stdout.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
