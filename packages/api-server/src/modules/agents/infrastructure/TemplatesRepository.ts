import type { Template, TemplateSpec } from "api-server-api";
import { eq } from "drizzle-orm";
import type { Db } from "db";
import { templates } from "db";

export interface TemplatesRepository {
  list(): Promise<Template[]>;
  get(id: string): Promise<Template | null>;
  readSpec(id: string): Promise<{ spec: TemplateSpec; isOwned: boolean } | null>;
}

export function createTemplatesRepository(db: Db): TemplatesRepository {
  return {
    async list() {
      const rows = await db.select().from(templates);
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        spec: r.spec as TemplateSpec,
      }));
    },

    async get(id) {
      const [row] = await db.select().from(templates).where(eq(templates.id, id));
      if (!row) return null;
      return { id: row.id, name: row.name, spec: row.spec as TemplateSpec };
    },

    async readSpec(id) {
      const [row] = await db.select().from(templates).where(eq(templates.id, id));
      if (!row) return null;
      return { spec: row.spec as TemplateSpec, isOwned: false };
    },
  };
}
