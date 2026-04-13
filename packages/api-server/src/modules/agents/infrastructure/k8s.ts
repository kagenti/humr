import * as k8s from "@kubernetes/client-node";
import yaml from "js-yaml";
import crypto from "node:crypto";
import type {
  Template, TemplateSpec,
  Agent, AgentSpec,
  Instance, InstanceSpec, InstanceStatus,
  Schedule, ScheduleSpec, ScheduleStatus,
} from "api-server-api";

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

// ---- Templates ----

export function listTemplates(api: k8s.CoreV1Api, namespace: string) {
  return async (): Promise<Template[]> => {
    const res = await api.listNamespacedConfigMap({
      namespace,
      labelSelector: `${LABEL_TYPE}=${LABEL_TEMPLATE}`,
    });
    return (res.items ?? [])
      .filter((cm) => !cm.metadata?.labels?.[LABEL_OWNER])
      .map(parseTemplate);
  };
}

export function getTemplate(api: k8s.CoreV1Api, namespace: string) {
  return async (id: string): Promise<Template | null> => {
    try {
      const cm = await api.readNamespacedConfigMap({ name: id, namespace });
      if (cm.metadata?.labels?.[LABEL_TYPE] !== LABEL_TEMPLATE) return null;
      if (cm.metadata?.labels?.[LABEL_OWNER]) return null;
      return parseTemplate(cm);
    } catch (err) {
      if (is404(err)) return null;
      throw err;
    }
  };
}

export function readTemplateSpec(api: k8s.CoreV1Api, namespace: string) {
  return async (id: string): Promise<{ spec: TemplateSpec; isOwned: boolean } | null> => {
    try {
      const cm = await api.readNamespacedConfigMap({ name: id, namespace });
      if (cm.metadata?.labels?.[LABEL_TYPE] !== LABEL_TEMPLATE) return null;
      return {
        spec: yaml.load(cm.data?.[SPEC_KEY] ?? "") as TemplateSpec,
        isOwned: !!cm.metadata?.labels?.[LABEL_OWNER],
      };
    } catch (err) {
      if (is404(err)) return null;
      throw err;
    }
  };
}

// ---- Agents ----

export function listAgents(api: k8s.CoreV1Api, namespace: string, owner: string) {
  return async (): Promise<Agent[]> => {
    const res = await api.listNamespacedConfigMap({
      namespace,
      labelSelector: `${LABEL_TYPE}=${LABEL_AGENT},${LABEL_OWNER}=${owner}`,
    });
    return (res.items ?? []).map(parseAgent);
  };
}

export function getAgent(api: k8s.CoreV1Api, namespace: string, owner: string) {
  return async (id: string): Promise<Agent | null> => {
    const cm = await readOwned(api, namespace, id, owner);
    if (!cm || cm.metadata?.labels?.[LABEL_TYPE] !== LABEL_AGENT) return null;
    return parseAgent(cm);
  };
}

export function createAgent(api: k8s.CoreV1Api, namespace: string, owner: string) {
  return async (
    spec: Record<string, unknown>,
    templateId?: string,
  ): Promise<Agent> => {
    const labels: Record<string, string> = {
      [LABEL_TYPE]: LABEL_AGENT,
      [LABEL_OWNER]: owner,
    };
    if (templateId) labels[LABEL_TEMPLATE_REF] = templateId;

    const k8sName = generateK8sName("agent");
    const cm: k8s.V1ConfigMap = {
      metadata: { name: k8sName, namespace, labels },
      data: { [SPEC_KEY]: yaml.dump(spec) },
    };
    const created = await api.createNamespacedConfigMap({ namespace, body: cm });
    return parseAgent(created);
  };
}

export function updateAgentSpec(api: k8s.CoreV1Api, namespace: string, owner: string) {
  return async (id: string, patch: { description?: string; mcpServers?: Record<string, unknown> }): Promise<Agent | null> => {
    const cm = await readOwned(api, namespace, id, owner);
    if (!cm || cm.metadata?.labels?.[LABEL_TYPE] !== LABEL_AGENT) return null;

    const spec = yaml.load(cm.data?.[SPEC_KEY] ?? "") as AgentSpec;
    if (patch.description !== undefined) spec.description = patch.description;
    if (patch.mcpServers !== undefined) spec.mcpServers = patch.mcpServers as AgentSpec["mcpServers"];

    cm.data = { ...cm.data, [SPEC_KEY]: yaml.dump(spec) };
    const updated = await api.replaceNamespacedConfigMap({ name: id, namespace, body: cm });
    return parseAgent(updated);
  };
}

export function deleteAgent(api: k8s.CoreV1Api, namespace: string, owner: string) {
  return async (id: string): Promise<void> => {
    const cm = await readOwned(api, namespace, id, owner);
    if (!cm || cm.metadata?.labels?.[LABEL_TYPE] !== LABEL_AGENT) return;
    await api.deleteNamespacedConfigMap({ name: id, namespace });
  };
}

// ---- Instances ----

export function listInstances(api: k8s.CoreV1Api, namespace: string, owner?: string) {
  return async (): Promise<Instance[]> => {
    const ownerSelector = owner ? `,${LABEL_OWNER}=${owner}` : "";
    const [configMaps, pods] = await Promise.all([
      api.listNamespacedConfigMap({
        namespace,
        labelSelector: `${LABEL_TYPE}=${LABEL_INSTANCE}${ownerSelector}`,
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
      return enrichWithPodStatus(inst, podMap.get(cm.metadata!.name!));
    });
  };
}

export function getInstance(api: k8s.CoreV1Api, namespace: string, owner?: string) {
  return async (id: string): Promise<Instance | null> => {
    try {
      if (owner) {
        const cm = await readOwned(api, namespace, id, owner);
        if (!cm) return null;
        const inst = parseInstance(cm);
        let pod: k8s.V1Pod | undefined;
        try { pod = await api.readNamespacedPod({ name: `${id}-0`, namespace }); } catch {}
        return enrichWithPodStatus(inst, pod);
      }
      const cm = await api.readNamespacedConfigMap({ name: id, namespace });
      if (cm.metadata?.labels?.[LABEL_TYPE] !== LABEL_INSTANCE) return null;
      const inst = parseInstance(cm);
      let pod: k8s.V1Pod | undefined;
      try { pod = await api.readNamespacedPod({ name: `${id}-0`, namespace }); } catch {}
      return enrichWithPodStatus(inst, pod);
    } catch (err) {
      if (is404(err)) return null;
      throw err;
    }
  };
}

export function createInstance(api: k8s.CoreV1Api, namespace: string, owner: string) {
  return async (agentId: string, spec: Record<string, unknown>): Promise<Instance> => {
    const k8sName = generateK8sName("inst");
    const cm: k8s.V1ConfigMap = {
      metadata: {
        name: k8sName,
        namespace,
        labels: {
          [LABEL_TYPE]: LABEL_INSTANCE,
          [LABEL_AGENT_REF]: agentId,
          [LABEL_OWNER]: owner,
        },
        annotations: {
          "humr.ai/last-activity": new Date().toISOString(),
        },
      },
      data: { [SPEC_KEY]: yaml.dump(spec) },
    };
    const created = await api.createNamespacedConfigMap({ namespace, body: cm });
    return parseInstance(created);
  };
}

export function updateInstanceSpec(api: k8s.CoreV1Api, namespace: string, owner: string) {
  return async (id: string, patch: { env?: unknown; secretRef?: unknown; enabledMcpServers?: unknown; channels?: unknown }): Promise<Instance | null> => {
    const cm = await readOwned(api, namespace, id, owner);
    if (!cm) return null;

    const spec = yaml.load(cm.data?.[SPEC_KEY] ?? "") as InstanceSpec;
    if (patch.env !== undefined) spec.env = patch.env as InstanceSpec["env"];
    if (patch.secretRef !== undefined) spec.secretRef = patch.secretRef as InstanceSpec["secretRef"];
    if (patch.enabledMcpServers !== undefined) spec.enabledMcpServers = patch.enabledMcpServers as InstanceSpec["enabledMcpServers"];
    if (patch.channels !== undefined) spec.channels = patch.channels as InstanceSpec["channels"];

    cm.data = { ...cm.data, [SPEC_KEY]: yaml.dump(spec) };
    const updated = await api.replaceNamespacedConfigMap({ name: id, namespace, body: cm });
    return parseInstance(updated);
  };
}

export function readInstanceSpec(api: k8s.CoreV1Api, namespace: string, owner: string) {
  return async (id: string): Promise<InstanceSpec | null> => {
    const cm = await readOwned(api, namespace, id, owner);
    if (!cm) return null;
    return yaml.load(cm.data?.[SPEC_KEY] ?? "") as InstanceSpec;
  };
}

export function deleteInstance(api: k8s.CoreV1Api, namespace: string, owner: string) {
  return async (id: string): Promise<boolean> => {
    const cm = await readOwned(api, namespace, id, owner);
    if (!cm) return false;
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
    } catch {}
    return true;
  };
}

export function wakeInstance(api: k8s.CoreV1Api, namespace: string) {
  return async (id: string): Promise<Instance | null> => {
    try {
      const cm = await api.readNamespacedConfigMap({ name: id, namespace });
      const spec = yaml.load(cm.data?.[SPEC_KEY] ?? "") as InstanceSpec;
      if (spec.desiredState !== "hibernated") return parseInstance(cm);

      spec.desiredState = "running";
      cm.data = { ...cm.data, [SPEC_KEY]: yaml.dump(spec) };
      if (!cm.metadata!.annotations) cm.metadata!.annotations = {};
      cm.metadata!.annotations["humr.ai/last-activity"] = new Date().toISOString();
      await api.replaceNamespacedConfigMap({ name: cm.metadata!.name!, namespace, body: cm });
      const reread = await api.readNamespacedConfigMap({ name: id, namespace });
      return parseInstance(reread);
    } catch (err) {
      if (is404(err)) return null;
      throw err;
    }
  };
}

export function verifyOwner(api: k8s.CoreV1Api, namespace: string) {
  return async (id: string, owner: string): Promise<boolean> => {
    const cm = await readOwned(api, namespace, id, owner);
    return cm !== null;
  };
}

export function readAgentRef(api: k8s.CoreV1Api, namespace: string, owner: string) {
  return async (instanceId: string): Promise<string | null> => {
    const cm = await readOwned(api, namespace, instanceId, owner);
    if (!cm) return null;
    return cm.metadata!.labels![LABEL_AGENT_REF] ?? null;
  };
}

// ---- Schedules ----

export function listSchedules(api: k8s.CoreV1Api, namespace: string, owner: string) {
  return async (instanceId: string): Promise<Schedule[]> => {
    const res = await api.listNamespacedConfigMap({
      namespace,
      labelSelector: `${LABEL_TYPE}=${LABEL_SCHEDULE},${LABEL_INSTANCE_REF}=${instanceId},${LABEL_OWNER}=${owner}`,
    });
    return (res.items ?? []).map(parseSchedule);
  };
}

export function getSchedule(api: k8s.CoreV1Api, namespace: string, owner: string) {
  return async (id: string): Promise<Schedule | null> => {
    const cm = await readOwned(api, namespace, id, owner);
    if (!cm) return null;
    return parseSchedule(cm);
  };
}

export function createSchedule(api: k8s.CoreV1Api, namespace: string, owner: string) {
  return async (instanceId: string, agentRef: string, spec: Record<string, unknown>): Promise<Schedule> => {
    const k8sName = generateK8sName("sched");
    const cm: k8s.V1ConfigMap = {
      metadata: {
        name: k8sName,
        namespace,
        labels: {
          [LABEL_TYPE]: LABEL_SCHEDULE,
          [LABEL_INSTANCE_REF]: instanceId,
          [LABEL_AGENT_REF]: agentRef,
          [LABEL_OWNER]: owner,
        },
      },
      data: { [SPEC_KEY]: yaml.dump(spec) },
    };
    const created = await api.createNamespacedConfigMap({ namespace, body: cm });
    return parseSchedule(created);
  };
}

export function deleteSchedule(api: k8s.CoreV1Api, namespace: string, owner: string) {
  return async (id: string): Promise<void> => {
    const cm = await readOwned(api, namespace, id, owner);
    if (!cm) return;
    await api.deleteNamespacedConfigMap({ name: id, namespace });
  };
}

export function toggleSchedule(api: k8s.CoreV1Api, namespace: string, owner: string) {
  return async (id: string): Promise<Schedule | null> => {
    const cm = await readOwned(api, namespace, id, owner);
    if (!cm) return null;
    const spec = yaml.load(cm.data?.[SPEC_KEY] ?? "") as ScheduleSpec;
    spec.enabled = !spec.enabled;
    cm.data = { ...cm.data, [SPEC_KEY]: yaml.dump(spec) };
    const updated = await api.replaceNamespacedConfigMap({ name: id, namespace, body: cm });
    return parseSchedule(updated);
  };
}

// ---- Pod & ConfigMap Annotations ----

export function patchPodAnnotation(api: k8s.CoreV1Api, namespace: string) {
  return async (instanceId: string, key: string, value: string): Promise<void> => {
    await api.patchNamespacedPod({
      name: `${instanceId}-0`, namespace,
      body: { metadata: { annotations: { [key]: value } } },
    });
  };
}

export function removePodAnnotation(api: k8s.CoreV1Api, namespace: string) {
  return async (instanceId: string, key: string): Promise<void> => {
    await api.patchNamespacedPod({
      name: `${instanceId}-0`, namespace,
      body: { metadata: { annotations: { [key]: null } } },
    });
  };
}

export function patchConfigMapAnnotation(api: k8s.CoreV1Api, namespace: string) {
  return async (name: string, key: string, value: string): Promise<void> => {
    const cm = await api.readNamespacedConfigMap({ name, namespace });
    if (!cm.metadata!.annotations) cm.metadata!.annotations = {};
    cm.metadata!.annotations[key] = value;
    await api.replaceNamespacedConfigMap({ name, namespace, body: cm });
  };
}

// ---- Utility ----

export function podBaseUrl(instanceId: string, namespace: string): string {
  return `${instanceId}-0.${instanceId}.${namespace}.svc:8080`;
}

export function createApi(namespace: string) {
  const kc = new k8s.KubeConfig();
  kc.loadFromDefault();
  return { api: kc.makeApiClient(k8s.CoreV1Api), namespace };
}
