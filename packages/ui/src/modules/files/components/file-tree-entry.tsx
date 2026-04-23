import { ChevronDown, ChevronRight, FileText, Folder, Image as ImageIcon } from "lucide-react";

import type { TreeEntry } from "../../../types.js";

interface Props {
  entry: TreeEntry;
  depth: number;
  isDot: boolean;
  isCollapsed: boolean;
  onOpenFile: (path: string) => void;
  onToggleDir: (path: string) => void;
}

export function FileTreeEntry({
  entry,
  depth,
  isDot,
  isCollapsed,
  onOpenFile,
  onToggleDir,
}: Props) {
  const { path, type } = entry;
  const isDir = type === "dir";
  const looksLikeImage = !isDir && /\.(png|jpe?g|gif|webp|svg|ico|bmp)$/i.test(path);
  const filename = path.split("/").pop();

  return (
    <div
      className={`flex items-center gap-1.5 py-[5px] text-[12px] cursor-pointer transition-colors ${isDir ? "text-text-secondary font-medium hover:bg-surface-raised" : "text-text-secondary hover:bg-accent-light hover:text-accent"}`}
      style={{ paddingLeft: `${12 + depth * 14}px`, paddingRight: 12, opacity: isDot ? 0.6 : 1 }}
      onClick={isDir ? () => onToggleDir(path) : () => onOpenFile(path)}
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
      <span className="truncate">{filename}</span>
    </div>
  );
}
