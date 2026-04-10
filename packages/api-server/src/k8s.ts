import * as k8s from "@kubernetes/client-node";
import yaml from "js-yaml";
import crypto from "node:crypto";
import type {
  Template,
  TemplateSpec,
  TemplatesContext,
  Agent,
  AgentSpec,
  AgentsContext,
  CreateAgentInput,
  UpdateAgentInput,
  Instance,
  InstanceSpec,
  InstanceStatus,
  InstancesContext,
  CreateInstanceInput,
  UpdateInstanceInput,
  Schedule,
  ScheduleSpec,
  ScheduleStatus,
  SchedulesContext,
  CreateCronScheduleInput,
  CreateHeartbeatScheduleInput,
} from "api-server-api";
import { SPEC_VERSION } from "api-server-api";
import { CronExpressionParser } from "cron-parser";


const LABEL_TYPE = "humr.ai/type";
const LABEL_TEMPLATE = "agent-template";
const LABEL_AGENT = "agent";
const LABEL_INSTANCE = "agent-instance";
const LABEL_TEMPLATE_REF = "humr.ai/template";
const LABEL_AGENT_REF = "humr.ai/agent";
const LABEL_SCHEDULE = "agent-schedule";
const LABEL_INSTANCE_REF = "humr.ai/instance";
const LABEL_OWNER = "humr.ai/owner";
const SPEC_KEY = "spec.yaml";
const STATUS_KEY = "status.yaml";

const DEFAULT_HEARTBEAT_INTERVAL_MINUTES = 5;

const DEFAULT_TEMPLATE_SPEC = {
  mounts: [
    { path: "/workspace", persist: true },
    { path: "/home/agent", persist: true },
    { path: "/tmp", persist: false },
  ],
  env: [{ name: "PORT", value: "8080" }],
  resources: {
    requests: { cpu: "250m", memory: "512Mi" },
    limits: { cpu: "1", memory: "2Gi" },
  },
  securityContext: {
    readOnlyRootFilesystem: false,
  },
};

function generateK8sName(prefix: string): string {
  return `${prefix}-${crypto.randomBytes(4).toString("hex")}`;
}

function displayName(cm: k8s.V1ConfigMap): string {
  const spec = yaml.load(cm.data?.[SPEC_KEY] ?? "") as { name?: string } | null;
  return spec?.name ?? cm.metadata!.name!;
}

function is404(err: unknown): boolean {
  return (
    err instanceof Error &&
    "code" in err &&
    (err as { code: number }).code === 404
  );
}

/** Read a ConfigMap by K8s name, verify it's owned by the given user. */
async function readOwned(
  api: k8s.CoreV1Api, namespace: string, id: string, owner: string,
): Promise<k8s.V1ConfigMap | null> {
  try {
    const cm = await api.readNamespacedConfigMap({ name: id, namespace });
    if (cm.metadata?.labels?.[LABEL_OWNER] !== owner) return null;
    return cm;
  } catch (err) {
    if (is404(err)) return null;
    throw err;
  }
}

function parseTemplate(cm: k8s.V1ConfigMap): Template {
  const spec = yaml.load(cm.data?.[SPEC_KEY] ?? "") as TemplateSpec;
  return { id: cm.metadata!.name!, name: displayName(cm), spec };
}

function parseAgent(cm: k8s.V1ConfigMap): Agent {
  const spec = yaml.load(cm.data?.[SPEC_KEY] ?? "") as AgentSpec;
  return {
    id: cm.metadata!.name!,
    name: displayName(cm),
    templateId: cm.metadata!.labels?.[LABEL_TEMPLATE_REF],
    spec,
  };
}

function parseInstance(cm: k8s.V1ConfigMap): Instance {
  const spec = yaml.load(cm.data?.[SPEC_KEY] ?? "") as InstanceSpec;
  const statusYaml = cm.data?.[STATUS_KEY];
  let status: InstanceStatus | undefined;
  if (statusYaml) {
    const raw = yaml.load(statusYaml) as { currentState?: string; error?: string };
    status = {
      currentState: (raw.currentState as InstanceStatus["currentState"]) ?? spec.desiredState,
      error: raw.error || undefined,
      podReady: false,
    };
  }
  return { id: cm.metadata!.name!, name: displayName(cm), spec, status };
}

function parseSchedule(cm: k8s.V1ConfigMap): Schedule {
  const spec = yaml.load(cm.data?.[SPEC_KEY] ?? "") as ScheduleSpec;
  const statusYaml = cm.data?.[STATUS_KEY];
  let status: ScheduleStatus | undefined;
  if (statusYaml) {
    status = yaml.load(statusYaml) as ScheduleStatus;
  }
  return {
    id: cm.metadata!.name!,
    name: displayName(cm),
    instanceId: cm.metadata!.labels![LABEL_INSTANCE_REF],
    spec,
    status,
  };
}

function isPodReady(pod: k8s.V1Pod): boolean {
  const cond = pod.status?.conditions?.find((c) => c.type === "Ready");
  return cond?.status === "True";
}

function enrichWithPodStatus(inst: Instance, pod?: k8s.V1Pod): Instance {
  const podReady = pod ? isPodReady(pod) : false;
  const status: InstanceStatus = inst.status
    ? { ...inst.status, podReady }
    : { currentState: inst.spec.desiredState === "running" ? "running" : "hibernated", podReady };
  return { ...inst, status };
}

function createApi(namespace: string) {
  const kc = new k8s.KubeConfig();
  kc.loadFromDefault();
  return { api: kc.makeApiClient(k8s.CoreV1Api), namespace };
}

// ---- Templates (read-only catalog) ----

export function createK8sTemplatesContext(
  namespace: string,
  api: k8s.CoreV1Api,
): TemplatesContext {
  return {
    async list() {
      const res = await api.listNamespacedConfigMap({
        namespace,
        labelSelector: `${LABEL_TYPE}=${LABEL_TEMPLATE}`,
      });
      // Catalog items have no owner label
      return (res.items ?? [])
        .filter((cm) => !cm.metadata?.labels?.[LABEL_OWNER])
        .map(parseTemplate);
    },

    async get(id) {
      try {
        const cm = await api.readNamespacedConfigMap({ name: id, namespace });
        if (cm.metadata?.labels?.[LABEL_TYPE] !== LABEL_TEMPLATE) return null;
        if (cm.metadata?.labels?.[LABEL_OWNER]) return null; // not a catalog item
        return parseTemplate(cm);
      } catch (err) {
        if (is404(err)) return null;
        throw err;
      }
    },
  };
}

// ---- Agents (user-owned) ----

export function createK8sAgentsContext(
  namespace: string,
  api: k8s.CoreV1Api,
  owner: string,
): AgentsContext {
  return {
    async list() {
      const res = await api.listNamespacedConfigMap({
        namespace,
        labelSelector: `${LABEL_TYPE}=${LABEL_AGENT},${LABEL_OWNER}=${owner}`,
      });
      return (res.items ?? []).map(parseAgent);
    },

    async get(id) {
      const cm = await readOwned(api, namespace, id, owner);
      if (!cm || cm.metadata?.labels?.[LABEL_TYPE] !== LABEL_AGENT) return null;
      return parseAgent(cm);
    },

    async create(input: CreateAgentInput) {
      let spec: Record<string, unknown>;
      const labels: Record<string, string> = {
        [LABEL_TYPE]: LABEL_AGENT,
        [LABEL_OWNER]: owner,
      };

      if (input.templateId) {
        // Copy from catalog template
        const tmplCm = await api.readNamespacedConfigMap({ name: input.templateId, namespace }).catch((err) => {
          if (is404(err)) throw new Error(`Template "${input.templateId}" not found`);
          throw err;
        });
        if (tmplCm.metadata?.labels?.[LABEL_OWNER]) {
          throw new Error(`Template "${input.templateId}" not found`);
        }
        const tmplSpec = yaml.load(tmplCm.data?.[SPEC_KEY] ?? "") as TemplateSpec;
        labels[LABEL_TEMPLATE_REF] = input.templateId;
        spec = {
          name: input.name,
          version: SPEC_VERSION,
          image: tmplSpec.image,
          description: input.description ?? tmplSpec.description,
          mounts: tmplSpec.mounts,
          init: tmplSpec.init,
          env: tmplSpec.env,
          resources: tmplSpec.resources,
          securityContext: tmplSpec.securityContext,
          mcpServers: input.mcpServers,
        };
      } else {
        // Custom image
        spec = {
          name: input.name,
          version: SPEC_VERSION,
          image: input.image,
          description: input.description,
          ...DEFAULT_TEMPLATE_SPEC,
          mcpServers: input.mcpServers,
        };
      }

      const k8sName = generateK8sName("agent");
      const cm: k8s.V1ConfigMap = {
        metadata: { name: k8sName, namespace, labels },
        data: { [SPEC_KEY]: yaml.dump(spec) },
      };
      const created = await api.createNamespacedConfigMap({ namespace, body: cm });
      return parseAgent(created);
    },

    async update(input: UpdateAgentInput) {
      const cm = await readOwned(api, namespace, input.id, owner);
      if (!cm || cm.metadata?.labels?.[LABEL_TYPE] !== LABEL_AGENT) return null;

      const spec = yaml.load(cm.data?.[SPEC_KEY] ?? "") as AgentSpec;
      if (input.description !== undefined) spec.description = input.description;
      if (input.mcpServers !== undefined) spec.mcpServers = input.mcpServers;

      cm.data = { ...cm.data, [SPEC_KEY]: yaml.dump(spec) };
      const updated = await api.replaceNamespacedConfigMap({ name: input.id, namespace, body: cm });
      return parseAgent(updated);
    },

    async delete(id) {
      const cm = await readOwned(api, namespace, id, owner);
      if (!cm || cm.metadata?.labels?.[LABEL_TYPE] !== LABEL_AGENT) return;
      await api.deleteNamespacedConfigMap({ name: id, namespace });
    },
  };
}

// ---- Instances ----

export function createK8sInstancesContext(
  namespace: string,
  api: k8s.CoreV1Api,
  owner: string,
): InstancesContext {
  return {
    async list() {
      const [configMaps, pods] = await Promise.all([
        api.listNamespacedConfigMap({
          namespace,
          labelSelector: `${LABEL_TYPE}=${LABEL_INSTANCE},${LABEL_OWNER}=${owner}`,
        }),
        api.listNamespacedPod({
          namespace,
          labelSelector: LABEL_INSTANCE_REF,
        }),
      ]);
      const podMap = new Map<string, k8s.V1Pod>();
      for (const pod of pods.items ?? []) {
        const ref = pod.metadata?.labels?.[LABEL_INSTANCE_REF];
        if (ref) podMap.set(ref, pod);
      }
      return (configMaps.items ?? []).map((cm) => {
        const inst = parseInstance(cm);
        const pod = podMap.get(cm.metadata!.name!);
        return enrichWithPodStatus(inst, pod);
      });
    },

    async get(id) {
      const cm = await readOwned(api, namespace, id, owner);
      if (!cm) return null;
      const inst = parseInstance(cm);
      let pod: k8s.V1Pod | undefined;
      try {
        pod = await api.readNamespacedPod({ name: `${id}-0`, namespace });
      } catch {}
      return enrichWithPodStatus(inst, pod);
    },

    async create(input: CreateInstanceInput) {
      // Verify agent exists and is owned by user
      const agentCm = await readOwned(api, namespace, input.agentId, owner);
      if (!agentCm || agentCm.metadata?.labels?.[LABEL_TYPE] !== LABEL_AGENT) {
        throw new Error(`Agent "${input.agentId}" not found`);
      }

      const k8sName = generateK8sName("inst");
      const spec = {
        name: input.name,
        version: SPEC_VERSION,
        agentId: input.agentId,
        desiredState: "running" as const,
        env: input.env,
        secretRef: input.secretRef,
        description: input.description,
        enabledMcpServers: input.enabledMcpServers,
      };
      const cm: k8s.V1ConfigMap = {
        metadata: {
          name: k8sName,
          namespace,
          labels: {
            [LABEL_TYPE]: LABEL_INSTANCE,
            [LABEL_AGENT_REF]: input.agentId,
            [LABEL_OWNER]: owner,
          },
        },
        data: { [SPEC_KEY]: yaml.dump(spec) },
      };
      const created = await api.createNamespacedConfigMap({ namespace, body: cm });
      return parseInstance(created);
    },

    async update(input: UpdateInstanceInput) {
      const cm = await readOwned(api, namespace, input.id, owner);
      if (!cm) return null;

      const spec = yaml.load(cm.data?.[SPEC_KEY] ?? "") as InstanceSpec;
      if (input.env !== undefined) spec.env = input.env;
      if (input.secretRef !== undefined) spec.secretRef = input.secretRef;
      if (input.enabledMcpServers !== undefined) spec.enabledMcpServers = input.enabledMcpServers;

      cm.data = { ...cm.data, [SPEC_KEY]: yaml.dump(spec) };
      const updated = await api.replaceNamespacedConfigMap({ name: input.id, namespace, body: cm });
      return parseInstance(updated);
    },

    async wake(id) {
      const cm = await readOwned(api, namespace, id, owner);
      if (!cm) return null;
      const spec = yaml.load(cm.data?.[SPEC_KEY] ?? "") as InstanceSpec;
      spec.desiredState = "running";
      cm.data = { ...cm.data, [SPEC_KEY]: yaml.dump(spec) };
      const updated = await api.replaceNamespacedConfigMap({ name: id, namespace, body: cm });
      return parseInstance(updated);
    },

    async delete(id) {
      const cm = await readOwned(api, namespace, id, owner);
      if (!cm) return;

      await api.deleteNamespacedConfigMap({ name: id, namespace });

      try {
        const pvcs = await api.listNamespacedPersistentVolumeClaim({
          namespace,
          labelSelector: `${LABEL_INSTANCE_REF}=${id}`,
        });
        await Promise.all(
          (pvcs.items ?? []).map((pvc) =>
            api.deleteNamespacedPersistentVolumeClaim({
              name: pvc.metadata!.name!,
              namespace,
            }),
          ),
        );
      } catch {
        // PVC cleanup is best-effort
      }
    },
  };
}

// ---- Schedules ----

function minutesToCron(minutes: number): string {
  if (minutes === 1) return "* * * * *";
  return `*/${minutes} * * * *`;
}

function validateCron(expr: string): void {
  CronExpressionParser.parse(expr);
}

export function createK8sSchedulesContext(
  namespace: string,
  api: k8s.CoreV1Api,
  owner: string,
): SchedulesContext {
  return {
    async list(instanceId) {
      const res = await api.listNamespacedConfigMap({
        namespace,
        labelSelector: `${LABEL_TYPE}=${LABEL_SCHEDULE},${LABEL_INSTANCE_REF}=${instanceId},${LABEL_OWNER}=${owner}`,
      });
      return (res.items ?? []).map(parseSchedule);
    },

    async get(id) {
      const cm = await readOwned(api, namespace, id, owner);
      if (!cm) return null;
      return parseSchedule(cm);
    },

    async createCron(input: CreateCronScheduleInput) {
      validateCron(input.cron);

      const instCm = await readOwned(api, namespace, input.instanceId, owner);
      if (!instCm) throw new Error(`Instance "${input.instanceId}" not found`);
      const agentRef = instCm.metadata!.labels![LABEL_AGENT_REF];

      const k8sName = generateK8sName("sched");
      const spec = {
        name: input.name,
        version: SPEC_VERSION,
        type: "cron" as const,
        cron: input.cron,
        task: input.task,
        enabled: true,
      };
      const cm: k8s.V1ConfigMap = {
        metadata: {
          name: k8sName,
          namespace,
          labels: {
            [LABEL_TYPE]: LABEL_SCHEDULE,
            [LABEL_INSTANCE_REF]: input.instanceId,
            [LABEL_AGENT_REF]: agentRef,
            [LABEL_OWNER]: owner,
          },
        },
        data: { [SPEC_KEY]: yaml.dump(spec) },
      };
      const created = await api.createNamespacedConfigMap({ namespace, body: cm });
      return parseSchedule(created);
    },

    async createHeartbeat(input: CreateHeartbeatScheduleInput) {
      const instCm = await readOwned(api, namespace, input.instanceId, owner);
      if (!instCm) throw new Error(`Instance "${input.instanceId}" not found`);
      const agentRef = instCm.metadata!.labels![LABEL_AGENT_REF];

      const k8sName = generateK8sName("sched");
      const spec = {
        name: input.name,
        version: SPEC_VERSION,
        type: "heartbeat" as const,
        cron: minutesToCron(input.intervalMinutes),
        task: "",
        enabled: true,
      };
      const cm: k8s.V1ConfigMap = {
        metadata: {
          name: k8sName,
          namespace,
          labels: {
            [LABEL_TYPE]: LABEL_SCHEDULE,
            [LABEL_INSTANCE_REF]: input.instanceId,
            [LABEL_AGENT_REF]: agentRef,
            [LABEL_OWNER]: owner,
          },
        },
        data: { [SPEC_KEY]: yaml.dump(spec) },
      };
      const created = await api.createNamespacedConfigMap({ namespace, body: cm });
      return parseSchedule(created);
    },

    async delete(id) {
      const cm = await readOwned(api, namespace, id, owner);
      if (!cm) return;
      await api.deleteNamespacedConfigMap({ name: id, namespace });
    },

    async toggle(id) {
      const cm = await readOwned(api, namespace, id, owner);
      if (!cm) return null;
      const spec = yaml.load(cm.data?.[SPEC_KEY] ?? "") as ScheduleSpec;
      spec.enabled = !spec.enabled;
      cm.data = { ...cm.data, [SPEC_KEY]: yaml.dump(spec) };
      const updated = await api.replaceNamespacedConfigMap({ name: id, namespace, body: cm });
      return parseSchedule(updated);
    },

    config() {
      return { defaultHeartbeatIntervalMinutes: DEFAULT_HEARTBEAT_INTERVAL_MINUTES };
    },
  };
}

// ---- Utilities ----

export function podBaseUrl(instanceId: string, namespace: string): string {
  return `${instanceId}-0.${instanceId}.${namespace}.svc:8080`;
}

export async function patchPodAnnotation(
  api: k8s.CoreV1Api, namespace: string, instanceId: string, key: string, value: string,
): Promise<void> {
  await api.patchNamespacedPod({
    name: `${instanceId}-0`, namespace,
    body: { metadata: { annotations: { [key]: value } } },
  });
}

export async function removePodAnnotation(
  api: k8s.CoreV1Api, namespace: string, instanceId: string, key: string,
): Promise<void> {
  await api.patchNamespacedPod({
    name: `${instanceId}-0`, namespace,
    body: { metadata: { annotations: { [key]: null } } },
  });
}

export async function patchConfigMapAnnotation(
  api: k8s.CoreV1Api, namespace: string, name: string, key: string, value: string,
): Promise<void> {
  const cm = await api.readNamespacedConfigMap({ name, namespace });
  if (!cm.metadata!.annotations) cm.metadata!.annotations = {};
  cm.metadata!.annotations[key] = value;
  await api.replaceNamespacedConfigMap({ name, namespace, body: cm });
}

/** Verify instance ownership. Returns the K8s name (= id) if owned, null otherwise. */
export async function verifyInstanceOwner(
  api: k8s.CoreV1Api, namespace: string, instanceId: string, owner: string,
): Promise<boolean> {
  const cm = await readOwned(api, namespace, instanceId, owner);
  return cm !== null;
}

export { createApi };
