#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# ///
"""Fetch all new Teams meeting transcripts not yet recorded in state/processed.json.

Downloads each new transcript VTT to /tmp and prints a JSON array to stdout:
  [{"subject", "meetingId", "transcriptId", "vttPath", "meetingStart"}, ...]

Usage:
    uv run scripts/fetch-new-transcripts.py [--since ISO8601] [--state PATH]

Defaults:
    --since   24 hours ago
    --state   state/processed.json
"""

import argparse
import json
import os
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path


GRAPH = "https://graph.microsoft.com/v1.0"


def graph_get(path: str, token: str) -> dict:
    url = path if path.startswith("http") else f"{GRAPH}{path}"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())


def graph_get_bytes(path: str, token: str, accept: str) -> bytes:
    url = path if path.startswith("http") else f"{GRAPH}{path}"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}", "Accept": accept})
    with urllib.request.urlopen(req) as resp:
        return resp.read()


def get_all_pages(first_url: str, token: str) -> list:
    items = []
    url = first_url
    while url:
        data = graph_get(url, token)
        items.extend(data.get("value", []))
        url = data.get("@odata.nextLink")
    return items


def load_processed_ids(state_path: Path) -> set:
    if not state_path.exists():
        return set()
    data = json.loads(state_path.read_text())
    return {e["id"] for e in data.get("processed", [])}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--since", default=None, help="ISO8601 start datetime (default: 24h ago)")
    parser.add_argument("--state", default="state/processed.json", help="Path to processed.json")
    args = parser.parse_args()

    token = os.environ.get("MICROSOFT_GRAPH_TOKEN")
    if not token:
        print("Error: MICROSOFT_GRAPH_TOKEN not set", file=sys.stderr)
        sys.exit(1)

    since = args.since or (
        datetime.now(timezone.utc) - timedelta(hours=24)
    ).strftime("%Y-%m-%dT%H:%M:%SZ")

    processed_ids = load_processed_ids(Path(args.state))

    since_enc = urllib.parse.quote(since)
    events = get_all_pages(
        f"{GRAPH}/me/events?$filter=start/dateTime%20ge%20'{since_enc}'"
        f"&$select=id,subject,start,isOnlineMeeting,onlineMeeting&$top=50&$orderby=start/dateTime%20desc",
        token,
    )

    results = []

    for event in events:
        if not event.get("isOnlineMeeting"):
            continue
        join_url = (event.get("onlineMeeting") or {}).get("joinUrl")
        if not join_url:
            continue
        subject = event.get("subject", "")
        meeting_start = (event.get("start") or {}).get("dateTime", "")

        # Resolve meeting resource ID from join URL
        join_url_enc = urllib.parse.quote(join_url, safe="")
        meeting_resp = graph_get(
            f"{GRAPH}/me/onlineMeetings?$filter=JoinWebUrl%20eq%20'{join_url_enc}'",
            token,
        )
        meetings = meeting_resp.get("value", [])
        if not meetings:
            continue
        meeting_id = meetings[0]["id"]

        # List transcripts
        transcripts_resp = graph_get(
            f"{GRAPH}/me/onlineMeetings/{meeting_id}/transcripts", token
        )
        for transcript in transcripts_resp.get("value", []):
            transcript_id = transcript["id"]
            if transcript_id in processed_ids:
                continue

            # Download VTT
            vtt_path = f"/tmp/transcript-{transcript_id[:20]}.vtt"
            content = graph_get_bytes(
                f"{GRAPH}/me/onlineMeetings/{meeting_id}/transcripts/{transcript_id}/content?$format=text/vtt",
                token,
                accept="text/vtt",
            )
            Path(vtt_path).write_bytes(content)

            results.append({
                "subject": subject,
                "meetingId": meeting_id,
                "transcriptId": transcript_id,
                "vttPath": vtt_path,
                "meetingStart": meeting_start,
            })

    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
