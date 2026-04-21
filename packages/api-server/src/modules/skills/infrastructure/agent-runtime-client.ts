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
}

async function post(url: string, token: string, body: unknown): Promise<void> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new Error(`agent-runtime ${url} unreachable: ${(err as Error).message}`);
  }
  if (!res.ok) {
    let detail = "";
    try {
      const data = (await res.json()) as { error?: string };
      detail = data.error ?? "";
    } catch {
      detail = await res.text().catch(() => "");
    }
    throw new Error(`agent-runtime ${url} → ${res.status}${detail ? `: ${detail}` : ""}`);
  }
}

export function createAgentRuntimeSkillsClient(namespace: string): AgentRuntimeSkillsClient {
  const base = (instanceId: string) => `http://${podBaseUrl(instanceId, namespace)}`;
  return {
    install: (instanceId, token, body) => post(`${base(instanceId)}/api/skills/install`, token, body),
    uninstall: (instanceId, token, body) => post(`${base(instanceId)}/api/skills/uninstall`, token, body),
  };
}
