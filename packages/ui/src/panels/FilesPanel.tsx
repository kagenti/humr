import { useState, useCallback } from "react";
import { useStore } from "../store.js";
import { ArrowLeft, ChevronRight, ChevronDown, Folder, FileText, Eye, Code } from "lucide-react";
import { Markdown } from "../components/Markdown.js";
import { HighlightedCode } from "../components/HighlightedCode.js";

export function FilesPanel({ onOpenFile }: { onOpenFile: (path: string) => void }) {
  const fileTree = useStore(s => s.fileTree);
  const openFile = useStore(s => s.openFile);
  const setOpenFile = useStore(s => s.setOpenFile);
  const [renderMd, setRenderMd] = useState(true);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // Sort tree: dirs before files at each level, children grouped under parents
  const sortedTree = [...fileTree].sort((a, b) => {
    const ap = a.path.split("/"), bp = b.path.split("/");
    // Compare each path segment
    for (let i = 0; i < Math.min(ap.length, bp.length); i++) {
      if (ap[i] !== bp[i]) {
        // At the same depth, dirs come before files
        const aIsDir = i < ap.length - 1 || a.type === "dir";
        const bIsDir = i < bp.length - 1 || b.type === "dir";
        if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
        return ap[i].localeCompare(bp[i]);
      }
    }
    return ap.length - bp.length;
  });

  const toggleDir = useCallback((path: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });
  }, []);

  // Filter out entries whose parent dir is collapsed
  const isVisible = useCallback((path: string) => {
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++) {
      const parentPath = parts.slice(0, i).join("/");
      if (collapsed.has(parentPath)) return false;
    }
    return true;
  }, [collapsed]);

  const isMd = openFile?.path.endsWith(".md") || openFile?.path.endsWith(".mdx");

  if (openFile) return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-2 px-3 h-9 border-b border-border-light shrink-0">
        <button className="flex items-center gap-1 text-[12px] font-semibold text-text-muted hover:text-accent transition-colors shrink-0" onClick={() => setOpenFile(null)}>
          <ArrowLeft size={12} /> Back
        </button>
        <span className="text-[12px] font-mono text-text-secondary truncate flex-1">{openFile.path}</span>
        {isMd && (
          <button
            className={`flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-md transition-colors ${renderMd ? "text-accent bg-accent-light" : "text-text-muted hover:text-text-secondary"}`}
            onClick={() => setRenderMd(p => !p)}
            title={renderMd ? "Show raw" : "Render markdown"}
          >
            {renderMd ? <Code size={11} /> : <Eye size={11} />}
            {renderMd ? "Raw" : "Render"}
          </button>
        )}
      </div>
      <div className="flex-1 overflow-auto p-4">
        {isMd && renderMd ? (
          <Markdown onFileClick={onOpenFile}>{openFile.content}</Markdown>
        ) : (
          <HighlightedCode code={openFile.content} path={openFile.path} />
        )}
      </div>
    </div>
  );

  return (
    <div className="flex-1 overflow-y-auto py-1">
      {sortedTree.length === 0 && <p className="px-4 py-5 text-[12px] text-text-muted">No files yet</p>}
      {sortedTree.filter(e => isVisible(e.path)).map(e => {
        const isDir = e.type === "dir";
        const isCollapsed = collapsed.has(e.path);
        const depth = e.path.split("/").length - 1;
        return (
          <div
            key={e.path}
            className={`flex items-center gap-1.5 py-[5px] text-[12px] cursor-pointer transition-colors ${isDir ? "text-text-secondary font-medium hover:bg-surface-raised" : "text-text-secondary hover:bg-accent-light hover:text-accent"}`}
            style={{ paddingLeft: `${12 + depth * 14}px`, paddingRight: 12 }}
            onClick={isDir ? () => toggleDir(e.path) : () => onOpenFile(e.path)}
          >
            {isDir ? (
              isCollapsed ? <ChevronRight size={13} className="shrink-0 text-text-muted" /> : <ChevronDown size={13} className="shrink-0 text-text-muted" />
            ) : (
              <span className="w-[13px] shrink-0" />
            )}
            {isDir ? <Folder size={13} className="shrink-0" /> : <FileText size={13} className="shrink-0" />}
            <span className="truncate">{e.path.split("/").pop()}</span>
          </div>
        );
      })}
    </div>
  );
}
