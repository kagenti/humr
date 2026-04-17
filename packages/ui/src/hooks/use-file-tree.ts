import { useEffect, useCallback, useMemo } from "react";
import { useStore } from "../store.js";
import { createInstanceTrpc } from "../instance-trpc.js";

/**
 * Polls the agent's file tree and manages the open-file viewer.
 * Includes a no-op guard: skips store updates when tree hasn't changed.
 */
export function useFileTree(selectedInstance: string | null) {
  const setFileTree = useStore((s) => s.setFileTree);
  const setOpenFile = useStore((s) => s.setOpenFile);
  const setRightTab = useStore((s) => s.setRightTab);
  const openFile = useStore((s) => s.openFile);

  const instanceTrpc = useMemo(
    () => (selectedInstance ? createInstanceTrpc(selectedInstance) : null),
    [selectedInstance],
  );

  // Initial fetch
  useEffect(() => {
    if (!instanceTrpc) return;
    instanceTrpc.files.tree.query().then(({ entries }) => setFileTree(entries)).catch(() => {});
  }, [instanceTrpc, setFileTree]);

  // Poll every 2s with no-op guard
  useEffect(() => {
    if (!instanceTrpc) return;
    let prevJson = "";
    const i = setInterval(async () => {
      try {
        const { entries } = await instanceTrpc.files.tree.query();
        const json = JSON.stringify(entries);
        if (json !== prevJson) {
          prevJson = json;
          setFileTree(entries);
        }
        const cur = useStore.getState().openFile;
        if (cur) {
          try {
            const d = await instanceTrpc.files.read.query({ path: cur.path });
            const next = { path: d.path, content: d.content ?? "", binary: d.binary, mimeType: d.mimeType };
            // Skip if nothing meaningful changed — avoids recreating blob URLs and flashing previews.
            if (cur.path === next.path && cur.content === next.content && cur.binary === next.binary && cur.mimeType === next.mimeType) return;
            setOpenFile(next);
          } catch { setOpenFile(null); }
        }
      } catch {}
    }, 2000);
    return () => clearInterval(i);
  }, [instanceTrpc, setFileTree, setOpenFile]);

  const openFileHandler = useCallback(
    async (path: string) => {
      if (!instanceTrpc) return;
      if (openFile?.path === path) { setOpenFile(null); return; }
      try {
        const d = await instanceTrpc.files.read.query({ path });
        setOpenFile({ path: d.path, content: d.content ?? "", binary: d.binary, mimeType: d.mimeType });
        setRightTab("files");
      } catch {}
    },
    [instanceTrpc, openFile, setOpenFile, setRightTab],
  );

  return { openFileHandler };
}
