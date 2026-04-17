import { useEffect, useState } from "react";
import { useStore } from "./store.js";
import { ListView } from "./views/ListView.js";
import { ChatView } from "./views/ChatView.js";
import { ProvidersView } from "./views/ProvidersView.js";
import { ConnectionsView } from "./views/ConnectionsView.js";
import { Sun, Moon, Monitor, LogOut, Menu, X } from "lucide-react";
import { getUser, logout } from "./auth.js";
import { DialogOverlay } from "./components/DialogOverlay.js";
import { Logo } from "./components/Logo.js";

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
      } else if (path === "/providers") {
        useStore.setState({ view: "providers" });
      } else if (path === "/connections" || path === "/connectors" || path === "/mcp") {
        useStore.setState({ view: "connections" });
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

  // All non-chat views share the shell
  return (
    <div className="min-h-screen bg-bg relative overflow-hidden">
      {/* Floating blobs */}
      <div className="blob blob-1" />
      <div className="blob blob-2" />
      <div className="blob blob-3" />

      <Nav />
      <main className="relative z-10 mx-auto w-full max-w-[960px] px-4 md:px-[5%] py-6 md:py-10">
        {view === "providers" ? <ProvidersView /> : view === "connections" ? <ConnectionsView /> : <ListView />}
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
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <nav className="sticky top-0 z-50 border-b border-border-light bg-surface/80 backdrop-blur-sm">
      <div className="flex items-center gap-6 px-4 md:px-[5%] h-12">
        {/* Brand */}
        <div className="flex items-center gap-2">
          <Logo size={22} className="text-accent" />
          <span className="text-[15px] font-extrabold tracking-[-0.03em] text-accent">humr</span>
        </div>

        {/* Desktop nav links */}
        <div className="hidden md:flex items-center gap-1">
          {([["list", "Agents"], ["providers", "Providers"], ["connections", "Connections"]] as const).map(([v, label]) => {
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

        {/* Desktop theme toggle */}
        <div className="ml-auto hidden md:flex items-center gap-0.5 rounded-lg border border-border-light p-0.5">
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

        {/* Desktop user/logout */}
        <div className="hidden md:flex items-center gap-2">
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

        {/* Mobile hamburger */}
        <button
          className="md:hidden ml-auto h-8 w-8 rounded-md flex items-center justify-center text-text-secondary hover:text-accent transition-colors"
          onClick={() => setMenuOpen(o => !o)}
        >
          {menuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {/* Mobile dropdown menu */}
      {menuOpen && (
        <div className="md:hidden border-t border-border-light bg-surface px-4 py-3 flex flex-col gap-3 anim-in">
          {/* Nav links */}
          {([["list", "Agents"], ["providers", "Providers"], ["connections", "Connections"]] as const).map(([v, label]) => {
            const active = view === v;
            return (
              <button
                key={v}
                onClick={() => { setView(v); setMenuOpen(false); }}
                className={`text-left px-3 py-2 text-[14px] font-medium rounded-lg transition-colors ${active ? "text-accent bg-accent-light" : "text-text-secondary hover:text-text hover:bg-surface-raised"}`}
              >
                {label}
              </button>
            );
          })}

          {/* Theme toggle */}
          <div className="flex items-center gap-2 px-3 py-2">
            <span className="text-[13px] text-text-muted mr-2">Theme</span>
            <div className="flex items-center gap-0.5 rounded-lg border border-border-light p-0.5">
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
          </div>

          {/* User info + logout */}
          <div className="flex items-center gap-3 px-3 py-2 border-t border-border-light pt-3">
            {user && (
              <span className="text-[13px] text-text-secondary flex-1">
                {user.profile.preferred_username ?? user.profile.sub}
              </span>
            )}
            <button
              onClick={() => { logout(); setMenuOpen(false); }}
              className="text-[13px] font-medium text-text-muted hover:text-danger transition-colors flex items-center gap-1"
            >
              <LogOut size={14} /> Log out
            </button>
          </div>
        </div>
      )}
    </nav>
  );
}
