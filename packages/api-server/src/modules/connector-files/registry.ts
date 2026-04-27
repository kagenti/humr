import type { ConnectorFile } from "./types.js";
import { githubEnterpriseHosts } from "./providers/github-enterprise-hosts.js";

/**
 * The complete list of connector-managed files in the agent pod. Adding a
 * new provider's file is one entry here — the rest of the platform is
 * provider-agnostic.
 */
export const connectorFilesRegistry: readonly ConnectorFile[] = [
  githubEnterpriseHosts,
];
