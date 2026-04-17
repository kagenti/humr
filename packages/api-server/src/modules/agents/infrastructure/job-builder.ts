import type * as k8s from "@kubernetes/client-node";
import yaml from "js-yaml";
import crypto from "node:crypto";
import { LABEL_AGENT_REF, SPEC_KEY } from "./labels.js";

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
    jobTtlAfterFinished: parseInt(process.env.HUMR_JOB_TTL_AFTER_FINISHED ?? "60", 10),
  };
}

interface AgentSpec {
  image: string;
  mounts?: { path: string; persist: boolean }[];
  init?: string;
  env?: { name: string; value: string }[];
  resources?: { requests?: Record<string, string>; limits?: Record<string, string> };
  securityContext?: { runAsNonRoot?: boolean };
}

interface InstanceSpec {
  agentId?: string;
  env?: { name: string; value: string }[];
  secretRef?: string;
}

function sanitizeMountName(path: string): string {
  return path.replace(/^\//, "").replace(/\//g, "-");
}

function gatewayFQDN(cfg: JobBuilderConfig): string {
  return `${cfg.gatewayHost}.${cfg.releaseNamespace}.svc.cluster.local`;
}

export function buildJob(opts: {
  instanceName: string;
  instanceCM: k8s.V1ConfigMap;
  agentCM: k8s.V1ConfigMap;
  cfg: JobBuilderConfig;
  extraEnv?: k8s.V1EnvVar[];
}): k8s.V1Job {
  const { instanceName, instanceCM, agentCM, cfg } = opts;
  const agentSpec = yaml.load(agentCM.data?.[SPEC_KEY] ?? "") as AgentSpec;
  const instanceSpec = yaml.load(instanceCM.data?.[SPEC_KEY] ?? "") as InstanceSpec;
  const agentName = instanceCM.metadata?.labels?.[LABEL_AGENT_REF]
    ?? instanceSpec.agentId ?? agentCM.metadata!.name!;

  const labels: Record<string, string> = { "humr.ai/instance": instanceName };
  const jobName = `${instanceName}-${crypto.randomBytes(4).toString("hex")}`;

  const proxyAddr = `http://x:$(ONECLI_ACCESS_TOKEN)@${gatewayFQDN(cfg)}:${cfg.gatewayPort}`;
  const caCertPath = "/etc/humr/ca/ca.crt";
  const tokenSecretName = `humr-agent-${agentName}-token`;

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
    { name: "API_SERVER_URL", value: `http://${cfg.releaseName}-apiserver.${cfg.releaseNamespace}.svc.cluster.local:4000` },
    { name: "HOME", value: "/home/agent" },
    ...(agentSpec.env ?? []).map(e => ({ name: e.name, value: e.value })),
    ...(instanceSpec.env ?? []).map(e => ({ name: e.name, value: e.value })),
    ...(opts.extraEnv ?? []),
  ];

  const envFrom: k8s.V1EnvFromSource[] = [];
  if (instanceSpec.secretRef) {
    envFrom.push({ secretRef: { name: instanceSpec.secretRef } });
  }

  const volumes: k8s.V1Volume[] = [];
  const volumeMounts: k8s.V1VolumeMount[] = [];

  for (const m of agentSpec.mounts ?? []) {
    const volName = sanitizeMountName(m.path);
    volumeMounts.push({ name: volName, mountPath: m.path });
    if (m.persist) {
      volumes.push({ name: volName, persistentVolumeClaim: { claimName: `${volName}-${instanceName}-0` } });
    } else {
      volumes.push({ name: volName, emptyDir: {} });
    }
  }

  volumes.push({ name: "ca-cert", emptyDir: {} });
  volumeMounts.push({ name: "ca-cert", mountPath: "/etc/humr/ca", readOnly: true });

  const webURL = `http://${gatewayFQDN(cfg)}:${cfg.webPort}`;
  const initContainers: k8s.V1Container[] = [{
    name: "fetch-ca-cert",
    image: cfg.caCertInitImage,
    imagePullPolicy: "IfNotPresent",
    command: ["sh", "-c", `until wget -qO /etc/humr/ca/ca.crt "${webURL}/api/gateway/ca" 2>/dev/null; do sleep 2; done`],
    volumeMounts: [{ name: "ca-cert", mountPath: "/etc/humr/ca" }],
  }];
  if (agentSpec.init) {
    initContainers.push({
      name: "init",
      image: agentSpec.image,
      imagePullPolicy: cfg.agentImagePullPolicy as any,
      command: ["sh", "-c", agentSpec.init],
      volumeMounts,
    });
  }

  return {
    metadata: { name: jobName, labels },
    spec: {
      backoffLimit: 0,
      ttlSecondsAfterFinished: cfg.jobTtlAfterFinished,
      activeDeadlineSeconds: cfg.jobActiveDeadline as any,
      template: {
        metadata: { labels },
        spec: {
          restartPolicy: "Never",
          terminationGracePeriodSeconds: cfg.terminationGracePeriod as any,
          imagePullSecrets: cfg.agentImagePullSecrets.length > 0
            ? cfg.agentImagePullSecrets.map(name => ({ name })) : undefined,
          securityContext: agentSpec.securityContext?.runAsNonRoot != null
            ? { runAsNonRoot: agentSpec.securityContext.runAsNonRoot } : undefined,
          initContainers,
          containers: [{
            name: "agent",
            image: agentSpec.image,
            imagePullPolicy: cfg.agentImagePullPolicy as any,
            ports: [{ name: "acp", containerPort: 8080 }],
            env,
            envFrom: envFrom.length > 0 ? envFrom : undefined,
            readinessProbe: { httpGet: { path: "/healthz", port: "acp" as any }, periodSeconds: 1 },
            livenessProbe: { httpGet: { path: "/healthz", port: "acp" as any }, initialDelaySeconds: 10, periodSeconds: 10 },
            securityContext: { capabilities: { drop: ["ALL"] } },
            resources: {
              requests: agentSpec.resources?.requests,
              limits: agentSpec.resources?.limits,
            },
            volumeMounts,
          }],
          volumes,
        },
      },
    },
  };
}
