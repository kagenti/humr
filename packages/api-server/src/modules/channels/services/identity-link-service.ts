import type { IdentityLink, IdentityProvider } from "../infrastructure/identity-links-repository.js";

export interface IdentityLinkService {
  resolve(provider: IdentityProvider, externalUserId: string): Promise<string | null>;
  link(provider: IdentityProvider, externalUserId: string, keycloakSub: string, refreshToken: string | null): Promise<void>;
  unlink(provider: IdentityProvider, externalUserId: string): Promise<void>;
}

export function createIdentityLinkService(deps: {
  find: (provider: IdentityProvider, externalUserId: string) => Promise<IdentityLink | null>;
  upsert: (provider: IdentityProvider, externalUserId: string, keycloakSub: string, refreshToken: string | null) => Promise<void>;
  delete: (provider: IdentityProvider, externalUserId: string) => Promise<void>;
}): IdentityLinkService {
  return {
    async resolve(provider, externalUserId) {
      const link = await deps.find(provider, externalUserId);
      return link?.keycloakSub ?? null;
    },

    async link(provider, externalUserId, keycloakSub, refreshToken) {
      await deps.upsert(provider, externalUserId, keycloakSub, refreshToken);
    },

    async unlink(provider, externalUserId) {
      await deps.delete(provider, externalUserId);
    },
  };
}
