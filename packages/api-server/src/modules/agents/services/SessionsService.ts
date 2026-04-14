import { SessionType, type SessionsApiService, type SessionView } from "api-server-api";
import { createAcpClient, type AcpSessionInfo } from "../../../acp-client.js";

export function createSessionsService(deps: {
  listByInstance: (instanceId: string) => Promise<{ sessionId: string; instanceId: string; type: string; createdAt: Date }[]>;
  upsert: (sessionId: string, instanceId: string, type?: SessionType) => Promise<void>;
  namespace: string;
}): SessionsApiService {
  return {
    async list(instanceId: string, includeChannel?: boolean) {
      const acp = createAcpClient({
        namespace: deps.namespace,
        instanceName: instanceId,
        onSessionCreated: (sid) => deps.upsert(sid, instanceId, SessionType.Regular),
      });

      const [dbRows, acpSessions] = await Promise.all([
        deps.listByInstance(instanceId),
        acp.listSessions(),
      ]);

      const acpMap = new Map<string, AcpSessionInfo>(
        acpSessions.map((s) => [s.sessionId, s]),
      );

      const filtered = includeChannel
        ? dbRows
        : dbRows.filter((r) => r.type === SessionType.Regular);

      return filtered.map((row): SessionView => {
        const acp = acpMap.get(row.sessionId);
        return {
          sessionId: row.sessionId,
          instanceId: row.instanceId,
          type: row.type as SessionType,
          createdAt: row.createdAt.toISOString(),
          title: acp?.title ?? null,
          updatedAt: acp?.updatedAt ?? null,
        };
      });
    },

    async create(sessionId: string, instanceId: string, type?: SessionType) {
      await deps.upsert(sessionId, instanceId, type);
    },
  };
}
