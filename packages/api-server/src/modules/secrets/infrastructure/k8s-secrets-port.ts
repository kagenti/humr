/**
 * Forward-only K8s mirror for user-typed secrets (generic + Anthropic).
 *
 * The Envoy credential-injector sidecar (ADR-033) reads credentials from files
 * mounted into the sidecar container. The Controller renders those mounts from
 * K8s Secrets labelled with the owner's sub. This port writes those Secrets so
 * newly-created OneCLI secrets land in K8s for the sidecar to discover.
 *
 * Existing OneCLI-only secrets are not migrated; users with the experimental
 * flag on must re-create the secrets they want injected.
 */
import type * as k8s from "@kubernetes/client-node";
import type { InjectionConfig } from "api-server-api";

import type { K8sClient } from "../../agents/infrastructure/k8s.js";

const LABEL_OWNER = "humr.ai/owner";
const LABEL_SECRET_TYPE = "humr.ai/secret-type";
const LABEL_MANAGED_BY = "humr.ai/managed-by";
const ANN_HOST_PATTERN = "humr.ai/host-pattern";
const ANN_PATH_PATTERN = "humr.ai/path-pattern";
const ANN_HEADER_NAME = "humr.ai/injection-header-name";

/**
 * Envoy's generic credential source injects the file contents verbatim under
 * the configured header. There is no header-prefix template upstream
 * (envoyproxy/envoy#37001), so we bake the prefix into the file content here.
 */
function injectionFileContent(value: string, injectionConfig?: InjectionConfig): string {
  const prefix = injectionConfig?.headerPrefix ?? "Bearer ";
  return `${prefix}${value}`;
}

export interface K8sSecretsPort {
  createSecret(input: {
    id: string;
    name: string;
    type: string;
    value: string;
    hostPattern: string;
    pathPattern?: string;
    injectionConfig?: InjectionConfig;
  }): Promise<void>;
  updateSecret(
    id: string,
    input: {
      value?: string;
      hostPattern?: string;
      pathPattern?: string | null;
      injectionConfig?: InjectionConfig | null;
    },
  ): Promise<void>;
  deleteSecret(id: string): Promise<void>;
}

function k8sSecretName(id: string): string {
  return `humr-cred-${id.toLowerCase()}`;
}

export function createK8sSecretsPort(client: K8sClient, ownerSub: string): K8sSecretsPort {
  return {
    async createSecret({ id, name, type, value, hostPattern, pathPattern, injectionConfig }) {
      const secretType = type === "anthropic" ? "anthropic" : "generic";
      const annotations: Record<string, string> = {
        [ANN_HOST_PATTERN]: hostPattern,
        [ANN_HEADER_NAME]: injectionConfig?.headerName ?? "Authorization",
      };
      if (pathPattern) annotations[ANN_PATH_PATTERN] = pathPattern;

      const body: k8s.V1Secret = {
        metadata: {
          name: k8sSecretName(id),
          labels: {
            [LABEL_OWNER]: ownerSub,
            [LABEL_SECRET_TYPE]: secretType,
            [LABEL_MANAGED_BY]: "api-server",
          },
          annotations: { ...annotations, "humr.ai/display-name": name },
        },
        type: "Opaque",
        stringData: { value: injectionFileContent(value, injectionConfig) },
      };
      await client.createSecret(body);
    },

    async updateSecret(id, patch) {
      const existing = await client.getSecret(k8sSecretName(id));
      if (!existing) return;

      const annotations = { ...(existing.metadata?.annotations ?? {}) };
      if (patch.hostPattern !== undefined) annotations[ANN_HOST_PATTERN] = patch.hostPattern;
      if (patch.pathPattern === null) delete annotations[ANN_PATH_PATTERN];
      else if (patch.pathPattern !== undefined) annotations[ANN_PATH_PATTERN] = patch.pathPattern;
      if (patch.injectionConfig === null) {
        annotations[ANN_HEADER_NAME] = "Authorization";
      } else if (patch.injectionConfig?.headerName) {
        annotations[ANN_HEADER_NAME] = patch.injectionConfig.headerName;
      }

      const body: k8s.V1Secret = {
        ...existing,
        metadata: {
          ...existing.metadata,
          annotations,
        },
      };
      if (patch.value !== undefined) {
        // Re-bake prefix into the file when the value or injectionConfig changes.
        const cfg = patch.injectionConfig === null ? undefined : patch.injectionConfig;
        body.stringData = { ...(body.stringData ?? {}), value: injectionFileContent(patch.value, cfg) };
        body.data = undefined;
      }
      await client.replaceSecret(k8sSecretName(id), body);
    },

    async deleteSecret(id) {
      await client.deleteSecret(k8sSecretName(id));
    },
  };
}
