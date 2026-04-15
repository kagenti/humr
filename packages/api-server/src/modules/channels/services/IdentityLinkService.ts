import type { IdentityLink } from "../infrastructure/identity-links-repository.js";

export interface IdentityLinkService {
  resolve(slackUserId: string): Promise<string | null>;
  link(slackUserId: string, keycloakSub: string, refreshToken: string | null): Promise<void>;
  unlink(slackUserId: string): Promise<void>;
}

export function createIdentityLinkService(deps: {
  findBySlackUser: (slackUserId: string) => Promise<IdentityLink | null>;
  upsert: (slackUserId: string, keycloakSub: string, refreshToken: string | null) => Promise<void>;
  delete: (slackUserId: string) => Promise<void>;
}): IdentityLinkService {
  return {
    async resolve(slackUserId) {
      const link = await deps.findBySlackUser(slackUserId);
      return link?.keycloakSub ?? null;
    },

    async link(slackUserId, keycloakSub, refreshToken) {
      await deps.upsert(slackUserId, keycloakSub, refreshToken);
    },

    async unlink(slackUserId) {
      await deps.delete(slackUserId);
    },
  };
}
