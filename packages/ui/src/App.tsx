import { useEffect } from "react";
import { useStore } from "./store.js";
import { ListView } from "./views/ListView.js";
import { ChatView } from "./views/ChatView.js";
import { ConnectorsView } from "./views/ConnectorsView.js";
import { Shell as ShellIcon, Sun, Moon, Monitor, LogOut } from "lucide-react";
import { getUser, logout } from "./auth.js";
import { DialogOverlay } from "./components/DialogOverlay.js";

export default function App() {
  const view = useStore((s) => s.view);
  const theme = useStore((s) => s.theme);
  const fetchTemplates = useStore((s) => s.fetchTemplates);
  const fetchAgents = useStore((s) => s.fetchAgents);
  const fetchInstances = useStore((s) => s.fetchInstances);

  // Apply theme on mount + listen for system preference changes
  useEffect(() => {
    const apply = () => {
      const t = useStore.getState().theme;
      const isDark = t === "dark" || (t === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
      document.documentElement.classList.toggle("dark", isDark);
    };
    apply();
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauthResult = params.get("oauth");
    if (!oauthResult) return;
    window.history.replaceState({}, "", window.location.pathname);
    if (oauthResult === "error") {
      useStore.getState().showAlert(params.get("message") ?? "Unknown error", "OAuth Failed");
    }
  }, []);

  // Browser back/forward
  useEffect(() => {
    const onPopState = () => {
      const path = window.location.pathname;
      if (path.startsWith("/chat/")) {
        const inst = decodeURIComponent(path.slice(6));
        useStore.setState({ selectedInstance: inst, sessionId: null, messages: [], sessions: [], fileTree: [], openFile: null, log: [], view: "chat" });
      } else if (path === "/connectors") {
        useStore.setState({ view: "connectors" });
      } else {
        useStore.setState({ selectedInstance: null, sessionId: null, messages: [], sessions: [], fileTree: [], openFile: null, log: [], view: "list" });
      }
    };
    // Handle initial URL (e.g. direct link to /chat/foo) — setState to avoid pushing duplicate history
    const path = window.location.pathname;
    if (path.startsWith("/chat/")) {
      const inst = decodeURIComponent(path.slice(6));
      useStore.setState({ selectedInstance: inst, sessionId: null, messages: [], sessions: [], fileTree: [], openFile: null, log: [], view: "chat" });
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    fetchTemplates();
    fetchAgents();
    fetchInstances();
    const i = setInterval(fetchInstances, 5000);
    return () => clearInterval(i);
  }, [fetchTemplates, fetchAgents, fetchInstances]);

  // Chat view is full-screen (has its own layout)
  if (view === "chat") return <><ChatView /><DialogOverlay /></>;

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
      <DialogOverlay />
    </div>
  );
}

const themeOptions = [
  { value: "light" as const, icon: Sun, label: "Light" },
  { value: "dark" as const, icon: Moon, label: "Dark" },
  { value: "system" as const, icon: Monitor, label: "System" },
];

function Nav() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const user = getUser();

  return (
    <nav className="sticky top-0 z-50 flex items-center gap-6 border-b border-border-light bg-surface/80 backdrop-blur-sm px-[5%] h-12">
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

      {/* Theme toggle */}
      <div className="ml-auto flex items-center gap-0.5 rounded-lg border border-border-light p-0.5">
        {themeOptions.map(({ value, icon: Icon, label }) => (
          <button
            key={value}
            onClick={() => setTheme(value)}
            title={label}
            className={`h-7 w-7 rounded-md flex items-center justify-center transition-colors ${theme === value ? "bg-accent text-white" : "text-text-muted hover:text-text-secondary"}`}
          >
            <Icon size={14} />
          </button>
        ))}
      </div>

      {/* User / logout */}
      <div className="flex items-center gap-2">
        {user && (
          <span className="text-[13px] text-text-secondary">
            {user.profile.preferred_username ?? user.profile.sub}
          </span>
        )}
        <button
          onClick={() => logout()}
          title="Log out"
          className="h-7 w-7 rounded-md flex items-center justify-center text-text-muted hover:text-text-secondary transition-colors"
        >
          <LogOut size={14} />
        </button>
      </div>
    </nav>
  );
}
