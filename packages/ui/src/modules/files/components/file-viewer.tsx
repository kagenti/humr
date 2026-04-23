import { ArrowLeft, Code, Download, Eye } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { HighlightedCode } from "../../../components/highlighted-code.js";
import { Markdown } from "../../../components/markdown.js";

interface OpenFile {
  path: string;
  content: string;
  binary?: boolean;
  mimeType?: string;
}

interface Props {
  file: OpenFile;
  onClose: () => void;
  onOpenFile: (path: string) => void;
}

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

export function FileViewer({ file, onClose, onOpenFile }: Props) {
  const { path, content, binary, mimeType: mime } = file;
  const isMarkdown = mime === "text/markdown";
  const isSvg = mime === "image/svg+xml";
  const isBinaryImage = binary && content && isImageMime(mime) && !isSvg;
  const isPdf = mime === "application/pdf";
  const hasContent = !!content;
  const filename = path.split("/").pop();

  const [renderMd, setRenderMd] = useState(true);
  const [renderSvg, setRenderSvg] = useState(true);

  // Create blob URL for PDF rendering; revoke on change/unmount to avoid leaking
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!isPdf || !content) {
      setPdfBlobUrl(null);
      return;
    }
    const url = URL.createObjectURL(base64ToBlob(content, "application/pdf"));
    setPdfBlobUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [content, isPdf]);

  const downloadFile = useCallback(() => {
    if (!content) return;
    const downloadName = path.split("/").pop() ?? "download";
    const blob = binary
      ? base64ToBlob(content, mime ?? "application/octet-stream")
      : new Blob([content], { type: mime ?? "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = downloadName;
    a.click();
    URL.revokeObjectURL(a.href);
  }, [path, content, binary, mime]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-2 px-3 h-9 border-b border-border-light shrink-0">
        <button className="flex items-center gap-1 text-[12px] font-semibold text-text-muted hover:text-accent transition-colors shrink-0" onClick={onClose}>
          <ArrowLeft size={12} /> Back
        </button>
        <span className="text-[12px] font-mono text-text-secondary truncate flex-1">{path}</span>
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
              src={`data:${mime};base64,${content}`}
              alt={filename ?? "image"}
              className="max-w-full max-h-[calc(100vh-200px)] object-contain rounded border border-border-light"
            />
          </div>
        ) : isPdf && pdfBlobUrl ? (
          <iframe
            src={pdfBlobUrl}
            title={filename ?? "pdf"}
            className="w-full h-[calc(100vh-200px)] rounded border border-border-light bg-white"
          />
        ) : binary && !content ? (
          <div className="py-12 text-center text-[13px] text-text-muted">
            <p>File too large to preview</p>
            <p className="mt-1 text-[11px]">Files over 10 MB cannot be displayed</p>
          </div>
        ) : binary ? (
          <div>
            <div className="mb-2 flex items-baseline gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-text-muted">Binary file — hex dump</p>
              {mime && <p className="text-[11px] font-mono text-text-muted">{mime}</p>}
            </div>
            <p className="mb-3 text-[11px] text-text-muted">This file is not directly viewable. The first bytes are shown below.</p>
            <pre className="text-[11px] font-mono leading-[1.6] text-text-secondary whitespace-pre overflow-x-auto">{hexDump(content)}</pre>
          </div>
        ) : isSvg && renderSvg ? (
          <div className="flex items-center justify-center">
            <img
              src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(content)}`}
              alt={filename ?? "image"}
              className="max-w-full max-h-[calc(100vh-200px)] object-contain rounded border border-border-light"
            />
          </div>
        ) : isMarkdown && renderMd ? (
          <Markdown onFileClick={onOpenFile}>{content}</Markdown>
        ) : (
          <HighlightedCode code={content} path={path} />
        )}
      </div>
    </div>
  );
}
