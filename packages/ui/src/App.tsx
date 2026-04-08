import { useEffect } from "react";
import { useStore } from "./store.js";
import { ListView } from "./views/ListView.js";
import { ChatView } from "./views/ChatView.js";
import { ConnectorsView } from "./views/ConnectorsView.js";
import { Shell as ShellIcon } from "lucide-react";

export default function App() {
  const view = useStore((s) => s.view);
  const fetchTemplates = useStore((s) => s.fetchTemplates);
  const fetchInstances = useStore((s) => s.fetchInstances);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauthResult = params.get("oauth");
    if (!oauthResult) return;
    window.history.replaceState({}, "", window.location.pathname);
    if (oauthResult === "error") {
      window.alert(`OAuth failed: ${params.get("message") ?? "Unknown error"}`);
    }
  }, []);

  useEffect(() => {
    fetchTemplates();
    fetchInstances();
  }, [fetchTemplates, fetchInstances]);

  // Chat view is full-screen (has its own layout)
  if (view === "chat") return <ChatView />;

  // List + Connectors share the shell
  return (
    <div className="min-h-screen bg-bg relative overflow-hidden">
      {/* Floating blobs */}
      <div className="blob blob-1" />
      <div className="blob blob-2" />
      <div className="blob blob-3" />

      <Nav />
      <main className="relative z-10 mx-auto w-full max-w-[960px] px-[5%] py-10">
        {view === "connectors" ? <ConnectorsView /> : <ListView />}
      </main>
    </div>
  );
}

function Nav() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);

  return (
    <nav className="sticky top-0 z-50 flex items-center gap-6 border-b-[3px] border-border bg-surface/80 backdrop-blur-sm px-[5%] h-14">
      <div className="flex items-center gap-2">
        <ShellIcon size={20} className="text-accent" />
        <span className="text-[15px] font-extrabold tracking-[-0.03em] text-accent">humr</span>
      </div>

      <div className="flex items-center gap-1">
        {(["list", "connectors"] as const).map((v) => {
          const label = v === "list" ? "Agents" : "Connectors";
          const active = view === v;
          return (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-3 py-1.5 text-[14px] font-medium rounded-lg transition-colors ${active ? "text-accent bg-accent-light" : "text-text-secondary hover:text-text hover:bg-surface-raised"}`}
            >
              {label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
