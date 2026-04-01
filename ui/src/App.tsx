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

export default function App() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const logBottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    logBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [log]);

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
          } else if (event.type === "done" || event.type === "error") {
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, streaming: false } : m)),
            );
          }
        }
      }
    } catch (err: any) {
      addLog("error", { message: err.message });
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? { ...m, streaming: false } : m)),
      );
    } finally {
      setBusy(false);
      textareaRef.current?.focus();
    }
  }, [input, busy, addLog]);

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
        <span className={`header-status ${busy ? "busy" : "idle"}`}>
          {busy ? "▶ running" : "● ready"}
        </span>
      </header>

      <div className="body">
        <section className="chat-panel">
          <div className="messages">
            {messages.length === 0 && (
              <div className="empty">send a message to start a session</div>
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
              disabled={busy}
            />
            <button className="send-btn" onClick={send} disabled={busy || !input.trim()}>
              {busy ? "…" : "send"}
            </button>
          </div>
        </section>

        <aside className="log-panel">
          <div className="log-header">event log</div>
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
        </aside>
      </div>
    </div>
  );
}
