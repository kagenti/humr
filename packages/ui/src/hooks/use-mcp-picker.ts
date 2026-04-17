import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useStore } from "../store.js";
import { isMcpSecret, mcpHostnameFromSecretName } from "../types.js";
import type { McpServer } from "@agentclientprotocol/sdk/dist/schema/types.gen.js";
import type { McpOption } from "./../panels/mcps-panel.js";

/**
 * Manages MCP server selection for session creation.
 * Computes available options from agent access + secrets, tracks enable/disable state.
 */
export function useMcpPicker(selectedInstance: string | null) {
  const instances = useStore((s) => s.instances);
  const secrets = useStore((s) => s.secrets);
  const fetchSecrets = useStore((s) => s.fetchSecrets);
  const agentAccess = useStore((s) => s.agentAccess);
  const fetchAgentAccess = useStore((s) => s.fetchAgentAccess);

  const currentAgentId = useMemo(
    () => instances.find((i) => i.id === selectedInstance)?.agentId,
    [instances, selectedInstance],
  );
  const access = currentAgentId ? agentAccess[currentAgentId] : undefined;

  useEffect(() => { fetchSecrets(); }, [fetchSecrets]);
  useEffect(() => {
    if (currentAgentId && !agentAccess[currentAgentId]) fetchAgentAccess(currentAgentId);
  }, [currentAgentId, agentAccess, fetchAgentAccess]);

  const mcpOptions = useMemo<McpOption[]>(() => {
    const mcpSecrets = secrets.filter(isMcpSecret);
    if (!access) return [];
    const pool = access.mode === "all"
      ? mcpSecrets
      : mcpSecrets.filter((s) => access.secretIds.includes(s.id));
    return pool.map((s) => ({
      id: s.id,
      hostname: mcpHostnameFromSecretName(s.name),
      assigned: true,
    }));
  }, [secrets, access]);

  const [enabledMcps, setEnabledMcps] = useState<Set<string>>(new Set());
  const initializedRef = useRef(false);

  useEffect(() => {
    if (!initializedRef.current && mcpOptions.length > 0) {
      setEnabledMcps(new Set(mcpOptions.map((o) => o.hostname)));
      initializedRef.current = true;
    }
  }, [mcpOptions]);

  // Reset when agent changes
  useEffect(() => {
    initializedRef.current = false;
    setEnabledMcps(new Set());
  }, [currentAgentId]);

  const toggleMcp = useCallback(
    (hostname: string) =>
      setEnabledMcps((p) => {
        const n = new Set(p);
        n.has(hostname) ? n.delete(hostname) : n.add(hostname);
        return n;
      }),
    [],
  );
  const selectAllMcps = useCallback(
    () => setEnabledMcps(new Set(mcpOptions.map((o) => o.hostname))),
    [mcpOptions],
  );
  const clearAllMcps = useCallback(() => setEnabledMcps(new Set()), []);

  const selectedMcpServers = useMemo<McpServer[]>(
    () =>
      mcpOptions
        .filter((o) => enabledMcps.has(o.hostname))
        .map((o) => ({
          type: "http",
          name: o.hostname.split(".")[0],
          url: `https://${o.hostname}/mcp`,
          headers: [],
        })),
    [mcpOptions, enabledMcps],
  );

  return {
    mcpOptions,
    enabledMcps,
    toggleMcp,
    selectAllMcps,
    clearAllMcps,
    selectedMcpServers,
    access,
  };
}
