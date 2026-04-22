import type { LocalSkill, Skill } from "api-server-api";
import { podBaseUrl } from "../../agents/infrastructure/k8s.js";

export interface InstallSkillCall {
  source: string;
  name: string;
  version: string;
  skillPaths: string[];
}

export interface UninstallSkillCall {
  name: string;
  skillPaths: string[];
}

export interface LocalSkillFile {
  relPath: string;
  content: string;
  base64?: true;
}

export interface PublishSkillCall {
  name: string;
  skillPaths: string[];
  owner: string;
  repo: string;
  title: string;
  body: string;
}

export interface PublishSkillResult {
  prUrl: string;
  branch: string;
}

/** Upstream-error envelope agent-runtime returns as HTTP 502 when OneCLI's
 *  gateway emits a structured error (app_not_connected / access_restricted /
 *  …). Shape matches what the client should parse to surface the CTA URL. */
export interface UpstreamGatewayError {
  status: number;
  body?: {
    error?: string;
    message?: string;
    connect_url?: string;
    manage_url?: string;
    provider?: string;
  };
}

export interface InstallSkillResult {
  contentHash: string;
}

export interface AgentRuntimeSkillsClient {
  install(instanceId: string, token: string, body: InstallSkillCall): Promise<InstallSkillResult>;
  uninstall(instanceId: string, token: string, body: UninstallSkillCall): Promise<void>;
  listLocal(instanceId: string, token: string, skillPaths: string[]): Promise<LocalSkill[]>;
  readLocal(
    instanceId: string,
    token: string,
    name: string,
    skillPaths: string[],
  ): Promise<LocalSkillFile[]>;
  publish(instanceId: string, token: string, body: PublishSkillCall): Promise<PublishSkillResult>;
  scan(instanceId: string, token: string, source: string): Promise<Skill[]>;
}

export class AgentRuntimeUpstreamError extends Error {
  constructor(message: string, public readonly upstream: UpstreamGatewayError) {
    super(message);
    this.name = "AgentRuntimeUpstreamError";
  }
}

async function post(url: string, token: string, body: unknown): Promise<void> {
  const res = await call(url, token, "POST", body);
  await assertOk(res, url);
}

async function postJson<T>(url: string, token: string, body: unknown): Promise<T> {
  const res = await call(url, token, "POST", body);
  // Preserve upstream structured errors (502 with .upstream) so callers can
  // parse connect_url / manage_url.
  if (!res.ok) {
    let data: unknown = null;
    try { data = await res.json(); } catch { data = { error: await res.text().catch(() => "") }; }
    const detail = (data as { error?: string }).error ?? "";
    const upstream = (data as { upstream?: UpstreamGatewayError }).upstream;
    const msg = `agent-runtime ${url} → ${res.status}${detail ? `: ${detail}` : ""}`;
    if (upstream) throw new AgentRuntimeUpstreamError(msg, upstream);
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

async function getJson<T>(url: string, token: string): Promise<T> {
  const res = await call(url, token, "GET");
  await assertOk(res, url);
  return (await res.json()) as T;
}

async function call(url: string, token: string, method: "GET" | "POST", body?: unknown): Promise<Response> {
  try {
    return await fetch(url, {
      method,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        Authorization: `Bearer ${token}`,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new Error(`agent-runtime ${url} unreachable: ${(err as Error).message}`);
  }
}

async function assertOk(res: Response, url: string): Promise<void> {
  if (res.ok) return;
  let detail = "";
  try {
    const data = (await res.json()) as { error?: string };
    detail = data.error ?? "";
  } catch {
    detail = await res.text().catch(() => "");
  }
  throw new Error(`agent-runtime ${url} → ${res.status}${detail ? `: ${detail}` : ""}`);
}

export function createAgentRuntimeSkillsClient(namespace: string): AgentRuntimeSkillsClient {
  const base = (instanceId: string) => `http://${podBaseUrl(instanceId, namespace)}`;
  return {
    install: (instanceId, token, body) =>
      postJson<InstallSkillResult>(`${base(instanceId)}/api/skills/install`, token, body),
    uninstall: (instanceId, token, body) => post(`${base(instanceId)}/api/skills/uninstall`, token, body),
    async listLocal(instanceId, token, skillPaths) {
      const qs = skillPaths.map((p) => `skillPaths=${encodeURIComponent(p)}`).join("&");
      const url = `${base(instanceId)}/api/skills/local?${qs}`;
      const { skills } = await getJson<{ skills: LocalSkill[] }>(url, token);
      return skills;
    },
    async readLocal(instanceId, token, name, skillPaths) {
      const qs = skillPaths.map((p) => `skillPaths=${encodeURIComponent(p)}`).join("&");
      const url = `${base(instanceId)}/api/skills/local/${encodeURIComponent(name)}?${qs}`;
      const { files } = await getJson<{ files: LocalSkillFile[] }>(url, token);
      return files;
    },
    publish: (instanceId, token, body) =>
      postJson<PublishSkillResult>(`${base(instanceId)}/api/skills/publish`, token, body),
    async scan(instanceId, token, source) {
      const { skills } = await postJson<{ skills: Skill[] }>(
        `${base(instanceId)}/api/skills/scan`,
        token,
        { source },
      );
      return skills;
    },
  };
}
