#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# ///
"""Append a transcript entry to state/processed.json, keeping the last 20.

Usage:
    uv run scripts/mark-processed.py \\
        --transcript-id ID --meeting-id ID --subject TEXT [--state PATH]
"""

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--transcript-id", required=True)
    parser.add_argument("--meeting-id", required=True)
    parser.add_argument("--subject", required=True)
    parser.add_argument("--state", default="state/processed.json")
    args = parser.parse_args()

    state_path = Path(args.state)
    state_path.parent.mkdir(parents=True, exist_ok=True)

    if state_path.exists():
        data = json.loads(state_path.read_text())
    else:
        data = {"processed": []}

    data["processed"].append({
        "id": args.transcript_id,
        "meetingId": args.meeting_id,
        "subject": args.subject,
        "processedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    })
    data["processed"] = data["processed"][-20:]

    state_path.write_text(json.dumps(data, indent=2) + "\n")
    print(f"Marked {args.transcript_id[:20]}… as processed ({len(data['processed'])} total)")


if __name__ == "__main__":
    main()
