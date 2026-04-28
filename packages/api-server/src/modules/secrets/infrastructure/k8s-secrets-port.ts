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
const ANN_AUTH_MODE = "humr.ai/auth-mode";
const ANN_VALUE_FORMAT = "humr.ai/injection-value-format";

export type AuthMode = "api-key" | "oauth";

/**
 * Resolves the header name + value-format template for a secret. Anthropic
 * gets a fixed shape per authMode; generic respects the user-supplied
 * `InjectionConfig` (with the `Authorization: Bearer {value}` default).
 *
 * On the wire, Envoy's generic credential source loads the file under the
 * configured header verbatim — there is no upstream prefix template (see
 * envoyproxy/envoy#37001) — so we apply the value-format substitution here
 * and store the result as the file content.
 */
export function resolveInjection(
  type: string,
  authMode: AuthMode | undefined,
  injectionConfig: InjectionConfig | undefined,
): { headerName: string; valueFormat: string } {
  if (type === "anthropic") {
    if (authMode === "api-key") {
      return { headerName: "x-api-key", valueFormat: "{value}" };
    }
    return { headerName: "Authorization", valueFormat: "Bearer {value}" };
  }
  return {
    headerName: injectionConfig?.headerName ?? "Authorization",
    valueFormat: injectionConfig?.valueFormat ?? "Bearer {value}",
  };
}

export function injectionFileContent(value: string, valueFormat: string): string {
  return valueFormat.replaceAll("{value}", value);
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
    authMode?: AuthMode;
  }): Promise<void>;
  updateSecret(
    id: string,
    input: {
      value?: string;
      hostPattern?: string;
      pathPattern?: string | null;
      injectionConfig?: InjectionConfig | null;
      authMode?: AuthMode;
    },
  ): Promise<void>;
  deleteSecret(id: string): Promise<void>;
}

function k8sSecretName(id: string): string {
  return `humr-cred-${id.toLowerCase()}`;
}

export function createK8sSecretsPort(client: K8sClient, ownerSub: string): K8sSecretsPort {
  return {
    async createSecret({ id, name, type, value, hostPattern, pathPattern, injectionConfig, authMode }) {
      const secretType = type === "anthropic" ? "anthropic" : "generic";
      const { headerName, valueFormat } = resolveInjection(secretType, authMode, injectionConfig);
      const annotations: Record<string, string> = {
        [ANN_HOST_PATTERN]: hostPattern,
        [ANN_HEADER_NAME]: headerName,
        [ANN_VALUE_FORMAT]: valueFormat,
        "humr.ai/display-name": name,
      };
      if (pathPattern) annotations[ANN_PATH_PATTERN] = pathPattern;
      if (authMode) annotations[ANN_AUTH_MODE] = authMode;

      const body: k8s.V1Secret = {
        metadata: {
          name: k8sSecretName(id),
          labels: {
            [LABEL_OWNER]: ownerSub,
            [LABEL_SECRET_TYPE]: secretType,
            [LABEL_MANAGED_BY]: "api-server",
          },
          annotations,
        },
        type: "Opaque",
        stringData: { value: injectionFileContent(value, valueFormat) },
      };
      await client.createSecret(body);
    },

    async updateSecret(id, patch) {
      const existing = await client.getSecret(k8sSecretName(id));
      if (!existing) return;

      const annotations = { ...(existing.metadata?.annotations ?? {}) };
      const labels = existing.metadata?.labels ?? {};
      const secretType = labels[LABEL_SECRET_TYPE] ?? "generic";

      if (patch.hostPattern !== undefined) annotations[ANN_HOST_PATTERN] = patch.hostPattern;
      if (patch.pathPattern === null) delete annotations[ANN_PATH_PATTERN];
      else if (patch.pathPattern !== undefined) annotations[ANN_PATH_PATTERN] = patch.pathPattern;

      // Recompute header + value format if the injection config or auth mode
      // changed; otherwise keep what was stored at create time.
      const newAuthMode: AuthMode | undefined = patch.authMode ?? (annotations[ANN_AUTH_MODE] as AuthMode | undefined);
      const newInjection: InjectionConfig | undefined =
        patch.injectionConfig === null ? undefined :
        patch.injectionConfig ?? (annotations[ANN_HEADER_NAME] && annotations[ANN_VALUE_FORMAT]
          ? { headerName: annotations[ANN_HEADER_NAME]!, valueFormat: annotations[ANN_VALUE_FORMAT]! }
          : undefined);

      const { headerName, valueFormat } = resolveInjection(secretType, newAuthMode, newInjection);
      annotations[ANN_HEADER_NAME] = headerName;
      annotations[ANN_VALUE_FORMAT] = valueFormat;
      if (newAuthMode) annotations[ANN_AUTH_MODE] = newAuthMode;

      const body: k8s.V1Secret = {
        ...existing,
        metadata: { ...existing.metadata, annotations },
      };
      if (patch.value !== undefined) {
        body.stringData = { ...(body.stringData ?? {}), value: injectionFileContent(patch.value, valueFormat) };
        body.data = undefined;
      }
      await client.replaceSecret(k8sSecretName(id), body);
    },

    async deleteSecret(id) {
      await client.deleteSecret(k8sSecretName(id));
    },
  };
}
