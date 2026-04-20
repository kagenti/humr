import yaml from "js-yaml";
import { eq } from "drizzle-orm";
import type { Db } from "db";
import { templates } from "db";
import type { K8sClient } from "./modules/agents/infrastructure/k8s.js";

/**
 * Seed platform templates from Helm-managed ConfigMaps into the DB.
 * Runs once on API server startup. Idempotent — existing rows are left alone.
 */
export async function seedTemplatesFromConfigMaps(k8s: K8sClient, db: Db) {
  try {
    const cms = await k8s.listConfigMaps("humr.ai/type=agent-template");
    for (const cm of cms) {
      const id = cm.metadata!.name!;
      const [existing] = await db.select().from(templates).where(eq(templates.id, id));
      if (existing) continue;

      const specYaml = cm.data?.["spec.yaml"] ?? "";
      const spec = yaml.load(specYaml) as { name?: string };
      const name = spec?.name ?? id;
      await db.insert(templates).values({ id, name, spec });
      process.stderr.write(`[seed] template ${id}\n`);
    }
  } catch (err) {
    process.stderr.write(`[seed] templates: ${err}\n`);
  }
}
