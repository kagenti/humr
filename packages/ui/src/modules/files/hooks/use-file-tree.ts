import { useCallback, useEffect } from "react";

import { useStore } from "../../../store.js";
import { fetchFileContent, useFileContentQuery, useFileTreeQuery } from "../api/queries.js";

/**
 * Drives the file tree + open-file viewer for the given instance. Backed by
 * TanStack Query; the 2-second poll is the refetchInterval, and TQ's
 * structuralSharing keeps the fileTree reference stable when the tree hasn't
 * changed — so the store effect below only fires when it actually did.
 */
export function useFileTree(selectedInstance: string | null) {
  const setFileTree = useStore((s) => s.setFileTree);
  const setOpenFile = useStore((s) => s.setOpenFile);
  const setRightTab = useStore((s) => s.setRightTab);
  const openFile = useStore((s) => s.openFile);
  const showToast = useStore((s) => s.showToast);

  const { data: fileTree } = useFileTreeQuery(selectedInstance);
  const { data: openFileContent, error: openFileError } = useFileContentQuery(
    selectedInstance,
    openFile?.path ?? null,
  );

  useEffect(() => {
    if (fileTree) setFileTree(fileTree);
  }, [fileTree, setFileTree]);

  useEffect(() => {
    if (openFileContent) setOpenFile(openFileContent);
  }, [openFileContent, setOpenFile]);

  // Close the viewer if the file is gone — don't surface as an error; files
  // disappear legitimately (deletes, git switches).
  useEffect(() => {
    if (openFileError) setOpenFile(null);
  }, [openFileError, setOpenFile]);

  const openFileHandler = useCallback(
    async (path: string) => {
      if (!selectedInstance) return;
      if (openFile?.path === path) {
        setOpenFile(null);
        return;
      }
      try {
        const content = await fetchFileContent(selectedInstance, path);
        setOpenFile(content);
        setRightTab("files");
      } catch (err) {
        showToast({
          kind: "error",
          message: err instanceof Error && err.message ? err.message : `Couldn't open ${path}`,
        });
      }
    },
    [selectedInstance, openFile, setOpenFile, setRightTab, showToast],
  );

  return { openFileHandler };
}
