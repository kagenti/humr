// ACP newSession / unstable_resumeSession responses stay typed as `any`
// until step 07 introduces Zod-inferred types at the boundary.
/* eslint-disable @typescript-eslint/no-explicit-any */

import type { ClientSideConnection } from "@agentclientprotocol/sdk/dist/acp.js";
import type { McpServer } from "@agentclientprotocol/sdk/dist/schema/types.gen.js";
import { useCallback, useRef } from "react";

import { useStore } from "../../../store.js";

/**
 * Owns the "engage a live ACP connection with the active session" decision.
 *
 *   - If the store has a `sessionId` already → `unstable_resumeSession`
 *     reattaches the live channel (returning the SDK's snapshot of the
 *     session config so we can hydrate the popover).
 *   - If not → `newSession` creates one and commits the id to the store.
 *
 * Either way, the response is forwarded to `captureSessionConfig` (cache +
 * localStorage) and `applySavedPreferences` (replays the user's per-instance
 * mode/model/option prefs onto the new session).
 *
 * `engagedSessionIdRef` is the source of truth for "the session this live
 * conn is currently bound to". The orchestrator's WS close handler and
 * `resetSession` call `clear()` to drop the binding.
 */
export function useAcpSessionEngagement(
  selectedInstance: string | null,
  selectedMcpServers: McpServer[],
  captureSessionConfig: (response: any) => void,
  applySavedPreferences: (
    conn: ClientSideConnection,
    sid: string,
    sessionResponse: any,
  ) => Promise<void>,
): {
  engagedSessionIdRef: React.MutableRefObject<string | null>;
  engage: (conn: ClientSideConnection) => Promise<void>;
  clear: () => void;
} {
  const setSessionId = useStore((s) => s.setSessionId);
  const addLog = useStore((s) => s.addLog);

  const engagedSessionIdRef = useRef<string | null>(null);

  const engage = useCallback(async (conn: ClientSideConnection) => {
    if (!selectedInstance) return;
    if (engagedSessionIdRef.current) return;

    const sid = useStore.getState().sessionId;
    if (sid) {
      const resp = await conn.unstable_resumeSession({
        sessionId: sid,
        cwd: ".",
        mcpServers: selectedMcpServers,
      });
      captureSessionConfig(resp);
      engagedSessionIdRef.current = sid;
      await applySavedPreferences(conn, sid, resp);
    } else {
      const s = await conn.newSession({
        cwd: ".",
        mcpServers: selectedMcpServers,
      });
      captureSessionConfig(s);
      setSessionId(s.sessionId);
      engagedSessionIdRef.current = s.sessionId;
      addLog("session", { sessionId: s.sessionId });
      await applySavedPreferences(conn, s.sessionId, s);
    }
  }, [selectedInstance, selectedMcpServers, captureSessionConfig, applySavedPreferences, setSessionId, addLog]);

  const clear = useCallback(() => {
    engagedSessionIdRef.current = null;
  }, []);

  return { engagedSessionIdRef, engage, clear };
}
