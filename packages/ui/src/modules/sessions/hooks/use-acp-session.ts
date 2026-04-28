import type { ClientSideConnection } from "@agentclientprotocol/sdk/dist/acp.js";
import { PROTOCOL_VERSION } from "@agentclientprotocol/sdk/dist/acp.js";
import type { McpServer } from "@agentclientprotocol/sdk/dist/schema/types.gen.js";
import { useCallback, useEffect, useRef } from "react";

import { platform } from "../../../platform.js";
import { useStore } from "../../../store.js";
import { openConnection } from "../../acp/acp.js";
import { finalizeAllStreaming, hasStreamingAssistant } from "../../acp/session-projection.js";
import {
  classifyResumeError,
  extractErrorMessage,
  RECONNECT_DELAYS,
} from "../../acp/utils.js";
import { useInstancesList } from "../../instances/api/queries.js";
import { useAcpConfigCache } from "./use-acp-config-cache.js";
import { useAcpHistory } from "./use-acp-history.js";
import { useAcpPrompt } from "./use-acp-prompt.js";
import { useAcpUpdateHandler } from "./use-acp-update-handler.js";

// ── Hook ──

export function useAcpSession(
  selectedInstance: string | null,
  selectedMcpServers: McpServer[],
  textareaRef: React.RefObject<HTMLTextAreaElement | null>,
) {
  const instances = useInstancesList();
  const sessionId = useStore((s) => s.sessionId);
  const messages = useStore((s) => s.messages);
  const setSessionId = useStore((s) => s.setSessionId);
  const setMessages = useStore((s) => s.setMessages);
  const setBusy = useStore((s) => s.setBusy);
  const setLoadingSession = useStore((s) => s.setLoadingSession);
  const addLog = useStore((s) => s.addLog);
  // Reset-on-leave + optimistic prefs nudges still need to reach the store
  // directly. Capture/handleConfigUpdate go through the config-cache hook.
  const setSessionModes = useStore((s) => s.setSessionModes);
  const setSessionModels = useStore((s) => s.setSessionModels);
  const setSessionConfigOptions = useStore((s) => s.setSessionConfigOptions);
  const setMobileScreen = useStore((s) => s.setMobileScreen);
  const setSessionError = useStore((s) => s.setSessionError);

  const connectionRef = useRef<{ connection: ClientSideConnection; ws: WebSocket } | null>(null);
  const activeSessionIdRef = useRef<string | null>(null);
  const ensureConnectionInFlight = useRef<Promise<ClientSideConnection | null> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const isMountedRef = useRef(true);
  const reconnectFnRef = useRef<(() => void) | null>(null);
  // Set when a live WS dies unexpectedly so the next ensureConnection knows to
  // reload via session/load (catching up any notifications appended during
  // the disconnect window) before reattaching via session/resume. Without
  // this, reconnect would only engage for *future* events and the gap stays
  // stranded in the runtime log until the user refreshes the page.
  const pendingReloadRef = useRef(false);

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

  const instanceRunState = instances.find(i => i.id === selectedInstance)?.state;
  const { captureSessionConfig, handleConfigUpdate, applySavedPreferences } =
    useAcpConfigCache(selectedInstance, sessionId, instanceRunState);
  const { loadHistory } = useAcpHistory(
    selectedInstance,
    selectedMcpServers,
    captureSessionConfig,
    handleConfigUpdate,
  );

  // Wake hibernated instance on entry
  useEffect(() => {
    if (!selectedInstance) return;
    const inst = instances.find(i => i.id === selectedInstance);
    if (inst?.state === "hibernated") {
      platform.instances.wake.mutate({ id: selectedInstance }).catch(() => {});
    }
  }, [selectedInstance, instances]);

  // The session list is owned by useAcpSessions in the sidebar / chat-view —
  // see modules/sessions/api/queries.ts. Mutations below invalidate the
  // shared TQ key after they cause new entries to land.

  const makeUpdateHandler = useAcpUpdateHandler(handleConfigUpdate);

  // ── Connection management ──

  const ensureConnectionInner = useCallback(async (): Promise<ClientSideConnection | null> => {
    if (!selectedInstance) return null;

    // After an unexpected WS death, reload the conversation from the runtime
    // log before reattaching. This is a session/load — runtime memory cache
    // hit when the session is still live there, cold-bootstrap from the
    // agent's on-disk store if it was reaped while we were offline. We swap
    // messages in one render rather than pre-clearing, so the user keeps
    // seeing their existing conversation until the fresh array is ready.
    if (pendingReloadRef.current) {
      const sid = useStore.getState().sessionId;
      pendingReloadRef.current = false;
      if (sid) {
        try {
          const fresh = await loadHistory(sid);
          setMessages(fresh);
        } catch (e) {
          // Network still unreachable, etc. — restore the flag so the next
          // reconnect attempt tries again.
          pendingReloadRef.current = true;
          throw e;
        }
      }
    }

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
        // Mark the next ensureConnection so it reloads from the runtime log
        // before reattaching — session/resume on its own only engages for
        // future events, so anything the agent appended during the gap would
        // be stranded otherwise. Skip when there's no session, since there's
        // nothing to reload.
        if (useStore.getState().sessionId) pendingReloadRef.current = true;
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
  }, [selectedInstance, selectedMcpServers, captureSessionConfig, applySavedPreferences, makeUpdateHandler, loadHistory, addLog, setMessages, setSessionId]);

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
    pendingReloadRef.current = false;
    setSessionId(null);
    setMessages([]);
    setSessionModes(null);
    setSessionModels(null);
    setSessionConfigOptions([]);
  }, [setSessionId, setMessages, setSessionModes, setSessionModels, setSessionConfigOptions]);

  // ── Resume / rehydrate ──

  const resumeSession = useCallback(async (sid: string) => {
    if (!selectedInstance) return;
    // Sidebar-click load handles its own history fetch — clear the
    // reload-on-reconnect flag so ensureConnection doesn't re-fetch right
    // after, when it opens the live channel for this session.
    pendingReloadRef.current = false;
    // Close current live WS — loadHistory replays through its own socket
    // and the runtime would broadcast every event to an overlapping live
    // channel, doubling every render.
    connectionRef.current?.ws.close();
    connectionRef.current = null;
    activeSessionIdRef.current = null;
    setLoadingSession(true);
    setMessages([]);
    setSessionError(null);
    setSessionId(sid);
    setMobileScreen("chat");
    try {
      const fresh = await loadHistory(sid);
      setMessages(fresh);
    } catch (e) {
      setSessionError({
        sessionId: sid,
        message: extractErrorMessage(e),
        kind: classifyResumeError(e),
      });
    }
    setLoadingSession(false);
  }, [selectedInstance, loadHistory, setLoadingSession, setMessages, setSessionError, setSessionId, setMobileScreen]);

  // ── Prompt + cancel ──

  const { sendPrompt, stopAgent } = useAcpPrompt(
    selectedInstance,
    ensureConnection,
    activeSessionIdRef,
    connectionRef,
    textareaRef,
  );

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
    busy,
  };
}
