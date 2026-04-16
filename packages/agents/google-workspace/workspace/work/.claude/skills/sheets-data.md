---
name: sheets-data
description: |
  Read and write Google Sheets data. Use when the user asks to read, update, or append spreadsheet data.
---

Manage Google Sheets using the `gws` CLI.

## Commands

**Read spreadsheet values:**
```bash
gws sheets +read --spreadsheet-id SPREADSHEET_ID --range 'Sheet1!A1:C10'
```

**Append a row:**
```bash
gws sheets +append --spreadsheet-id SPREADSHEET_ID --range 'Sheet1' --values '["col1", "col2", "col3"]'
```

## Tips

- Sheets ranges with `!` need single quotes in bash to avoid history expansion.
- The spreadsheet ID is the long string in the Google Sheets URL between `/d/` and `/edit`.
