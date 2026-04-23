import { Hono } from "hono";
import { z } from "zod";
import { and, eq, inArray } from "db";
import type { Db } from "db";
import { cpAgents, cpAgentSecrets, cpSecrets } from "db";
import type { KeyRing } from "../../crypto/key.js";
import { wrapSecretDekForAgent } from "../crypto.js";

const putInput = z.object({
  secretIds: z.array(z.string().uuid()),
});

export function grantsRoutes(db: Db, keyRing: KeyRing) {
  const router = new Hono();

  router.get("/:agentId/secrets", async (c) => {
    const user = c.get("user");
    const { agentId } = c.req.param();
    const owns = await db
      .select({ id: cpAgents.id })
      .from(cpAgents)
      .where(and(eq(cpAgents.id, agentId), eq(cpAgents.ownerSub, user.sub)))
      .limit(1);
    if (owns.length === 0) return c.json({ error: "not found" }, 404);
    const rows = await db
      .select({ secretId: cpAgentSecrets.secretId })
      .from(cpAgentSecrets)
      .where(eq(cpAgentSecrets.agentId, agentId));
    return c.json(rows.map((r) => r.secretId));
  });

  router.put("/:agentId/secrets", async (c) => {
    const user = c.get("user");
    const body = putInput.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: "invalid body", details: body.error.issues }, 400);
    const { agentId } = c.req.param();

    const [agent] = await db
      .select({
        id: cpAgents.id,
        wrappedDek: cpAgents.wrappedDek,
        kekVersion: cpAgents.kekVersion,
      })
      .from(cpAgents)
      .where(and(eq(cpAgents.id, agentId), eq(cpAgents.ownerSub, user.sub)))
      .limit(1);
    if (!agent) return c.json({ error: "not found" }, 404);

    const secrets = await db
      .select({
        id: cpSecrets.id,
        wrappedDek: cpSecrets.wrappedDek,
        kekVersion: cpSecrets.kekVersion,
      })
      .from(cpSecrets)
      .where(
        and(
          inArray(cpSecrets.id, body.data.secretIds.length > 0 ? body.data.secretIds : [""]),
          eq(cpSecrets.ownerSub, user.sub),
        ),
      );
    if (secrets.length !== body.data.secretIds.length) {
      return c.json({ error: "one or more secrets not found or not owned" }, 400);
    }

    // Replace all grants in a single transaction so the sidecar either sees the
    // old set or the new set, never a partial union.
    await db.transaction(async (tx) => {
      await tx.delete(cpAgentSecrets).where(eq(cpAgentSecrets.agentId, agentId));
      if (secrets.length === 0) return;
      const inserts = secrets.map((s) => ({
        agentId,
        secretId: s.id,
        dekWrappedByAgent: wrapSecretDekForAgent(
          keyRing,
          s.wrappedDek,
          s.kekVersion,
          agent.wrappedDek,
          agent.kekVersion,
        ),
      }));
      await tx.insert(cpAgentSecrets).values(inserts);
    });

    return c.body(null, 204);
  });

  return router;
}
