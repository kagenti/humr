import { useState, useRef, useEffect, useCallback, type KeyboardEvent } from "react";
import { useStore } from "../store.js";
import { instanceState, stateLabel, badgeColors, dotColors } from "../components/StatusIndicator.js";
import { ArrowLeft, Send as SendIcon, Square, Settings2 } from "lucide-react";
import { Markdown } from "../components/Markdown.js";
import { ToolChip } from "../components/ToolChip.js";
import { ResizeHandle } from "../components/ResizeHandle.js";
import { SessionsSidebar } from "../panels/SessionsSidebar.js";
import { FilesPanel } from "../panels/FilesPanel.js";
import { LogPanel } from "../panels/LogPanel.js";
import { ConfigurationPanel } from "../panels/ConfigurationPanel.js";
import { SessionConfigBar } from "../components/SessionConfigPopover.js";
import { useAcpSession } from "../hooks/useAcpSession.js";
import { useMcpPicker } from "../hooks/useMcpPicker.js";
import { useFileTree } from "../hooks/useFileTree.js";
import { useAutoResize } from "../hooks/useAutoResize.js";

export function ChatView() {
  const selectedInstance = useStore((s) => s.selectedInstance);
  const instances = useStore((s) => s.instances);
  const sessionId = useStore((s) => s.sessionId);
  const messages = useStore((s) => s.messages);
  const rightTab = useStore((s) => s.rightTab);
  const loadingSession = useStore((s) => s.loading.session);
  const goBack = useStore((s) => s.goBack);
  const setRightTab = useStore((s) => s.setRightTab);
  const queuedMessage = useStore((s) => s.queuedMessage);
  const setQueuedMessage = useStore((s) => s.setQueuedMessage);
  const mobileScreen = useStore((s) => s.mobileScreen);
  const setMobileScreen = useStore((s) => s.setMobileScreen);
  const showMobilePanel = useStore((s) => s.showMobilePanel);
  const setShowMobilePanel = useStore((s) => s.setShowMobilePanel);

  const [input, setInput] = useState("");
  const [leftW, setLeftW] = useState(() => Number(localStorage.getItem("humr-left-w")) || 220);
  const [rightW, setRightW] = useState(() => Number(localStorage.getItem("humr-right-w")) || 340);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ── Hooks ──
  const { mcpOptions, enabledMcps, toggleMcp, selectAllMcps, clearAllMcps, selectedMcpServers, access } =
    useMcpPicker(selectedInstance);

  const { ensureConnection, resetSession, resumeSession, sendPrompt, stopAgent, fetchSessions, busy, activeSessionIdRef } =
    useAcpSession(selectedInstance, selectedMcpServers, textareaRef);

  const { openFileHandler } = useFileTree(selectedInstance);

  useAutoResize(textareaRef, input);

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── Input handling ──
  const isComputing = busy && !loadingSession;
  const hasInput = input.trim().length > 0;
  const showStop = isComputing && !hasInput;
  const sendDisabled = !isComputing && !hasInput;

  const send = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    setInput("");
    if (busy) {
      useStore.getState().setQueuedMessage(text);
      return;
    }
    sendPrompt(text);
  }, [input, busy, sendPrompt]);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  };

  const mobileResumeSession = useCallback((sid: string) => {
    setMobileScreen("chat");
    resumeSession(sid);
  }, [setMobileScreen, resumeSession]);

  const handleNewSession = useCallback(() => {
    if (!sessionId && messages.length === 0) { setMobileScreen("chat"); return; }
    resetSession();
    setMobileScreen("chat");
  }, [sessionId, messages.length, resetSession, setMobileScreen]);

  const handleBack = useCallback(() => {
    if (window.innerWidth < 768 && mobileScreen === "chat") {
      setMobileScreen("sessions");
      return;
    }
    resetSession();
    goBack();
  }, [mobileScreen, setMobileScreen, resetSession, goBack]);

  // ── Right panel ──
  const rightTabs = ["files", "log", "configuration"] as const;
  const rightPanelContent = (
    <>
      <div className="flex border-b border-border-light shrink-0">
        {rightTabs.map(tab => (
          <button key={tab} onClick={() => setRightTab(tab)}
            className={`flex-1 h-9 text-[11px] font-bold uppercase tracking-[0.05em] border-b-2 transition-colors ${rightTab === tab ? "text-accent border-accent bg-accent-light" : "text-text-muted border-transparent hover:text-text-secondary"}`}>
            {tab === "configuration" ? "config" : tab}
          </button>
        ))}
      </div>
      <div className="flex flex-1 flex-col overflow-hidden">
        {rightTab === "files" && <FilesPanel onOpenFile={openFileHandler} />}
        {rightTab === "log" && <LogPanel />}
        {rightTab === "configuration" && (
          <ConfigurationPanel
            mcpOptions={mcpOptions} enabledMcps={enabledMcps}
            onToggleMcp={toggleMcp} onSelectAllMcps={selectAllMcps} onClearAllMcps={clearAllMcps}
            hasActiveSession={!!sessionId} accessMode={access?.mode ?? null}
          />
        )}
      </div>
    </>
  );

  // ── Layout ──
  return (
    <div className="flex h-screen bg-bg relative overflow-hidden">
      <div className="blob blob-1" />
      <div className="blob blob-2" />
      <div className="blob blob-3" />

      {/* Left: Sessions */}
      <div
        style={{ width: leftW }}
        className={`shrink-0 flex flex-col border-r border-border-light bg-surface/50 backdrop-blur-xl overflow-hidden relative z-10 ${
          mobileScreen === "chat" ? "hidden md:flex" : "flex"
        } ${mobileScreen === "sessions" ? "max-md:!w-full" : ""}`}
      >
        <SessionsSidebar
          onResumeSession={mobileResumeSession}
          onRefresh={fetchSessions}
          onNewSession={handleNewSession}
        />
      </div>
      <ResizeHandle side="left" onResize={d => setLeftW(w => { const v = Math.max(140, Math.min(400, w + d)); localStorage.setItem("humr-left-w", String(v)); return v; })} />

      {/* Main chat column */}
      <div className={`flex flex-1 flex-col min-w-0 ${mobileScreen === "sessions" ? "hidden md:flex" : "flex"}`}>
        {/* Header */}
        <header className="flex items-center gap-4 px-5 h-11 border-b border-border-light bg-surface/50 backdrop-blur-xl shrink-0">
          <button className="flex items-center gap-1 text-[13px] font-medium text-text-secondary hover:text-accent transition-colors" onClick={handleBack}>
            <ArrowLeft size={14} />
            <span className="hidden md:inline">Agents</span>
          </button>
          <span className="w-px h-4 bg-border-light" />
          <h1 className="text-[14px] font-bold text-text truncate">{selectedInstance}</h1>
          <div className="ml-auto flex items-center gap-2">
            <button
              className="md:hidden h-7 w-7 rounded-md border border-border-light flex items-center justify-center text-text-muted hover:text-accent hover:border-accent transition-colors"
              onClick={() => setShowMobilePanel(true)}
            >
              <Settings2 size={14} />
            </button>
            <StatusBadge selectedInstance={selectedInstance} instances={instances} busy={busy} />
          </div>
        </header>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[760px] px-4 md:px-8 py-8 flex flex-col gap-6">
            {loadingSession && (
              <div className="py-20 flex items-center justify-center gap-3 text-[14px] text-text-muted">
                <span className="w-5 h-5 rounded-full border-2 border-border-light border-t-accent anim-spin" />
                Loading session...
              </div>
            )}
            {!loadingSession && messages.length === 0 && (
              <div className="py-24 text-center">
                <p className="text-[16px] font-bold text-text mb-2">Start a conversation</p>
                <p className="text-[14px] text-text-muted">Send a message to begin a new session with this agent</p>
              </div>
            )}
            {messages.map((m) => (
              <div key={m.id} className={`flex flex-col gap-1 anim-in ${m.role === "user" ? "items-end" : "items-start"}`}>
                <span className="text-[11px] font-bold uppercase tracking-[0.05em] text-text-muted mb-0.5">
                  {m.role === "user" ? "You" : "Agent"}
                </span>
                <div className={m.role === "user"
                  ? "rounded-xl rounded-br-sm border border-accent/30 bg-accent-light px-5 py-3 text-[14px] text-text max-w-[620px]"
                  : "flex flex-col gap-2 max-w-full"
                }>
                  {m.parts.map((p, i) =>
                    p.kind === "text" ? (
                      m.role === "assistant" ? <Markdown key={i} onFileClick={openFileHandler}>{p.text}</Markdown> : (
                        <span key={i} className="whitespace-pre-wrap break-words">
                          {p.text}
                          {m.streaming && i === m.parts.length - 1 && <span className="inline-block w-[7px] h-4 bg-accent ml-0.5 align-text-bottom anim-blink rounded-sm" />}
                        </span>
                      )
                    ) : <ToolChip key={i} chip={p} />
                  )}
                  {m.streaming && m.parts.length === 0 && <span className="inline-block w-[7px] h-4 bg-accent anim-blink rounded-sm" />}
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        </div>

        {/* Input area */}
        <div className="border-t border-border-light bg-surface/50 backdrop-blur-xl px-4 md:px-8 py-3">
          <div className="mx-auto max-w-[760px] flex flex-col gap-1.5">
            <div className="flex items-end gap-2">
              <textarea
                ref={textareaRef}
                className="flex-1 rounded-lg border border-border-light bg-bg px-4 py-3 text-[14px] text-text outline-none resize-none min-h-[44px] max-h-[50vh] overflow-hidden transition-all focus:border-accent focus:shadow-[0_0_0_3px_var(--color-accent-glow)] placeholder:text-text-muted disabled:opacity-40"
                value={input} onChange={e => setInput(e.target.value)} onKeyDown={onKeyDown}
                placeholder={isComputing ? "Queue a message..." : "Message agent..."}
                rows={1} disabled={loadingSession}
              />
              {showStop ? (
                <button className="btn-brutal h-[44px] w-[44px] rounded-lg border-2 border-danger bg-danger text-white shrink-0 flex items-center justify-center"
                  style={{ boxShadow: "3px 3px 0 var(--c-danger)" }} onClick={stopAgent} title="Stop">
                  <Square size={16} />
                </button>
              ) : (
                <button className="btn-brutal h-[44px] w-[44px] rounded-lg border-2 border-accent-hover bg-accent text-white disabled:opacity-40 shrink-0 flex items-center justify-center"
                  style={{ boxShadow: "var(--shadow-brutal-accent)" }} onClick={send} disabled={sendDisabled || loadingSession} title="Send">
                  <SendIcon size={16} />
                </button>
              )}
            </div>
            <div className="flex items-center min-h-[24px]">
              {!loadingSession && (
                <SessionConfigBar ensureConnection={ensureConnection} activeSessionIdRef={activeSessionIdRef} instanceId={selectedInstance ?? ""} />
              )}
              {queuedMessage && (
                <span className="ml-auto text-[11px] text-text-muted">
                  1 queued
                  <button className="ml-1.5 text-danger hover:text-danger/80 font-semibold" onClick={() => setQueuedMessage(null)}>x</button>
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Right panel: desktop */}
      <ResizeHandle side="right" onResize={d => setRightW(w => { const v = Math.max(240, Math.min(600, w + d)); localStorage.setItem("humr-right-w", String(v)); return v; })} />
      <div style={{ width: rightW }} className="hidden md:flex shrink-0 flex-col border-l border-border-light bg-surface/50 backdrop-blur-xl overflow-hidden relative z-10">
        {rightPanelContent}
      </div>

      {/* Right panel: mobile overlay */}
      {showMobilePanel && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowMobilePanel(false)} />
          <div className="absolute right-0 top-0 bottom-0 w-full max-w-[400px] bg-surface flex flex-col anim-slide-in-right">
            <div className="flex items-center justify-between px-4 h-11 border-b border-border-light shrink-0">
              <span className="text-[13px] font-bold text-text">Panel</span>
              <button className="h-7 w-7 rounded-md border border-border-light flex items-center justify-center text-text-muted hover:text-accent hover:border-accent transition-colors"
                onClick={() => setShowMobilePanel(false)}>
                <ArrowLeft size={14} />
              </button>
            </div>
            {rightPanelContent}
          </div>
        </div>
      )}
    </div>
  );
}

/** Status badge extracted for readability */
function StatusBadge({ selectedInstance, instances, busy }: { selectedInstance: string | null; instances: any[]; busy: boolean }) {
  const inst = instances.find((i: any) => i.id === selectedInstance);
  const state = inst ? instanceState(inst) : ("starting" as const);
  const label = busy ? "Busy" : stateLabel[state];
  const color = busy ? "bg-warning-light text-warning border-warning" : badgeColors[state];
  const dot = busy ? "bg-warning anim-pulse" : dotColors[state];
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.03em] border rounded-full px-2.5 py-0.5 ${color}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
      {label}
    </span>
  );
}
