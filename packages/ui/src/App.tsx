import { useState, useRef, useEffect, useCallback, useMemo, KeyboardEvent } from "react";
import {
  ClientSideConnection,
  PROTOCOL_VERSION,
} from "@agentclientprotocol/sdk/dist/acp.js";
import type { Stream } from "@agentclientprotocol/sdk/dist/stream.js";
import type { AnyMessage } from "@agentclientprotocol/sdk/dist/jsonrpc.js";
import type { McpServer } from "@agentclientprotocol/sdk/dist/schema/types.gen.js";
import { platform } from "./platform.js";
import { createInstanceTrpc } from "./instance-trpc.js";

type Role = "user" | "assistant";

interface ToolChip {
  kind: "tool";
  title: string;
  status: string;
}

interface TextPart {
  kind: "text";
  text: string;
}

type MessagePart = TextPart | ToolChip;

interface Message {
  id: string;
  role: Role;
  parts: MessagePart[];
  streaming: boolean;
}

interface LogEntry {
  id: string;
  ts: string;
  type: string;
  payload: object;
}

interface SessionInfo {
  sessionId: string;
  title?: string | null;
  updatedAt?: string | null;
}

interface TreeEntry {
  path: string;
  type: "file" | "dir";
}

interface MCPServerConfig {
  type: "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
}

interface TemplateView {
  name: string;
  image: string;
  description?: string;
  mcpServers?: Record<string, MCPServerConfig> | null;
}

interface InstanceView {
  name: string;
  templateName: string;
  description?: string;
  desiredState: "running" | "hibernated";
  enabledMcpServers?: string[] | null;
  status: { currentState: string; error?: string; podReady: boolean } | null;
}

/** Resolve enabled MCP servers from template config + instance enabled list. */
function resolveAcpMcpServers(
  templates: TemplateView[],
  instance?: InstanceView | null,
): McpServer[] {
  if (!instance) return [];
  const tmpl = templates.find((t) => t.name === instance.templateName);
  if (!tmpl?.mcpServers) return [];
  const enabled = instance.enabledMcpServers;
  // If no explicit list, enable all template servers
  const entries = enabled
    ? Object.entries(tmpl.mcpServers).filter(([name]) => enabled.includes(name))
    : Object.entries(tmpl.mcpServers);
  return entries.map(([name, s]): McpServer => {
    if (s.type === "http") {
      return { type: "http", name, url: s.url!, headers: [] };
    }
    return { command: s.command!, args: s.args ?? [], env: [], name };
  });
}

function wsStream(url: string): Promise<{ stream: Stream; ws: WebSocket }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.onopen = () => {
      const readable = new ReadableStream<AnyMessage>({
        start(controller) {
          ws.onmessage = (e) => controller.enqueue(JSON.parse(e.data));
          ws.onclose = () => {
            try {
              controller.close();
            } catch {}
          };
          ws.onerror = (err) => {
            try {
              controller.error(err);
            } catch {}
          };
        },
      });
      const writable = new WritableStream<AnyMessage>({
        write(chunk) {
          ws.send(JSON.stringify(chunk));
        },
        close() {
          ws.close();
        },
      });
      resolve({ stream: { readable, writable }, ws });
    };
    ws.onerror = reject;
  });
}

function wsUrl(instanceId: string): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/api/instances/${instanceId}/acp`;
}

type UpdateHandler = (update: any) => void;

async function openConnection(
  instanceId: string,
  onUpdate: UpdateHandler,
): Promise<{ connection: ClientSideConnection; ws: WebSocket }> {
  const { stream, ws } = await wsStream(wsUrl(instanceId));
  const connection = new ClientSideConnection(
    () => ({
      async requestPermission(params: any) {
        return {
          outcome: {
            outcome: "selected" as const,
            optionId: params.options[0].optionId,
          },
        };
      },
      async sessionUpdate(params: any) {
        onUpdate(params.update);
      },
      async writeTextFile() {
        return {};
      },
      async readTextFile() {
        return { content: "" };
      },
    }),
    stream,
  );
  return { connection, ws };
}

interface McpFormEntry {
  id: string;
  name: string;
  type: "stdio" | "http";
  command: string;
  args: string;
  url: string;
}

/** Create template dialog — name, image, description, MCP servers from connectors + custom stdio. */
function CreateTemplateDialog({
  onSubmit,
  onCancel,
  onGoToConnectors,
}: {
  onSubmit: (input: {
    name: string;
    image: string;
    description?: string;
    mcpServers?: Record<string, MCPServerConfig>;
  }) => void;
  onCancel: () => void;
  onGoToConnectors: () => void;
}) {
  const [name, setName] = useState("");
  const [image, setImage] = useState("");
  const [description, setDescription] = useState("");

  // Connected remote servers (from OneCLI)
  const [connections, setConnections] = useState<
    { hostname: string; connectedAt: string; expired: boolean }[]
  >([]);
  const [selectedConnections, setSelectedConnections] = useState<Set<string>>(new Set());
  const [loadingConnections, setLoadingConnections] = useState(true);

  // Custom stdio MCP servers
  const [stdioEntries, setStdioEntries] = useState<McpFormEntry[]>([]);

  useEffect(() => {
    fetch("/api/mcp/connections")
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setConnections(data); })
      .catch(() => {})
      .finally(() => setLoadingConnections(false));
  }, []);

  const toggleConnection = (hostname: string) => {
    setSelectedConnections((prev) => {
      const next = new Set(prev);
      if (next.has(hostname)) next.delete(hostname);
      else next.add(hostname);
      return next;
    });
  };

  const addStdio = () => {
    setStdioEntries((prev) => [
      ...prev,
      { id: crypto.randomUUID(), name: "", type: "stdio", command: "", args: "", url: "" },
    ]);
  };

  const updateStdio = (id: string, field: keyof McpFormEntry, value: string) => {
    setStdioEntries((prev) =>
      prev.map((e) => (e.id === id ? { ...e, [field]: value } : e)),
    );
  };

  const removeStdio = (id: string) => {
    setStdioEntries((prev) => prev.filter((e) => e.id !== id));
  };

  const handleSubmit = () => {
    const trimmedName = name.trim();
    const trimmedImage = image.trim();
    if (!trimmedName || !trimmedImage) return;

    const servers: Record<string, MCPServerConfig> = {};

    // Add selected remote connections
    for (const hostname of selectedConnections) {
      const serverName = hostname.split(".")[0];
      servers[serverName] = { type: "http", url: `https://${hostname}/mcp` };
    }

    // Add custom stdio servers
    for (const e of stdioEntries) {
      if (!e.name.trim() || !e.command.trim()) continue;
      const args = e.args.trim() ? e.args.split(/\s+/) : [];
      servers[e.name.trim()] = { type: "stdio", command: e.command.trim(), args };
    }

    onSubmit({
      name: trimmedName,
      image: trimmedImage,
      description: description.trim() || undefined,
      mcpServers: Object.keys(servers).length > 0 ? servers : undefined,
    });
  };

  return (
    <div className="dialog-overlay" onClick={onCancel}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <span>new template</span>
        </div>

        <label className="dialog-label">
          name
          <input
            className="dialog-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="my-template"
            autoFocus
          />
        </label>

        <label className="dialog-label">
          image
          <input
            className="dialog-input"
            value={image}
            onChange={(e) => setImage(e.target.value)}
            placeholder="humr-base:latest"
          />
        </label>

        <label className="dialog-label">
          description
          <input
            className="dialog-input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="optional"
          />
        </label>

        <div className="dialog-section">
          <div className="dialog-section-header">
            <span>connectors</span>
          </div>

          {loadingConnections && <div className="mcp-empty">loading...</div>}

          {!loadingConnections && connections.length === 0 && (
            <div className="mcp-empty">
              no connectors available —{" "}
              <button className="link-btn" onClick={onGoToConnectors}>connect a server</button>
            </div>
          )}

          {connections.map((c) => (
            <label key={c.hostname} className={`mcp-toggle${c.expired ? " expired" : ""}`}>
              <input
                type="checkbox"
                checked={selectedConnections.has(c.hostname)}
                onChange={() => toggleConnection(c.hostname)}
                disabled={c.expired}
              />
              <span className={`instance-dot ${c.expired ? "dot-error" : "dot-ready"}`} />
              <span className="mcp-toggle-name">{c.hostname}</span>
              {c.expired && <span className="mcp-toggle-meta">expired</span>}
            </label>
          ))}

          {!loadingConnections && connections.length > 0 && (
            <button className="link-btn" onClick={onGoToConnectors}>+ connect another server</button>
          )}
        </div>

        <div className="dialog-section">
          <div className="dialog-section-header">
            <span>custom CLI tools</span>
            <button className="dialog-add-btn" onClick={addStdio}>+ add</button>
          </div>

          {stdioEntries.map((entry) => (
            <div key={entry.id} className="mcp-entry">
              <div className="mcp-entry-row">
                <input
                  className="dialog-input mcp-name"
                  value={entry.name}
                  onChange={(e) => updateStdio(entry.id, "name", e.target.value)}
                  placeholder="server name"
                />
                <button className="mcp-remove-btn" onClick={() => removeStdio(entry.id)}>x</button>
              </div>
              <div className="mcp-entry-row">
                <input
                  className="dialog-input"
                  value={entry.command}
                  onChange={(e) => updateStdio(entry.id, "command", e.target.value)}
                  placeholder="command (e.g. npx)"
                />
                <input
                  className="dialog-input mcp-args"
                  value={entry.args}
                  onChange={(e) => updateStdio(entry.id, "args", e.target.value)}
                  placeholder="args (e.g. -y @modelcontextprotocol/server-github)"
                />
              </div>
            </div>
          ))}

          {stdioEntries.length === 0 && (
            <div className="mcp-empty">no custom tools — add stdio MCP servers that run inside the agent pod</div>
          )}
        </div>

        <div className="dialog-actions">
          <button className="dialog-cancel-btn" onClick={onCancel}>cancel</button>
          <button
            className="dialog-submit-btn"
            onClick={handleSubmit}
            disabled={!name.trim() || !image.trim()}
          >
            create
          </button>
        </div>
      </div>
    </div>
  );
}

/** Create instance dialog — name + toggle template MCP servers. */
function CreateInstanceDialog({
  templateName,
  mcpServers,
  onSubmit,
  onCancel,
}: {
  templateName: string;
  mcpServers?: Record<string, MCPServerConfig> | null;
  onSubmit: (name: string, enabledMcpServers?: string[]) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const serverNames = Object.keys(mcpServers ?? {});
  const [enabled, setEnabled] = useState<Set<string>>(new Set(serverNames));

  const toggle = (serverName: string) => {
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(serverName)) next.delete(serverName);
      else next.add(serverName);
      return next;
    });
  };

  const handleSubmit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const list = serverNames.filter((n) => enabled.has(n));
    onSubmit(trimmed, list.length > 0 ? list : undefined);
  };

  return (
    <div className="dialog-overlay" onClick={onCancel}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <span>new instance</span>
          <span className="dialog-sub">template: {templateName}</span>
        </div>

        <label className="dialog-label">
          name
          <input
            className="dialog-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            placeholder="my-agent"
            autoFocus
          />
        </label>

        {serverNames.length > 0 && (
          <div className="dialog-section">
            <div className="dialog-section-header">
              <span>MCP servers</span>
              <span className="dialog-sub">{enabled.size}/{serverNames.length} enabled</span>
            </div>
            {serverNames.map((serverName) => {
              const s = mcpServers![serverName];
              return (
                <label key={serverName} className="mcp-toggle">
                  <input
                    type="checkbox"
                    checked={enabled.has(serverName)}
                    onChange={() => toggle(serverName)}
                  />
                  <span className="mcp-toggle-name">{serverName}</span>
                  <span className="mcp-toggle-meta">
                    {s.type === "http" ? s.url : `${s.command} ${(s.args ?? []).join(" ")}`}
                  </span>
                </label>
              );
            })}
          </div>
        )}

        <div className="dialog-actions">
          <button className="dialog-cancel-btn" onClick={onCancel}>cancel</button>
          <button className="dialog-submit-btn" onClick={handleSubmit} disabled={!name.trim()}>
            create
          </button>
        </div>
      </div>
    </div>
  );
}

/** Connectors page — manage global MCP connections (OAuth). */
function ConnectorsPage({ onBack }: { onBack: () => void }) {
  const [connections, setConnections] = useState<
    { hostname: string; connectedAt: string; expired: boolean }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [connectUrl, setConnectUrl] = useState("");
  const [connecting, setConnecting] = useState(false);

  const fetchConnections = useCallback(() => {
    setLoading(true);
    fetch("/api/mcp/connections")
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setConnections(data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchConnections(); }, [fetchConnections]);

  const startOAuth = async () => {
    if (!connectUrl.trim()) return;
    setConnecting(true);
    try {
      const res = await fetch("/api/oauth/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mcpServerUrl: connectUrl.trim() }),
      });
      const data = await res.json() as { authUrl?: string; error?: string };
      if (data.error) {
        window.alert(`OAuth error: ${data.error}`);
        setConnecting(false);
        return;
      }
      if (data.authUrl) {
        sessionStorage.setItem("humr-return-view", "connectors");
        window.location.href = data.authUrl;
      }
    } catch (err) {
      window.alert(`Failed: ${err}`);
      setConnecting(false);
    }
  };

  return (
    <div className="shell">
      <header className="header">
        <button className="back-btn" onClick={onBack}>← back</button>
        <span className="header-logo">◈ Humr</span>
        <span className="header-sub">connectors</span>
      </header>

      <div className="connectors-page">
        <div className="connectors-section">
          <h3 className="connectors-title">connected MCP servers</h3>
          {loading && <div className="mcp-empty">loading...</div>}
          {!loading && connections.length === 0 && (
            <div className="mcp-empty">no connections yet</div>
          )}
          {connections.map((c) => (
            <div key={c.hostname} className="connector-card">
              <span className={`instance-dot ${c.expired ? "dot-error" : "dot-ready"}`} />
              <span className="connector-host">{c.hostname}</span>
              <span className="connector-meta">
                {c.expired ? "expired" : `connected ${new Date(c.connectedAt).toLocaleDateString()}`}
              </span>
              {c.expired && (
                <button
                  className="mcp-connect-btn expired"
                  onClick={() => { setConnectUrl(`https://${c.hostname}/mcp`); }}
                >
                  reconnect
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="connectors-section">
          <h3 className="connectors-title">connect new MCP server</h3>
          <div className="mcp-entry-row">
            <input
              className="dialog-input"
              value={connectUrl}
              onChange={(e) => setConnectUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && startOAuth()}
              placeholder="https://example.com/mcp"
            />
            <button
              className="mcp-connect-btn"
              onClick={startOAuth}
              disabled={!connectUrl.trim() || connecting}
            >
              {connecting ? "..." : "connect"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [view, setView] = useState<"list" | "chat" | "connectors">(() => {
    // Return to connectors page after OAuth redirect if that's where we came from
    const saved = sessionStorage.getItem("humr-return-view");
    if (saved) {
      sessionStorage.removeItem("humr-return-view");
      return saved as "list" | "chat" | "connectors";
    }
    return "list";
  });
  const [selectedInstance, setSelectedInstance] = useState<string | null>(null);
  const [instances, setInstances] = useState<InstanceView[]>([]);
  const [loadingInstances, setLoadingInstances] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [rightTab, setRightTab] = useState<"files" | "log" | "schedules">("files");
  const [schedules, setSchedules] = useState<
    {
      name: string;
      instanceName: string;
      type: "heartbeat" | "cron";
      cron: string;
      task: string | null;
      enabled: boolean;
      status: { lastRun?: string; nextRun?: string; lastResult?: string } | null;
    }[]
  >([]);
  const [showCreateSchedule, setShowCreateSchedule] = useState(false);
  const [scheduleForm, setScheduleForm] = useState({
    type: "cron" as "cron" | "heartbeat",
    name: "",
    cron: "",
    task: "",
    intervalMinutes: 5,
  });
  const [creatingSched, setCreatingSched] = useState(false);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [loadingSession, setLoadingSession] = useState(false);
  const [fileTree, setFileTree] = useState<TreeEntry[]>([]);
  const [openFile, setOpenFile] = useState<{
    path: string;
    content: string;
  } | null>(null);
  const [templates, setTemplates] = useState<TemplateView[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [creatingInstance, setCreatingInstance] = useState<string | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState<string | null>(null);
  const [creatingTemplate, setCreatingTemplate] = useState(false);
  const [deletingTemplate, setDeletingTemplate] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const logBottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const connectionRef = useRef<{
    connection: ClientSideConnection;
    ws: WebSocket;
  } | null>(null);
  const activeSessionIdRef = useRef<string | null>(null);
  const currentAssistantIdRef = useRef<string | null>(null);

  const instanceTrpc = useMemo(
    () => (selectedInstance ? createInstanceTrpc(selectedInstance) : null),
    [selectedInstance],
  );

  const selectedMcpServers = useMemo(
    () => resolveAcpMcpServers(templates, instances.find((i) => i.name === selectedInstance)),
    [templates, instances, selectedInstance],
  );

  // Handle OAuth callback redirect
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
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    logBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [log]);

  const fetchSchedules = useCallback(async () => {
    if (!selectedInstance) return;
    try {
      const list = await platform.schedules.list.query({ instanceName: selectedInstance });
      setSchedules(list);
    } catch {}
  }, [selectedInstance]);

  useEffect(() => {
    if (!selectedInstance || rightTab !== "schedules") return;
    fetchSchedules();
    const poll = setInterval(fetchSchedules, 5000);
    return () => clearInterval(poll);
  }, [selectedInstance, rightTab, fetchSchedules]);

  useEffect(() => {
    if (!instanceTrpc) return;
    const poll = setInterval(async () => {
      try {
        const { entries } = await instanceTrpc.files.tree.query();
        setFileTree(entries);
        if (openFile) {
          try {
            const data = await instanceTrpc.files.read.query({ path: openFile.path });
            if (data.content !== undefined)
              setOpenFile({ path: data.path, content: data.content });
            else setOpenFile(null);
          } catch {
            setOpenFile(null);
          }
        }
      } catch {}
    }, 2000);
    return () => clearInterval(poll);
  }, [instanceTrpc, openFile]);

  useEffect(() => {
    if (!instanceTrpc) return;
    instanceTrpc.files.tree
      .query()
      .then(({ entries }) => setFileTree(entries))
      .catch(() => {});
  }, [instanceTrpc]);

  const fetchTemplates = useCallback(async () => {
    setLoadingTemplates(true);
    try {
      const list = await platform.templates.list.query();
      setTemplates(list);
    } catch {}
    setLoadingTemplates(false);
  }, []);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  const fetchInstances = useCallback(async () => {
    setLoadingInstances(true);
    try {
      const list = await platform.instances.list.query();
      setInstances(list);
    } catch {}
    setLoadingInstances(false);
  }, []);

  useEffect(() => {
    fetchInstances();
  }, [fetchInstances]);

  const [showTemplateDialog, setShowTemplateDialog] = useState(false);

  const submitCreateTemplate = useCallback(async (input: {
    name: string;
    image: string;
    description?: string;
    mcpServers?: Record<string, MCPServerConfig>;
  }) => {
    setShowTemplateDialog(false);
    setCreatingTemplate(true);
    try {
      await platform.templates.create.mutate(input);
      await fetchTemplates();
    } catch (err: any) {
      window.alert(err?.message ?? "Failed to create template");
    }
    setCreatingTemplate(false);
  }, [fetchTemplates]);

  const deleteTemplate = useCallback(async (name: string) => {
    if (!window.confirm(`Delete template "${name}"?`)) return;
    setDeletingTemplate(name);
    try {
      await platform.templates.delete.mutate({ name });
      await fetchTemplates();
      await fetchInstances();
    } catch (err: any) {
      window.alert(err?.message ?? "Failed to delete template");
    }
    setDeletingTemplate(null);
  }, [fetchTemplates, fetchInstances]);

  const deleteInstance = useCallback(async (name: string) => {
    if (!window.confirm(`Delete instance "${name}"?`)) return;
    try {
      await platform.instances.delete.mutate({ name });
      await fetchInstances();
    } catch (err: any) {
      window.alert(err?.message ?? "Failed to delete instance");
    }
  }, [fetchInstances]);

  const createInstance = useCallback((templateName: string) => {
    setShowCreateDialog(templateName);
  }, []);

  const submitCreateInstance = useCallback(async (
    templateName: string,
    name: string,
    enabledMcpServers?: string[],
  ) => {
    setCreatingInstance(templateName);
    setShowCreateDialog(null);
    try {
      await platform.instances.create.mutate({
        name,
        templateName,
        enabledMcpServers,
      });
      await fetchInstances();
    } catch (err: any) {
      window.alert(err?.message ?? "Failed to create instance");
    }
    setCreatingInstance(null);
  }, [fetchInstances]);

  const selectInstance = useCallback((name: string) => {
    connectionRef.current?.ws.close();
    connectionRef.current = null;
    activeSessionIdRef.current = null;
    setSelectedInstance(name);
    setSessionId(null);
    setMessages([]);
    setSessions([]);
    setFileTree([]);
    setOpenFile(null);
    setLog([]);
    setView("chat");
  }, []);

  const goBack = useCallback(() => {
    connectionRef.current?.ws.close();
    connectionRef.current = null;
    activeSessionIdRef.current = null;
    setSelectedInstance(null);
    setSessionId(null);
    setMessages([]);
    setSessions([]);
    setFileTree([]);
    setOpenFile(null);
    setLog([]);
    setView("list");
    fetchInstances();
  }, [fetchInstances]);

  const fetchSessions = useCallback(async () => {
    if (!selectedInstance) return;
    setLoadingSessions(true);
    try {
      const { connection, ws } = await openConnection(selectedInstance, () => {});
      await connection.initialize({
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
      });
      const result = await connection.listSessions({ cwd: "." });
      setSessions(result.sessions ?? []);
      ws.close();
    } catch {}
    setLoadingSessions(false);
  }, [selectedInstance]);

  useEffect(() => {
    if (selectedInstance) fetchSessions();
  }, [selectedInstance, fetchSessions]);

  const resumeSession = useCallback(async (sid: string) => {
    if (!selectedInstance) return;
    setBusy(true);
    setLoadingSession(true);
    setMessages([]);
    setSessionId(sid);

    connectionRef.current?.ws.close();
    connectionRef.current = null;
    activeSessionIdRef.current = null;

    const msgMap = new Map<string, Message>();
    const msgOrder: string[] = [];

    try {
      const { connection, ws } = await openConnection(selectedInstance, (u) => {
        if (
          u.sessionUpdate === "user_message_chunk" ||
          u.sessionUpdate === "agent_message_chunk"
        ) {
          if (u.content.type !== "text") return;
          const txt = u.content.text as string;
          if (/<[a-z-]+>/.test(txt) && /<\/[a-z-]+>/.test(txt)) return;
          const role: Role =
            u.sessionUpdate === "user_message_chunk" ? "user" : "assistant";
          const mid = u.messageId ?? crypto.randomUUID();
          const existing = msgMap.get(mid);
          if (existing) {
            const last = existing.parts[existing.parts.length - 1];
            if (last?.kind === "text") {
              last.text += u.content.text;
            } else {
              existing.parts.push({ kind: "text", text: u.content.text });
            }
          } else {
            const msg: Message = {
              id: mid,
              role,
              parts: [{ kind: "text", text: u.content.text }],
              streaming: false,
            };
            msgMap.set(mid, msg);
            msgOrder.push(mid);
          }
        } else if (u.sessionUpdate === "tool_call") {
          const mid = u.messageId ?? msgOrder[msgOrder.length - 1];
          const existing = mid ? msgMap.get(mid) : null;
          if (existing) {
            existing.parts.push({
              kind: "tool",
              title: u.title,
              status: u.status,
            });
          }
        }
      });
      await connection.initialize({
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
      });
      await connection.loadSession({
        sessionId: sid,
        cwd: ".",
        mcpServers: selectedMcpServers,
      });
      ws.close();
    } catch {}

    setMessages(msgOrder.map((id) => msgMap.get(id)!));
    setLoadingSession(false);
    setBusy(false);
  }, [selectedInstance]);

  const openFileHandler = useCallback(
    async (path: string) => {
      if (!instanceTrpc) return;
      if (openFile?.path === path) {
        setOpenFile(null);
        return;
      }
      try {
        const data = await instanceTrpc.files.read.query({ path });
        if (data.content !== undefined)
          setOpenFile({ path: data.path, content: data.content });
      } catch {}
    },
    [instanceTrpc, openFile],
  );

  const addLog = useCallback((type: string, payload: object) => {
    const ts = new Date().toISOString().slice(11, 23);
    setLog((prev) => [...prev, { id: crypto.randomUUID(), ts, type, payload }]);
  }, []);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || busy || !selectedInstance) return;
    setInput("");
    setBusy(true);

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      parts: [{ kind: "text", text }],
      streaming: false,
    };
    const assistantId = crypto.randomUUID();
    const assistantMsg: Message = {
      id: assistantId,
      role: "assistant",
      parts: [],
      streaming: true,
    };
    currentAssistantIdRef.current = assistantId;

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    addLog("prompt", { text });

    try {
      if (
        !connectionRef.current ||
        connectionRef.current.ws.readyState !== WebSocket.OPEN
      ) {
        const { connection, ws } = await openConnection(selectedInstance, (u) => {
          const aid = currentAssistantIdRef.current;
          if (!aid) return;
          if (
            u.sessionUpdate === "agent_message_chunk" &&
            u.content.type === "text"
          ) {
            setMessages((prev) =>
              prev.map((m) => {
                if (m.id !== aid) return m;
                const parts = [...m.parts];
                const last = parts[parts.length - 1];
                if (last?.kind === "text") {
                  parts[parts.length - 1] = {
                    kind: "text",
                    text: last.text + u.content.text,
                  };
                } else {
                  parts.push({ kind: "text", text: u.content.text });
                }
                return { ...m, parts };
              }),
            );
            addLog("text", { text: u.content.text });
          } else if (u.sessionUpdate === "tool_call") {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === aid
                  ? {
                      ...m,
                      parts: [
                        ...m.parts,
                        {
                          kind: "tool",
                          title: u.title,
                          status: u.status,
                        } as ToolChip,
                      ],
                    }
                  : m,
              ),
            );
            addLog("tool", { title: u.title, status: u.status });
          }
        });

        await connection.initialize({
          protocolVersion: PROTOCOL_VERSION,
          clientCapabilities: {
            fs: { readTextFile: true, writeTextFile: true },
          },
        });

        ws.onclose = () => {
          connectionRef.current = null;
        };

        connectionRef.current = { connection, ws };
      }

      const conn = connectionRef.current!.connection;

      if (!activeSessionIdRef.current) {
        if (sessionId) {
          await conn.unstable_resumeSession({
            sessionId,
            cwd: ".",
            mcpServers: selectedMcpServers,
          });
          activeSessionIdRef.current = sessionId;
        } else {
          const session = await conn.newSession({
            cwd: ".",
            mcpServers: selectedMcpServers,
          });
          setSessionId(session.sessionId);
          activeSessionIdRef.current = session.sessionId;
          addLog("session", { sessionId: session.sessionId });
        }
      }

      const result = await conn.prompt({
        sessionId: activeSessionIdRef.current!,
        prompt: [{ type: "text", text }],
      });

      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId ? { ...m, streaming: false } : m,
        ),
      );
      addLog("done", { stopReason: result.stopReason });
    } catch (err: any) {
      addLog("error", { message: err?.message });
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId ? { ...m, streaming: false } : m,
        ),
      );
      connectionRef.current?.ws.close();
      connectionRef.current = null;
      activeSessionIdRef.current = null;
    } finally {
      setBusy(false);
      textareaRef.current?.focus();
    }
  }, [input, busy, selectedInstance, sessionId, addLog]);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  function instanceDotClass(inst: InstanceView): string {
    if (inst.status?.podReady) return "ready";
    if (inst.status?.currentState === "error") return "error";
    if (inst.desiredState === "hibernated" || inst.status?.currentState === "hibernated") return "hibernated";
    return "running";
  }

  const instancesByTemplate = useMemo(() => {
    const map = new Map<string, InstanceView[]>();
    for (const inst of instances) {
      const list = map.get(inst.templateName) ?? [];
      list.push(inst);
      map.set(inst.templateName, list);
    }
    return map;
  }, [instances]);

  if (view === "connectors") {
    return <ConnectorsPage onBack={() => setView("list")} />;
  }

  if (view === "list") {
    return (
      <div className="shell">
        <header className="header">
          <span className="header-logo">◈ Humr</span>
          <span className="header-sub">PROTOTYPE</span>
          <button className="connectors-btn" onClick={() => setView("connectors")}>connectors</button>
        </header>

        <div className="list-view">
          <div className="list-toolbar">
            <span className="list-title">templates</span>
            <button
              className="create-template-btn"
              disabled={creatingTemplate}
              onClick={() => setShowTemplateDialog(true)}
            >
              {creatingTemplate ? "…" : "+ template"}
            </button>
            <button className="left-sidebar-refresh" onClick={() => { fetchTemplates(); fetchInstances(); }}>↻</button>
          </div>

          {(loadingTemplates || loadingInstances) && (
            <div className="sessions-empty">loading...</div>
          )}
          {!loadingTemplates && templates.length === 0 && (
            <div className="sessions-empty">no templates</div>
          )}

          <div className="template-grid">
            {templates.map((tmpl) => {
              const tmplInstances = instancesByTemplate.get(tmpl.name) ?? [];
              return (
                <div key={tmpl.name} className="template-card">
                  <div className="template-card-header">
                    <div className="template-card-title-row">
                      <span className="template-card-name">{tmpl.name}</span>
                      <button
                        className="create-instance-btn"
                        disabled={creatingInstance === tmpl.name}
                        onClick={() => createInstance(tmpl.name)}
                      >
                        {creatingInstance === tmpl.name ? "…" : "+ instance"}
                      </button>
                      <button
                        className="delete-template-btn"
                        disabled={deletingTemplate === tmpl.name}
                        onClick={() => deleteTemplate(tmpl.name)}
                      >
                        {deletingTemplate === tmpl.name ? "…" : "×"}
                      </button>
                    </div>
                    <span className="template-card-meta">
                      {tmpl.image}{tmpl.description ? ` · ${tmpl.description}` : ""}
                    </span>
                  </div>
                  <div className="template-card-instances">
                    {tmplInstances.length === 0 && (
                      <div className="template-card-empty">no instances</div>
                    )}
                    {tmplInstances.map((inst) => {
                      const ready = inst.status?.podReady === true;
                      return (
                        <div
                          key={inst.name}
                          className={`instance-entry${ready ? " clickable" : " disabled"}`}
                          onClick={ready ? () => selectInstance(inst.name) : undefined}
                        >
                          <div className="instance-header">
                            <span className={`instance-dot ${instanceDotClass(inst)}`} />
                            <span className="instance-name">{inst.name}</span>
                          </div>
                          <span className="instance-meta">
                            {inst.status
                              ? ready
                                ? inst.status.currentState
                                : inst.status.currentState === "running"
                                  ? "starting"
                                  : inst.status.currentState
                              : "unknown"}
                          </span>
                          <button
                            className="delete-instance-btn"
                            onClick={(e) => { e.stopPropagation(); deleteInstance(inst.name); }}
                          >×</button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {showTemplateDialog && (
          <CreateTemplateDialog
            onSubmit={submitCreateTemplate}
            onCancel={() => setShowTemplateDialog(false)}
            onGoToConnectors={() => { setShowTemplateDialog(false); setView("connectors"); }}
          />
        )}

        {showCreateDialog && (
          <CreateInstanceDialog
            templateName={showCreateDialog}
            mcpServers={templates.find((t) => t.name === showCreateDialog)?.mcpServers}
            onSubmit={(name, enabled) => submitCreateInstance(showCreateDialog, name, enabled)}
            onCancel={() => setShowCreateDialog(null)}
          />
        )}
      </div>
    );
  }

  return (
    <div className="shell">
      <header className="header">
        <button className="back-btn" onClick={goBack}>← templates</button>
        <span className="header-logo">◈ Humr</span>
        <span className="header-sub">{selectedInstance}</span>
        {sessionId && (
          <button
            className="new-session-btn"
            onClick={() => {
              connectionRef.current?.ws.close();
              connectionRef.current = null;
              activeSessionIdRef.current = null;
              setSessionId(null);
              setMessages([]);
            }}
          >
            + new session
          </button>
        )}
        <span className={`header-status ${busy ? "busy" : "idle"}`}>
          {busy ? "▶ running" : "● ready"}
        </span>
      </header>

      <div className="body">
        <aside className="left-sidebar">
          <div className="left-sidebar-header">
            <span className="left-sidebar-title">sessions</span>
            <button className="left-sidebar-refresh" onClick={fetchSessions}>↻</button>
          </div>
          <div className="sessions-panel">
            {loadingSessions && (
              <div className="sessions-empty">loading sessions...</div>
            )}
            {!loadingSessions && sessions.length === 0 && (
              <div className="sessions-empty">no sessions</div>
            )}
            {sessions.map((s) => (
              <div
                key={s.sessionId}
                className={`session-entry ${s.sessionId === sessionId ? "active" : ""}`}
                onClick={() => resumeSession(s.sessionId)}
              >
                <span className="session-title">
                  {s.title || s.sessionId.slice(0, 12)}
                </span>
                {s.updatedAt && (
                  <span className="session-time">
                    {new Date(s.updatedAt).toLocaleString()}
                  </span>
                )}
              </div>
            ))}
          </div>
        </aside>

        <section className="chat-panel">
          <div className="messages">
            {loadingSession && (
              <div className="loading-session">
                <span className="spinner" />
                loading session…
              </div>
            )}
            {!loadingSession && messages.length === 0 && (
              <div className="empty">send a message to start a new session</div>
            )}
            {messages.map((m) => (
              <div key={m.id} className={`message ${m.role}`}>
                <span className="role-tag">
                  {m.role === "user" ? "you" : "agent"}
                </span>
                <div className="content">
                  {m.parts.map((p, i) =>
                    p.kind === "text" ? (
                      <span key={i} className="text-part">
                        {p.text}
                        {m.streaming &&
                          i === m.parts.length - 1 &&
                          p.kind === "text" && <span className="cursor" />}
                      </span>
                    ) : (
                      <span key={i} className={`tool-chip status-${p.status}`}>
                        ⚙ {p.title}
                        <span className="tool-status">{p.status}</span>
                      </span>
                    ),
                  )}
                  {m.streaming && m.parts.length === 0 && (
                    <span className="cursor" />
                  )}
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          <div className="input-bar">
            <textarea
              ref={textareaRef}
              className="input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="message agent  ↵ send  shift+↵ newline"
              rows={1}
              disabled={busy}
            />
            <button
              className="send-btn"
              onClick={send}
              disabled={busy || !input.trim()}
            >
              {busy ? "…" : "send"}
            </button>
          </div>
        </section>

        <aside className="sidebar">
          <div className="sidebar-tabs">
            <button
              className={`sidebar-tab ${rightTab === "files" ? "active" : ""}`}
              onClick={() => setRightTab("files")}
            >
              files
            </button>
            <button
              className={`sidebar-tab ${rightTab === "log" ? "active" : ""}`}
              onClick={() => setRightTab("log")}
            >
              log
            </button>
            <button
              className={`sidebar-tab ${rightTab === "schedules" ? "active" : ""}`}
              onClick={() => setRightTab("schedules")}
            >
              schedules
            </button>
          </div>
          <div className="sidebar-content">
            {rightTab === "files" && !openFile && (
              <div className="file-tree">
                {fileTree.length === 0 && (
                  <div className="file-tree-empty">no files yet</div>
                )}
                {fileTree.map((e) => (
                  <div
                    key={e.path}
                    className={`tree-entry ${e.type}`}
                    style={{
                      paddingLeft: `${16 + (e.path.split("/").length - 1) * 14}px`,
                    }}
                    onClick={
                      e.type === "file"
                        ? () => openFileHandler(e.path)
                        : undefined
                    }
                  >
                    <span className="tree-icon">
                      {e.type === "dir" ? "▸" : "·"}
                    </span>
                    <span className="tree-name">{e.path.split("/").pop()}</span>
                  </div>
                ))}
              </div>
            )}
            {rightTab === "files" && openFile && (
              <div className="file-viewer">
                <div className="file-viewer-header">
                  <button
                    className="file-viewer-back"
                    onClick={() => setOpenFile(null)}
                  >
                    ←
                  </button>
                  <span className="file-viewer-name">{openFile.path}</span>
                </div>
                <div className="file-viewer-content">
                  <pre>{openFile.content}</pre>
                </div>
              </div>
            )}
            {rightTab === "log" && (
              <div className="log-panel">
                <div className="log-entries">
                  {log.length === 0 && (
                    <div className="log-empty">no events yet</div>
                  )}
                  {log.map((e) => (
                    <div key={e.id} className={`log-entry type-${e.type}`}>
                      <span className="log-ts">{e.ts}</span>
                      <span className="log-type">{e.type}</span>
                      <pre className="log-payload">
                        {JSON.stringify(e.payload, null, 2)}
                      </pre>
                    </div>
                  ))}
                  <div ref={logBottomRef} />
                </div>
              </div>
            )}
            {rightTab === "schedules" && (
              <div className="schedule-panel">
                <div className="schedule-toolbar">
                  <button
                    className="create-schedule-btn"
                    onClick={() => {
                      setScheduleForm({ type: "cron", name: "", cron: "", task: "", intervalMinutes: 5 });
                      setShowCreateSchedule(true);
                    }}
                  >
                    + add schedule
                  </button>
                </div>
                {showCreateSchedule && (
                  <div className="schedule-form">
                    <div className="schedule-form-type">
                      <button
                        className={`schedule-type-btn ${scheduleForm.type === "cron" ? "active" : ""}`}
                        onClick={() => setScheduleForm((f) => ({ ...f, type: "cron" }))}
                      >
                        cron
                      </button>
                      <button
                        className={`schedule-type-btn ${scheduleForm.type === "heartbeat" ? "active" : ""}`}
                        onClick={() => setScheduleForm((f) => ({ ...f, type: "heartbeat" }))}
                      >
                        heartbeat
                      </button>
                    </div>
                    <input
                      className="schedule-input"
                      placeholder="name"
                      value={scheduleForm.name}
                      onChange={(e) => setScheduleForm((f) => ({ ...f, name: e.target.value }))}
                    />
                    {scheduleForm.type === "cron" && (
                      <>
                        <input
                          className="schedule-input"
                          placeholder="cron expression"
                          value={scheduleForm.cron}
                          onChange={(e) => setScheduleForm((f) => ({ ...f, cron: e.target.value }))}
                        />
                        <textarea
                          className="schedule-textarea"
                          placeholder="task prompt"
                          value={scheduleForm.task}
                          onChange={(e) => setScheduleForm((f) => ({ ...f, task: e.target.value }))}
                          rows={3}
                        />
                      </>
                    )}
                    {scheduleForm.type === "heartbeat" && (
                      <input
                        className="schedule-input"
                        type="number"
                        min={1}
                        placeholder="interval (minutes)"
                        value={scheduleForm.intervalMinutes}
                        onChange={(e) => setScheduleForm((f) => ({ ...f, intervalMinutes: parseInt(e.target.value) || 1 }))}
                      />
                    )}
                    <div className="schedule-form-actions">
                      <button
                        className="schedule-submit"
                        disabled={creatingSched || !scheduleForm.name.trim()}
                        onClick={async () => {
                          if (!selectedInstance) return;
                          setCreatingSched(true);
                          try {
                            if (scheduleForm.type === "cron") {
                              await platform.schedules.createCron.mutate({
                                name: scheduleForm.name,
                                instanceName: selectedInstance,
                                cron: scheduleForm.cron,
                                task: scheduleForm.task,
                              });
                            } else {
                              await platform.schedules.createHeartbeat.mutate({
                                name: scheduleForm.name,
                                instanceName: selectedInstance,
                                intervalMinutes: scheduleForm.intervalMinutes,
                              });
                            }
                            setShowCreateSchedule(false);
                            fetchSchedules();
                          } catch (err) {
                            alert(err instanceof Error ? err.message : "failed to create schedule");
                          } finally {
                            setCreatingSched(false);
                          }
                        }}
                      >
                        {creatingSched ? "…" : "create"}
                      </button>
                      <button
                        className="schedule-cancel"
                        onClick={() => setShowCreateSchedule(false)}
                      >
                        cancel
                      </button>
                    </div>
                  </div>
                )}
                {schedules.length === 0 && !showCreateSchedule && (
                  <div className="schedule-empty">no schedules</div>
                )}
                {schedules.map((s) => (
                  <div key={s.name} className="schedule-row">
                    <div className="schedule-row-top">
                      <span className={`schedule-badge ${s.type}`}>
                        {s.type}
                      </span>
                      <span className="schedule-name">{s.name}</span>
                      <span className="schedule-expr">{s.cron}</span>
                      <button
                        className={`schedule-toggle ${s.enabled ? "on" : "off"}`}
                        onClick={async () => {
                          await platform.schedules.toggle.mutate({ name: s.name });
                          fetchSchedules();
                        }}
                      >
                        {s.enabled ? "on" : "off"}
                      </button>
                      <button
                        className="schedule-delete"
                        onClick={async () => {
                          if (!window.confirm(`Delete schedule "${s.name}"?`)) return;
                          await platform.schedules.delete.mutate({ name: s.name });
                          fetchSchedules();
                        }}
                      >
                        ×
                      </button>
                    </div>
                    {s.status && (
                      <div className="schedule-status">
                        {s.status.lastRun && <span>last: {s.status.lastRun}</span>}
                        {s.status.nextRun && <span>next: {s.status.nextRun}</span>}
                        {s.status.lastResult && (
                          <span className={`schedule-result ${s.status.lastResult}`}>
                            {s.status.lastResult}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
