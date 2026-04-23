import { useCallback, useEffect, useMemo } from "react";

import { createInstanceTrpc } from "../../../instance-trpc.js";
import { useStore } from "../../../store.js";
import { ACTION_FAILED,runAction, runQuery } from "../../../store/query-helpers.js";

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
    (async () => {
      const res = await runQuery(
        "file-tree",
        () => instanceTrpc.files.tree.query(),
        { fallback: "Couldn't load file tree" },
      );
      if (res) setFileTree(res.entries);
    })();
  }, [instanceTrpc, setFileTree]);

  // Poll every 2s with no-op guard
  useEffect(() => {
    if (!instanceTrpc) return;
    let prevJson = "";
    const i = setInterval(async () => {
      const res = await runQuery(
        "file-tree",
        () => instanceTrpc.files.tree.query(),
        { fallback: "Couldn't refresh file tree" },
      );
      if (!res) return;
      const json = JSON.stringify(res.entries);
      if (json !== prevJson) {
        prevJson = json;
        setFileTree(res.entries);
      }
      const cur = useStore.getState().openFile;
      if (cur) {
        // Close the viewer if the file is gone — don't surface that as an
        // error; files disappear legitimately (deletes, git switches).
        try {
          const d = await instanceTrpc.files.read.query({ path: cur.path });
          const next = { path: d.path, content: d.content ?? "", binary: d.binary, mimeType: d.mimeType };
          // Skip if nothing meaningful changed — avoids recreating blob URLs and flashing previews.
          if (cur.path === next.path && cur.content === next.content && cur.binary === next.binary && cur.mimeType === next.mimeType) return;
          setOpenFile(next);
        } catch { setOpenFile(null); }
      }
    }, 2000);
    return () => clearInterval(i);
  }, [instanceTrpc, setFileTree, setOpenFile]);

  const openFileHandler = useCallback(
    async (path: string) => {
      if (!instanceTrpc) return;
      if (openFile?.path === path) { setOpenFile(null); return; }
      const d = await runAction(
        () => instanceTrpc.files.read.query({ path }),
        `Couldn't open ${path}`,
      );
      if (d === ACTION_FAILED) return;
      setOpenFile({ path: d.path, content: d.content ?? "", binary: d.binary, mimeType: d.mimeType });
      setRightTab("files");
    },
    [instanceTrpc, openFile, setOpenFile, setRightTab],
  );

  return { openFileHandler };
}
