import type { Db } from "db";
import { identityLinks, eq, and } from "db";

export type IdentityProvider = "slack" | "telegram";

export interface IdentityLink {
  provider: IdentityProvider;
  externalUserId: string;
  keycloakSub: string;
  refreshToken: string | null;
}

export function findIdentityLink(db: Db) {
  return async (provider: IdentityProvider, externalUserId: string): Promise<IdentityLink | null> => {
    const rows = await db
      .select()
      .from(identityLinks)
      .where(and(eq(identityLinks.provider, provider), eq(identityLinks.externalUserId, externalUserId)))
      .limit(1);
    if (rows.length === 0) return null;
    return {
      provider: rows[0].provider as IdentityProvider,
      externalUserId: rows[0].externalUserId,
      keycloakSub: rows[0].keycloakSub,
      refreshToken: rows[0].refreshToken,
    };
  };
}

export function upsertIdentityLink(db: Db) {
  return async (
    provider: IdentityProvider,
    externalUserId: string,
    keycloakSub: string,
    refreshToken: string | null,
  ): Promise<void> => {
    await db
      .insert(identityLinks)
      .values({ provider, externalUserId, keycloakSub, refreshToken })
      .onConflictDoUpdate({
        target: [identityLinks.provider, identityLinks.externalUserId],
        set: { keycloakSub, refreshToken },
      });
  };
}

export function deleteIdentityLink(db: Db) {
  return async (provider: IdentityProvider, externalUserId: string): Promise<void> => {
    await db
      .delete(identityLinks)
      .where(and(eq(identityLinks.provider, provider), eq(identityLinks.externalUserId, externalUserId)));
  };
}
