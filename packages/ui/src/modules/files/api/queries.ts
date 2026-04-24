import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { queryClient } from "../../../query-client.js";
import { createInstanceTrpc } from "../../instances/instance-trpc.js";

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
  mtimeMs?: number;
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
        mtimeMs: result.mtimeMs,
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
        mtimeMs: result.mtimeMs,
      };
    },
  });
}

function invalidateFiles(qc: ReturnType<typeof useQueryClient>, instanceId: string, path?: string) {
  qc.invalidateQueries({ queryKey: fileKeys.tree(instanceId) });
  if (path) qc.invalidateQueries({ queryKey: fileKeys.content(instanceId, path) });
}

export function useFileWriteMutation(instanceId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { path: string; content: string; expectedMtimeMs?: number }) => {
      const trpc = getInstanceTrpc(instanceId!);
      return trpc.files.write.mutate(input);
    },
    onSuccess: (_data, vars) => {
      if (instanceId) invalidateFiles(qc, instanceId, vars.path);
    },
  });
}

export function useFileCreateMutation(instanceId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { path: string; content?: string }) => {
      const trpc = getInstanceTrpc(instanceId!);
      return trpc.files.create.mutate({ path: input.path, content: input.content ?? "" });
    },
    onSuccess: (_data, vars) => {
      if (instanceId) invalidateFiles(qc, instanceId, vars.path);
    },
  });
}

export function useFolderCreateMutation(instanceId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { path: string }) => {
      const trpc = getInstanceTrpc(instanceId!);
      return trpc.files.mkdir.mutate(input);
    },
    onSuccess: () => {
      if (instanceId) invalidateFiles(qc, instanceId);
    },
  });
}

export function useFileRenameMutation(instanceId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { from: string; to: string; overwrite?: boolean }) => {
      const trpc = getInstanceTrpc(instanceId!);
      return trpc.files.rename.mutate(input);
    },
    onSuccess: (_data, vars) => {
      if (instanceId) {
        invalidateFiles(qc, instanceId, vars.from);
        qc.invalidateQueries({ queryKey: fileKeys.content(instanceId, vars.to) });
      }
    },
  });
}

export function useFileDeleteMutation(instanceId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { path: string }) => {
      const trpc = getInstanceTrpc(instanceId!);
      return trpc.files.remove.mutate(input);
    },
    onSuccess: (_data, vars) => {
      if (instanceId) invalidateFiles(qc, instanceId, vars.path);
    },
  });
}

export function useFileUploadMutation(instanceId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      path: string;
      contentBase64: string;
      contentType?: string;
      overwrite?: boolean;
    }) => {
      const trpc = getInstanceTrpc(instanceId!);
      return trpc.files.upload.mutate(input);
    },
    onSuccess: (_data, vars) => {
      if (instanceId) invalidateFiles(qc, instanceId, vars.path);
    },
  });
}
