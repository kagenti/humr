import { useQuery } from "@tanstack/react-query";

import { createInstanceTrpc } from "../../../instance-trpc.js";
import { queryClient } from "../../../query-client.js";

export const fileKeys = {
  root: (instanceId: string) => ["files", instanceId] as const,
  tree: (instanceId: string) => [...fileKeys.root(instanceId), "tree"] as const,
  content: (instanceId: string, path: string) =>
    [...fileKeys.root(instanceId), "content", path] as const,
};

// Per-instance tRPC clients are cheap but creating a new one per refetch is
// wasteful churn. Cache by instanceId so each polled query reuses the same
// client for its lifetime.
const clientCache = new Map<string, ReturnType<typeof createInstanceTrpc>>();
function getInstanceTrpc(instanceId: string) {
  let client = clientCache.get(instanceId);
  if (!client) {
    client = createInstanceTrpc(instanceId);
    clientCache.set(instanceId, client);
  }
  return client;
}

interface FileContent {
  path: string;
  content: string;
  binary?: boolean;
  mimeType?: string;
}

export function useFileTreeQuery(instanceId: string | null) {
  return useQuery({
    queryKey: fileKeys.tree(instanceId ?? "_none"),
    queryFn: async () => {
      const trpc = getInstanceTrpc(instanceId!);
      const result = await trpc.files.tree.query();
      return result.entries;
    },
    enabled: !!instanceId,
    refetchInterval: 2000,
    staleTime: 2000,
    meta: { errorToast: "Couldn't refresh file tree" },
  });
}

export function useFileContentQuery(instanceId: string | null, path: string | null) {
  return useQuery({
    queryKey: fileKeys.content(instanceId ?? "_none", path ?? "_none"),
    queryFn: async () => {
      const trpc = getInstanceTrpc(instanceId!);
      const result = await trpc.files.read.query({ path: path! });
      return {
        path: result.path,
        content: result.content ?? "",
        binary: result.binary,
        mimeType: result.mimeType,
      } satisfies FileContent;
    },
    enabled: !!instanceId && !!path,
    refetchInterval: 2000,
    staleTime: 2000,
    retry: 0,
  });
}

/**
 * Imperative fetch for user-initiated file opens. Goes through the query
 * cache so the subsequent useFileContentQuery subscription reuses the result
 * instead of refetching.
 */
export async function fetchFileContent(instanceId: string, path: string): Promise<FileContent> {
  return queryClient.fetchQuery({
    queryKey: fileKeys.content(instanceId, path),
    queryFn: async () => {
      const trpc = getInstanceTrpc(instanceId);
      const result = await trpc.files.read.query({ path });
      return {
        path: result.path,
        content: result.content ?? "",
        binary: result.binary,
        mimeType: result.mimeType,
      };
    },
  });
}
