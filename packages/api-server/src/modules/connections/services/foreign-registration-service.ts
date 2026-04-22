import {
  cacheKey,
  type ForeignCredentialMintError,
  type ForeignCredentialsPort,
  type ForeignRegistrationKey,
} from "../domain/foreign-registration.js";
import { err, ok, type Result } from "../domain/result.js";
import {
  buildForkIdentifier,
  type OnecliForeignCredentialsPort,
} from "../infrastructure/onecli-foreign-credentials-port.js";

export interface ForeignRegistrationService extends ForeignCredentialsPort {
  evict(key: ForeignRegistrationKey): void;
}

export function createForeignRegistrationService(deps: {
  port: OnecliForeignCredentialsPort;
  buildIdentifier?: (instanceId: string, foreignSub: string) => string;
}): ForeignRegistrationService {
  const cache = new Map<string, string>();
  const buildId = deps.buildIdentifier ?? buildForkIdentifier;

  async function mintForeignToken(args: {
    foreignSub: string;
    instanceId: string;
  }): Promise<Result<string, ForeignCredentialMintError>> {
    const key = cacheKey(args);
    const cached = cache.get(key);
    if (cached !== undefined) return ok(cached);

    let onecliToken: string;
    try {
      onecliToken = await deps.port.exchangeImpersonationToken(args.foreignSub);
    } catch (e) {
      return err({ kind: "TokenExchangeFailed", detail: errorDetail(e) });
    }

    let agentToken: string;
    try {
      const result = await deps.port.createOrFindAgent({
        onecliToken,
        identifier: buildId(args.instanceId, args.foreignSub),
        displayName: `Fork for ${args.foreignSub} on ${args.instanceId}`,
      });
      agentToken = result.accessToken;
    } catch (e) {
      return err({ kind: "OnecliRegistrationFailed", detail: errorDetail(e) });
    }

    cache.set(key, agentToken);
    return ok(agentToken);
  }

  return {
    mintForeignToken,
    evict(k) {
      cache.delete(cacheKey(k));
    },
  };
}

function errorDetail(e: unknown): string | undefined {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  return undefined;
}
