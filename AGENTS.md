# Agent Authoring Guide

This document describes the runtime environment that Humr provides to agent harnesses. It is relevant to anyone building or configuring an agent image.

## Runtime model

Each conversation turn (or scheduled trigger) runs as a **single-use Kubernetes Job**. The container starts fresh from the image, handles one interaction, and is destroyed. No process state carries over between turns.

## What persists

`/home/agent` is backed by a persistent volume that survives across turns. Everything under this path — workspace files, git checkouts, `node_modules`, `.venv`, tool caches, agent memory, configuration — is preserved.

`/tmp` and all other paths outside `/home/agent` are **ephemeral**. They are lost when the Job completes.

### Recommendations

- **Workspace data**: Keep repositories, build artifacts, and working files under `/home/agent`.
- **Global tool installs**: Use home-directory-scoped installs so they land on the persistent volume:
  - `npm install -g` with `NPM_CONFIG_PREFIX=~/.npm-global`
  - `pip install --user`
  - `cargo install` (defaults to `~/.cargo/bin`)
  - `go install` (defaults to `~/go/bin`)
- **mise.toml** (preferred): Declare tools and versions in a `mise.toml` at the workspace root. Mise caches downloads under `~/.local/share/mise`, which persists across turns. After the first install, tool resolution is instant.
- **Agent memory**: Store learned preferences, `SOUL.md`, and accumulated knowledge under `/home/agent`. This is what makes agents stateful across sessions.

### What does NOT persist

- OS packages installed via `apt`, `dnf`, etc. — these write outside `/home/agent`.
- Edits to `/etc/hosts`, `/etc/resolv.conf`, or other system files.
- Kernel tunables (`sysctl`), cgroup settings, or other OS-level configuration.
- Anything in `/tmp`.

If your agent needs system-level configuration, build a **custom container image** with those changes baked in. Do not rely on init scripts for non-persistable changes — they would run on every turn, adding latency to every interaction.

## Init scripts

The agent template's `init` field runs as an init container before the main agent process starts. Use it for one-time setup that writes to the persistent volume:

```yaml
init: |
  #!/bin/bash
  if [ ! -f /home/agent/.initialized ]; then
    # First-time setup
    cp -rn /app/working-dir/. /home/agent/ 2>/dev/null || true
    touch /home/agent/.initialized
  fi
```

The marker file pattern (`.initialized`) ensures the script's heavy work runs only once. Subsequent turns skip it.

## Environment

The platform injects proxy configuration, CA certificates, and credential tokens automatically. See the agent template `spec.yaml` for the full list of platform-injected environment variables.
