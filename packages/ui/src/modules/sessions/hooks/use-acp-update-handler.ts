// ACP update payloads stay typed as `any` until step 07 introduces
// Zod-inferred types at the boundary.
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useCallback } from "react";

import { useStore } from "../../../store.js";
import { applyUpdate } from "../../acp/session-projection.js";

/**
 * Build the streaming-update callback fed to `openConnection`. The handler:
 *   - lets the config cache absorb mode/option updates,
 *   - drops any pending permission dialog whose tool call has moved past
 *     `pending` (another client answered, or the agent proceeded without one),
 *   - logs visible side effects (text/image chunks, tool-call starts), and
 *   - feeds every notification through the pure projection to update messages.
 *
 * Returns a *factory* — `openConnection` wants a fresh handler per WS, so the
 * orchestrator calls `make()` at the connect site.
 */
export function useAcpUpdateHandler(
  handleConfigUpdate: (u: any) => void,
): () => (u: any) => void {
  const setMessages = useStore((s) => s.setMessages);
  const addLog = useStore((s) => s.addLog);

  const dismissStalePermission = useCallback((toolCallId: string | undefined) => {
    if (!toolCallId) return;
    const pending = useStore.getState().pendingPermissions;
    if (pending.some((p) => p.toolCallId === toolCallId)) {
      useStore.getState().dismissPendingPermission(toolCallId);
    }
  }, []);

  return useCallback(() => {
    return (u: any) => {
      handleConfigUpdate(u);

      if ((u?.sessionUpdate === "tool_call" || u?.sessionUpdate === "tool_call_update")
          && u.status && u.status !== "pending") {
        dismissStalePermission(u.toolCallId);
      }

      if (u?.sessionUpdate === "agent_message_chunk") {
        if (u.content?.type === "text") addLog("text", { text: u.content.text });
        else if (u.content?.type === "image") addLog("image", { mimeType: u.content.mimeType });
      } else if (u?.sessionUpdate === "agent_thought_chunk") {
        if (u.content?.type === "text") addLog("thought", { text: u.content.text });
      } else if (u?.sessionUpdate === "tool_call") {
        addLog("tool", { title: u.title, status: u.status });
      }

      setMessages((prev) => applyUpdate(prev, u));
    };
  }, [handleConfigUpdate, dismissStalePermission, addLog, setMessages]);
}
