import type { Db } from "db";
import { identityLinks, eq } from "db";

export interface IdentityLink {
  slackUserId: string;
  keycloakSub: string;
  username: string | null;
  refreshToken: string | null;
}

export function findIdentityBySlackUser(db: Db) {
  return async (slackUserId: string): Promise<IdentityLink | null> => {
    const rows = await db
      .select()
      .from(identityLinks)
      .where(eq(identityLinks.slackUserId, slackUserId))
      .limit(1);
    if (rows.length === 0) return null;
    return {
      slackUserId: rows[0].slackUserId,
      keycloakSub: rows[0].keycloakSub,
      username: rows[0].username,
      refreshToken: rows[0].refreshToken,
    };
  };
}

export function upsertIdentityLink(db: Db) {
  return async (slackUserId: string, keycloakSub: string, refreshToken: string | null, username: string | null): Promise<void> => {
    await db
      .insert(identityLinks)
      .values({ slackUserId, keycloakSub, refreshToken, username })
      .onConflictDoUpdate({
        target: identityLinks.slackUserId,
        set: { keycloakSub, refreshToken, username },
      });
  };
}

export function listAllIdentityLinks(db: Db) {
  return async (): Promise<IdentityLink[]> => {
    const rows = await db.select().from(identityLinks);
    return rows.map((r) => ({
      slackUserId: r.slackUserId,
      keycloakSub: r.keycloakSub,
      username: r.username,
      refreshToken: r.refreshToken,
    }));
  };
}

export function deleteIdentityLink(db: Db) {
  return async (slackUserId: string): Promise<void> => {
    await db.delete(identityLinks).where(eq(identityLinks.slackUserId, slackUserId));
  };
}
