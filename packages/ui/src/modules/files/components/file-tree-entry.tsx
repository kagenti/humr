import { ChevronDown, ChevronRight, FileText, Folder, Image as ImageIcon, MoreHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { TreeEntry } from "../../../types.js";

interface Props {
  entry: TreeEntry;
  depth: number;
  isDot: boolean;
  isCollapsed: boolean;
  renaming: boolean;
  dropActive: boolean;
  onOpenFile: (path: string) => void;
  onToggleDir: (path: string) => void;
  onRequestRename: (path: string) => void;
  onCommitRename: (path: string, nextName: string) => void;
  onCancelRename: () => void;
  onDelete: (path: string) => void;
  onUploadHere: (dir: string) => void;
  onRowDragEnter: (targetDir: string) => void;
  onRowDragLeave: (targetDir: string) => void;
  onRowDrop: (targetDir: string, files: FileList) => void;
}

function parentDirOf(path: string): string {
  const lastSlash = path.lastIndexOf("/");
  return lastSlash >= 0 ? path.slice(0, lastSlash) : "";
}

export function FileTreeEntry({
  entry,
  depth,
  isDot,
  isCollapsed,
  renaming,
  dropActive,
  onOpenFile,
  onToggleDir,
  onRequestRename,
  onCommitRename,
  onCancelRename,
  onDelete,
  onUploadHere,
  onRowDragEnter,
  onRowDragLeave,
  onRowDrop,
}: Props) {
  const { path, type } = entry;
  const isDir = type === "dir";
  const looksLikeImage = !isDir && /\.(png|jpe?g|gif|webp|svg|ico|bmp)$/i.test(path);
  const filename = path.split("/").pop() ?? "";
  const targetDir = isDir ? path : parentDirOf(path);

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  if (renaming) {
    return (
      <div
        className="flex items-center gap-1.5 py-[5px] text-[12px]"
        style={{ paddingLeft: `${12 + depth * 14}px`, paddingRight: 12 }}
      >
        <span className="w-[13px] shrink-0" />
        {isDir ? <Folder size={13} className="shrink-0" /> : <FileText size={13} className="shrink-0" />}
        <InlineNameInput
          initial={filename}
          onCommit={(next) => onCommitRename(path, next)}
          onCancel={onCancelRename}
        />
      </div>
    );
  }

  const hasFiles = (e: React.DragEvent) => !!e.dataTransfer?.types?.includes("Files");
  // Dir rows highlight on drop-hover; file rows don't, but they still route
  // drops to their parent dir so the UX matches VSCode / Finder.
  const highlight = isDir && dropActive;

  return (
    <div
      className={`group relative flex items-center gap-1.5 py-[5px] text-[12px] cursor-pointer transition-colors ${highlight ? "bg-accent-light ring-1 ring-accent ring-inset" : isDir ? "text-text-secondary font-medium hover:bg-surface-raised" : "text-text-secondary hover:bg-accent-light hover:text-accent"}`}
      style={{ paddingLeft: `${12 + depth * 14}px`, paddingRight: 12, opacity: isDot ? 0.6 : 1 }}
      onClick={isDir ? () => onToggleDir(path) : () => onOpenFile(path)}
      onContextMenu={(e) => { e.preventDefault(); setMenuOpen(true); }}
      onDragEnter={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        onRowDragEnter(targetDir);
      }}
      onDragOver={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        onRowDragLeave(targetDir);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer?.files?.length) return;
        e.preventDefault();
        e.stopPropagation();
        onRowDrop(targetDir, e.dataTransfer.files);
      }}
    >
      {isDir ? (
        isCollapsed ? <ChevronRight size={13} className="shrink-0 text-text-muted" /> : <ChevronDown size={13} className="shrink-0 text-text-muted" />
      ) : (
        <span className="w-[13px] shrink-0" />
      )}
      {isDir ? <Folder size={13} className="shrink-0" /> : (
        looksLikeImage
          ? <ImageIcon size={13} className="shrink-0" />
          : <FileText size={13} className="shrink-0" />
      )}
      <span className="truncate flex-1">{filename}</span>
      <button
        className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-text-muted hover:text-text-secondary p-0.5 rounded transition-opacity"
        onClick={(e) => { e.stopPropagation(); setMenuOpen(true); }}
        title="More actions"
      >
        <MoreHorizontal size={13} />
      </button>
      {menuOpen && (
        <div
          ref={menuRef}
          className="absolute right-2 top-7 z-10 min-w-[160px] rounded-md border border-border-light bg-surface shadow-md py-1 text-[12px]"
          onClick={(e) => e.stopPropagation()}
        >
          {isDir && (
            <button
              className="block w-full text-left px-3 py-1.5 hover:bg-surface-raised"
              onClick={() => { setMenuOpen(false); onUploadHere(path); }}
            >
              Upload files here…
            </button>
          )}
          <button
            className="block w-full text-left px-3 py-1.5 hover:bg-surface-raised"
            onClick={() => { setMenuOpen(false); onRequestRename(path); }}
          >
            Rename
          </button>
          <button
            className="block w-full text-left px-3 py-1.5 text-red-500 hover:bg-surface-raised"
            onClick={() => { setMenuOpen(false); onDelete(path); }}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

interface InlineInputProps {
  initial: string;
  placeholder?: string;
  onCommit: (next: string) => void;
  onCancel: () => void;
}

export function InlineNameInput({ initial, placeholder, onCommit, onCancel }: InlineInputProps) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement | null>(null);
  // Guard against double-firing commit from blur + Enter; both paths race.
  const committedRef = useRef(false);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const commit = () => {
    if (committedRef.current) return;
    committedRef.current = true;
    const trimmed = value.trim();
    if (!trimmed || trimmed === initial) onCancel();
    else onCommit(trimmed);
  };

  return (
    <input
      ref={ref}
      className="flex-1 bg-surface border border-accent rounded px-1 py-0 text-[12px] font-mono outline-none"
      value={value}
      placeholder={placeholder}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); commit(); }
        else if (e.key === "Escape") { e.preventDefault(); committedRef.current = true; onCancel(); }
      }}
      onBlur={commit}
      onClick={(e) => e.stopPropagation()}
    />
  );
}
