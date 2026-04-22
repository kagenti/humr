import type { EnvMapping } from "../secrets/types.js";

export type AppConnectionStatus =
  | "connected"
  | "expired"
  | "disconnected"
  | "unknown";

export interface AppConnectionView {
  id: string;
  provider: string;
  label: string;
  status: AppConnectionStatus;
  identity?: string;
  scopes?: string[];
  connectedAt?: string;
  /**
   * Pod envs contributed by this connection. Declared by OneCLI's app
   * registry (see the matching `AppDefinition.envMappings` field) and
   * returned verbatim on `GET /api/connections` — Humr never writes this.
   */
  envMappings?: EnvMapping[];
}

export interface AgentAppConnections {
  connectionIds: string[];
}

export interface ConnectionsService {
  list(): Promise<AppConnectionView[]>;
  getAgentConnections(agentName: string): Promise<AgentAppConnections>;
  setAgentConnections(agentName: string, connectionIds: string[]): Promise<void>;
}
