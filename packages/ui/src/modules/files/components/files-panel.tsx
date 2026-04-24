import { FilePlus, FolderPlus, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useStore } from "../../../store.js";
import {
  useFileContentQuery,
  useFileCreateMutation,
  useFileDeleteMutation,
  useFileRenameMutation,
  useFileTreeQuery,
  useFileUploadMutation,
  useFolderCreateMutation,
} from "../api/queries.js";
import { FileTreeEntry, InlineNameInput } from "./file-tree-entry.js";
import { FileViewer } from "./file-viewer.js";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

function isDotName(path: string): boolean {
  return path.split("/").pop()!.startsWith(".");
}

function sanitizeUploadName(name: string): string {
  // Strip any path components the browser might hand us (some browsers include
  // relative paths on drag-and-drop directory uploads).
  return name.replace(/\\/g, "/").split("/").filter(Boolean).join("/") || name;
}

async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  // btoa chokes on large strings; chunk to stay under arg-length limits.
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

type PendingNew = { kind: "file" | "dir" } | null;

export function FilesPanel({ onOpenFile }: { onOpenFile: (path: string) => void }) {
  const selectedInstance = useStore(s => s.selectedInstance);
  const openFilePath = useStore(s => s.openFilePath);
  const setOpenFilePath = useStore(s => s.setOpenFilePath);
  const showConfirm = useStore(s => s.showConfirm);
  const showToast = useStore(s => s.showToast);

  const { data: fileTree = [] } = useFileTreeQuery(selectedInstance);
  const { data: openFile, error: openFileError } = useFileContentQuery(selectedInstance, openFilePath);

  const createFile = useFileCreateMutation(selectedInstance);
  const createFolder = useFolderCreateMutation(selectedInstance);
  const renameMutation = useFileRenameMutation(selectedInstance);
  const deleteMutation = useFileDeleteMutation(selectedInstance);
  const uploadMutation = useFileUploadMutation(selectedInstance);

  // If the file disappeared (rename, delete, git switch), close the viewer
  // silently rather than surface the error.
  useEffect(() => {
    if (openFileError) setOpenFilePath(null);
  }, [openFileError, setOpenFilePath]);

  const [toggled, setToggled] = useState<Set<string>>(new Set());
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [pendingNew, setPendingNew] = useState<PendingNew>(null);
  const [panelDragActive, setPanelDragActive] = useState(false);
  const [dragTargetPath, setDragTargetPath] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Stashes the dir the next picker invocation should upload into. Cleared
  // after onChange fires so subsequent toolbar picks default to root.
  const pickerTargetDirRef = useRef<string>("");

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

  const commitCreate = useCallback(async (rawName: string) => {
    if (!pendingNew) return;
    const name = rawName.trim().replace(/^\/+/, "");
    setPendingNew(null);
    if (!name) return;
    try {
      if (pendingNew.kind === "file") {
        await createFile.mutateAsync({ path: name, content: "" });
        showToast({ kind: "success", message: `Created ${name}` });
      } else {
        await createFolder.mutateAsync({ path: name });
        showToast({ kind: "success", message: `Created ${name}/` });
      }
    } catch (err) {
      showToast({ kind: "error", message: err instanceof Error ? err.message : "Create failed" });
    }
  }, [pendingNew, createFile, createFolder, showToast]);

  const commitRename = useCallback(async (from: string, nextName: string) => {
    setRenamingPath(null);
    const lastSlash = from.lastIndexOf("/");
    const parent = lastSlash >= 0 ? from.slice(0, lastSlash) : "";
    const to = parent ? `${parent}/${nextName}` : nextName;
    if (to === from) return;
    try {
      await renameMutation.mutateAsync({ from, to });
      if (openFilePath === from) setOpenFilePath(to);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Rename failed";
      if (/conflict|already exists/i.test(msg)) {
        const ok = await showConfirm(`"${nextName}" already exists. Overwrite?`, "Overwrite");
        if (!ok) return;
        try {
          await renameMutation.mutateAsync({ from, to, overwrite: true });
          if (openFilePath === from) setOpenFilePath(to);
        } catch (err2) {
          showToast({ kind: "error", message: err2 instanceof Error ? err2.message : "Rename failed" });
        }
        return;
      }
      showToast({ kind: "error", message: msg });
    }
  }, [renameMutation, openFilePath, setOpenFilePath, showConfirm, showToast]);

  const handleDelete = useCallback(async (path: string) => {
    const entry = fileTree.find(e => e.path === path);
    const isDir = entry?.type === "dir";
    const childCount = isDir
      ? fileTree.filter(e => e.path.startsWith(path + "/")).length
      : 0;
    const msg = isDir && childCount > 0
      ? `Delete ${path}/? This will remove ${childCount} file${childCount === 1 ? "" : "s"}.`
      : `Delete ${path}?`;
    const ok = await showConfirm(msg, "Delete");
    if (!ok) return;
    try {
      await deleteMutation.mutateAsync({ path });
      if (openFilePath === path || (openFilePath ?? "").startsWith(path + "/")) setOpenFilePath(null);
      showToast({ kind: "success", message: `Deleted ${path}` });
    } catch (err) {
      showToast({ kind: "error", message: err instanceof Error ? err.message : "Delete failed" });
    }
  }, [fileTree, deleteMutation, openFilePath, setOpenFilePath, showConfirm, showToast]);

  const uploadFiles = useCallback(async (files: FileList | File[], targetDir?: string) => {
    const list = Array.from(files);
    if (list.length === 0) return;
    const dir = (targetDir ?? "").replace(/^\/+|\/+$/g, "");
    const prefix = dir ? `${dir}/` : "";
    const treePaths = new Set(fileTree.map(e => e.path));
    for (const file of list) {
      if (file.size > MAX_UPLOAD_BYTES) {
        showToast({ kind: "error", message: `${file.name} exceeds 10 MB — skipped` });
        continue;
      }
      const name = sanitizeUploadName(file.name);
      if (!name) continue;
      const path = `${prefix}${name}`;
      try {
        const contentBase64 = await fileToBase64(file);
        const contentType = file.type || undefined;
        const exists = treePaths.has(path);
        if (exists) {
          const ok = await showConfirm(`"${path}" already exists. Overwrite?`, "Overwrite");
          if (!ok) continue;
          await uploadMutation.mutateAsync({ path, contentBase64, contentType, overwrite: true });
        } else {
          try {
            await uploadMutation.mutateAsync({ path, contentBase64, contentType });
          } catch (err) {
            const msg = err instanceof Error ? err.message : "";
            if (/conflict|already exists/i.test(msg)) {
              const ok = await showConfirm(`"${path}" already exists. Overwrite?`, "Overwrite");
              if (!ok) continue;
              await uploadMutation.mutateAsync({ path, contentBase64, contentType, overwrite: true });
            } else {
              throw err;
            }
          }
        }
        showToast({ kind: "success", message: `Uploaded ${path}` });
      } catch (err) {
        showToast({ kind: "error", message: err instanceof Error ? err.message : `Upload failed: ${path}` });
      }
    }
  }, [fileTree, uploadMutation, showConfirm, showToast]);

  const openFilePickerFor = useCallback((dir: string) => {
    pickerTargetDirRef.current = dir;
    fileInputRef.current?.click();
  }, []);

  const handleRowDragEnter = useCallback((targetDir: string) => {
    setDragTargetPath(targetDir);
  }, []);
  const handleRowDragLeave = useCallback((targetDir: string) => {
    // Only clear if we haven't already moved into another row. A new row's
    // dragenter fires before the previous row's dragleave, so compare before
    // clearing.
    setDragTargetPath(prev => (prev === targetDir ? null : prev));
  }, []);
  const handleRowDrop = useCallback((targetDir: string, files: FileList) => {
    setDragTargetPath(null);
    setPanelDragActive(false);
    void uploadFiles(files, targetDir);
  }, [uploadFiles]);

  if (openFile) {
    return (
      <FileViewer
        file={openFile}
        onClose={() => setOpenFilePath(null)}
        onOpenFile={onOpenFile}
      />
    );
  }

  // Panel-level overlay only when the pointer isn't over a specific row; that
  // row has its own highlight (see FileTreeEntry).
  const showPanelOverlay = panelDragActive && dragTargetPath === null;

  return (
    <div
      className="relative flex-1 overflow-y-auto py-1"
      onDragEnter={(e) => { e.preventDefault(); if (e.dataTransfer?.types?.includes("Files")) setPanelDragActive(true); }}
      onDragOver={(e) => { if (e.dataTransfer?.types?.includes("Files")) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; } }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setPanelDragActive(false);
        setDragTargetPath(null);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer?.files?.length) return;
        e.preventDefault();
        setPanelDragActive(false);
        setDragTargetPath(null);
        // Row handlers stopPropagation before this fires, so reaching here
        // means the drop happened on empty panel space → upload to root.
        void uploadFiles(e.dataTransfer.files);
      }}
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          const target = pickerTargetDirRef.current;
          pickerTargetDirRef.current = "";
          if (e.target.files) void uploadFiles(e.target.files, target);
          e.target.value = "";
        }}
      />
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border-light">
        <span className="text-[11px] font-mono text-text-muted flex-1 truncate">/home/agent</span>
        <button
          className="text-text-muted hover:text-accent p-0.5 rounded transition-colors"
          title="Upload files"
          onClick={() => openFilePickerFor("")}
        >
          <Upload size={13} />
        </button>
        <button
          className="text-text-muted hover:text-accent p-0.5 rounded transition-colors"
          title="New file"
          onClick={() => { setPendingNew({ kind: "file" }); setRenamingPath(null); }}
        >
          <FilePlus size={13} />
        </button>
        <button
          className="text-text-muted hover:text-accent p-0.5 rounded transition-colors"
          title="New folder"
          onClick={() => { setPendingNew({ kind: "dir" }); setRenamingPath(null); }}
        >
          <FolderPlus size={13} />
        </button>
      </div>
      {pendingNew && (
        <div className="flex items-center gap-1.5 py-[5px] text-[12px]" style={{ paddingLeft: 12, paddingRight: 12 }}>
          <span className="w-[13px] shrink-0" />
          <span className="w-[13px] shrink-0 text-text-muted">{pendingNew.kind === "dir" ? "📁" : "📄"}</span>
          <InlineNameInput
            initial=""
            placeholder={pendingNew.kind === "dir" ? "new-folder" : "new-file.md"}
            onCommit={commitCreate}
            onCancel={() => setPendingNew(null)}
          />
        </div>
      )}
      {sortedTree.length === 0 && !pendingNew && <p className="px-4 py-5 text-[12px] text-text-muted">No files yet</p>}
      {sortedTree.filter(entry => isVisible(entry.path)).map(entry => (
        <FileTreeEntry
          key={entry.path}
          entry={entry}
          depth={entry.path.split("/").length - 1}
          isDot={isDotName(entry.path)}
          isCollapsed={entry.type === "dir" && isDirCollapsed(entry.path)}
          renaming={renamingPath === entry.path}
          dropActive={entry.type === "dir" && dragTargetPath === entry.path}
          onOpenFile={onOpenFile}
          onToggleDir={toggleDir}
          onRequestRename={setRenamingPath}
          onCommitRename={commitRename}
          onCancelRename={() => setRenamingPath(null)}
          onDelete={handleDelete}
          onUploadHere={openFilePickerFor}
          onRowDragEnter={handleRowDragEnter}
          onRowDragLeave={handleRowDragLeave}
          onRowDrop={handleRowDrop}
        />
      ))}
      {showPanelOverlay && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-accent-light/80 border-2 border-dashed border-accent rounded">
          <div className="text-[12px] font-semibold text-accent">Drop files to upload to /home/agent</div>
        </div>
      )}
    </div>
  );
}
