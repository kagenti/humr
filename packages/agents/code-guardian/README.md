# code-guardian

PR code review agent for the humr repository. Built on the Claude Code harness,
uses the GitHub CLI (`gh`) to fetch open pull requests and produces a
structured review report in the chat UI.

## How it works

On every run, the agent:

1. Reads learned review preferences from `workspace/MEMORY.md`.
2. Reads the review history from `workspace/REVIEWS.md`.
3. Lists open PRs in the configured repository (`$GITHUB_REPO`, or the repo
   detected by `gh repo view` in the working directory).
4. Skips PRs already reviewed at the same HEAD commit.
5. Reviews new or updated PRs against the configured review criteria
   (correctness, security, performance, maintainability, architecture, tests).
6. Appends the review outcome to `REVIEWS.md` and reports findings to the user.

The agent never posts reviews back to GitHub — it only reports into the chat UI.
Feedback the user gives is persisted into `MEMORY.md` so subsequent runs respect
those preferences.

See [`workspace/CLAUDE.md`](workspace/CLAUDE.md) for the full operating manual
the agent loads at startup.

## Configuration

- `GITHUB_REPO` — `owner/repo` slug to review. Defaults to the repo detected in
  the working directory via `gh repo view`.
- A GitHub connection must be provided via OneCLI so that `gh` can
  authenticate.

## Persistence

The workspace (including `MEMORY.md` and `REVIEWS.md`) is persisted on the
`/home/agent` PVC, so preferences and review history survive pod restarts.
