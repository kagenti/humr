import { ArrowLeft, ChevronDown, ChevronRight, Code, Download, Eye, FileText, Folder, Image as ImageIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { HighlightedCode } from "../../../components/highlighted-code.js";
import { Markdown } from "../../../components/markdown.js";
import { useStore } from "../../../store.js";
import { useFileContentQuery, useFileTreeQuery } from "../api/queries.js";

function hexDump(base64: string): string {
  const raw = atob(base64);
  const lines: string[] = [];
  const maxBytes = Math.min(raw.length, 1024);
  for (let off = 0; off < maxBytes; off += 16) {
    const slice = raw.slice(off, Math.min(off + 16, maxBytes));
    const hex = Array.from(slice).map(c => c.charCodeAt(0).toString(16).padStart(2, "0")).join(" ");
    const ascii = Array.from(slice).map(c => { const code = c.charCodeAt(0); return code >= 0x20 && code < 0x7f ? c : "."; }).join("");
    lines.push(`${off.toString(16).padStart(8, "0")}  ${hex.padEnd(47)}  ${ascii}`);
  }
  if (raw.length > maxBytes) lines.push(`... ${raw.length - maxBytes} more bytes`);
  return lines.join("\n");
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

function isImageMime(mime: string | undefined): boolean {
  return !!mime && mime.startsWith("image/");
}

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

  const [renderMd, setRenderMd] = useState(true);
  const [renderSvg, setRenderSvg] = useState(true);
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

  const mime = openFile?.mimeType;
  const isMarkdown = mime === "text/markdown";
  const isSvg = mime === "image/svg+xml";
  const isBinaryImage = openFile?.binary && openFile.content && isImageMime(mime) && !isSvg;
  const isPdf = mime === "application/pdf";
  const hasContent = !!openFile?.content;

  // Create blob URL for PDF rendering; revoke on change/unmount to avoid leaking
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!openFile || !isPdf || !openFile.content) {
      setPdfBlobUrl(null);
      return;
    }
    const url = URL.createObjectURL(base64ToBlob(openFile.content, "application/pdf"));
    setPdfBlobUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [openFile, isPdf]);

  const downloadFile = useCallback(() => {
    if (!openFile || !openFile.content) return;
    const filename = openFile.path.split("/").pop() ?? "download";
    const blob = openFile.binary
      ? base64ToBlob(openFile.content, mime ?? "application/octet-stream")
      : new Blob([openFile.content], { type: mime ?? "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }, [openFile, mime]);

  if (openFile) return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-2 px-3 h-9 border-b border-border-light shrink-0">
        <button className="flex items-center gap-1 text-[12px] font-semibold text-text-muted hover:text-accent transition-colors shrink-0" onClick={() => setOpenFilePath(null)}>
          <ArrowLeft size={12} /> Back
        </button>
        <span className="text-[12px] font-mono text-text-secondary truncate flex-1">{openFile.path}</span>
        {hasContent && (
          <button
            className="flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-md text-text-muted hover:text-accent transition-colors"
            onClick={downloadFile}
            title="Download file"
          >
            <Download size={11} />
          </button>
        )}
        {isSvg && (
          <button
            className={`flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-md transition-colors ${renderSvg ? "text-accent bg-accent-light" : "text-text-muted hover:text-text-secondary"}`}
            onClick={() => setRenderSvg(p => !p)}
            title={renderSvg ? "Show raw SVG" : "Render SVG"}
          >
            {renderSvg ? <Code size={11} /> : <Eye size={11} />}
            {renderSvg ? "Raw" : "Render"}
          </button>
        )}
        {isMarkdown && (
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
        {isBinaryImage ? (
          <div className="flex items-center justify-center">
            <img
              src={`data:${mime};base64,${openFile.content}`}
              alt={openFile.path.split("/").pop() ?? "image"}
              className="max-w-full max-h-[calc(100vh-200px)] object-contain rounded border border-border-light"
            />
          </div>
        ) : isPdf && pdfBlobUrl ? (
          <iframe
            src={pdfBlobUrl}
            title={openFile.path.split("/").pop() ?? "pdf"}
            className="w-full h-[calc(100vh-200px)] rounded border border-border-light bg-white"
          />
        ) : openFile.binary && !openFile.content ? (
          <div className="py-12 text-center text-[13px] text-text-muted">
            <p>File too large to preview</p>
            <p className="mt-1 text-[11px]">Files over 10 MB cannot be displayed</p>
          </div>
        ) : openFile.binary ? (
          <div>
            <div className="mb-2 flex items-baseline gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-text-muted">Binary file — hex dump</p>
              {mime && <p className="text-[11px] font-mono text-text-muted">{mime}</p>}
            </div>
            <p className="mb-3 text-[11px] text-text-muted">This file is not directly viewable. The first bytes are shown below.</p>
            <pre className="text-[11px] font-mono leading-[1.6] text-text-secondary whitespace-pre overflow-x-auto">{hexDump(openFile.content)}</pre>
          </div>
        ) : isSvg && renderSvg ? (
          <div className="flex items-center justify-center">
            <img
              src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(openFile.content)}`}
              alt={openFile.path.split("/").pop() ?? "image"}
              className="max-w-full max-h-[calc(100vh-200px)] object-contain rounded border border-border-light"
            />
          </div>
        ) : isMarkdown && renderMd ? (
          <Markdown onFileClick={onOpenFile}>{openFile.content}</Markdown>
        ) : (
          <HighlightedCode code={openFile.content} path={openFile.path} />
        )}
      </div>
    </div>
  );

  return (
    <div className="flex-1 overflow-y-auto py-1">
      <div className="px-3 py-1.5 text-[11px] font-mono text-text-muted border-b border-border-light">/home/agent</div>
      {sortedTree.length === 0 && <p className="px-4 py-5 text-[12px] text-text-muted">No files yet</p>}
      {sortedTree.filter(e => isVisible(e.path)).map(e => {
        const isDir = e.type === "dir";
        const isCollapsed = isDir && isDirCollapsed(e.path);
        const depth = e.path.split("/").length - 1;
        const isDot = isDotName(e.path);
        const looksLikeImage = !isDir && /\.(png|jpe?g|gif|webp|svg|ico|bmp)$/i.test(e.path);
        return (
          <div
            key={e.path}
            className={`flex items-center gap-1.5 py-[5px] text-[12px] cursor-pointer transition-colors ${isDir ? "text-text-secondary font-medium hover:bg-surface-raised" : "text-text-secondary hover:bg-accent-light hover:text-accent"}`}
            style={{ paddingLeft: `${12 + depth * 14}px`, paddingRight: 12, opacity: isDot ? 0.6 : 1 }}
            onClick={isDir ? () => toggleDir(e.path) : () => onOpenFile(e.path)}
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
            <span className="truncate">{e.path.split("/").pop()}</span>
          </div>
        );
      })}
    </div>
  );
}
