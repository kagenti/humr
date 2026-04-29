import { createHash } from "node:crypto";
import type { OnecliClient } from "../../../apps/api-server/onecli.js";

export interface OnecliForeignCredentialsPort {
  exchangeImpersonationToken(foreignSub: string): Promise<string>;
  createOrFindAgent(args: {
    onecliToken: string;
    identifier: string;
    displayName: string;
  }): Promise<{ accessToken: string }>;
}

interface OnecliAgent {
  id: string;
  identifier: string;
  accessToken: string;
}

export function buildForkIdentifier(instanceId: string, foreignSub: string): string {
  const hash = createHash("sha256").update(foreignSub).digest("hex").slice(0, 12);
  return `fork-${instanceId}-${hash}`;
}

export function createOnecliForeignCredentialsPort(
  onecli: OnecliClient,
): OnecliForeignCredentialsPort {
  async function findAgentByIdentifier(
    token: string,
    identifier: string,
  ): Promise<OnecliAgent | null> {
    const res = await onecli.onecliFetchWithToken(token, "/api/agents");
    if (!res.ok) {
      throw new Error(`OneCLI GET /api/agents: ${res.status} ${await res.text()}`);
    }
    const list = (await res.json()) as OnecliAgent[];
    return list.find((a) => a.identifier === identifier) ?? null;
  }

  async function setSecretMode(
    onecliToken: string,
    agentId: string,
    mode: "all" | "selective",
  ): Promise<void> {
    const res = await onecli.onecliFetchWithToken(onecliToken, `/api/agents/${agentId}/secret-mode`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode }),
    });
    if (!res.ok) {
      throw new Error(`OneCLI PATCH secret-mode: ${res.status} ${await res.text()}`);
    }
  }

  async function createOrFindAgent(args: {
    onecliToken: string;
    identifier: string;
    displayName: string;
  }): Promise<{ accessToken: string }> {
    const res = await onecli.onecliFetchWithToken(args.onecliToken, "/api/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: args.displayName, identifier: args.identifier }),
    });

    if (res.status === 409) {
      const existing = await findAgentByIdentifier(args.onecliToken, args.identifier);
      if (!existing) {
        throw new Error(`OneCLI 409 on create but no agent with identifier ${args.identifier}`);
      }
      await setSecretMode(args.onecliToken, existing.id, "all");
      return { accessToken: existing.accessToken };
    }

    if (!res.ok) {
      throw new Error(`OneCLI POST /api/agents: ${res.status} ${await res.text()}`);
    }

    const created = (await res.json()) as { id: string; accessToken?: string };
    await setSecretMode(args.onecliToken, created.id, "all");

    if (created.accessToken) return { accessToken: created.accessToken };

    const full = await findAgentByIdentifier(args.onecliToken, args.identifier);
    if (!full) throw new Error(`OneCLI agent ${args.identifier} not found after create`);
    return { accessToken: full.accessToken };
  }

  return {
    exchangeImpersonationToken: onecli.impersonate,
    createOrFindAgent,
  };
}
