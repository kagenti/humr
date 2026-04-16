---
name: gmail-triage
description: |
  Triage Gmail inbox — summarize unread messages, find emails by sender/subject, extract attachments. Use when the user asks about their email, inbox, or messages.
---

Triage and manage Gmail using the `gws` CLI.

## Commands

**Inbox summary (unread messages with sender, subject, date):**
```bash
gws gmail +triage
```

**Search messages:**
```bash
gws gmail users messages list --params '{"userId": "me", "q": "from:someone@example.com has:attachment", "maxResults": 10}'
```

Gmail search supports the same syntax as the web UI: `is:unread`, `has:attachment`, `from:`, `subject:`, `after:2025/01/01`, etc.

**Read a specific message:**
```bash
gws gmail users messages get --params '{"userId": "me", "id": "MESSAGE_ID"}'
```

**Send an email:**
```bash
gws gmail +send --to recipient@example.com --subject "Subject" --body "Message body"
```

**Reply to a message (handles threading):**
```bash
gws gmail +reply --message-id MESSAGE_ID --body "Reply text"
```

**Forward a message:**
```bash
gws gmail +forward --message-id MESSAGE_ID --to recipient@example.com
```

## Tips

- Start with `gws gmail +triage` to get an overview, then drill into specific messages.
- Message IDs from the triage output can be used with `+reply`, `+forward`, and the API `get` command.
- For attachments, read the full message to find attachment IDs, then use the attachments API.
