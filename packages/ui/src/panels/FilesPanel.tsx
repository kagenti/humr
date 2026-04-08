import { useStore } from "../store.js";
import { ArrowLeft, Folder, FileText } from "lucide-react";

export function FilesPanel({ onOpenFile }: { onOpenFile: (path: string) => void }) {
  const fileTree = useStore(s => s.fileTree);
  const openFile = useStore(s => s.openFile);
  const setOpenFile = useStore(s => s.setOpenFile);

  if (openFile) return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-2 px-4 h-10 border-b-2 border-border-light shrink-0">
        <button className="flex items-center gap-1 text-[12px] font-bold text-text-muted hover:text-accent transition-colors" onClick={() => setOpenFile(null)}>
          <ArrowLeft size={12} /> Back
        </button>
        <span className="text-[12px] font-mono text-text-secondary truncate">{openFile.path}</span>
      </div>
      <div className="flex-1 overflow-auto p-4">
        <pre className="text-[12px] leading-[1.65] font-mono text-text whitespace-pre tab-[2]">{openFile.content}</pre>
      </div>
    </div>
  );

  return (
    <div className="flex-1 overflow-y-auto py-1">
      {fileTree.length === 0 && <p className="px-4 py-5 text-[12px] text-text-muted">No files yet</p>}
      {fileTree.map(e => (
        <div
          key={e.path}
          className={`flex items-center gap-2 py-[5px] text-[12px] ${e.type === "dir" ? "text-text-muted" : "text-text-secondary cursor-pointer hover:bg-accent-light hover:text-accent"} transition-colors`}
          style={{ paddingLeft: `${16 + (e.path.split("/").length - 1) * 14}px`, paddingRight: 16 }}
          onClick={e.type === "file" ? () => onOpenFile(e.path) : undefined}
        >
          {e.type === "dir" ? <Folder size={13} /> : <FileText size={13} />}
          <span className="truncate">{e.path.split("/").pop()}</span>
        </div>
      ))}
    </div>
  );
}
