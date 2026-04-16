---
name: drive-upload
description: |
  Upload files to Google Drive. Use when the user asks to upload, save, or put files in Drive.
---

Upload files to Google Drive using the `gws` CLI.

## Steps

1. If the file doesn't exist locally yet, create it first (write the content to a local file).
2. Upload using the helper command:
   ```bash
   gws drive +upload ./filename --name "Display Name"
   ```
3. To upload to a specific folder, use the API form:
   ```bash
   gws drive files create --json '{"name": "filename", "parents": ["FOLDER_ID"]}' --upload ./filename
   ```
4. To find a folder ID, list folders:
   ```bash
   gws drive files list --params '{"q": "mimeType='\''application/vnd.google-apps.folder'\''", "pageSize": 20}'
   ```
5. Report the file name and Drive link back to the user.
