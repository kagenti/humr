import { create } from "zustand";
import { platform } from "./platform.js";
import type {
  TemplateView,
  AgentView,
  InstanceView,
  SessionInfo,
  Message,
  LogEntry,
  TreeEntry,
  Schedule,
  MCPServerConfig,
} from "./types.js";

type View = "list" | "chat" | "connectors";

interface LoadingState {
  templates: boolean;
  agents: boolean;
  instances: boolean;
  sessions: boolean;
  session: boolean;
}

type Theme = "light" | "dark" | "system";

export interface DialogState {
  type: "alert" | "confirm";
  title: string;
  message: string;
  resolve: (ok: boolean) => void;
}

export interface HumrStore {
  // Dialog
  dialog: DialogState | null;
  showAlert: (message: string, title?: string) => Promise<void>;
  showConfirm: (message: string, title?: string) => Promise<boolean>;
  closeDialog: (ok: boolean) => void;

  // Theme
  theme: Theme;
  setTheme: (t: Theme) => void;

  // Navigation
  view: View;
  setView: (v: View) => void;

  // Data
  templates: TemplateView[];
  agents: AgentView[];
  instances: InstanceView[];
  selectedInstance: string | null;
  sessions: SessionInfo[];
  messages: Message[];
  schedules: Schedule[];
  fileTree: TreeEntry[];
  openFile: { path: string; content: string } | null;
  log: LogEntry[];
  busy: boolean;
  sessionId: string | null;
  rightTab: "files" | "log" | "schedules";

  // Loading states
  loading: LoadingState;

  // Template actions (read-only catalog)
  fetchTemplates: () => Promise<void>;

  // Agent actions
  fetchAgents: () => Promise<void>;
  createAgent: (input: {
    name: string;
    templateId?: string;
    image?: string;
    description?: string;
    mcpServers?: Record<string, MCPServerConfig>;
  }) => Promise<void>;
  deleteAgent: (id: string) => Promise<void>;

  // Instance actions
  fetchInstances: () => Promise<void>;
  createInstance: (
    agentId: string,
    name: string,
    enabledMcpServers?: string[],
  ) => Promise<void>;
  deleteInstance: (id: string) => Promise<void>;
  selectInstance: (id: string) => void;
  goBack: () => void;

  // Session/chat actions
  setSessionId: (id: string | null) => void;
  setSessions: (sessions: SessionInfo[]) => void;
  setMessages: (updater: Message[] | ((prev: Message[]) => Message[])) => void;
  setBusy: (busy: boolean) => void;
  setLoadingSessions: (loading: boolean) => void;
  setLoadingSession: (loading: boolean) => void;
  addLog: (type: string, payload: object) => void;

  // File tree
  setFileTree: (entries: TreeEntry[]) => void;
  setOpenFile: (file: { path: string; content: string } | null) => void;

  // Right tab
  setRightTab: (tab: "files" | "log" | "schedules") => void;

  // Schedules
  setSchedules: (schedules: Schedule[]) => void;
  fetchSchedules: () => Promise<void>;
  toggleSchedule: (id: string) => Promise<void>;
  deleteSchedule: (id: string) => Promise<void>;
}

function applyTheme(theme: Theme) {
  const isDark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", isDark);
}

function viewToPath(view: View, instance?: string | null): string {
  if (view === "chat" && instance) return `/chat/${encodeURIComponent(instance)}`;
  if (view === "connectors") return "/connectors";
  return "/";
}

function pathToState(path: string): { view: View; instance?: string } {
  if (path.startsWith("/chat/")) return { view: "chat", instance: decodeURIComponent(path.slice(6)) };
  if (path === "/connectors") return { view: "connectors" };
  return { view: "list" };
}

export const useStore = create<HumrStore>((set, get) => ({
  // Dialog
  dialog: null,
  showAlert: (message, title = "Error") =>
    new Promise<void>((resolve) => {
      set({ dialog: { type: "alert", title, message, resolve: () => resolve() } });
    }),
  showConfirm: (message, title = "Confirm") =>
    new Promise<boolean>((resolve) => {
      set({ dialog: { type: "confirm", title, message, resolve } });
    }),
  closeDialog: (ok) => {
    const d = get().dialog;
    if (d) { d.resolve(ok); set({ dialog: null }); }
  },

  // Theme
  theme: (localStorage.getItem("humr-theme") as Theme) || "system",
  setTheme: (t) => {
    localStorage.setItem("humr-theme", t);
    applyTheme(t);
    set({ theme: t });
  },

  // Navigation
  view: (() => {
    const saved = sessionStorage.getItem("humr-return-view");
    if (saved) {
      sessionStorage.removeItem("humr-return-view");
      return saved as View;
    }
    return pathToState(window.location.pathname).view;
  })(),
  setView: (v) => {
    history.pushState(null, "", viewToPath(v));
    set({ view: v });
  },

  // Data
  templates: [],
  agents: [],
  instances: [],
  selectedInstance: null,
  sessions: [],
  messages: [],
  schedules: [],
  fileTree: [],
  openFile: null,
  log: [],
  busy: false,
  sessionId: null,
  rightTab: "files",

  // Loading states
  loading: { templates: false, agents: false, instances: false, sessions: false, session: false },

  // Template actions (read-only catalog)
  fetchTemplates: async () => {
    set((s) => ({ loading: { ...s.loading, templates: true } }));
    try {
      const list = await platform.templates.list.query();
      set({ templates: list });
    } catch {}
    set((s) => ({ loading: { ...s.loading, templates: false } }));
  },

  // Agent actions
  fetchAgents: async () => {
    set((s) => ({ loading: { ...s.loading, agents: true } }));
    try {
      const list = await platform.agents.list.query();
      set({ agents: list });
    } catch {}
    set((s) => ({ loading: { ...s.loading, agents: false } }));
  },

  createAgent: async (input) => {
    try {
      await platform.agents.create.mutate(input);
      await get().fetchAgents();
    } catch (err: any) {
      get().showAlert(err?.message ?? "Failed to create agent");
    }
  },

  deleteAgent: async (id) => {
    try {
      await platform.agents.delete.mutate({ id });
      await get().fetchAgents();
      await get().fetchInstances();
    } catch (err: any) {
      get().showAlert(err?.message ?? "Failed to delete agent");
    }
  },

  // Instance actions
  fetchInstances: async () => {
    set((s) => ({ loading: { ...s.loading, instances: true } }));
    try {
      const list = await platform.instances.list.query();
      set({ instances: list });
    } catch {}
    set((s) => ({ loading: { ...s.loading, instances: false } }));
  },

  createInstance: async (agentId, name, enabledMcpServers) => {
    try {
      await platform.instances.create.mutate({ name, agentId, enabledMcpServers });
      await get().fetchInstances();
    } catch (err: any) {
      get().showAlert(err?.message ?? "Failed to create instance");
    }
  },

  deleteInstance: async (id) => {
    try {
      await platform.instances.delete.mutate({ id });
      await get().fetchInstances();
    } catch (err: any) {
      get().showAlert(err?.message ?? "Failed to delete instance");
    }
  },

  selectInstance: (id) => {
    history.pushState(null, "", viewToPath("chat", id));
    set({
      selectedInstance: id,
      sessionId: null,
      messages: [],
      sessions: [],
      fileTree: [],
      openFile: null,
      log: [],
      view: "chat",
    });
  },

  goBack: () => {
    history.pushState(null, "", "/");
    set({
      selectedInstance: null,
      sessionId: null,
      messages: [],
      sessions: [],
      fileTree: [],
      openFile: null,
      log: [],
      view: "list",
    });
    get().fetchAgents();
    get().fetchInstances();
  },

  // Session/chat actions
  setSessionId: (id) => set({ sessionId: id }),
  setSessions: (sessions) => set({ sessions }),
  setMessages: (updater) =>
    set((s) => ({
      messages: typeof updater === "function" ? updater(s.messages) : updater,
    })),
  setBusy: (busy) => set({ busy }),
  setLoadingSessions: (loading) =>
    set((s) => ({ loading: { ...s.loading, sessions: loading } })),
  setLoadingSession: (loading) =>
    set((s) => ({ loading: { ...s.loading, session: loading } })),
  addLog: (type, payload) => {
    const ts = new Date().toISOString().slice(11, 23);
    set((s) => ({
      log: [...s.log, { id: crypto.randomUUID(), ts, type, payload }],
    }));
  },

  // File tree
  setFileTree: (entries) => set({ fileTree: entries }),
  setOpenFile: (file) => set({ openFile: file }),

  // Right tab
  setRightTab: (tab) => set({ rightTab: tab }),

  // Schedules
  setSchedules: (schedules) => set({ schedules }),
  fetchSchedules: async () => {
    const { selectedInstance } = get();
    if (!selectedInstance) return;
    try {
      const list = await platform.schedules.list.query({ instanceId: selectedInstance });
      set({ schedules: list });
    } catch {}
  },
  toggleSchedule: async (id) => {
    await platform.schedules.toggle.mutate({ id });
    await get().fetchSchedules();
  },
  deleteSchedule: async (id) => {
    await platform.schedules.delete.mutate({ id });
    await get().fetchSchedules();
  },
}));
