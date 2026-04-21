import { Hono } from "hono";
import { z } from "zod";
import { and, eq } from "db";
import type { Db } from "db";
import { cpSecrets } from "db";
import type { KeyRing } from "../../crypto/key.js";
import { encryptSecret } from "../crypto.js";

const envMapping = z.object({
  envName: z.string().min(1),
  placeholder: z.string().optional(),
});

const injectionConfig = z.object({
  headerName: z.string().min(1),
  valueFormat: z.string().optional(),
});

const metadataSchema = z.object({
  authMode: z.enum(["api-key", "oauth"]).optional(),
  envMappings: z.array(envMapping).optional(),
  injectionConfig: injectionConfig.optional(),
  oauth: z
    .object({
      providerId: z.string(),
      expiresAt: z.string().optional(),
    })
    .optional(),
});

const createInput = z.object({
  name: z.string().min(1).max(128),
  type: z.enum(["pat", "oauth", "anthropic", "generic"]),
  value: z.string().min(1),
  hostPattern: z.string().min(1),
  metadata: metadataSchema.optional(),
});

const updateInput = z.object({
  name: z.string().min(1).max(128).optional(),
  hostPattern: z.string().min(1).optional(),
  metadata: metadataSchema.optional(),
});

export function secretsRoutes(db: Db, keyRing: KeyRing) {
  const router = new Hono();

  router.post("/", async (c) => {
    const user = c.get("user");
    const body = createInput.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: "invalid body", details: body.error.issues }, 400);

    const enc = encryptSecret(keyRing, body.data.value);
    const [row] = await db
      .insert(cpSecrets)
      .values({
        name: body.data.name,
        type: body.data.type,
        hostPattern: body.data.hostPattern,
        ciphertext: enc.ciphertext,
        wrappedDek: enc.wrappedDek,
        kekVersion: enc.kekVersion,
        metadata: body.data.metadata ?? null,
        ownerSub: user.sub,
      })
      .returning({
        id: cpSecrets.id,
        name: cpSecrets.name,
        type: cpSecrets.type,
        hostPattern: cpSecrets.hostPattern,
      });
    return c.json(row, 201);
  });

  router.get("/", async (c) => {
    const user = c.get("user");
    const rows = await db
      .select({
        id: cpSecrets.id,
        name: cpSecrets.name,
        type: cpSecrets.type,
        hostPattern: cpSecrets.hostPattern,
        metadata: cpSecrets.metadata,
        createdAt: cpSecrets.createdAt,
      })
      .from(cpSecrets)
      .where(eq(cpSecrets.ownerSub, user.sub));
    return c.json(rows);
  });

  router.patch("/:id", async (c) => {
    const user = c.get("user");
    const body = updateInput.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: "invalid body", details: body.error.issues }, 400);
    const { id } = c.req.param();
    const updated = await db
      .update(cpSecrets)
      .set({
        ...(body.data.name !== undefined && { name: body.data.name }),
        ...(body.data.hostPattern !== undefined && { hostPattern: body.data.hostPattern }),
        ...(body.data.metadata !== undefined && { metadata: body.data.metadata }),
      })
      .where(and(eq(cpSecrets.id, id), eq(cpSecrets.ownerSub, user.sub)))
      .returning({ id: cpSecrets.id });
    if (updated.length === 0) return c.json({ error: "not found" }, 404);
    return c.body(null, 204);
  });

  router.delete("/:id", async (c) => {
    const user = c.get("user");
    const { id } = c.req.param();
    const deleted = await db
      .delete(cpSecrets)
      .where(and(eq(cpSecrets.id, id), eq(cpSecrets.ownerSub, user.sub)))
      .returning({ id: cpSecrets.id });
    if (deleted.length === 0) return c.json({ error: "not found" }, 404);
    return c.body(null, 204);
  });

  return router;
}
