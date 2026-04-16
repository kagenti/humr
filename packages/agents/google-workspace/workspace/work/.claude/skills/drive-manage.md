---
name: drive-manage
description: |
  List, search, download, and organize Google Drive files. Use when the user asks to find, list, download, or manage Drive files and folders.
---

Manage Google Drive files using the `gws` CLI.

## Commands

**List recent files:**
```bash
gws drive files list --params '{"pageSize": 10}'
```

**Search for files:**
```bash
gws drive files list --params '{"q": "name contains '\''report'\''", "pageSize": 10}'
```

**Download a file:**
```bash
gws drive files get --params '{"fileId": "FILE_ID", "alt": "media"}'
```

**Create a folder:**
```bash
gws drive files create --json '{"name": "Folder Name", "mimeType": "application/vnd.google-apps.folder"}'
```

**Delete a file:**
```bash
gws drive files delete --params '{"fileId": "FILE_ID"}'
```

**List files in a specific folder:**
```bash
gws drive files list --params '{"q": "'\''FOLDER_ID'\'' in parents", "pageSize": 20}'
```

## Tips

- All output is JSON — parse it to extract file IDs, names, and metadata.
- Use `gws drive +upload` (see drive-upload skill) for uploading files.
- Common search queries: `mimeType='application/vnd.google-apps.folder'` for folders, `name contains 'term'` for name search, `modifiedTime > '2025-01-01'` for date filtering.
