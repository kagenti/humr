## Session Persistence

- First prompt creates a new session via `newSession()`
- Subsequent prompts resume via `unstable_resumeSession({ sessionId })`
- UI stores `sessionId` in React state, can list past sessions
