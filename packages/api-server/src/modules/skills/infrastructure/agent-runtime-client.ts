import type { LocalSkill } from "api-server-api";
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

export interface AgentRuntimeSkillsClient {
  install(instanceId: string, token: string, body: InstallSkillCall): Promise<void>;
  uninstall(instanceId: string, token: string, body: UninstallSkillCall): Promise<void>;
  listLocal(instanceId: string, token: string, skillPaths: string[]): Promise<LocalSkill[]>;
}

async function post(url: string, token: string, body: unknown): Promise<void> {
  const res = await call(url, token, "POST", body);
  await assertOk(res, url);
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
    install: (instanceId, token, body) => post(`${base(instanceId)}/api/skills/install`, token, body),
    uninstall: (instanceId, token, body) => post(`${base(instanceId)}/api/skills/uninstall`, token, body),
    async listLocal(instanceId, token, skillPaths) {
      const qs = skillPaths.map((p) => `skillPaths=${encodeURIComponent(p)}`).join("&");
      const url = `${base(instanceId)}/api/skills/local?${qs}`;
      const { skills } = await getJson<{ skills: LocalSkill[] }>(url, token);
      return skills;
    },
  };
}
