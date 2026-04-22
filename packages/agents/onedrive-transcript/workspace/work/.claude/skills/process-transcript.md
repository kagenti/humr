---
name: process-transcript
description: |
  Process a VTT meeting transcript into structured markdown meeting notes. Use when
  a VTT file has been downloaded and needs to be converted into readable notes with
  metadata, attendees, summary, key topics, action items, and clean speaker attribution.
---

Process a Teams meeting VTT transcript into structured markdown meeting notes.

## Steps

1. **Parse the VTT file** using the bundled parser:

```bash
uv run scripts/parse-vtt.py <input.vtt> -o /tmp/transcript.json
```

2. **Read the parsed JSON** — it contains `metadata`, `speakers`, and `segments`.

3. **Generate meeting notes** in the following markdown format:

```markdown
# Meeting Notes: <meeting title from filename or context>

**Date:** <date from filename or OneDrive metadata>
**Duration:** <from metadata.duration>
**Attendees:** <comma-separated speakers list>

## Summary

<2-4 sentence executive summary of the meeting>

## Key Topics

### <Topic 1>
<Summary of discussion with speaker attribution>

### <Topic 2>
<Summary of discussion with speaker attribution>

## Action Items

- [ ] <action> — **<owner>**
- [ ] <action> — **<owner>**

## Detailed Notes

<Chronological notes with speaker attribution, organized by topic shifts.
Use > blockquotes for notable direct quotes.>
```

## Guidelines

- **Speaker attribution**: Use first names where possible. If the VTT uses full names (e.g., "John Smith"), use "John" in the body but list full names in Attendees.
- **Summary**: Focus on decisions made and outcomes, not play-by-play.
- **Action items**: Extract explicit commitments ("I'll do X", "Can you handle Y") with the responsible person.
- **Key topics**: Group related discussion into logical topics rather than following strict chronological order.
- **Direct quotes**: Use sparingly — only for important statements, decisions, or commitments.
- **Filler removal**: Omit filler words, false starts, and crosstalk artifacts from the VTT.
