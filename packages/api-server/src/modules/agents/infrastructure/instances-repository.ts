import crypto from "node:crypto";
import { eq, and } from "drizzle-orm";
import type { Db } from "db";
import { instances } from "db";
import type { InfraInstance } from "../domain/instance-assembly.js";

export interface InstancesRepository {
  list(owner?: string): Promise<InfraInstance[]>;
  get(id: string, owner?: string): Promise<InfraInstance | null>;
  create(agentId: string, spec: Record<string, unknown>, owner: string): Promise<InfraInstance>;
  updateSpec(id: string, owner: string | undefined, patch: Record<string, unknown>): Promise<InfraInstance | null>;
  delete(id: string, owner?: string): Promise<boolean>;
  isOwnedBy(id: string, owner: string): Promise<boolean>;
}

function toInfra(row: typeof instances.$inferSelect): InfraInstance {
  return {
    id: row.id,
    name: row.name,
    agentId: row.agentId,
    description: row.description ?? undefined,
  };
}

export function createInstancesRepository(db: Db): InstancesRepository {
  return {
    async list(owner?) {
      const rows = owner
        ? await db.select().from(instances).where(eq(instances.owner, owner))
        : await db.select().from(instances);
      return rows.map(toInfra);
    },

    async get(id, owner?) {
      const conds = owner
        ? and(eq(instances.id, id), eq(instances.owner, owner))
        : eq(instances.id, id);
      const [row] = await db.select().from(instances).where(conds);
      return row ? toInfra(row) : null;
    },

    async create(agentId, spec, owner) {
      const id = `inst-${crypto.randomBytes(4).toString("hex")}`;
      const name = (spec as any).name ?? id;
      const description = (spec as any).description ?? null;
      const [row] = await db.insert(instances).values({
        id, name, agentId, owner, description,
      }).returning();
      return toInfra(row);
    },

    async updateSpec(id, owner, patch) {
      const conds = owner
        ? and(eq(instances.id, id), eq(instances.owner, owner))
        : eq(instances.id, id);
      const updates: Partial<typeof instances.$inferInsert> = {};
      if (patch.description !== undefined) updates.description = patch.description as string;
      if (patch.name !== undefined) updates.name = patch.name as string;
      const [updated] = await db.update(instances).set(updates).where(conds).returning();
      return updated ? toInfra(updated) : null;
    },

    async delete(id, owner?) {
      const conds = owner
        ? and(eq(instances.id, id), eq(instances.owner, owner))
        : eq(instances.id, id);
      const result = await db.delete(instances).where(conds).returning();
      return result.length > 0;
    },

    async isOwnedBy(id, owner) {
      const [row] = await db.select({ id: instances.id }).from(instances)
        .where(and(eq(instances.id, id), eq(instances.owner, owner)));
      return !!row;
    },
  };
}
