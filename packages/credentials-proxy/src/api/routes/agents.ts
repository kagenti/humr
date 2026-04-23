import { Hono } from "hono";
import { z } from "zod";
import { and, eq } from "db";
import type { Db } from "db";
import { cpAgents } from "db";
import type { KeyRing } from "../../crypto/key.js";
import { issueAgentDek } from "../crypto.js";

const createInput = z.object({
  name: z.string().min(1).max(128),
  identifier: z.string().min(1).max(128),
  secretMode: z.enum(["all", "selective"]).default("selective"),
});

export function agentsRoutes(db: Db, keyRing: KeyRing) {
  const router = new Hono();

  router.post("/", async (c) => {
    const user = c.get("user");
    const body = createInput.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: "invalid body", details: body.error.issues }, 400);

    const existing = await db
      .select({ id: cpAgents.id, identifier: cpAgents.identifier })
      .from(cpAgents)
      .where(and(eq(cpAgents.identifier, body.data.identifier), eq(cpAgents.ownerSub, user.sub)))
      .limit(1);
    if (existing.length > 0) {
      return c.json({ error: "agent already exists", id: existing[0]!.id }, 409);
    }

    const dek = issueAgentDek(keyRing);
    const [row] = await db
      .insert(cpAgents)
      .values({
        name: body.data.name,
        identifier: body.data.identifier,
        secretMode: body.data.secretMode,
        ownerSub: user.sub,
        wrappedDek: dek.wrappedDek,
        kekVersion: dek.kekVersion,
      })
      .returning({ id: cpAgents.id, identifier: cpAgents.identifier, secretMode: cpAgents.secretMode });

    // Raw DEK is surfaced ONCE to the caller (the controller) so it can stage
    // a per-agent K8s Secret the sidecar will mount. Never returned again.
    return c.json({
      id: row!.id,
      identifier: row!.identifier,
      secretMode: row!.secretMode,
      dek: dek.rawDek.toString("base64"),
    }, 201);
  });

  router.get("/", async (c) => {
    const user = c.get("user");
    const rows = await db
      .select({
        id: cpAgents.id,
        name: cpAgents.name,
        identifier: cpAgents.identifier,
        secretMode: cpAgents.secretMode,
        createdAt: cpAgents.createdAt,
      })
      .from(cpAgents)
      .where(eq(cpAgents.ownerSub, user.sub));
    return c.json(rows);
  });

  router.delete("/:id", async (c) => {
    const user = c.get("user");
    const { id } = c.req.param();
    const deleted = await db
      .delete(cpAgents)
      .where(and(eq(cpAgents.id, id), eq(cpAgents.ownerSub, user.sub)))
      .returning({ id: cpAgents.id });
    if (deleted.length === 0) return c.json({ error: "not found" }, 404);
    return c.body(null, 204);
  });

  return router;
}
