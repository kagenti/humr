# Files & Workspace

The **Files** panel lets you browse and manage files in the agent's working directory.

## What you can do

- **Browse** the file tree
- **View** file contents
- **Upload** files (useful for giving the agent context — docs, configs, data files)
- **Download** files the agent has created (reports, generated code, exports)

## Persistence

Files in `/home/agent` (including the working directory at `/home/agent/work`) persist across restarts, hibernation, and schedule fires. This is the agent's long-term storage.

Everything outside `/home/agent` is ephemeral — system packages, `/etc` edits, and `/tmp` are wiped on restart. If you need a tool to persist, use `npm install -g` or `uv tool install` (which install to the home directory).
