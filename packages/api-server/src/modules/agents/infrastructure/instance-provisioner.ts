import type * as k8s from "@kubernetes/client-node";
import yaml from "js-yaml";
import type { K8sClient } from "./k8s.js";
import { LABEL_AGENT_REF, SPEC_KEY } from "./labels.js";
import { loadJobBuilderConfig } from "./job-builder.js";

interface AgentSpec {
  mounts?: { path: string; persist: boolean }[];
}

function sanitizeMountName(path: string): string {
  return path.replace(/^\//, "").replace(/\//g, "-");
}

export interface InstanceProvisioner {
  provision(instanceId: string): Promise<void>;
  deprovision(instanceId: string): Promise<void>;
}

export function createInstanceProvisioner(k8s: K8sClient): InstanceProvisioner {
  const cfg = loadJobBuilderConfig();

  return {
    async provision(instanceId) {
      const instanceCM = await k8s.getConfigMap(instanceId);
      if (!instanceCM) throw new Error(`instance ${instanceId} not found`);

      const agentName = instanceCM.metadata?.labels?.[LABEL_AGENT_REF];
      if (!agentName) throw new Error(`instance ${instanceId} has no agent label`);

      const agentCM = await k8s.getConfigMap(agentName);
      if (!agentCM) throw new Error(`agent ${agentName} not found`);

      const agentSpec = yaml.load(agentCM.data?.[SPEC_KEY] ?? "") as AgentSpec;

      // Create PVCs for persistent mounts
      for (const m of agentSpec.mounts ?? []) {
        if (!m.persist) continue;
        const volName = sanitizeMountName(m.path);
        const pvcName = `${volName}-${instanceId}-0`;
        const existing = await k8s.listPVCs(`humr.ai/instance=${instanceId}`);
        if (existing.some((p) => p.metadata?.name === pvcName)) continue;

        await k8s.createPVC({
          metadata: {
            name: pvcName,
            labels: { "humr.ai/instance": instanceId },
          },
          spec: {
            // RWO: one Job pod at a time (enforced by one-shot model).
            // See ADR-012 appendix for tradeoff discussion.
            accessModes: ["ReadWriteOnce"],
            resources: { requests: { storage: "10Gi" } },
          },
        });
      }

      // Create NetworkPolicy
      const npName = `${instanceId}-egress`;
      const existingNp = await k8s.getNetworkPolicy(npName);
      if (!existingNp) {
        await k8s.createNetworkPolicy(buildNetworkPolicy(instanceId, cfg));
      }
    },

    async deprovision(instanceId) {
      const pvcs = await k8s.listPVCs(`humr.ai/instance=${instanceId}`);
      for (const pvc of pvcs) {
        try { await k8s.deletePVC(pvc.metadata!.name!); } catch { /* ignore */ }
      }
    },
  };
}

function buildNetworkPolicy(instanceId: string, cfg: ReturnType<typeof loadJobBuilderConfig>): k8s.V1NetworkPolicy {
  const gatewayFQDN = `${cfg.gatewayHost}.${cfg.releaseNamespace}.svc.cluster.local`;
  return {
    metadata: {
      name: `${instanceId}-egress`,
      labels: { "humr.ai/instance": instanceId },
    },
    spec: {
      podSelector: { matchLabels: { "humr.ai/instance": instanceId } },
      policyTypes: ["Egress", "Ingress"],
      egress: [
        {
          to: [{
            podSelector: { matchLabels: { "app.kubernetes.io/component": "onecli" } },
            namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": cfg.releaseNamespace } },
          }],
          ports: [
            { protocol: "TCP", port: cfg.gatewayPort },
            { protocol: "TCP", port: cfg.webPort },
          ],
        },
        {
          to: [{
            podSelector: { matchLabels: { "app.kubernetes.io/component": "apiserver" } },
            namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": cfg.releaseNamespace } },
          }],
          ports: [{ protocol: "TCP", port: 4000 }],
        },
        {
          ports: [
            { protocol: "TCP", port: 53 },
            { protocol: "UDP", port: 53 },
            { protocol: "TCP", port: 5353 },
            { protocol: "UDP", port: 5353 },
          ],
        },
      ],
      ingress: [{ ports: [{ protocol: "TCP", port: 8080 }] }],
    },
  } as k8s.V1NetworkPolicy;
}
