import { useMutation } from "@tanstack/react-query";

import { disconnectMcp, startMcpOAuth } from "./fetchers.js";
import { mcpConnectionKeys } from "./queries.js";

export function useStartMcpOAuth() {
  return useMutation({
    mutationFn: startMcpOAuth,
    meta: { errorToast: "Couldn't start MCP connection" },
  });
}

export function useDisconnectMcp() {
  return useMutation({
    mutationFn: disconnectMcp,
    meta: {
      invalidates: [mcpConnectionKeys.list()],
      errorToast: "Couldn't disconnect MCP server",
    },
  });
}
