import type * as k8s from "@kubernetes/client-node";
import { eq } from "drizzle-orm";
import type { Db } from "db";
import { instances, agents } from "db";
import type { K8sClient } from "./k8s.js";
import { loadJobBuilderConfig } from "./job-builder.js";

function sanitizeMountName(path: string): string {
  return path.replace(/^\//, "").replace(/\//g, "-");
}

export interface InstanceProvisioner {
  provision(instanceId: string): Promise<void>;
  deprovision(instanceId: string): Promise<void>;
}

export function createInstanceProvisioner(k8s: K8sClient, db: Db): InstanceProvisioner {
  const cfg = loadJobBuilderConfig();

  return {
    async provision(instanceId) {
      const [inst] = await db.select().from(instances).where(eq(instances.id, instanceId));
      if (!inst) throw new Error(`instance ${instanceId} not found`);

      const [agent] = await db.select().from(agents).where(eq(agents.id, inst.agentId));
      if (!agent) throw new Error(`agent ${inst.agentId} not found`);

      const agentSpec = agent.spec as { mounts?: { path: string; persist: boolean }[] };

      for (const m of agentSpec.mounts ?? []) {
        if (!m.persist) continue;
        const volName = sanitizeMountName(m.path);
        const pvcName = `${volName}-${instanceId}-0`;
        const existing = await k8s.listPVCs(`humr.ai/instance=${instanceId}`);
        if (existing.some((p) => p.metadata?.name === pvcName)) continue;

        await k8s.createPVC({
          metadata: { name: pvcName, labels: { "humr.ai/instance": instanceId } },
          spec: {
            accessModes: ["ReadWriteOnce"],
            resources: { requests: { storage: "10Gi" } },
          },
        });
      }

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
  return {
    metadata: { name: `${instanceId}-egress`, labels: { "humr.ai/instance": instanceId } },
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
            { protocol: "TCP", port: 53 }, { protocol: "UDP", port: 53 },
            { protocol: "TCP", port: 5353 }, { protocol: "UDP", port: 5353 },
          ],
        },
      ],
      ingress: [{ ports: [{ protocol: "TCP", port: 8080 }] }],
    },
  } as k8s.V1NetworkPolicy;
}
