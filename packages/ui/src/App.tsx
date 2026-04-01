import { useState, useRef, useEffect, useCallback, KeyboardEvent } from "react";

type Role = "user" | "assistant";

interface ToolChip {
  kind: "tool";
  title: string;
  status: string;
}

interface TextPart {
  kind: "text";
  text: string;
}

type MessagePart = TextPart | ToolChip;

interface Message {
  id: string;
  role: Role;
  parts: MessagePart[];
  streaming: boolean;
}

interface LogEntry {
  id: string;
  ts: string;
  type: string;
  payload: object;
}

interface SessionInfo {
  sessionId: string;
  cwd: string;
  title?: string;
  updatedAt?: string;
}

interface TreeEntry {
  path: string;
  type: "file" | "dir";
}

export default function App() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);
  const [loginUrl, setLoginUrl] = useState<string | null>(null);
  const [authCode, setAuthCode] = useState("");
  const [pasteReady, setPasteReady] = useState(false);
  const [serverDown, setServerDown] = useState(false);
  const [rightTab, setRightTab] = useState<"sessions" | "files" | "log">("sessions");
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [fileTree, setFileTree] = useState<TreeEntry[]>([]);
  const [fileVersion, setFileVersion] = useState(-1);
  const [openFile, setOpenFile] = useState<{ path: string; content: string } | null>(null);
  const pendingPromptRef = useRef<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const logBottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fetch("/api/auth/status")
      .then((r) => r.json())
      .then((s) => {
        setServerDown(false);
        if (!s.authenticated) setAuthRequired(true);
      })
      .catch(() => setServerDown(true));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    logBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [log]);

  useEffect(() => {
    const poll = setInterval(async () => {
      try {
        const r = await fetch("/api/files/version");
        const { version } = await r.json();
        if (version === fileVersion) return;
        setFileVersion(version);
        const treeRes = await fetch("/api/files/tree");
        const { entries } = await treeRes.json();
        setFileTree(entries);
        if (openFile) {
          const fileRes = await fetch(`/api/files/read?path=${encodeURIComponent(openFile.path)}`);
          const data = await fileRes.json();
          if (data.content !== undefined) setOpenFile({ path: data.path, content: data.content });
          else setOpenFile(null);
        }
      } catch {}
    }, 2000);
    return () => clearInterval(poll);
  }, [fileVersion, openFile]);

  useEffect(() => {
    fetch("/api/files/tree")
      .then((r) => r.json())
      .then(({ version, entries }) => { setFileVersion(version); setFileTree(entries); })
      .catch(() => {});
  }, []);

  const fetchSessions = useCallback(async () => {
    setLoadingSessions(true);
    try {
      const r = await fetch("/api/sessions");
      const data = await r.json();
      setSessions(data.sessions ?? []);
    } catch {}
    setLoadingSessions(false);
  }, []);

  useEffect(() => {
    fetchSessions();
  }, []);

  const resumeSession = useCallback(async (sid: string) => {
    setBusy(true);
    setMessages([]);
    setSessionId(sid);
    setRightTab("files");

    const msgMap = new Map<string, Message>();
    const msgOrder: string[] = [];

    try {
      const res = await fetch(`/api/sessions/${sid}`);
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop()!;
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const event = JSON.parse(line.slice(6));

          if (event.type === "user_text" || event.type === "agent_text") {
            const role: Role = event.type === "user_text" ? "user" : "assistant";
            const mid = event.messageId ?? crypto.randomUUID();
            const existing = msgMap.get(mid);
            if (existing) {
              const last = existing.parts[existing.parts.length - 1];
              if (last?.kind === "text") {
                last.text += event.text;
              } else {
                existing.parts.push({ kind: "text", text: event.text });
              }
            } else {
              const msg: Message = { id: mid, role, parts: [{ kind: "text", text: event.text }], streaming: false };
              msgMap.set(mid, msg);
              msgOrder.push(mid);
            }
          } else if (event.type === "tool") {
            const mid = event.messageId ?? msgOrder[msgOrder.length - 1];
            const existing = mid ? msgMap.get(mid) : null;
            if (existing) {
              existing.parts.push({ kind: "tool", title: event.title, status: event.status });
            }
          }
        }
      }
    } catch {}

    setMessages(msgOrder.map((id) => msgMap.get(id)!));
    setBusy(false);
  }, []);

  const openFileHandler = useCallback(async (path: string) => {
    if (openFile?.path === path) { setOpenFile(null); return; }
    try {
      const r = await fetch(`/api/files/read?path=${encodeURIComponent(path)}`);
      const data = await r.json();
      if (data.content !== undefined) setOpenFile({ path: data.path, content: data.content });
    } catch {}
  }, [openFile]);

  const addLog = useCallback((type: string, payload: object) => {
    const ts = new Date().toISOString().slice(11, 23);
    setLog((prev) => [...prev, { id: crypto.randomUUID(), ts, type, payload }]);
  }, []);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setBusy(true);

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      parts: [{ kind: "text", text }],
      streaming: false,
    };
    const assistantId = crypto.randomUUID();
    const assistantMsg: Message = {
      id: assistantId,
      role: "assistant",
      parts: [],
      streaming: true,
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    addLog("prompt", { text });

    try {
      const res = await fetch("/api/prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: text, sessionId }),
      });

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop()!;
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const event = JSON.parse(line.slice(6));
          addLog(event.type, event);

          if (event.type === "text") {
            setMessages((prev) =>
              prev.map((m) => {
                if (m.id !== assistantId) return m;
                const parts = [...m.parts];
                const last = parts[parts.length - 1];
                if (last?.kind === "text") {
                  parts[parts.length - 1] = { kind: "text", text: last.text + event.text };
                } else {
                  parts.push({ kind: "text", text: event.text });
                }
                return { ...m, parts };
              }),
            );
          } else if (event.type === "tool") {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, parts: [...m.parts, { kind: "tool", title: event.title, status: event.status } as ToolChip] }
                  : m,
              ),
            );
          } else if (event.type === "session") {
            setSessionId(event.sessionId);
          } else if (event.type === "auth_required") {
            setAuthRequired(true);
            pendingPromptRef.current = text;
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, streaming: false } : m)),
            );
          } else if (event.type === "done" || event.type === "error") {
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, streaming: false } : m)),
            );
          }
        }
      }
    } catch (err: any) {
      if (err.message === "Failed to fetch" || err.name === "TypeError") {
        setServerDown(true);
      }
      addLog("error", { message: err.message });
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? { ...m, streaming: false } : m)),
      );
    } finally {
      setBusy(false);
      textareaRef.current?.focus();
    }
  }, [input, busy, addLog]);

  const startLogin = useCallback(async () => {
    setLoggingIn(true);
    setLoginUrl(null);
    setPasteReady(false);
    try {
      const res = await fetch("/api/auth/login", { method: "POST" });
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop()!;
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const event = JSON.parse(line.slice(6));
          if (event.type === "login_url") {
            setLoginUrl(event.url);
            window.open(event.url, "_blank");
          } else if (event.type === "paste_ready") {
            setPasteReady(true);
          }
        }
      }
    } catch {
      setLoggingIn(false);
    }
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="shell">
      <header className="header">
        <span className="header-logo">◈ ACP</span>
        <span className="header-sub">agent client protocol</span>
        {sessionId && (
          <button className="new-session-btn" onClick={() => { setSessionId(null); setMessages([]); }}>
            + new session
          </button>
        )}
        <span className={`header-status ${busy ? "busy" : "idle"}`}>
          {busy ? "▶ running" : "● ready"}
        </span>
      </header>

      <div className="body">
        <section className="chat-panel">
          <div className="messages">
            {serverDown && (
              <div className="auth-banner">
                <span className="auth-title">server unavailable</span>
                <p className="auth-desc">Could not connect to the harness runtime. Make sure the server is running.</p>
                <button
                  className="auth-btn"
                  onClick={() => {
                    fetch("/api/auth/status")
                      .then((r) => r.json())
                      .then((s) => {
                        setServerDown(false);
                        if (!s.authenticated) setAuthRequired(true);
                      })
                      .catch(() => setServerDown(true));
                  }}
                >
                  retry
                </button>
              </div>
            )}
            {!serverDown && authRequired && (
              <div className="auth-banner">
                <span className="auth-title">authentication required</span>
                <p className="auth-desc">Claude is not logged in. Sign in to start a session.</p>
                {!loggingIn && (
                  <button className="auth-btn" onClick={startLogin}>
                    log in
                  </button>
                )}
                {loginUrl && (
                  <>
                    <a className="auth-link" href={loginUrl} target="_blank" rel="noreferrer">
                      open login page
                    </a>
                    {!pasteReady && (
                      <p className="auth-desc">Waiting for login prompt...</p>
                    )}
                  </>
                )}
                {pasteReady && (
                  <>
                    <p className="auth-desc">Paste the authentication code below:</p>
                    <div className="auth-code-row">
                      <input
                        className="auth-code-input"
                        type="text"
                        value={authCode}
                        onChange={(e) => setAuthCode(e.target.value)}
                        placeholder="paste authentication code"
                      />
                      <button
                        className="auth-btn"
                        disabled={!authCode.trim()}
                        onClick={async () => {
                          const r = await fetch("/api/auth/code", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ code: authCode.trim() }),
                          });
                          const result = await r.json();
                          if (result.ok) {
                            setAuthRequired(false);
                            setLoggingIn(false);
                            setLoginUrl(null);
                            setPasteReady(false);
                            setAuthCode("");
                            if (pendingPromptRef.current) {
                              setInput(pendingPromptRef.current);
                              pendingPromptRef.current = null;
                            }
                          } else {
                            setAuthCode("");
                          }
                        }}
                      >
                        submit
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
            {!authRequired && messages.length === 0 && (
              <div className="empty">send a message to start a new session</div>
            )}
            {messages.map((m) => (
              <div key={m.id} className={`message ${m.role}`}>
                <span className="role-tag">{m.role === "user" ? "you" : "agent"}</span>
                <div className="content">
                  {m.parts.map((p, i) =>
                    p.kind === "text" ? (
                      <span key={i} className="text-part">
                        {p.text}
                        {m.streaming && i === m.parts.length - 1 && p.kind === "text" && (
                          <span className="cursor" />
                        )}
                      </span>
                    ) : (
                      <span key={i} className={`tool-chip status-${p.status}`}>
                        ⚙ {p.title}
                        <span className="tool-status">{p.status}</span>
                      </span>
                    ),
                  )}
                  {m.streaming && m.parts.length === 0 && <span className="cursor" />}
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          <div className="input-bar">
            <textarea
              ref={textareaRef}
              className="input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="message agent  ↵ send  shift+↵ newline"
              rows={1}
              disabled={busy || authRequired || serverDown}
            />
            <button className="send-btn" onClick={send} disabled={busy || authRequired || serverDown || !input.trim()}>
              {busy ? "…" : "send"}
            </button>
          </div>
        </section>

        <aside className="sidebar">
          <div className="sidebar-tabs">
            <button className={`sidebar-tab ${rightTab === "sessions" ? "active" : ""}`} onClick={() => { setRightTab("sessions"); fetchSessions(); }}>sessions</button>
            <button className={`sidebar-tab ${rightTab === "files" ? "active" : ""}`} onClick={() => setRightTab("files")}>files</button>
            <button className={`sidebar-tab ${rightTab === "log" ? "active" : ""}`} onClick={() => setRightTab("log")}>log</button>
          </div>
          <div className="sidebar-content">
            {rightTab === "sessions" && (
              <div className="sessions-panel">
                {loadingSessions && <div className="sessions-empty">loading sessions...</div>}
                {!loadingSessions && sessions.length === 0 && <div className="sessions-empty">no sessions</div>}
                {sessions.map((s) => (
                  <div
                    key={s.sessionId}
                    className={`session-entry ${s.sessionId === sessionId ? "active" : ""}`}
                    onClick={() => resumeSession(s.sessionId)}
                  >
                    <span className="session-title">{s.title || s.sessionId.slice(0, 12)}</span>
                    {s.updatedAt && <span className="session-time">{new Date(s.updatedAt).toLocaleString()}</span>}
                  </div>
                ))}
              </div>
            )}
            {rightTab === "files" && !openFile && (
              <div className="file-tree">
                {fileTree.length === 0 && <div className="file-tree-empty">no files yet</div>}
                {fileTree.map((e) => (
                  <div
                    key={e.path}
                    className={`tree-entry ${e.type}`}
                    style={{ paddingLeft: `${16 + (e.path.split("/").length - 1) * 14}px` }}
                    onClick={e.type === "file" ? () => openFileHandler(e.path) : undefined}
                  >
                    <span className="tree-icon">{e.type === "dir" ? "▸" : "·"}</span>
                    <span className="tree-name">{e.path.split("/").pop()}</span>
                  </div>
                ))}
              </div>
            )}
            {rightTab === "files" && openFile && (
              <div className="file-viewer">
                <div className="file-viewer-header">
                  <button className="file-viewer-back" onClick={() => setOpenFile(null)}>←</button>
                  <span className="file-viewer-name">{openFile.path}</span>
                </div>
                <div className="file-viewer-content">
                  <pre>{openFile.content}</pre>
                </div>
              </div>
            )}
            {rightTab === "log" && (
              <div className="log-panel">
                <div className="log-entries">
                  {log.length === 0 && <div className="log-empty">no events yet</div>}
                  {log.map((e) => (
                    <div key={e.id} className={`log-entry type-${e.type}`}>
                      <span className="log-ts">{e.ts}</span>
                      <span className="log-type">{e.type}</span>
                      <pre className="log-payload">{JSON.stringify(e.payload, null, 2)}</pre>
                    </div>
                  ))}
                  <div ref={logBottomRef} />
                </div>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
