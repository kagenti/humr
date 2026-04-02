import { useState, useRef, useEffect, useCallback, useMemo, KeyboardEvent } from "react";
import {
  ClientSideConnection,
  PROTOCOL_VERSION,
} from "@agentclientprotocol/sdk/dist/acp.js";
import type { Stream } from "@agentclientprotocol/sdk/dist/stream.js";
import type { AnyMessage } from "@agentclientprotocol/sdk/dist/jsonrpc.js";
import { platform } from "./platform.js";
import { createInstanceTrpc } from "./instance-trpc.js";

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
  title?: string | null;
  updatedAt?: string | null;
}

interface TreeEntry {
  path: string;
  type: "file" | "dir";
}

interface InstanceView {
  name: string;
  templateName: string;
  description?: string;
  desiredState: "running" | "hibernated";
  status: { currentState: string; error?: string; podReady: boolean } | null;
}

function wsStream(url: string): Promise<{ stream: Stream; ws: WebSocket }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.onopen = () => {
      const readable = new ReadableStream<AnyMessage>({
        start(controller) {
          ws.onmessage = (e) => controller.enqueue(JSON.parse(e.data));
          ws.onclose = () => {
            try {
              controller.close();
            } catch {}
          };
          ws.onerror = (err) => {
            try {
              controller.error(err);
            } catch {}
          };
        },
      });
      const writable = new WritableStream<AnyMessage>({
        write(chunk) {
          ws.send(JSON.stringify(chunk));
        },
        close() {
          ws.close();
        },
      });
      resolve({ stream: { readable, writable }, ws });
    };
    ws.onerror = reject;
  });
}

function wsUrl(instanceId: string): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/api/instances/${instanceId}/acp`;
}

type UpdateHandler = (update: any) => void;

async function openConnection(
  instanceId: string,
  onUpdate: UpdateHandler,
): Promise<{ connection: ClientSideConnection; ws: WebSocket }> {
  const { stream, ws } = await wsStream(wsUrl(instanceId));
  const connection = new ClientSideConnection(
    () => ({
      async requestPermission(params: any) {
        return {
          outcome: {
            outcome: "selected" as const,
            optionId: params.options[0].optionId,
          },
        };
      },
      async sessionUpdate(params: any) {
        onUpdate(params.update);
      },
      async writeTextFile() {
        return {};
      },
      async readTextFile() {
        return { content: "" };
      },
    }),
    stream,
  );
  return { connection, ws };
}

export default function App() {
  const [view, setView] = useState<"list" | "chat">("list");
  const [selectedInstance, setSelectedInstance] = useState<string | null>(null);
  const [instances, setInstances] = useState<InstanceView[]>([]);
  const [loadingInstances, setLoadingInstances] = useState(false);
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
  const [rightTab, setRightTab] = useState<"files" | "log">("files");
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [loadingSession, setLoadingSession] = useState(false);
  const [fileTree, setFileTree] = useState<TreeEntry[]>([]);
  const [openFile, setOpenFile] = useState<{
    path: string;
    content: string;
  } | null>(null);
  const [templates, setTemplates] = useState<
    { name: string; image: string; description?: string }[]
  >([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [creatingInstance, setCreatingInstance] = useState<string | null>(null);
  const pendingPromptRef = useRef<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const logBottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const connectionRef = useRef<{
    connection: ClientSideConnection;
    ws: WebSocket;
  } | null>(null);
  const activeSessionIdRef = useRef<string | null>(null);
  const currentAssistantIdRef = useRef<string | null>(null);

  const instanceTrpc = useMemo(
    () => (selectedInstance ? createInstanceTrpc(selectedInstance) : null),
    [selectedInstance],
  );

  const checkAuth = useCallback(async () => {
    if (!instanceTrpc) return;
    try {
      const s = await instanceTrpc.auth.status.query();
      if (!s.authenticated) setAuthRequired(true);
      else setAuthRequired(false);
    } catch {
      setAuthRequired(false);
    }
  }, [instanceTrpc]);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    logBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [log]);

  useEffect(() => {
    if (!instanceTrpc) return;
    const poll = setInterval(async () => {
      try {
        const { entries } = await instanceTrpc.files.tree.query();
        setFileTree(entries);
        if (openFile) {
          try {
            const data = await instanceTrpc.files.read.query({ path: openFile.path });
            if (data.content !== undefined)
              setOpenFile({ path: data.path, content: data.content });
            else setOpenFile(null);
          } catch {
            setOpenFile(null);
          }
        }
      } catch {}
    }, 2000);
    return () => clearInterval(poll);
  }, [instanceTrpc, openFile]);

  useEffect(() => {
    if (!instanceTrpc) return;
    instanceTrpc.files.tree
      .query()
      .then(({ entries }) => setFileTree(entries))
      .catch(() => {});
  }, [instanceTrpc]);

  const fetchTemplates = useCallback(async () => {
    setLoadingTemplates(true);
    try {
      const list = await platform.templates.list.query();
      setTemplates(list);
    } catch {}
    setLoadingTemplates(false);
  }, []);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  const fetchInstances = useCallback(async () => {
    setLoadingInstances(true);
    try {
      const list = await platform.instances.list.query();
      setInstances(list);
    } catch {}
    setLoadingInstances(false);
  }, []);

  useEffect(() => {
    fetchInstances();
  }, [fetchInstances]);

  const createInstance = useCallback(async (templateName: string) => {
    const name = window.prompt("Instance name:");
    if (!name?.trim()) return;
    setCreatingInstance(templateName);
    try {
      await platform.instances.create.mutate({ name: name.trim(), templateName });
      await fetchInstances();
    } catch (err: any) {
      window.alert(err?.message ?? "Failed to create instance");
    }
    setCreatingInstance(null);
  }, [fetchInstances]);

  const selectInstance = useCallback((name: string) => {
    connectionRef.current?.ws.close();
    connectionRef.current = null;
    activeSessionIdRef.current = null;
    setSelectedInstance(name);
    setSessionId(null);
    setMessages([]);
    setSessions([]);
    setFileTree([]);
    setOpenFile(null);
    setAuthRequired(false);
    setLog([]);
    setView("chat");
  }, []);

  const goBack = useCallback(() => {
    connectionRef.current?.ws.close();
    connectionRef.current = null;
    activeSessionIdRef.current = null;
    setSelectedInstance(null);
    setSessionId(null);
    setMessages([]);
    setSessions([]);
    setFileTree([]);
    setOpenFile(null);
    setAuthRequired(false);
    setLog([]);
    setView("list");
    fetchInstances();
  }, [fetchInstances]);

  const fetchSessions = useCallback(async () => {
    if (!selectedInstance) return;
    setLoadingSessions(true);
    try {
      const { connection, ws } = await openConnection(selectedInstance, () => {});
      await connection.initialize({
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
      });
      const result = await connection.listSessions({ cwd: "." });
      setSessions(result.sessions ?? []);
      ws.close();
    } catch {}
    setLoadingSessions(false);
  }, [selectedInstance]);

  useEffect(() => {
    if (selectedInstance) fetchSessions();
  }, [selectedInstance, fetchSessions]);

  const resumeSession = useCallback(async (sid: string) => {
    if (!selectedInstance) return;
    setBusy(true);
    setLoadingSession(true);
    setMessages([]);
    setSessionId(sid);

    connectionRef.current?.ws.close();
    connectionRef.current = null;
    activeSessionIdRef.current = null;

    const msgMap = new Map<string, Message>();
    const msgOrder: string[] = [];

    try {
      const { connection, ws } = await openConnection(selectedInstance, (u) => {
        if (
          u.sessionUpdate === "user_message_chunk" ||
          u.sessionUpdate === "agent_message_chunk"
        ) {
          if (u.content.type !== "text") return;
          const txt = u.content.text as string;
          if (/<[a-z-]+>/.test(txt) && /<\/[a-z-]+>/.test(txt)) return;
          const role: Role =
            u.sessionUpdate === "user_message_chunk" ? "user" : "assistant";
          const mid = u.messageId ?? crypto.randomUUID();
          const existing = msgMap.get(mid);
          if (existing) {
            const last = existing.parts[existing.parts.length - 1];
            if (last?.kind === "text") {
              last.text += u.content.text;
            } else {
              existing.parts.push({ kind: "text", text: u.content.text });
            }
          } else {
            const msg: Message = {
              id: mid,
              role,
              parts: [{ kind: "text", text: u.content.text }],
              streaming: false,
            };
            msgMap.set(mid, msg);
            msgOrder.push(mid);
          }
        } else if (u.sessionUpdate === "tool_call") {
          const mid = u.messageId ?? msgOrder[msgOrder.length - 1];
          const existing = mid ? msgMap.get(mid) : null;
          if (existing) {
            existing.parts.push({
              kind: "tool",
              title: u.title,
              status: u.status,
            });
          }
        }
      });
      await connection.initialize({
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
      });
      await connection.loadSession({
        sessionId: sid,
        cwd: ".",
        mcpServers: [],
      });
      ws.close();
    } catch {}

    setMessages(msgOrder.map((id) => msgMap.get(id)!));
    setLoadingSession(false);
    setBusy(false);
  }, [selectedInstance]);

  const openFileHandler = useCallback(
    async (path: string) => {
      if (!instanceTrpc) return;
      if (openFile?.path === path) {
        setOpenFile(null);
        return;
      }
      try {
        const data = await instanceTrpc.files.read.query({ path });
        if (data.content !== undefined)
          setOpenFile({ path: data.path, content: data.content });
      } catch {}
    },
    [instanceTrpc, openFile],
  );

  const addLog = useCallback((type: string, payload: object) => {
    const ts = new Date().toISOString().slice(11, 23);
    setLog((prev) => [...prev, { id: crypto.randomUUID(), ts, type, payload }]);
  }, []);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || busy || !selectedInstance) return;
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
    currentAssistantIdRef.current = assistantId;

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    addLog("prompt", { text });

    try {
      if (
        !connectionRef.current ||
        connectionRef.current.ws.readyState !== WebSocket.OPEN
      ) {
        const { connection, ws } = await openConnection(selectedInstance, (u) => {
          const aid = currentAssistantIdRef.current;
          if (!aid) return;
          if (
            u.sessionUpdate === "agent_message_chunk" &&
            u.content.type === "text"
          ) {
            setMessages((prev) =>
              prev.map((m) => {
                if (m.id !== aid) return m;
                const parts = [...m.parts];
                const last = parts[parts.length - 1];
                if (last?.kind === "text") {
                  parts[parts.length - 1] = {
                    kind: "text",
                    text: last.text + u.content.text,
                  };
                } else {
                  parts.push({ kind: "text", text: u.content.text });
                }
                return { ...m, parts };
              }),
            );
            addLog("text", { text: u.content.text });
          } else if (u.sessionUpdate === "tool_call") {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === aid
                  ? {
                      ...m,
                      parts: [
                        ...m.parts,
                        {
                          kind: "tool",
                          title: u.title,
                          status: u.status,
                        } as ToolChip,
                      ],
                    }
                  : m,
              ),
            );
            addLog("tool", { title: u.title, status: u.status });
          }
        });

        await connection.initialize({
          protocolVersion: PROTOCOL_VERSION,
          clientCapabilities: {
            fs: { readTextFile: true, writeTextFile: true },
          },
        });

        ws.onclose = () => {
          connectionRef.current = null;
        };

        connectionRef.current = { connection, ws };
      }

      const conn = connectionRef.current!.connection;

      if (!activeSessionIdRef.current) {
        if (sessionId) {
          await conn.unstable_resumeSession({
            sessionId,
            cwd: ".",
            mcpServers: [],
          });
          activeSessionIdRef.current = sessionId;
        } else {
          const session = await conn.newSession({
            cwd: ".",
            mcpServers: [],
          });
          setSessionId(session.sessionId);
          activeSessionIdRef.current = session.sessionId;
          addLog("session", { sessionId: session.sessionId });
        }
      }

      const result = await conn.prompt({
        sessionId: activeSessionIdRef.current!,
        prompt: [{ type: "text", text }],
      });

      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId ? { ...m, streaming: false } : m,
        ),
      );
      addLog("done", { stopReason: result.stopReason });
    } catch (err: any) {
      if (err?.code === -32000) {
        setAuthRequired(true);
        pendingPromptRef.current = text;
      }
      addLog("error", { message: err?.message });
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId ? { ...m, streaming: false } : m,
        ),
      );
      connectionRef.current?.ws.close();
      connectionRef.current = null;
      activeSessionIdRef.current = null;
    } finally {
      setBusy(false);
      textareaRef.current?.focus();
    }
  }, [input, busy, selectedInstance, sessionId, addLog]);

  const startLogin = useCallback(async () => {
    if (!instanceTrpc) return;
    setLoggingIn(true);
    setLoginUrl(null);
    setPasteReady(false);
    try {
      const { url } = await instanceTrpc.auth.login.mutate();
      setLoginUrl(url);
      window.open(url, "_blank");
      setPasteReady(true);
    } catch {
      setLoggingIn(false);
    }
  }, [instanceTrpc]);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  function instanceDotClass(inst: InstanceView): string {
    if (inst.status?.podReady) return "ready";
    if (inst.status?.currentState === "error") return "error";
    if (inst.desiredState === "hibernated" || inst.status?.currentState === "hibernated") return "hibernated";
    return "running";
  }

  const instancesByTemplate = useMemo(() => {
    const map = new Map<string, InstanceView[]>();
    for (const inst of instances) {
      const list = map.get(inst.templateName) ?? [];
      list.push(inst);
      map.set(inst.templateName, list);
    }
    return map;
  }, [instances]);

  if (view === "list") {
    return (
      <div className="shell">
        <header className="header">
          <span className="header-logo">◈ Humr</span>
          <span className="header-sub">PROTOTYPE</span>
        </header>

        <div className="list-view">
          <div className="list-toolbar">
            <span className="list-title">templates</span>
            <button className="left-sidebar-refresh" onClick={() => { fetchTemplates(); fetchInstances(); }}>↻</button>
          </div>

          {(loadingTemplates || loadingInstances) && (
            <div className="sessions-empty">loading...</div>
          )}
          {!loadingTemplates && templates.length === 0 && (
            <div className="sessions-empty">no templates</div>
          )}

          <div className="template-grid">
            {templates.map((tmpl) => {
              const tmplInstances = instancesByTemplate.get(tmpl.name) ?? [];
              return (
                <div key={tmpl.name} className="template-card">
                  <div className="template-card-header">
                    <div className="template-card-title-row">
                      <span className="template-card-name">{tmpl.name}</span>
                      <button
                        className="create-instance-btn"
                        disabled={creatingInstance === tmpl.name}
                        onClick={() => createInstance(tmpl.name)}
                      >
                        {creatingInstance === tmpl.name ? "…" : "+ instance"}
                      </button>
                    </div>
                    <span className="template-card-meta">
                      {tmpl.image}{tmpl.description ? ` · ${tmpl.description}` : ""}
                    </span>
                  </div>
                  <div className="template-card-instances">
                    {tmplInstances.length === 0 && (
                      <div className="template-card-empty">no instances</div>
                    )}
                    {tmplInstances.map((inst) => {
                      const ready = inst.status?.podReady === true;
                      return (
                        <div
                          key={inst.name}
                          className={`instance-entry${ready ? " clickable" : " disabled"}`}
                          onClick={ready ? () => selectInstance(inst.name) : undefined}
                        >
                          <div className="instance-header">
                            <span className={`instance-dot ${instanceDotClass(inst)}`} />
                            <span className="instance-name">{inst.name}</span>
                          </div>
                          <span className="instance-meta">
                            {inst.status
                              ? ready
                                ? inst.status.currentState
                                : inst.status.currentState === "running"
                                  ? "starting"
                                  : inst.status.currentState
                              : "unknown"}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="shell">
      <header className="header">
        <button className="back-btn" onClick={goBack}>← templates</button>
        <span className="header-logo">◈ Humr</span>
        <span className="header-sub">{selectedInstance}</span>
        {sessionId && (
          <button
            className="new-session-btn"
            onClick={() => {
              connectionRef.current?.ws.close();
              connectionRef.current = null;
              activeSessionIdRef.current = null;
              setSessionId(null);
              setMessages([]);
            }}
          >
            + new session
          </button>
        )}
        <span className={`header-status ${busy ? "busy" : "idle"}`}>
          {busy ? "▶ running" : "● ready"}
        </span>
      </header>

      <div className="body">
        <aside className="left-sidebar">
          <div className="left-sidebar-header">
            <span className="left-sidebar-title">sessions</span>
            <button className="left-sidebar-refresh" onClick={fetchSessions}>↻</button>
          </div>
          <div className="sessions-panel">
            {loadingSessions && (
              <div className="sessions-empty">loading sessions...</div>
            )}
            {!loadingSessions && sessions.length === 0 && (
              <div className="sessions-empty">no sessions</div>
            )}
            {sessions.map((s) => (
              <div
                key={s.sessionId}
                className={`session-entry ${s.sessionId === sessionId ? "active" : ""}`}
                onClick={() => resumeSession(s.sessionId)}
              >
                <span className="session-title">
                  {s.title || s.sessionId.slice(0, 12)}
                </span>
                {s.updatedAt && (
                  <span className="session-time">
                    {new Date(s.updatedAt).toLocaleString()}
                  </span>
                )}
              </div>
            ))}
          </div>
        </aside>

        <section className="chat-panel">
          <div className="messages">
            {authRequired && (
              <div className="auth-banner">
                <span className="auth-title">authentication required</span>
                <p className="auth-desc">
                  Claude is not logged in. Sign in to start a session.
                </p>
                {!loggingIn && (
                  <button className="auth-btn" onClick={startLogin}>
                    log in
                  </button>
                )}
                {loginUrl && (
                  <>
                    <a
                      className="auth-link"
                      href={loginUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      open login page
                    </a>
                    {!pasteReady && (
                      <p className="auth-desc">Waiting for login prompt...</p>
                    )}
                  </>
                )}
                {pasteReady && (
                  <>
                    <p className="auth-desc">
                      Paste the authentication code below:
                    </p>
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
                          if (!instanceTrpc) return;
                          const result = await instanceTrpc.auth.code.mutate({
                            code: authCode.trim(),
                          });
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
            {!authRequired && loadingSession && (
              <div className="loading-session">
                <span className="spinner" />
                loading session…
              </div>
            )}
            {!authRequired && !loadingSession && messages.length === 0 && (
              <div className="empty">send a message to start a new session</div>
            )}
            {messages.map((m) => (
              <div key={m.id} className={`message ${m.role}`}>
                <span className="role-tag">
                  {m.role === "user" ? "you" : "agent"}
                </span>
                <div className="content">
                  {m.parts.map((p, i) =>
                    p.kind === "text" ? (
                      <span key={i} className="text-part">
                        {p.text}
                        {m.streaming &&
                          i === m.parts.length - 1 &&
                          p.kind === "text" && <span className="cursor" />}
                      </span>
                    ) : (
                      <span key={i} className={`tool-chip status-${p.status}`}>
                        ⚙ {p.title}
                        <span className="tool-status">{p.status}</span>
                      </span>
                    ),
                  )}
                  {m.streaming && m.parts.length === 0 && (
                    <span className="cursor" />
                  )}
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
              disabled={busy || authRequired}
            />
            <button
              className="send-btn"
              onClick={send}
              disabled={busy || authRequired || !input.trim()}
            >
              {busy ? "…" : "send"}
            </button>
          </div>
        </section>

        <aside className="sidebar">
          <div className="sidebar-tabs">
            <button
              className={`sidebar-tab ${rightTab === "files" ? "active" : ""}`}
              onClick={() => setRightTab("files")}
            >
              files
            </button>
            <button
              className={`sidebar-tab ${rightTab === "log" ? "active" : ""}`}
              onClick={() => setRightTab("log")}
            >
              log
            </button>
          </div>
          <div className="sidebar-content">
            {rightTab === "files" && !openFile && (
              <div className="file-tree">
                {fileTree.length === 0 && (
                  <div className="file-tree-empty">no files yet</div>
                )}
                {fileTree.map((e) => (
                  <div
                    key={e.path}
                    className={`tree-entry ${e.type}`}
                    style={{
                      paddingLeft: `${16 + (e.path.split("/").length - 1) * 14}px`,
                    }}
                    onClick={
                      e.type === "file"
                        ? () => openFileHandler(e.path)
                        : undefined
                    }
                  >
                    <span className="tree-icon">
                      {e.type === "dir" ? "▸" : "·"}
                    </span>
                    <span className="tree-name">{e.path.split("/").pop()}</span>
                  </div>
                ))}
              </div>
            )}
            {rightTab === "files" && openFile && (
              <div className="file-viewer">
                <div className="file-viewer-header">
                  <button
                    className="file-viewer-back"
                    onClick={() => setOpenFile(null)}
                  >
                    ←
                  </button>
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
                  {log.length === 0 && (
                    <div className="log-empty">no events yet</div>
                  )}
                  {log.map((e) => (
                    <div key={e.id} className={`log-entry type-${e.type}`}>
                      <span className="log-ts">{e.ts}</span>
                      <span className="log-type">{e.type}</span>
                      <pre className="log-payload">
                        {JSON.stringify(e.payload, null, 2)}
                      </pre>
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
