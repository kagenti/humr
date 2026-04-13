import { create } from "zustand";
import { platform } from "./platform.js";
import type {
  TemplateView,
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
  availableChannels: Record<string, boolean>;
  templates: TemplateView[];
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

  // Template actions
  fetchTemplates: () => Promise<void>;
  createTemplate: (input: {
    name: string;
    image: string;
    description?: string;
    mcpServers?: Record<string, MCPServerConfig>;
  }) => Promise<void>;
  deleteTemplate: (name: string) => Promise<void>;

  // Instance actions
  fetchInstances: () => Promise<void>;
  createInstance: (
    templateName: string,
    name: string,
    enabledMcpServers?: string[],
  ) => Promise<void>;
  deleteInstance: (name: string) => Promise<void>;
  connectSlack: (name: string, botToken: string) => Promise<void>;
  disconnectSlack: (name: string) => Promise<void>;
  selectInstance: (name: string) => void;
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
  toggleSchedule: (name: string) => Promise<void>;
  deleteSchedule: (name: string) => Promise<void>;
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
  availableChannels: {},
  templates: [],
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
  loading: { templates: false, instances: false, sessions: false, session: false },

  // Template actions
  fetchTemplates: async () => {
    set((s) => ({ loading: { ...s.loading, templates: true } }));
    try {
      const list = await platform.templates.list.query();
      set({ templates: list });
    } catch {}
    set((s) => ({ loading: { ...s.loading, templates: false } }));
  },

  createTemplate: async (input) => {
    try {
      await platform.templates.create.mutate(input);
      await get().fetchTemplates();
    } catch (err: any) {
      get().showAlert(err?.message ?? "Failed to create template");
    }
  },

  deleteTemplate: async (name) => {
    try {
      await platform.templates.delete.mutate({ name });
      await get().fetchTemplates();
      await get().fetchInstances();
    } catch (err: any) {
      get().showAlert(err?.message ?? "Failed to delete template");
    }
  },

  // Instance actions
  fetchInstances: async () => {
    set((s) => ({ loading: { ...s.loading, instances: true } }));
    try {
      const [list, availableChannels] = await Promise.all([
        platform.instances.list.query(),
        platform.channels.available.query(),
      ]);
      set({ instances: list, availableChannels });
    } catch {}
    set((s) => ({ loading: { ...s.loading, instances: false } }));
  },

  createInstance: async (templateName, name, enabledMcpServers) => {
    try {
      await platform.instances.create.mutate({ name, templateName, enabledMcpServers });
      await get().fetchInstances();
    } catch (err: any) {
      get().showAlert(err?.message ?? "Failed to create instance");
    }
  },

  deleteInstance: async (name) => {
    try {
      await platform.instances.delete.mutate({ name });
      await get().fetchInstances();
    } catch (err: any) {
      get().showAlert(err?.message ?? "Failed to delete instance");
    }
  },

  connectSlack: async (name, botToken) => {
    try {
      await platform.instances.connectSlack.mutate({ name, botToken });
      await get().fetchInstances();
    } catch (err: any) {
      get().showAlert(err?.message ?? "Failed to connect Slack");
    }
  },

  disconnectSlack: async (name) => {
    try {
      await platform.instances.disconnectSlack.mutate({ name });
      await get().fetchInstances();
    } catch (err: any) {
      get().showAlert(err?.message ?? "Failed to disconnect Slack");
    }
  },

  selectInstance: (name) => {
    history.pushState(null, "", viewToPath("chat", name));
    set({
      selectedInstance: name,
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
      const list = await platform.schedules.list.query({ instanceName: selectedInstance });
      set({ schedules: list });
    } catch {}
  },
  toggleSchedule: async (name) => {
    await platform.schedules.toggle.mutate({ name });
    await get().fetchSchedules();
  },
  deleteSchedule: async (name) => {
    await platform.schedules.delete.mutate({ name });
    await get().fetchSchedules();
  },
}));
