import { useCallback, useEffect, useState } from "react";

import { useStore } from "../../../store.js";
import { useFileContentQuery, useFileTreeQuery } from "../api/queries.js";
import { FileTreeEntry } from "./file-tree-entry.js";
import { FileViewer } from "./file-viewer.js";

function isDotName(path: string): boolean {
  return path.split("/").pop()!.startsWith(".");
}

export function FilesPanel({ onOpenFile }: { onOpenFile: (path: string) => void }) {
  const selectedInstance = useStore(s => s.selectedInstance);
  const openFilePath = useStore(s => s.openFilePath);
  const setOpenFilePath = useStore(s => s.setOpenFilePath);

  const { data: fileTree = [] } = useFileTreeQuery(selectedInstance);
  const { data: openFile, error: openFileError } = useFileContentQuery(selectedInstance, openFilePath);

  // If the file disappeared (rename, delete, git switch), close the viewer
  // silently rather than surface the error.
  useEffect(() => {
    if (openFileError) setOpenFilePath(null);
  }, [openFileError, setOpenFilePath]);

  // Tracks user-explicit toggles only. Dot-dirs default to collapsed unless toggled open.
  const [toggled, setToggled] = useState<Set<string>>(new Set());

  // Sort tree: dirs before files at each level, children grouped under parents
  const sortedTree = [...fileTree].sort((a, b) => {
    const ap = a.path.split("/"), bp = b.path.split("/");
    for (let i = 0; i < Math.min(ap.length, bp.length); i++) {
      if (ap[i] !== bp[i]) {
        const aIsDir = i < ap.length - 1 || a.type === "dir";
        const bIsDir = i < bp.length - 1 || b.type === "dir";
        if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
        return ap[i].localeCompare(bp[i]);
      }
    }
    return ap.length - bp.length;
  });

  const isDirCollapsed = useCallback((path: string) => {
    const userToggled = toggled.has(path);
    const defaultCollapsed = isDotName(path);
    return userToggled ? !defaultCollapsed : defaultCollapsed;
  }, [toggled]);

  const toggleDir = useCallback((path: string) => {
    setToggled(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  }, []);

  const isVisible = useCallback((path: string) => {
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++) {
      const parentPath = parts.slice(0, i).join("/");
      if (isDirCollapsed(parentPath)) return false;
    }
    return true;
  }, [isDirCollapsed]);

  if (openFile) {
    return (
      <FileViewer
        file={openFile}
        onClose={() => setOpenFilePath(null)}
        onOpenFile={onOpenFile}
      />
    );
  }

  return (
    <div className="flex-1 overflow-y-auto py-1">
      <div className="px-3 py-1.5 text-[11px] font-mono text-text-muted border-b border-border-light">/home/agent</div>
      {sortedTree.length === 0 && <p className="px-4 py-5 text-[12px] text-text-muted">No files yet</p>}
      {sortedTree.filter(entry => isVisible(entry.path)).map(entry => (
        <FileTreeEntry
          key={entry.path}
          entry={entry}
          depth={entry.path.split("/").length - 1}
          isDot={isDotName(entry.path)}
          isCollapsed={entry.type === "dir" && isDirCollapsed(entry.path)}
          onOpenFile={onOpenFile}
          onToggleDir={toggleDir}
        />
      ))}
    </div>
  );
}
