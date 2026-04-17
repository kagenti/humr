import type { Agent, AgentSpec } from "api-server-api";
import crypto from "node:crypto";
import { eq, and } from "drizzle-orm";
import type { Db } from "db";
import { agents } from "db";

export interface AgentsRepository {
  list(owner: string): Promise<Agent[]>;
  get(id: string, owner: string): Promise<Agent | null>;
  create(spec: Record<string, unknown>, owner: string, templateId?: string): Promise<Agent>;
  updateSpec(id: string, owner: string, patch: Record<string, unknown>): Promise<Agent | null>;
  delete(id: string, owner: string): Promise<void>;
}

function toAgent(row: typeof agents.$inferSelect): Agent {
  return {
    id: row.id,
    name: row.name,
    templateId: row.templateId ?? undefined,
    spec: row.spec as AgentSpec,
  };
}

export function createAgentsRepository(db: Db): AgentsRepository {
  return {
    async list(owner) {
      const rows = await db.select().from(agents).where(eq(agents.owner, owner));
      return rows.map(toAgent);
    },

    async get(id, owner) {
      const [row] = await db.select().from(agents).where(and(eq(agents.id, id), eq(agents.owner, owner)));
      return row ? toAgent(row) : null;
    },

    async create(spec, owner, templateId?) {
      const id = `agent-${crypto.randomBytes(4).toString("hex")}`;
      const name = (spec as any).name ?? id;
      const [row] = await db.insert(agents).values({
        id, name, owner, templateId: templateId ?? null, spec,
      }).returning();
      return toAgent(row);
    },

    async updateSpec(id, owner, patch) {
      const [existing] = await db.select().from(agents).where(and(eq(agents.id, id), eq(agents.owner, owner)));
      if (!existing) return null;
      const merged = { ...(existing.spec as Record<string, unknown>), ...patch };
      const [updated] = await db.update(agents)
        .set({ spec: merged, name: (merged as any).name ?? existing.name })
        .where(and(eq(agents.id, id), eq(agents.owner, owner)))
        .returning();
      return toAgent(updated);
    },

    async delete(id, owner) {
      await db.delete(agents).where(and(eq(agents.id, id), eq(agents.owner, owner)));
    },
  };
}
