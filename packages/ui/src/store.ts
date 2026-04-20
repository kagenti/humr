import { create } from "zustand";
import type { ReactNode } from "react";
import { platform } from "./platform.js";
import type {
  TemplateView,
  AgentView,
  InstanceView,
  SessionView,
  Message,
  LogEntry,
  TreeEntry,
  Schedule,
  SecretView,
  SecretMode,
  EnvMapping,
  EnvVar,
  InjectionConfig,
} from "./types.js";
import type {
  SessionModeState,
  SessionModelState,
  SessionConfigOption,
} from "@agentclientprotocol/sdk/dist/acp.js";

type View = "list" | "chat" | "providers" | "connections" | "settings";

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
  message: ReactNode;
  resolve: (ok: boolean) => void;
}

export interface HumrStore {
  // Dialog
  dialog: DialogState | null;
  showAlert: (message: ReactNode, title?: string) => Promise<void>;
  showConfirm: (message: ReactNode, title?: string) => Promise<boolean>;
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
  agents: AgentView[];
  instances: InstanceView[];
  selectedInstance: string | null;
  sessions: SessionView[];
  messages: Message[];
  schedules: Schedule[];
  fileTree: TreeEntry[];
  openFile: { path: string; content: string; binary?: boolean; mimeType?: string } | null;
  log: LogEntry[];
  busy: boolean;
  sessionId: string | null;
  rightTab: "files" | "log" | "configuration";

  // Session config (ACP protocol state)
  sessionModes: SessionModeState | null;
  sessionModels: SessionModelState | null;
  sessionConfigOptions: SessionConfigOption[];
  setSessionModes: (modes: SessionModeState | null) => void;
  setSessionModels: (models: SessionModelState | null) => void;
  setSessionConfigOptions: (options: SessionConfigOption[]) => void;

  // Message queue (for queuing messages while agent is busy)
  queuedMessage: string | null;
  setQueuedMessage: (msg: string | null) => void;

  // Mobile navigation
  mobileScreen: "sessions" | "chat";
  setMobileScreen: (screen: "sessions" | "chat") => void;
  showMobilePanel: boolean;
  setShowMobilePanel: (show: boolean) => void;

  // Loading states
  loading: LoadingState;

  // Persist-across-mount "we've fetched at least once" flags. Prevents the
  // list-view skeleton from reappearing when the user navigates away and back.
  loadedOnce: { agents: boolean; instances: boolean };

  // Template actions (read-only catalog)
  fetchTemplates: () => Promise<void>;

  // Agent actions
  fetchAgents: () => Promise<void>;
  createAgent: (input: {
    name: string;
    templateId?: string;
    image?: string;
    description?: string;
    secretMode?: "all" | "selective";
    secretIds?: string[];
    appConnectionIds?: string[];
    autoCreateInstance?: boolean;
  }) => Promise<void>;
  deleteAgent: (id: string) => Promise<void>;
  updateAgent: (
    id: string,
    patch: { description?: string; env?: EnvVar[] },
  ) => Promise<void>;

  // Per-agent credential-access cache (mode + assigned secret ids)
  agentAccess: Record<string, { mode: SecretMode; secretIds: string[] }>;
  fetchAgentAccess: (agentId: string) => Promise<void>;

  // Instance actions
  fetchInstances: () => Promise<void>;
  createInstance: (agentId: string, name: string) => Promise<void>;
  deleteInstance: (id: string) => Promise<void>;
  updateInstance: (id: string, updates: { allowedUsers?: string[] }) => Promise<void>;
  connectSlack: (id: string, slackChannelId: string) => Promise<void>;
  disconnectSlack: (id: string) => Promise<void>;
  selectInstance: (id: string) => void;
  goBack: () => void;

  // Session/chat actions
  includeChannelSessions: boolean;
  setIncludeChannelSessions: (v: boolean) => void;
  setSessionId: (id: string | null) => void;
  setSessions: (sessions: SessionView[]) => void;
  setMessages: (updater: Message[] | ((prev: Message[]) => Message[])) => void;
  setBusy: (busy: boolean) => void;
  setLoadingSessions: (loading: boolean) => void;
  setLoadingSession: (loading: boolean) => void;
  addLog: (type: string, payload: object) => void;
  deleteSession: (sessionId: string) => Promise<void>;

  // File tree
  setFileTree: (entries: TreeEntry[]) => void;
  setOpenFile: (file: { path: string; content: string; binary?: boolean; mimeType?: string } | null) => void;

  // Right tab
  setRightTab: (tab: "files" | "log" | "configuration") => void;

  // Secrets
  secrets: SecretView[];
  fetchSecrets: () => Promise<void>;
  createSecret: (input: {
    type: "anthropic" | "generic";
    name: string;
    value: string;
    hostPattern?: string;
    pathPattern?: string;
    injectionConfig?: InjectionConfig;
    envMappings?: EnvMapping[];
  }) => Promise<void>;
  updateSecret: (
    id: string,
    patch: {
      name?: string;
      value?: string;
      /** `null` clears the path pattern; `undefined` leaves it unchanged. */
      pathPattern?: string | null;
      /** `null` resets to the default; `undefined` leaves it unchanged. */
      injectionConfig?: InjectionConfig | null;
      envMappings?: EnvMapping[];
    },
  ) => Promise<void>;
  deleteSecret: (id: string) => Promise<void>;

  // Schedules
  setSchedules: (schedules: Schedule[]) => void;
  fetchSchedules: () => Promise<void>;
  toggleSchedule: (id: string) => Promise<void>;
  deleteSchedule: (id: string) => Promise<void>;
  resetScheduleSession: (scheduleId: string) => Promise<void>;
}

function applyTheme(theme: Theme) {
  const isDark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", isDark);
}

function viewToPath(view: View, instance?: string | null): string {
  if (view === "chat" && instance) return `/chat/${encodeURIComponent(instance)}`;
  if (view === "providers") return "/providers";
  if (view === "connections") return "/connections";
  if (view === "settings") return "/settings";
  return "/";
}

function pathToState(path: string): { view: View; instance?: string } {
  if (path.startsWith("/chat/")) return { view: "chat", instance: decodeURIComponent(path.slice(6)) };
  if (path === "/providers") return { view: "providers" };
  if (path === "/connections") return { view: "connections" };
  if (path === "/settings") return { view: "settings" };
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

  // Session config
  sessionModes: null,
  sessionModels: null,
  sessionConfigOptions: [],
  setSessionModes: (modes) => set({ sessionModes: modes }),
  setSessionModels: (models) => set({ sessionModels: models }),
  setSessionConfigOptions: (options) => set({ sessionConfigOptions: options }),

  // Message queue
  queuedMessage: null,
  setQueuedMessage: (msg) => set({ queuedMessage: msg }),

  // Mobile navigation
  mobileScreen: "sessions",
  setMobileScreen: (screen) => set({ mobileScreen: screen }),
  showMobilePanel: false,
  setShowMobilePanel: (show) => set({ showMobilePanel: show }),

  // Loading states
  loading: { templates: false, agents: false, instances: false, sessions: false, session: false },
  loadedOnce: { agents: false, instances: false },

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
      set((s) => ({ agents: list, loadedOnce: { ...s.loadedOnce, agents: true } }));
    } catch {}
    set((s) => ({ loading: { ...s.loading, agents: false } }));
  },

  createAgent: async ({ secretMode, secretIds, appConnectionIds, autoCreateInstance, ...input }) => {
    try {
      const agent = await platform.agents.create.mutate(input);
      await get().fetchAgents();

      // Auto-create a first instance named after the agent, if requested
      if (autoCreateInstance) {
        try {
          await platform.instances.create.mutate({ name: input.name, agentId: agent.id });
          await get().fetchInstances();
        } catch (err: any) {
          get().showAlert(err?.message ?? "Agent created but failed to create instance");
        }
      }

      // Only call setAgentAccess if the user deviates from the controller's default
      // ("selective" + auto-assigned anthropic) — i.e. selective with an explicit
      // list, or all-credentials mode.
      const needsAccessUpdate =
        secretMode === "all" || (secretMode === "selective" && secretIds?.length);
      // Controller registers the OneCLI agent asynchronously, so both
      // setAgentAccess and setAgentConnections have to retry past the sync lag.
      const withRetry = async (label: string, fn: () => Promise<void>) => {
        for (let attempt = 0; attempt < 5; attempt++) {
          try {
            await fn();
            return;
          } catch (err: any) {
            if (attempt === 4) {
              get().showAlert(err?.message ?? `Agent created but ${label} failed`);
              return;
            }
            await new Promise((r) => setTimeout(r, 2000));
          }
        }
      };
      if (needsAccessUpdate) {
        await withRetry("secret assignment", () =>
          platform.secrets.setAgentAccess.mutate({
            agentName: agent.id,
            mode: secretMode ?? "selective",
            secretIds: secretIds ?? [],
          }),
        );
      }
      if (appConnectionIds?.length) {
        await withRetry("app assignment", () =>
          platform.connections.setAgentConnections.mutate({
            agentName: agent.id,
            connectionIds: appConnectionIds,
          }),
        );
      }
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

  updateAgent: async (id, patch) => {
    try {
      await platform.agents.update.mutate({ id, ...patch });
      await get().fetchAgents();
    } catch (err: any) {
      get().showAlert(err?.message ?? "Failed to update agent");
    }
  },

  agentAccess: {},
  fetchAgentAccess: async (agentId) => {
    try {
      const access = await platform.secrets.getAgentAccess.query({ agentName: agentId });
      set((s) => ({ agentAccess: { ...s.agentAccess, [agentId]: access } }));
    } catch {
      // Agent might not be registered in OneCLI yet — silently skip.
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
      set((s) => ({
        instances: list,
        availableChannels,
        loadedOnce: { ...s.loadedOnce, instances: true },
      }));
    } catch {}
    set((s) => ({ loading: { ...s.loading, instances: false } }));
  },

  createInstance: async (agentId, name) => {
    try {
      await platform.instances.create.mutate({ name, agentId });
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

  updateInstance: async (id, updates) => {
    try {
      await platform.instances.update.mutate({ id, ...updates });
      await get().fetchInstances();
    } catch (err: any) {
      get().showAlert(err?.message ?? "Failed to update instance");
    }
  },

  connectSlack: async (id, slackChannelId) => {
    try {
      await platform.instances.connectSlack.mutate({ id, slackChannelId });
      await get().fetchInstances();
    } catch (err: any) {
      get().showAlert(err?.message ?? "Failed to connect Slack");
    }
  },

  disconnectSlack: async (id) => {
    try {
      await platform.instances.disconnectSlack.mutate({ id });
      await get().fetchInstances();
    } catch (err: any) {
      get().showAlert(err?.message ?? "Failed to disconnect Slack");
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
      sessionModes: null,
      sessionModels: null,
      sessionConfigOptions: [],
      queuedMessage: null,
      mobileScreen: "sessions",
      showMobilePanel: false,
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
      sessionModes: null,
      sessionModels: null,
      sessionConfigOptions: [],
      queuedMessage: null,
      showMobilePanel: false,
    });
    get().fetchAgents();
    get().fetchInstances();
  },

  // Session/chat actions
  includeChannelSessions: false,
  setIncludeChannelSessions: (v) => set({ includeChannelSessions: v }),
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
  deleteSession: async (sessionId) => {
    const instanceId = get().selectedInstance;
    if (!instanceId) return;
    try {
      await platform.sessions.delete.mutate({ sessionId, instanceId });
      set((s) => ({
        sessions: s.sessions.filter((x) => x.sessionId !== sessionId),
        // If the deleted session is the active one, clear it
        ...(s.sessionId === sessionId
          ? { sessionId: null, messages: [], sessionModes: null, sessionModels: null, sessionConfigOptions: [] }
          : {}),
      }));
    } catch (err: any) {
      get().showAlert(err?.message ?? "Failed to delete session");
    }
  },

  // File tree
  setFileTree: (entries) => set({ fileTree: entries }),
  setOpenFile: (file) => set({ openFile: file }),

  // Right tab
  setRightTab: (tab) => set({ rightTab: tab }),

  // Secrets
  secrets: [],
  fetchSecrets: async () => {
    try {
      const list = await platform.secrets.list.query();
      set({ secrets: list });
    } catch {}
  },
  createSecret: async (input) => {
    try {
      await platform.secrets.create.mutate(input);
      await get().fetchSecrets();
    } catch (err: any) {
      get().showAlert(err?.message ?? "Failed to create secret");
    }
  },
  updateSecret: async (id, patch) => {
    try {
      await platform.secrets.update.mutate({ id, ...patch });
      await get().fetchSecrets();
    } catch (err: any) {
      get().showAlert(err?.message ?? "Failed to update secret");
    }
  },
  deleteSecret: async (id) => {
    try {
      await platform.secrets.delete.mutate({ id });
      await get().fetchSecrets();
    } catch (err: any) {
      get().showAlert(err?.message ?? "Failed to delete secret");
    }
  },

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
  resetScheduleSession: async (scheduleId) => {
    await platform.sessions.resetByScheduleId.mutate({ scheduleId });
    await get().fetchSchedules();
  },
}));
