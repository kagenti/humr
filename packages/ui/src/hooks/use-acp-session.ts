import { useRef, useEffect, useCallback } from "react";
import { PROTOCOL_VERSION } from "@agentclientprotocol/sdk/dist/acp.js";
import type { ClientSideConnection } from "@agentclientprotocol/sdk/dist/acp.js";
import type { McpServer } from "@agentclientprotocol/sdk/dist/schema/types.gen.js";
import { useStore } from "../store.js";
import { openConnection } from "../acp.js";
import { platform } from "../platform.js";
import { applyUpdate, finalizeAllStreaming, hasStreamingAssistant, isTextMime } from "../session-projection.js";
import type { Message, Attachment } from "../types.js";
import { instanceState } from "./../components/status-indicator.js";
import { getSavedPreferences } from "./../components/session-config-popover.js";
import { runQuery } from "../store/query-helpers.js";

/**
 * Read a human-readable message off any error shape we may see here. The
 * promise that `prompt`/`loadSession` returns can reject with:
 *  - an `Error` / `DOMException` — has `.message`
 *  - the raw JSON-RPC error `{ code, message, data }` — has `.message`
 *  - a WebSocket `CloseEvent` on connection drop — no message; use `code`/`reason`
 *  - a WebSocket `Event` from `onerror` — browsers omit useful details here
 *
 * The fallback `String(e)` on an Event yields `[object Event]`, which is what
 * users were seeing on disconnect.
 */
function extractErrorMessage(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) {
    const m = (e as { message: unknown }).message;
    if (typeof m === "string" && m) return m;
  }
  if (e instanceof Error) return e.message;
  if (typeof CloseEvent !== "undefined" && e instanceof CloseEvent) {
    return e.reason || `Connection closed (code ${e.code})`;
  }
  if (typeof Event !== "undefined" && e instanceof Event) {
    return "Connection error";
  }
  return String(e);
}

/**
 * Classify a resume-time failure so the inline error card can render the
 * right message and action. Prefers structured error fields (ACP JSON-RPC
 * `code`, tRPC `data.code`) over regexing the human-readable message — the
 * latter breaks the moment server wording changes.
 */
function classifyResumeError(e: unknown): "not-found" | "connection" | "other" {
  if (e && typeof e === "object") {
    const anyE = e as { code?: unknown; data?: { code?: unknown } };
    if (anyE.code === -32002) return "not-found";
    if (anyE.data?.code === "NOT_FOUND") return "not-found";
    if (e instanceof DOMException) return "connection";
  }
  const msg = extractErrorMessage(e);
  if (/not\s*found/i.test(msg)) return "not-found";
  if (/refused|ECONN|WebSocket|network/i.test(msg)) return "connection";
  return "other";
}

// ── Hook ──

export function useAcpSession(
  selectedInstance: string | null,
  selectedMcpServers: McpServer[],
  textareaRef: React.RefObject<HTMLTextAreaElement | null>,
) {
  const instances = useStore((s) => s.instances);
  const sessionId = useStore((s) => s.sessionId);
  const messages = useStore((s) => s.messages);
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
  const setMobileScreen = useStore((s) => s.setMobileScreen);
  const includeChannelSessions = useStore((s) => s.includeChannelSessions);
  const setSessionError = useStore((s) => s.setSessionError);
  const showToast = useStore((s) => s.showToast);

  const connectionRef = useRef<{ connection: ClientSideConnection; ws: WebSocket } | null>(null);
  const activeSessionIdRef = useRef<string | null>(null);
  const ensureConnectionInFlight = useRef<Promise<ClientSideConnection | null> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const isMountedRef = useRef(true);
  const reconnectFnRef = useRef<(() => void) | null>(null);
  // Session IDs already persisted to the platform DB. We only upsert after a
  // prompt actually succeeds, so opening the app without sending anything
  // (or StrictMode double-mount) doesn't leave empty rows in the sidebar.
  const persistedSessionsRef = useRef<Set<string>>(new Set());

  // Derive busy from the projection instead of tracking it with explicit
  // setBusy calls scattered across sendPrompt/resume/disconnect paths. The
  // projection owns streaming state on every message, so "any streaming
  // assistant" is the authoritative answer.
  const busy = hasStreamingAssistant(messages);
  useEffect(() => { setBusy(busy); }, [busy, setBusy]);

  useEffect(() => () => {
    isMountedRef.current = false;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    connectionRef.current?.ws.close();
    connectionRef.current = null;
    activeSessionIdRef.current = null;
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

    try {
      const raw = localStorage.getItem(`humr-cached-config:${selectedInstance}`);
      if (raw) { applyConfig(JSON.parse(raw)); return; }
    } catch {}

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
          try { await connection.unstable_closeSession?.({ sessionId: s.sessionId }); } catch {}
          ws.close();
          if (cancelled) return;
          const data = { modes: s.modes, models: s.models, configOptions: s.configOptions };
          try { localStorage.setItem(`humr-cached-config:${selectedInstance}`, JSON.stringify(data)); } catch {}
          applyConfig(data);
          return;
        } catch {
          if (!cancelled) await new Promise(r => setTimeout(r, 2000));
        }
      }
    })();

    return () => { cancelled = true; };
  }, [selectedInstance, sessionId, instanceRunState, setSessionModes, setSessionModels, setSessionConfigOptions]);

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
    if (inst?.state !== "running") return false;
    const list = await runQuery(
      `sessions:${selectedInstance}`,
      () => platform.sessions.list.query({ instanceId: selectedInstance, includeChannel: includeChannelSessions }),
      { fallback: "Couldn't refresh session list" },
    );
    if (!list) return false;
    setSessions(list);
    return true;
  }, [selectedInstance, includeChannelSessions, setSessions]);

  useEffect(() => {
    if (!selectedInstance) return;
    setLoadingSessions(true);
    let stopped = false;
    const attempt = () => {
      if (stopped) return;
      fetchSessions().then((ok) => {
        if (stopped) return;
        if (ok) { setLoadingSessions(false); return; }
        setTimeout(attempt, 3000);
      });
    };
    attempt();
    return () => { stopped = true; };
  }, [selectedInstance, fetchSessions, setLoadingSessions]);

  // ── Streaming update handler ──

  /** Drop a pending permission prompt whose resolution arrived out-of-band —
   *  either another client answered it or the agent proceeded without one.
   *  Local-only: we don't resolve the ACP promise, just clean up the UI. */
  const dismissStalePermission = useCallback((toolCallId: string | undefined) => {
    if (!toolCallId) return;
    const pending = useStore.getState().pendingPermissions;
    if (pending.some((p) => p.toolCallId === toolCallId)) {
      useStore.getState().dismissPendingPermission(toolCallId);
    }
  }, []);

  /** Build an update handler that feeds every sessionUpdate through the
   *  pure projection and fires a couple of side effects (log entries,
   *  permission-dialog cleanup) that aren't about message shape. */
  const makeUpdateHandler = useCallback(() => {
    return (u: any) => {
      handleConfigUpdate(u);


      if ((u?.sessionUpdate === "tool_call" || u?.sessionUpdate === "tool_call_update")
          && u.status && u.status !== "pending") {
        dismissStalePermission(u.toolCallId);
      }

      if (u?.sessionUpdate === "agent_message_chunk") {
        if (u.content?.type === "text") addLog("text", { text: u.content.text });
        else if (u.content?.type === "image") addLog("image", { mimeType: u.content.mimeType });
      } else if (u?.sessionUpdate === "tool_call") {
        addLog("tool", { title: u.title, status: u.status });
      }

      setMessages((prev) => applyUpdate(prev, u));
    };
  }, [handleConfigUpdate, dismissStalePermission, addLog, setMessages]);

  // ── Apply saved preferences to a session ──

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
      const { connection, ws } = await openConnection(selectedInstance, makeUpdateHandler());
      await connection.initialize({
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
      });
      // addEventListener (not onclose=) so we don't clobber the handler that
      // closes the ACP ReadableStream controller inside openConnection.
      ws.addEventListener("close", () => {
        connectionRef.current = null;
        activeSessionIdRef.current = null;
        // Any in-flight stream is now dead. Finalize every streaming bubble
        // so busy clears, prompts show whatever they had so far, and the
        // next turn opens a fresh bubble instead of merging into a stale one.
        setMessages((prev) => finalizeAllStreaming(prev));
        reconnectFnRef.current?.();
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
        await applySavedPreferences(conn, s.sessionId, s);
      }
    }
    return conn;
  }, [selectedInstance, selectedMcpServers, captureSessionConfig, makeUpdateHandler, addLog, setMessages, setSessionId]);

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

  // ── Resume / rehydrate (load history) ──

  /**
   * Pull the authoritative message list from the agent via `loadSession`
   * through a throwaway connection, closing the current live WS first so
   * the runtime doesn't broadcast the history replay to both channels.
   * The caller is responsible for UX state (spinner vs. silent) and for
   * letting `ensureConnection` reopen a live channel after.
   */
  const loadHistoryInto = useCallback(async (sid: string): Promise<Message[]> => {
    if (!selectedInstance) return [];
    connectionRef.current?.ws.close();
    connectionRef.current = null;
    activeSessionIdRef.current = null;

    let replayed: Message[] = [];
    let ws: WebSocket | null = null;
    try {
      const conn = await openConnection(selectedInstance, (u) => {
        handleConfigUpdate(u);
        replayed = applyUpdate(replayed, u);
      });
      ws = conn.ws;
      await conn.connection.initialize({
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
      });
      const resp = await conn.connection.loadSession({ sessionId: sid, cwd: ".", mcpServers: selectedMcpServers });
      captureSessionConfig(resp);

      // Optimistic store updates for saved prefs — real ACP calls happen
      // when ensureConnection opens a live channel.
      if (selectedInstance) {
        const prefs = getSavedPreferences(selectedInstance);
        if (prefs.model && resp.models?.availableModels?.some((m: any) => m.modelId === prefs.model)) {
          setSessionModels({ ...resp.models, currentModelId: prefs.model });
        }
        if (prefs.mode && resp.modes?.availableModes?.some((m: any) => m.id === prefs.mode)) {
          setSessionModes({ ...resp.modes, currentModeId: prefs.mode });
        }
      }
    } finally {
      // Leave the SDK session alive — the live reconnect that follows will
      // resume it and the SDK dedupes by sessionId, so an open session is
      // cheap whereas closing it would force a `claude` CLI respawn. Only
      // the WS is throwaway.
      ws?.close();
    }

    return finalizeAllStreaming(replayed);
  }, [selectedInstance, selectedMcpServers, captureSessionConfig, handleConfigUpdate,
      setSessionModels, setSessionModes]);

  const resumeSession = useCallback(async (sid: string) => {
    if (!selectedInstance) return;
    setLoadingSession(true);
    setMessages([]);
    setSessionError(null);
    setSessionId(sid);
    setMobileScreen("chat");
    try {
      const fresh = await loadHistoryInto(sid);
      setMessages(fresh);
    } catch (e) {
      setSessionError({
        sessionId: sid,
        message: extractErrorMessage(e),
        kind: classifyResumeError(e),
      });
    }
    setLoadingSession(false);
  }, [selectedInstance, loadHistoryInto, setLoadingSession, setMessages, setSessionError, setSessionId, setMobileScreen]);

  // ── Send prompt ──

  const sendPrompt = useCallback(async (text: string, attachments?: Attachment[]) => {
    if ((!text && (!attachments || attachments.length === 0)) || !selectedInstance) return;

    const userParts: Message["parts"] = [];
    if (attachments?.length) for (const a of attachments) userParts.push(a);
    if (text) userParts.push({ kind: "text", text });

    const aId = crypto.randomUUID();

    // If a prior turn is still streaming, this bubble starts `queued: true`
    // — the projection will promote it to active once prompt N's content
    // actually arrives. The user sees a "Waiting for previous prompt…"
    // indicator meanwhile.
    const startingQueued = hasStreamingAssistant(useStore.getState().messages);
    const uMsg: Message = { id: crypto.randomUUID(), role: "user", parts: userParts, streaming: false };
    const aMsg: Message = { id: aId, role: "assistant", parts: [], streaming: true, queued: startingQueued };
    // Drop Retry buttons on any prior failed send — only the latest failure
    // should offer a retry. The error text itself stays for history.
    setMessages((p) => [
      ...p.map((m) => (m.error?.retryWith ? { ...m, error: { message: m.error.message } } : m)),
      uMsg,
      aMsg,
    ]);
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
            const textBody = new TextDecoder().decode(Uint8Array.from(atob(a.data), c => c.charCodeAt(0)));
            promptBlocks.push({
              type: "resource",
              resource: { uri: `file:///${a.name}`, text: textBody, mimeType: a.mimeType },
            });
          } else {
            addLog("warning", { message: `Binary attachment "${a.name}" (${a.mimeType}) — Claude cannot read this file type.` });
            promptBlocks.push({ type: "resource_link", uri: `file:///${a.name}`, name: a.name, mimeType: a.mimeType });
          }
        }
      }
      if (text) promptBlocks.push({ type: "text", text });

      const sid = activeSessionIdRef.current!;
      const r = await conn.prompt({ sessionId: sid, prompt: promptBlocks });
      addLog("done", { stopReason: r.stopReason });
      // Persist to the platform DB lazily, only once the session has real
      // content. Prevents empty rows from appearing in the sidebar when the
      // user opens the app and closes it without sending anything.
      if (!persistedSessionsRef.current.has(sid)) {
        persistedSessionsRef.current.add(sid);
        platform.sessions.create.mutate({ sessionId: sid, instanceId: selectedInstance })
          .catch((err) => {
            showToast({
              kind: "warning",
              message: `Session won't appear in the list: ${err instanceof Error ? err.message : "sync failed"}`,
            });
          });
      }
      // Belt-and-braces: if humr_turn_ended somehow didn't fire (server
      // variant without our extension), force-close our bubble anyway.
      setMessages((p) => p.map((m) => m.id === aId ? { ...m, streaming: false, queued: false } : m));
    } catch (err: unknown) {
      const errMsg = extractErrorMessage(err);
      addLog("error", { message: errMsg });
      setMessages((p) => p.map((m) =>
        m.id === aId
          ? { ...m, streaming: false, queued: false, parts: [], error: { message: errMsg, retryWith: { text, attachments } } }
          : m,
      ));
    } finally {
      fetchSessions();
      textareaRef.current?.focus();
    }
  }, [selectedInstance, ensureConnection, addLog, setMessages, fetchSessions, showToast, textareaRef]);

  const stopAgent = useCallback(async () => {
    const conn = connectionRef.current?.connection;
    const sid = activeSessionIdRef.current;
    // Finalize up front so the UI reacts immediately even if `cancel` hangs
    // or the SDK never rejects on a dropped stream.
    setMessages((p) => finalizeAllStreaming(p));
    if (!conn || !sid) return;
    try { await conn.cancel({ sessionId: sid }); } catch {}
  }, [setMessages]);

  const RECONNECT_DELAYS = [1_000, 2_000, 5_000, 10_000, 20_000, 30_000];

  useEffect(() => {
    reconnectFnRef.current = () => {
      if (!isMountedRef.current) return;
      const sid = useStore.getState().sessionId;
      const inst = useStore.getState().selectedInstance;
      if (!sid || inst !== selectedInstance) return;
      if (reconnectTimerRef.current) return;

      const attempt = reconnectAttemptRef.current;
      const delay = RECONNECT_DELAYS[Math.min(attempt, RECONNECT_DELAYS.length - 1)];
      reconnectAttemptRef.current = attempt + 1;

      reconnectTimerRef.current = setTimeout(async () => {
        reconnectTimerRef.current = null;
        if (!isMountedRef.current) return;
        const currentSid = useStore.getState().sessionId;
        const currentInst = useStore.getState().selectedInstance;
        if (!currentSid || currentInst !== selectedInstance) return;
        try {
          await ensureConnection();
          reconnectAttemptRef.current = 0;
        } catch {
          reconnectFnRef.current?.();
        }
      }, delay);
    };
  }, [selectedInstance, ensureConnection]);

  useEffect(() => {
    reconnectAttemptRef.current = 0;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, [sessionId, selectedInstance]);

  // Keep a live connection open whenever we're viewing a session. Without
  // this, `resumeSession` (sidebar click) opens a throwaway WS just for
  // history replay and closes it — so any pending tool-permission prompt
  // replayed to that socket has no channel to answer on.
  const loadingSession = useStore((s) => s.loading.session);
  useEffect(() => {
    // Don't open a live WS while resumeSession's throwaway is still replaying
    // history. If we overlap, both channels are engaged with the same session
    // and receive the history stream — the live projection would apply every
    // update twice.
    if (!selectedInstance || !sessionId || loadingSession) return;
    ensureConnection().catch(() => {});
  }, [selectedInstance, sessionId, loadingSession, ensureConnection]);

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
