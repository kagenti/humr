export type AppConnectionStatus = "connected" | "expired" | "disconnected";

export interface AppConnectionView {
  id: string;
  provider: string;
  label: string;
  status: AppConnectionStatus;
  identity?: string;
  scopes?: string[];
  connectedAt?: string;
}

export interface AgentAppConnections {
  connectionIds: string[];
}

export interface ConnectionsService {
  list(): Promise<AppConnectionView[]>;
  getAgentConnections(agentName: string): Promise<AgentAppConnections>;
}
