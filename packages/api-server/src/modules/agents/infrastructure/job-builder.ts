/**
 * Builds Kubernetes Job manifests for agent turns.
 *
 * Reads agent and instance ConfigMaps, produces a batchv1.Job spec
 * that mirrors what the Go controller's BuildStatefulSet() used to create
 * — same env vars, volumes, init containers, security context.
 */
import type * as k8s from "@kubernetes/client-node";
import yaml from "js-yaml";
import crypto from "node:crypto";
import { LABEL_AGENT_REF, SPEC_KEY } from "./labels.js";

// ---------------------------------------------------------------------------
// Config — loaded from env vars matching the controller's config
// ---------------------------------------------------------------------------

export interface JobBuilderConfig {
  namespace: string;
  releaseNamespace: string;
  releaseName: string;
  gatewayHost: string;
  gatewayPort: number;
  webPort: number;
  caCertInitImage: string;
  agentImagePullPolicy: string;
  agentImagePullSecrets: string[];
  terminationGracePeriod: number;
  jobActiveDeadline: number;
  jobTtlAfterFinished: number;
}

export function loadJobBuilderConfig(): JobBuilderConfig {
  return {
    namespace: process.env.NAMESPACE ?? "humr-agents",
    releaseNamespace: process.env.HUMR_RELEASE_NAMESPACE ?? "default",
    releaseName: process.env.HUMR_RELEASE_NAME ?? "humr",
    gatewayHost: process.env.ONECLI_GATEWAY_HOST ?? "humr-onecli",
    gatewayPort: parseInt(process.env.ONECLI_GATEWAY_PORT ?? "10255", 10),
    webPort: parseInt(process.env.ONECLI_WEB_PORT ?? "10254", 10),
    caCertInitImage: process.env.CA_CERT_INIT_IMAGE ?? "busybox:stable",
    agentImagePullPolicy: process.env.AGENT_IMAGE_PULL_POLICY ?? "IfNotPresent",
    agentImagePullSecrets: (process.env.AGENT_IMAGE_PULL_SECRETS ?? "")
      .split(",").map(s => s.trim()).filter(Boolean),
    terminationGracePeriod: parseInt(process.env.HUMR_TERMINATION_GRACE_PERIOD ?? "5", 10),
    jobActiveDeadline: parseInt(process.env.HUMR_JOB_ACTIVE_DEADLINE ?? "1800", 10),
    jobTtlAfterFinished: parseInt(process.env.HUMR_JOB_TTL_AFTER_FINISHED ?? "300", 10),
  };
}

// ---------------------------------------------------------------------------
// Agent/Instance spec types (mirror Go types)
// ---------------------------------------------------------------------------

interface AgentSpec {
  image: string;
  mounts?: { path: string; persist: boolean }[];
  init?: string;
  env?: { name: string; value: string }[];
  resources?: {
    requests?: Record<string, string>;
    limits?: Record<string, string>;
  };
  securityContext?: {
    runAsNonRoot?: boolean;
  };
}

interface InstanceSpec {
  agentId?: string;
  env?: { name: string; value: string }[];
  secretRef?: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function parseAgentSpec(cm: k8s.V1ConfigMap): AgentSpec {
  return yaml.load(cm.data?.[SPEC_KEY] ?? "") as AgentSpec;
}

export function parseInstanceSpec(cm: k8s.V1ConfigMap): InstanceSpec {
  return yaml.load(cm.data?.[SPEC_KEY] ?? "") as InstanceSpec;
}

function sanitizeMountName(path: string): string {
  return path.replace(/^\//, "").replace(/\//g, "-");
}

function agentTokenSecretName(agentName: string): string {
  return `humr-agent-${agentName}-token`;
}

function gatewayFQDN(cfg: JobBuilderConfig): string {
  return `${cfg.gatewayHost}.${cfg.releaseNamespace}.svc.cluster.local`;
}

function webURL(cfg: JobBuilderConfig): string {
  return `http://${gatewayFQDN(cfg)}:${cfg.webPort}`;
}

function apiServerURL(cfg: JobBuilderConfig): string {
  return `http://${cfg.releaseName}-apiserver.${cfg.releaseNamespace}.svc.cluster.local:4000`;
}

/**
 * Build a Kubernetes Job manifest for an agent turn.
 */
export function buildJob(opts: {
  instanceName: string;
  instanceCM: k8s.V1ConfigMap;
  agentCM: k8s.V1ConfigMap;
  cfg: JobBuilderConfig;
}): k8s.V1Job {
  const { instanceName, instanceCM, agentCM, cfg } = opts;
  const agentSpec = parseAgentSpec(agentCM);
  const instanceSpec = parseInstanceSpec(instanceCM);
  const agentName = instanceCM.metadata?.labels?.[LABEL_AGENT_REF]
    ?? instanceSpec.agentId
    ?? agentCM.metadata!.name!;

  const labels: Record<string, string> = { "humr.ai/instance": instanceName };
  const jobName = `${instanceName}-${crypto.randomBytes(4).toString("hex")}`;

  // Proxy URL — same $(ONECLI_ACCESS_TOKEN) interpolation as the Go code
  const proxyAddr = `http://x:$(ONECLI_ACCESS_TOKEN)@${gatewayFQDN(cfg)}:${cfg.gatewayPort}`;
  const caCertPath = "/etc/humr/ca/ca.crt";
  const tokenSecretName = agentTokenSecretName(agentName);

  // Env vars — platform + agent + instance (last wins in K8s)
  const env: k8s.V1EnvVar[] = [
    { name: "ONECLI_ACCESS_TOKEN", valueFrom: { secretKeyRef: { name: tokenSecretName, key: "access-token" } } },
    { name: "HTTPS_PROXY", value: proxyAddr },
    { name: "HTTP_PROXY", value: proxyAddr },
    { name: "https_proxy", value: proxyAddr },
    { name: "http_proxy", value: proxyAddr },
    { name: "SSL_CERT_FILE", value: caCertPath },
    { name: "NODE_EXTRA_CA_CERTS", value: caCertPath },
    { name: "GIT_SSL_CAINFO", value: caCertPath },
    { name: "NODE_USE_ENV_PROXY", value: "1" },
    { name: "GIT_HTTP_PROXY_AUTHMETHOD", value: "basic" },
    { name: "GH_TOKEN", value: "humr:sentinel" },
    { name: "ADK_INSTANCE_ID", value: instanceName },
    { name: "API_SERVER_URL", value: apiServerURL(cfg) },
    { name: "HOME", value: "/home/agent" },
  ];
  for (const e of agentSpec.env ?? []) {
    env.push({ name: e.name, value: e.value });
  }
  for (const e of instanceSpec.env ?? []) {
    env.push({ name: e.name, value: e.value });
  }

  // EnvFrom secretRef
  const envFrom: k8s.V1EnvFromSource[] = [];
  if (instanceSpec.secretRef) {
    envFrom.push({ secretRef: { name: instanceSpec.secretRef } });
  }

  // Volumes + mounts
  const volumes: k8s.V1Volume[] = [];
  const volumeMounts: k8s.V1VolumeMount[] = [];

  for (const m of agentSpec.mounts ?? []) {
    const volName = sanitizeMountName(m.path);
    volumeMounts.push({ name: volName, mountPath: m.path });
    if (m.persist) {
      // Reference the PVC created by the controller
      const pvcName = `${volName}-${instanceName}-0`;
      volumes.push({
        name: volName,
        persistentVolumeClaim: { claimName: pvcName },
      });
    } else {
      volumes.push({ name: volName, emptyDir: {} });
    }
  }

  // CA cert volume
  volumes.push({ name: "ca-cert", emptyDir: {} });
  volumeMounts.push({ name: "ca-cert", mountPath: "/etc/humr/ca", readOnly: true });

  // Resources
  const resources: k8s.V1ResourceRequirements = {};
  if (agentSpec.resources?.requests) {
    resources.requests = agentSpec.resources.requests;
  }
  if (agentSpec.resources?.limits) {
    resources.limits = agentSpec.resources.limits;
  }

  // Init containers
  const caCertScript =
    `until wget -qO /etc/humr/ca/ca.crt "${webURL(cfg)}/api/gateway/ca" 2>/dev/null; do sleep 2; done`;

  const initContainers: k8s.V1Container[] = [
    {
      name: "fetch-ca-cert",
      image: cfg.caCertInitImage,
      imagePullPolicy: "IfNotPresent",
      command: ["sh", "-c", caCertScript],
      volumeMounts: [{ name: "ca-cert", mountPath: "/etc/humr/ca" }],
    },
  ];
  if (agentSpec.init) {
    initContainers.push({
      name: "init",
      image: agentSpec.image,
      imagePullPolicy: cfg.agentImagePullPolicy as "Always" | "IfNotPresent" | "Never",
      command: ["sh", "-c", agentSpec.init],
      volumeMounts,
    });
  }

  // Image pull secrets
  const imagePullSecrets: k8s.V1LocalObjectReference[] = cfg.agentImagePullSecrets
    .map(name => ({ name }));

  // Pod security context
  const podSecurityContext: k8s.V1PodSecurityContext | undefined =
    agentSpec.securityContext?.runAsNonRoot != null
      ? { runAsNonRoot: agentSpec.securityContext.runAsNonRoot }
      : undefined;

  const terminationGracePeriod = cfg.terminationGracePeriod;

  return {
    metadata: {
      name: jobName,
      labels,
    },
    spec: {
      backoffLimit: 0,
      ttlSecondsAfterFinished: cfg.jobTtlAfterFinished,
      activeDeadlineSeconds: cfg.jobActiveDeadline as any,
      template: {
        metadata: { labels },
        spec: {
          restartPolicy: "Never",
          terminationGracePeriodSeconds: terminationGracePeriod as any,
          imagePullSecrets: imagePullSecrets.length > 0 ? imagePullSecrets : undefined,
          securityContext: podSecurityContext,
          initContainers,
          containers: [
            {
              name: "agent",
              image: agentSpec.image,
              imagePullPolicy: cfg.agentImagePullPolicy as "Always" | "IfNotPresent" | "Never",
              ports: [{ name: "acp", containerPort: 8080 }],
              env,
              envFrom: envFrom.length > 0 ? envFrom : undefined,
              readinessProbe: {
                httpGet: { path: "/healthz", port: "acp" as any },
                periodSeconds: 1,
              },
              livenessProbe: {
                httpGet: { path: "/healthz", port: "acp" as any },
                initialDelaySeconds: 10,
                periodSeconds: 10,
              },
              securityContext: {
                capabilities: { drop: ["ALL"] },
              },
              resources,
              volumeMounts,
            },
          ],
          volumes,
        },
      },
    },
  };
}
