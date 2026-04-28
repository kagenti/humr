# Files & Workspace

The **Files** panel lets you browse and manage files in the agent's working directory.

## What you can do

- **Browse** the file tree
- **View** file contents
- **Upload** files via the chat input (attach files using the paperclip button, drag-and-drop, or paste)
- **Download** files the agent has created (reports, generated code, exports)

## Persistence

Files in `/home/agent` (including the working directory at `/home/agent/work`) persist across restarts, hibernation, and schedule fires. This is the agent's long-term storage.

Everything outside `/home/agent` is ephemeral — system packages, `/etc` edits, and `/tmp` are wiped on restart. If you need a tool to persist, use `uv tool install` (which installs to `~/.local/bin` inside the home directory). Note that `npm install -g` installs to `/usr/local/` by default and will **not** persist — install npm packages locally in your project instead, or use `npm install -g --prefix ~/.local`.
