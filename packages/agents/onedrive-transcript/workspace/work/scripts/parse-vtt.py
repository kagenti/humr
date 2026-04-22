#!/usr/bin/env python3
"""Parse a WebVTT transcript into structured JSON.

Usage:
    uv run scripts/parse-vtt.py <input.vtt> [--output <output.json>]

Reads a VTT file (Teams meeting transcript format) and produces JSON with:
- metadata (filename, total duration, speaker count)
- speakers (list of unique speakers)
- segments (merged consecutive same-speaker blocks with timestamps)
"""

import argparse
import json
import re
import sys
from pathlib import Path


def parse_timestamp(ts: str) -> float:
    """Convert VTT timestamp (HH:MM:SS.mmm) to seconds."""
    parts = ts.strip().replace(",", ".").split(":")
    if len(parts) == 3:
        h, m, s = parts
        return int(h) * 3600 + int(m) * 60 + float(s)
    if len(parts) == 2:
        m, s = parts
        return int(m) * 60 + float(s)
    return float(parts[0])


def format_duration(seconds: float) -> str:
    """Format seconds as HH:MM:SS."""
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    if h > 0:
        return f"{h}:{m:02d}:{s:02d}"
    return f"{m}:{s:02d}"


def parse_vtt(content: str) -> dict:
    """Parse VTT content into structured data."""
    lines = content.strip().splitlines()

    # Skip BOM and WEBVTT header
    start = 0
    for i, line in enumerate(lines):
        cleaned = line.strip().lstrip("\ufeff")
        if cleaned.startswith("WEBVTT"):
            start = i + 1
            break
    else:
        start = 0

    # Skip any header metadata lines (NOTE, empty lines after WEBVTT)
    while start < len(lines) and (not lines[start].strip() or lines[start].strip().startswith("NOTE")):
        start += 1

    # Parse cue blocks
    timestamp_re = re.compile(
        r"(\d{1,2}:\d{2}:\d{2}[.,]\d{3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[.,]\d{3})"
    )
    # Teams VTT speaker tag: <v Speaker Name>text</v> or <v Speaker Name>text
    speaker_re = re.compile(r"<v\s+([^>]+)>(.*?)(?:</v>)?$")

    raw_cues: list[dict] = []
    i = start
    while i < len(lines):
        line = lines[i].strip()

        # Look for timestamp line
        m = timestamp_re.search(line)
        if m:
            start_ts = parse_timestamp(m.group(1))
            end_ts = parse_timestamp(m.group(2))

            # Collect text lines until next blank line or timestamp
            text_lines = []
            i += 1
            while i < len(lines) and lines[i].strip() and not timestamp_re.search(lines[i]):
                text_lines.append(lines[i].strip())
                i += 1

            text = " ".join(text_lines)

            # Extract speaker if present
            speaker = None
            sm = speaker_re.match(text)
            if sm:
                speaker = sm.group(1).strip()
                text = sm.group(2).strip()
                # Handle remaining lines that may not have speaker tags
                if not text and text_lines:
                    text = " ".join(text_lines)

            # Strip any remaining VTT tags
            text = re.sub(r"<[^>]+>", "", text).strip()

            if text:
                raw_cues.append({
                    "start": start_ts,
                    "end": end_ts,
                    "speaker": speaker,
                    "text": text,
                })
        else:
            i += 1

    # Merge consecutive cues from the same speaker
    segments: list[dict] = []
    for cue in raw_cues:
        if segments and segments[-1]["speaker"] == cue["speaker"]:
            segments[-1]["end"] = cue["end"]
            segments[-1]["text"] += " " + cue["text"]
        else:
            segments.append({
                "start": cue["start"],
                "end": cue["end"],
                "speaker": cue["speaker"],
                "text": cue["text"],
            })

    # Format timestamps in segments for output
    for seg in segments:
        seg["start_fmt"] = format_duration(seg["start"])
        seg["end_fmt"] = format_duration(seg["end"])

    speakers = sorted({s["speaker"] for s in segments if s["speaker"]})
    total_duration = max((s["end"] for s in segments), default=0)

    return {
        "metadata": {
            "speaker_count": len(speakers),
            "segment_count": len(segments),
            "duration": format_duration(total_duration),
            "duration_seconds": round(total_duration, 1),
        },
        "speakers": speakers,
        "segments": [
            {
                "speaker": s["speaker"],
                "start": s["start_fmt"],
                "end": s["end_fmt"],
                "text": s["text"],
            }
            for s in segments
        ],
    }


def main():
    parser = argparse.ArgumentParser(description="Parse VTT transcript to structured JSON")
    parser.add_argument("input", help="Path to .vtt file")
    parser.add_argument("--output", "-o", help="Output JSON path (default: stdout)")
    args = parser.parse_args()

    input_path = Path(args.input)
    if not input_path.exists():
        print(f"Error: {input_path} not found", file=sys.stderr)
        sys.exit(1)

    # Try common encodings for VTT files
    content = None
    for encoding in ("utf-8-sig", "utf-8", "utf-16", "latin-1"):
        try:
            content = input_path.read_text(encoding=encoding)
            break
        except (UnicodeDecodeError, UnicodeError):
            continue

    if content is None:
        print(f"Error: could not decode {input_path}", file=sys.stderr)
        sys.exit(1)

    result = parse_vtt(content)
    result["metadata"]["source_file"] = input_path.name

    output = json.dumps(result, indent=2, ensure_ascii=False)

    if args.output:
        Path(args.output).write_text(output + "\n")
        print(f"Written to {args.output}", file=sys.stderr)
    else:
        print(output)


if __name__ == "__main__":
    main()
