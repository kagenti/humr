import type { Schedule, ScheduleSpec, ScheduleStatus } from "api-server-api";
import crypto from "node:crypto";
import { eq, and } from "drizzle-orm";
import type { Db } from "db";
import { schedules, instances } from "db";

export interface SchedulesRepository {
  list(instanceId: string, owner: string): Promise<Schedule[]>;
  get(id: string, owner: string): Promise<Schedule | null>;
  create(instanceId: string, agentRef: string, spec: Record<string, unknown>, owner: string): Promise<Schedule>;
  delete(id: string, owner: string): Promise<void>;
  toggle(id: string, owner: string): Promise<Schedule | null>;
  readAgentRef(instanceId: string, owner: string): Promise<string | null>;
}

function toSchedule(row: typeof schedules.$inferSelect): Schedule {
  const spec = row.spec as ScheduleSpec;
  const status: ScheduleStatus | undefined = row.lastRun
    ? { lastRun: row.lastRun.toISOString(), lastResult: row.lastResult ?? undefined }
    : undefined;
  return {
    id: row.id,
    name: row.name,
    instanceId: row.instanceId,
    spec,
    status,
  };
}

export function createSchedulesRepository(db: Db): SchedulesRepository {
  return {
    async list(instanceId, owner) {
      const rows = await db.select().from(schedules)
        .where(and(eq(schedules.instanceId, instanceId), eq(schedules.owner, owner)));
      return rows.map(toSchedule);
    },

    async get(id, owner) {
      const [row] = await db.select().from(schedules)
        .where(and(eq(schedules.id, id), eq(schedules.owner, owner)));
      return row ? toSchedule(row) : null;
    },

    async create(instanceId, agentRef, spec, owner) {
      const id = `sched-${crypto.randomBytes(4).toString("hex")}`;
      const name = (spec as any).name ?? id;
      const [row] = await db.insert(schedules).values({
        id, name, instanceId, agentId: agentRef, owner, spec,
      }).returning();
      return toSchedule(row);
    },

    async delete(id, owner) {
      await db.delete(schedules).where(and(eq(schedules.id, id), eq(schedules.owner, owner)));
    },

    async toggle(id, owner) {
      const [existing] = await db.select().from(schedules)
        .where(and(eq(schedules.id, id), eq(schedules.owner, owner)));
      if (!existing) return null;
      const spec = existing.spec as ScheduleSpec;
      spec.enabled = !spec.enabled;
      const [updated] = await db.update(schedules)
        .set({ spec })
        .where(eq(schedules.id, id))
        .returning();
      return toSchedule(updated);
    },

    async readAgentRef(instanceId, owner) {
      const [row] = await db.select({ agentId: instances.agentId }).from(instances)
        .where(and(eq(instances.id, instanceId), eq(instances.owner, owner)));
      return row?.agentId ?? null;
    },
  };
}
