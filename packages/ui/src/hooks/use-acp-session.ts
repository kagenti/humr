import { useRef, useEffect, useCallback } from "react";
import { PROTOCOL_VERSION } from "@agentclientprotocol/sdk/dist/acp.js";
import type { ClientSideConnection } from "@agentclientprotocol/sdk/dist/acp.js";
import type { McpServer } from "@agentclientprotocol/sdk/dist/schema/types.gen.js";
import { useStore } from "../store.js";
import { openConnection } from "../acp.js";
import { platform } from "../platform.js";
import type { Message, MessagePart, Attachment, ToolChip } from "../types.js";
import { instanceState } from "./../components/status-indicator.js";
import { getSavedPreferences } from "./../components/session-config-popover.js";

// ── Shared helpers ──

/** Extract tool content from ACP update payloads */
function mapToolContent(content: any[] | undefined) {
  return content?.map((c: any) => ({ type: c.type, text: c.text ?? c.content?.text })).filter((c: any) => c.text);
}

/** Strip system tags from text chunks */
function cleanText(raw: string): string {
  return raw.replace(/<[a-z-]+>[\s\S]*?<\/[a-z-]+>/g, "").trim();
}

/** Detect text-based files. Browsers often leave file.type empty for Markdown, YAML, etc. */
const TEXT_EXTENSIONS = new Set([
  ".md", ".mdx", ".txt", ".json", ".jsonl", ".csv", ".tsv", ".yaml", ".yml",
  ".xml", ".html", ".htm", ".css", ".scss", ".js", ".jsx", ".ts", ".tsx",
  ".py", ".rb", ".go", ".rs", ".java", ".c", ".h", ".cpp", ".hpp", ".sh",
  ".toml", ".ini", ".env", ".log", ".sql", ".graphql", ".svg",
]);

/**
 * Parse a replayed user message into chip + text parts.
 *
 * The Claude SDK round-trips uploaded attachments back as text:
 *  - text files become `<context ref="file:///NAME">FULL_BODY</context>`
 *  - binary files become `[@NAME](file:///PATH)`
 *
 * Both should render as a file chip — we don't want to dump the whole file
 * body into the user bubble.
 */
function parseUserText(text: string): MessagePart[] {
  const parts: MessagePart[] = [];
  const regex = /<context\s+ref="file:\/\/\/([^"]+)">[\s\S]*?<\/context>|\[@([^\]]+)\]\(file:\/\/\/([^)]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) {
      const seg = text.slice(last, m.index).trim();
      if (seg) parts.push({ kind: "text", text: seg });
    }
    const name = m[1] ?? m[2] ?? m[3];
    parts.push({ kind: "file", name, mimeType: "" });
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    const seg = text.slice(last).trim();
    if (seg) parts.push({ kind: "text", text: seg });
  }
  return parts.length > 0 ? parts : [{ kind: "text", text }];
}

function isTextMime(mime: string, name: string): boolean {
  if (mime.startsWith("text/")) return true;
  if (mime === "application/json" || mime === "application/xml") return true;
  const dot = name.lastIndexOf(".");
  if (dot !== -1 && TEXT_EXTENSIONS.has(name.substring(dot).toLowerCase())) return true;
  return false;
}

// ── Hook ──

export function useAcpSession(
  selectedInstance: string | null,
  selectedMcpServers: McpServer[],
  textareaRef: React.RefObject<HTMLTextAreaElement | null>,
) {
  const instances = useStore((s) => s.instances);
  const instancesLoaded = useStore((s) => s.loadedOnce.instances);
  const sessionId = useStore((s) => s.sessionId);
  const busy = useStore((s) => s.busy);
  const setSessionId = useStore((s) => s.setSessionId);
  const setMessages = useStore((s) => s.setMessages);
  const setSessions = useStore((s) => s.setSessions);
  const setBusy = useStore((s) => s.setBusy);
  const setLoadingSessions = useStore((s) => s.setLoadingSessions);
  const setLoadingSession = useStore((s) => s.setLoadingSession);
  const addLog = useStore((s) => s.addLog);
  const setSessionModes = useStore((s) => s.setSessionModes);
  const setSessionModels = useStore((s) => s.setSessionModels);
  const setSessionConfigOptions = useStore((s) => s.setSessionConfigOptions);
  const setQueuedMessage = useStore((s) => s.setQueuedMessage);
  const setMobileScreen = useStore((s) => s.setMobileScreen);
  const includeChannelSessions = useStore((s) => s.includeChannelSessions);
  const showAlert = useStore((s) => s.showAlert);

  const connectionRef = useRef<{ connection: ClientSideConnection; ws: WebSocket } | null>(null);
  const activeSessionIdRef = useRef<string | null>(null);
  const currentAssistantIdRef = useRef<string | null>(null);
  const ensureConnectionInFlight = useRef<Promise<ClientSideConnection | null> | null>(null);
  const sessionListAttemptsRef = useRef(0);
  const lastSessionListErrorRef = useRef<string | null>(null);

  // Cleanup refs on unmount
  useEffect(() => () => {
    connectionRef.current?.ws.close();
    connectionRef.current = null;
    activeSessionIdRef.current = null;
    currentAssistantIdRef.current = null;
  }, []);

  // ── Config capture & caching ──

  const captureSessionConfig = useCallback((response: { modes?: any; models?: any; configOptions?: any }) => {
    setSessionModes(response.modes ?? null);
    setSessionModels(response.models ?? null);
    setSessionConfigOptions(response.configOptions ?? []);
    if (selectedInstance) {
      try {
        localStorage.setItem(`humr-cached-config:${selectedInstance}`, JSON.stringify({
          modes: response.modes ?? null,
          models: response.models ?? null,
          configOptions: response.configOptions ?? [],
        }));
      } catch {}
    }
  }, [selectedInstance, setSessionModes, setSessionModels, setSessionConfigOptions]);

  const handleConfigUpdate = useCallback((u: any) => {
    if (u.sessionUpdate === "current_mode_update") {
      const modes = useStore.getState().sessionModes;
      if (modes) setSessionModes({ ...modes, currentModeId: u.currentModeId });
    } else if (u.sessionUpdate === "config_option_update") {
      setSessionConfigOptions(u.configOptions);
    }
  }, [setSessionModes, setSessionConfigOptions]);

  // Derive the selected instance's state for use as a stable dep
  const instanceRunState = instances.find(i => i.id === selectedInstance)?.state;

  // Restore cached config or fetch via throwaway session
  useEffect(() => {
    if (!selectedInstance || sessionId) return;
    const prefs = getSavedPreferences(selectedInstance);

    const applyConfig = (data: { modes?: any; models?: any; configOptions?: any }) => {
      if (data.modes) {
        const modes = { ...data.modes };
        if (prefs.mode && modes.availableModes?.some((m: any) => m.id === prefs.mode)) modes.currentModeId = prefs.mode;
        setSessionModes(modes);
      }
      if (data.models) {
        const models = { ...data.models };
        if (prefs.model && models.availableModels?.some((m: any) => m.modelId === prefs.model)) models.currentModelId = prefs.model;
        setSessionModels(models);
      }
      if (data.configOptions?.length) setSessionConfigOptions(data.configOptions);
    };

    // Try cache first
    try {
      const raw = localStorage.getItem(`humr-cached-config:${selectedInstance}`);
      if (raw) { applyConfig(JSON.parse(raw)); return; }
    } catch {}

    // Fetch from throwaway session (retry up to 3 times — the ACP server
    // inside the pod may not be ready immediately after state flips to running)
    if (instanceRunState !== "running") return;
    let cancelled = false;

    (async () => {
      for (let attempt = 0; attempt < 3 && !cancelled; attempt++) {
        try {
          const { connection, ws } = await openConnection(selectedInstance, () => {});
          if (cancelled) { ws.close(); return; }
          await connection.initialize({
            protocolVersion: PROTOCOL_VERSION,
            clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
          });
          const s = await connection.newSession({ cwd: ".", mcpServers: [] });
          ws.close();
          if (cancelled) return;
          const data = { modes: s.modes, models: s.models, configOptions: s.configOptions };
          try { localStorage.setItem(`humr-cached-config:${selectedInstance}`, JSON.stringify(data)); } catch {}
          applyConfig(data);
          return; // success
        } catch (err: any) {
          addLog("error", {
            message: err?.message ?? "Failed to fetch session configuration",
          });
          if (!cancelled) await new Promise(r => setTimeout(r, 2000));
        }
      }
    })();

    return () => { cancelled = true; };
  }, [selectedInstance, sessionId, instanceRunState, setSessionModes, setSessionModels, setSessionConfigOptions, addLog]);

  // Wake hibernated instance on entry
  useEffect(() => {
    if (!selectedInstance) return;
    const inst = instances.find(i => i.id === selectedInstance);
    if (inst && instanceState(inst) === "hibernated") {
      platform.instances.wake.mutate({ id: selectedInstance }).catch(() => {});
    }
  }, [selectedInstance, instances]);

  // ── Session list ──

  const fetchSessions = useCallback(async () => {
    if (!selectedInstance) return false;
    const inst = useStore.getState().instances.find(x => x.id === selectedInstance);
    if (!inst) {
      lastSessionListErrorRef.current = useStore.getState().loadedOnce.instances
        ? `Instance "${selectedInstance}" was not found`
        : null;
      return false;
    }
    if (inst.state !== "running") {
      lastSessionListErrorRef.current = null;
      return false;
    }
    try {
      const list = await platform.sessions.list.query({ instanceId: selectedInstance, includeChannel: includeChannelSessions });
      setSessions(list);
      lastSessionListErrorRef.current = null;
      return true;
    } catch (err: any) {
      lastSessionListErrorRef.current = err?.message ?? "Failed to load sessions";
      return false;
    }
  }, [selectedInstance, includeChannelSessions, setSessions]);

  useEffect(() => {
    if (!selectedInstance) return;
    setLoadingSessions(true);
    sessionListAttemptsRef.current = 0;
    lastSessionListErrorRef.current = null;
    let stopped = false;
    const attempt = () => {
      if (stopped) return;
      fetchSessions().then((ok) => {
        if (stopped) return;
        if (ok) { setLoadingSessions(false); return; }
        sessionListAttemptsRef.current += 1;
        const instanceMissing = instancesLoaded && !instances.some((i) => i.id === selectedInstance);
        const maxAttemptsReached = sessionListAttemptsRef.current >= 10;
        if (instanceMissing || maxAttemptsReached) {
          setLoadingSessions(false);
          const message = lastSessionListErrorRef.current
            ?? (instanceMissing
              ? `Instance "${selectedInstance}" was not found`
              : "Failed to load sessions for this instance");
          addLog("error", { message });
          showAlert(message, "Session List Failed").catch(() => {});
          return;
        }
        setTimeout(attempt, 3000);
      });
    };
    attempt();
    return () => { stopped = true; };
  }, [selectedInstance, fetchSessions, setLoadingSessions, instancesLoaded, instances, addLog, showAlert]);

  // ── Streaming update handler (shared between live prompts) ──

  function createLiveUpdateHandler() {
    return (u: any) => {
      handleConfigUpdate(u);
      const aid = currentAssistantIdRef.current;
      if (!aid) return;

      if (u.sessionUpdate === "agent_message_chunk" && u.content.type === "text") {
        setMessages((p) =>
          p.map((m) => {
            if (m.id !== aid) return m;
            const parts = [...m.parts];
            const l = parts[parts.length - 1];
            l?.kind === "text"
              ? (parts[parts.length - 1] = { kind: "text", text: l.text + u.content.text })
              : parts.push({ kind: "text", text: u.content.text });
            return { ...m, parts };
          }),
        );
        addLog("text", { text: u.content.text });
      } else if (u.sessionUpdate === "agent_message_chunk" && u.content.type === "image") {
        setMessages((p) =>
          p.map((m) => {
            if (m.id !== aid) return m;
            return { ...m, parts: [...m.parts, { kind: "image", data: u.content.data, mimeType: u.content.mimeType }] };
          }),
        );
        addLog("image", { mimeType: u.content.mimeType });
      } else if (u.sessionUpdate === "tool_call") {
        const content = mapToolContent(u.content);
        setMessages((p) =>
          p.map((m) =>
            m.id === aid
              ? { ...m, parts: [...m.parts, { kind: "tool", toolCallId: u.toolCallId, title: u.title, status: u.status, content } as ToolChip] }
              : m,
          ),
        );
        addLog("tool", { title: u.title, status: u.status });
      } else if (u.sessionUpdate === "tool_call_update") {
        const newContent = mapToolContent(u.content);
        setMessages((p) =>
          p.map((m) => {
            if (m.id !== aid) return m;
            const parts = m.parts.map((part) =>
              part.kind === "tool" && part.toolCallId === u.toolCallId
                ? { ...part, status: u.status ?? part.status, title: u.title ?? part.title, content: newContent?.length ? newContent : part.content }
                : part,
            );
            return { ...m, parts };
          }),
        );
      }
    };
  }

  // ── Apply saved preferences to a session (new or resumed) ──

  async function applySavedPreferences(
    conn: ClientSideConnection,
    sid: string,
    sessionResponse: { modes?: any; models?: any; configOptions?: any },
  ) {
    if (!selectedInstance) return;
    const prefs = getSavedPreferences(selectedInstance);
    const calls: Promise<unknown>[] = [];
    if (prefs.model && sessionResponse.models?.availableModels.some((m: any) => m.modelId === prefs.model)) {
      calls.push(conn.unstable_setSessionModel({ sessionId: sid, modelId: prefs.model }).catch(() => {}));
      setSessionModels({ ...sessionResponse.models, currentModelId: prefs.model });
    }
    if (prefs.mode && sessionResponse.modes?.availableModes.some((m: any) => m.id === prefs.mode)) {
      calls.push(conn.setSessionMode({ sessionId: sid, modeId: prefs.mode }).catch(() => {}));
      setSessionModes({ ...sessionResponse.modes, currentModeId: prefs.mode });
    }
    for (const [configId, value] of Object.entries(prefs.config)) {
      const opt = sessionResponse.configOptions?.find((o: any) => o.id === configId);
      if (!opt) continue;
      const req = opt.type === "boolean"
        ? { sessionId: sid, configId, type: "boolean" as const, value: value === "true" }
        : { sessionId: sid, configId, value };
      calls.push(conn.setSessionConfigOption(req).catch(() => {}));
    }
    if (calls.length) await Promise.all(calls);
  }

  // ── Connection management ──

  const ensureConnectionInner = useCallback(async (): Promise<ClientSideConnection | null> => {
    if (!selectedInstance) return null;

    if (!connectionRef.current || connectionRef.current.ws.readyState !== WebSocket.OPEN) {
      const { connection, ws } = await openConnection(selectedInstance, createLiveUpdateHandler());
      await connection.initialize({
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
      });
      // addEventListener (not onclose=) so we don't clobber the handler that
      // closes the ACP ReadableStream controller inside openConnection.
      // activeSessionIdRef must be reset too — otherwise the next call skips
      // resume and the fresh agent process rejects with "Session not found".
      ws.addEventListener("close", () => {
        connectionRef.current = null;
        activeSessionIdRef.current = null;
      });
      ws.addEventListener("error", () => {
        addLog("error", { message: "WebSocket connection error" });
      });
      connectionRef.current = { connection, ws };
    }

    const conn = connectionRef.current!.connection;
    if (!activeSessionIdRef.current) {
      const sid = useStore.getState().sessionId;
      if (sid) {
        const resp = await conn.unstable_resumeSession({ sessionId: sid, cwd: ".", mcpServers: selectedMcpServers });
        captureSessionConfig(resp);
        activeSessionIdRef.current = sid;
        await applySavedPreferences(conn, sid, resp);
      } else {
        const s = await conn.newSession({ cwd: ".", mcpServers: selectedMcpServers });
        captureSessionConfig(s);
        setSessionId(s.sessionId);
        activeSessionIdRef.current = s.sessionId;
        addLog("session", { sessionId: s.sessionId });
        platform.sessions.create.mutate({ sessionId: s.sessionId, instanceId: selectedInstance }).catch(() => {});
        await applySavedPreferences(conn, s.sessionId, s);
      }
    }
    return conn;
  }, [selectedInstance, selectedMcpServers, captureSessionConfig]);

  const ensureConnection = useCallback((): Promise<ClientSideConnection | null> => {
    if (!ensureConnectionInFlight.current) {
      ensureConnectionInFlight.current = ensureConnectionInner().finally(() => {
        ensureConnectionInFlight.current = null;
      });
    }
    return ensureConnectionInFlight.current;
  }, [ensureConnectionInner]);

  // ── Session reset ──

  const resetSession = useCallback(() => {
    connectionRef.current?.ws.close();
    connectionRef.current = null;
    activeSessionIdRef.current = null;
    setSessionId(null);
    setMessages([]);
    setSessionModes(null);
    setSessionModels(null);
    setSessionConfigOptions([]);
  }, [setSessionId, setMessages, setSessionModes, setSessionModels, setSessionConfigOptions]);

  // ── Resume session (load history) ──

  const resumeSession = useCallback(async (sid: string) => {
    if (!selectedInstance) return;
    setBusy(true);
    setLoadingSession(true);
    setMessages([]);
    setSessionId(sid);
    setMobileScreen("chat");
    connectionRef.current?.ws.close();
    connectionRef.current = null;
    activeSessionIdRef.current = null;

    const mm = new Map<string, Message>();
    const mo: string[] = [];
    let loadFailed = false;

    const currentAssistant = (): Message => {
      let lastUserIdx = -1;
      for (let i = mo.length - 1; i >= 0; i--) {
        if (mm.get(mo[i])?.role === "user") { lastUserIdx = i; break; }
      }
      for (let i = lastUserIdx + 1; i < mo.length; i++) {
        const m = mm.get(mo[i]);
        if (m?.role === "assistant") return m;
      }
      const id = crypto.randomUUID();
      const m: Message = { id, role: "assistant", parts: [], streaming: false };
      mm.set(id, m);
      mo.push(id);
      return m;
    };

    try {
      const { connection, ws } = await openConnection(selectedInstance, (u) => {
        handleConfigUpdate(u);

        if (u.sessionUpdate === "user_message_chunk" && u.content.type === "text") {
          const txt = cleanText(u.content.text as string);
          if (!txt) return;
          const mid = u.messageId ?? crypto.randomUUID();
          const newParts = parseUserText(txt);
          const ex = mm.get(mid);
          if (ex) {
            for (const p of newParts) {
              const l = ex.parts[ex.parts.length - 1];
              if (p.kind === "text" && l?.kind === "text") {
                l.text += p.text;
              } else {
                ex.parts.push(p);
              }
            }
          } else {
            mm.set(mid, { id: mid, role: "user", parts: newParts, streaming: false });
            mo.push(mid);
          }
        } else if (u.sessionUpdate === "user_message_chunk" && u.content.type === "image") {
          const mid = u.messageId ?? crypto.randomUUID();
          const ex = mm.get(mid);
          const part = { kind: "image" as const, data: u.content.data as string, mimeType: u.content.mimeType as string };
          if (ex) {
            ex.parts.push(part);
          } else {
            mm.set(mid, { id: mid, role: "user", parts: [part], streaming: false });
            mo.push(mid);
          }
        } else if (u.sessionUpdate === "agent_message_chunk" && u.content.type === "text") {
          const txt = cleanText(u.content.text as string);
          if (!txt) return;
          const target = currentAssistant();
          const l = target.parts[target.parts.length - 1];
          l?.kind === "text" ? (l.text += txt) : target.parts.push({ kind: "text", text: txt });
        } else if (u.sessionUpdate === "agent_message_chunk" && u.content.type === "image") {
          const target = currentAssistant();
          target.parts.push({ kind: "image", data: u.content.data as string, mimeType: u.content.mimeType as string });
        } else if (u.sessionUpdate === "tool_call") {
          const target = currentAssistant();
          target.parts.push({ kind: "tool", toolCallId: u.toolCallId, title: u.title, status: u.status, content: mapToolContent(u.content) });
        } else if (u.sessionUpdate === "tool_call_update") {
          for (const [, m] of mm) {
            const chip = m.parts.find((p): p is ToolChip => p.kind === "tool" && p.toolCallId === u.toolCallId);
            if (chip) {
              if (u.status) chip.status = u.status;
              if (u.title) chip.title = u.title;
              if (u.content) chip.content = mapToolContent(u.content);
              break;
            }
          }
        }
      });

      await connection.initialize({
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
      });
      const resp = await connection.loadSession({ sessionId: sid, cwd: ".", mcpServers: selectedMcpServers });
      captureSessionConfig(resp);
      ws.close();

      // Apply saved prefs to the store only (optimistic) — the connection is
      // closed after loadSession. The real ACP calls happen when ensureConnection
      // opens a live connection and calls applySavedPreferences.
      if (selectedInstance) {
        const prefs = getSavedPreferences(selectedInstance);
        if (prefs.model && resp.models?.availableModels?.some((m: any) => m.modelId === prefs.model)) {
          setSessionModels({ ...resp.models, currentModelId: prefs.model });
        }
        if (prefs.mode && resp.modes?.availableModes?.some((m: any) => m.id === prefs.mode)) {
          setSessionModes({ ...resp.modes, currentModeId: prefs.mode });
        }
      }
    } catch (err: any) {
      loadFailed = true;
      const errMsg = err?.message ?? "Failed to load session";
      addLog("error", { message: errMsg });
      setMessages([{
        id: crypto.randomUUID(),
        role: "assistant",
        parts: [{ kind: "text", text: `Failed to load session: ${errMsg}` }],
        streaming: false,
      }]);
      showAlert(errMsg, "Session Load Failed").catch(() => {});
    }

    if (!loadFailed) {
      setMessages(mo.map((id) => mm.get(id)!));
    }
    setLoadingSession(false);
    setBusy(false);
  }, [selectedInstance, selectedMcpServers, setBusy, setLoadingSession, setMessages, setSessionId, setMobileScreen, captureSessionConfig, handleConfigUpdate, addLog, showAlert]);

  // ── Send prompt ──

  const sendPrompt = useCallback(async (text: string, attachments?: Attachment[]) => {
    if ((!text && (!attachments || attachments.length === 0)) || !selectedInstance) return;
    setBusy(true);

    const userParts: Message["parts"] = [];
    if (attachments?.length) for (const a of attachments) userParts.push(a);
    if (text) userParts.push({ kind: "text", text });

    const uMsg: Message = { id: crypto.randomUUID(), role: "user", parts: userParts, streaming: false };
    const aId = crypto.randomUUID();
    const aMsg: Message = { id: aId, role: "assistant", parts: [], streaming: true };
    currentAssistantIdRef.current = aId;
    setMessages((p) => [...p, uMsg, aMsg]);
    addLog("prompt", { text });

    try {
      const conn = await ensureConnection();
      if (!conn) throw new Error("Failed to establish connection");

      const promptBlocks: any[] = [];
      if (attachments?.length) {
        for (const a of attachments) {
          if (a.kind === "image") {
            promptBlocks.push({ type: "image", data: a.data, mimeType: a.mimeType });
          } else if (isTextMime(a.mimeType, a.name)) {
            // Claude only honors EmbeddedResource with a `text` field — decode base64 back to UTF-8.
            const text = new TextDecoder().decode(Uint8Array.from(atob(a.data), c => c.charCodeAt(0)));
            promptBlocks.push({
              type: "resource",
              resource: { uri: `file:///${a.name}`, text, mimeType: a.mimeType },
            });
          } else {
            // Binary blobs are ignored by the Claude agent — send as resource_link so the
            // file name at least appears in the conversation, and warn in the log.
            addLog("warning", { message: `Binary attachment "${a.name}" (${a.mimeType}) — Claude cannot read this file type.` });
            promptBlocks.push({ type: "resource_link", uri: `file:///${a.name}`, name: a.name, mimeType: a.mimeType });
          }
        }
      }
      if (text) promptBlocks.push({ type: "text", text });

      const r = await conn.prompt({ sessionId: activeSessionIdRef.current!, prompt: promptBlocks });
      setMessages((p) => p.map((m) => (m.id === aId ? { ...m, streaming: false } : m)));
      addLog("done", { stopReason: r.stopReason });
    } catch (err: any) {
      const errMsg = err?.message ?? String(err);
      addLog("error", { message: errMsg });
      setMessages((p) => p.map((m) =>
        m.id === aId ? { ...m, streaming: false, parts: [{ kind: "text" as const, text: errMsg }] } : m,
      ));
      connectionRef.current?.ws.close();
      connectionRef.current = null;
      activeSessionIdRef.current = null;
    } finally {
      setBusy(false);
      fetchSessions();
      textareaRef.current?.focus();
      const queued = useStore.getState().queuedMessage;
      if (queued) {
        setQueuedMessage(null);
        setTimeout(() => sendPrompt(queued), 0);
      }
    }
  }, [selectedInstance, ensureConnection, addLog, setBusy, setMessages, fetchSessions, setQueuedMessage, textareaRef]);

  const stopAgent = useCallback(async () => {
    const conn = connectionRef.current?.connection;
    const sid = activeSessionIdRef.current;
    if (!conn || !sid) return;
    try { await conn.cancel({ sessionId: sid }); } catch {}
  }, []);

  return {
    connectionRef,
    activeSessionIdRef,
    ensureConnection,
    resetSession,
    resumeSession,
    sendPrompt,
    stopAgent,
    fetchSessions,
    busy,
  };
}
