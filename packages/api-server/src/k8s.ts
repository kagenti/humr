import * as k8s from "@kubernetes/client-node";
import yaml from "js-yaml";
import type {
  Template,
  TemplateSpec,
  TemplatesContext,
  CreateTemplateInput,
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
const LABEL_INSTANCE = "agent-instance";
const LABEL_TEMPLATE_REF = "humr.ai/template";
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

// --- Name prefixing: K8s name = "{username}-{user-visible-name}" ---

/** Build the K8s resource name from owner username and user-visible name. */
function qualifiedName(ownerUsername: string, name: string): string {
  return `${ownerUsername}-${name}`;
}

/** Strip the owner prefix from a K8s resource name to get the user-visible name. */
function userVisibleName(ownerUsername: string, k8sName: string): string {
  if (!ownerUsername) return k8sName;
  const prefix = `${ownerUsername}-`;
  return k8sName.startsWith(prefix) ? k8sName.slice(prefix.length) : k8sName;
}

// --- Helpers ---

function hasOwner(cm: k8s.V1ConfigMap, owner: string): boolean {
  return cm.metadata?.labels?.[LABEL_OWNER] === owner;
}

function is404(err: unknown): boolean {
  return (
    err instanceof Error &&
    "code" in err &&
    (err as { code: number }).code === 404
  );
}

function parseTemplate(cm: k8s.V1ConfigMap, ownerUsername: string): Template {
  const spec = yaml.load(cm.data?.[SPEC_KEY] ?? "") as TemplateSpec;
  return { name: userVisibleName(ownerUsername, cm.metadata!.name!), spec };
}

function parseInstance(cm: k8s.V1ConfigMap, ownerUsername: string): Instance {
  const spec = yaml.load(cm.data?.[SPEC_KEY] ?? "") as InstanceSpec;
  // templateName in spec is the K8s name — strip owner prefix if present
  if (spec.templateName) {
    spec.templateName = userVisibleName(ownerUsername, spec.templateName);
  }
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
  return { name: userVisibleName(ownerUsername, cm.metadata!.name!), spec, status };
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

export function createK8sTemplatesContext(
  namespace: string,
  api: k8s.CoreV1Api,
  owner: string,
  ownerUsername: string,
): TemplatesContext {
  async function readOwned(name: string): Promise<k8s.V1ConfigMap | null> {
    const qName = qualifiedName(ownerUsername, name);
    try {
      const cm = await api.readNamespacedConfigMap({ name: qName, namespace });
      return hasOwner(cm, owner) ? cm : null;
    } catch (err) {
      if (is404(err)) return null;
      throw err;
    }
  }

  return {
    async list() {
      // Show user's own templates + system templates (no owner label)
      const res = await api.listNamespacedConfigMap({
        namespace,
        labelSelector: `${LABEL_TYPE}=${LABEL_TEMPLATE}`,
      });
      return (res.items ?? [])
        .filter((cm) => {
          const cmOwner = cm.metadata?.labels?.[LABEL_OWNER];
          return !cmOwner || cmOwner === owner;
        })
        .map((cm) => {
          const cmOwner = cm.metadata?.labels?.[LABEL_OWNER];
          // System templates (no owner) use their raw name; user templates strip prefix
          return parseTemplate(cm, cmOwner ? ownerUsername : "");
        });
    },

    async get(name) {
      // Try user-owned template first, then system template (no prefix)
      const cm = await readOwned(name);
      if (cm) return parseTemplate(cm, ownerUsername);
      // Fall back to system template (no owner prefix)
      try {
        const sysCm = await api.readNamespacedConfigMap({ name, namespace });
        if (!sysCm.metadata?.labels?.[LABEL_OWNER]) return parseTemplate(sysCm, "");
      } catch (err) {
        if (!is404(err)) throw err;
      }
      return null;
    },

    async create(input: CreateTemplateInput) {
      const qName = qualifiedName(ownerUsername, input.name);
      const spec: TemplateSpec = {
        version: SPEC_VERSION,
        image: input.image,
        description: input.description,
        ...DEFAULT_TEMPLATE_SPEC,
        mcpServers: input.mcpServers,
      };
      const cm: k8s.V1ConfigMap = {
        metadata: {
          name: qName,
          namespace,
          labels: {
            [LABEL_TYPE]: LABEL_TEMPLATE,
            [LABEL_OWNER]: owner,
          },
        },
        data: { [SPEC_KEY]: yaml.dump(spec) },
      };
      const created = await api.createNamespacedConfigMap({
        namespace,
        body: cm,
      });
      return parseTemplate(created, ownerUsername);
    },

    async delete(name) {
      const cm = await readOwned(name);
      if (!cm) return;
      await api.deleteNamespacedConfigMap({ name: cm.metadata!.name!, namespace });
    },
  };
}

export function createK8sInstancesContext(
  namespace: string,
  api: k8s.CoreV1Api,
  owner: string,
  ownerUsername: string,
): InstancesContext {
  async function readOwned(name: string): Promise<k8s.V1ConfigMap | null> {
    const qName = qualifiedName(ownerUsername, name);
    try {
      const cm = await api.readNamespacedConfigMap({ name: qName, namespace });
      return hasOwner(cm, owner) ? cm : null;
    } catch (err) {
      if (is404(err)) return null;
      throw err;
    }
  }

  /** Resolve a user-visible template name to its K8s ConfigMap name.
   *  Tries user-owned (prefixed) first, then system (unprefixed). */
  async function resolveTemplateName(name: string): Promise<string | null> {
    const qName = qualifiedName(ownerUsername, name);
    try {
      const cm = await api.readNamespacedConfigMap({ name: qName, namespace });
      if (hasOwner(cm, owner)) return qName;
    } catch (err) {
      if (!is404(err)) throw err;
    }
    // Try system template (no prefix)
    try {
      const cm = await api.readNamespacedConfigMap({ name, namespace });
      if (!cm.metadata?.labels?.[LABEL_OWNER]) return name;
    } catch (err) {
      if (!is404(err)) throw err;
    }
    return null;
  }

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
        const name = pod.metadata?.labels?.[LABEL_INSTANCE_REF];
        if (name) podMap.set(name, pod);
      }
      return (configMaps.items ?? []).map((cm) => {
        const inst = parseInstance(cm, ownerUsername);
        // Pod lookup uses the qualified K8s name
        const pod = podMap.get(cm.metadata!.name!);
        return enrichWithPodStatus(inst, pod);
      });
    },

    async get(name) {
      const cm = await readOwned(name);
      if (!cm) return null;
      const inst = parseInstance(cm, ownerUsername);
      const qName = cm.metadata!.name!;
      let pod: k8s.V1Pod | undefined;
      try {
        pod = await api.readNamespacedPod({ name: `${qName}-0`, namespace });
      } catch {}
      return enrichWithPodStatus(inst, pod);
    },

    async create(input: CreateInstanceInput) {
      const qTemplateName = await resolveTemplateName(input.templateName);
      if (!qTemplateName) {
        throw new Error(`Template "${input.templateName}" not found`);
      }

      const qName = qualifiedName(ownerUsername, input.name);
      const spec: InstanceSpec = {
        version: SPEC_VERSION,
        templateName: qTemplateName,
        desiredState: "running",
        env: input.env,
        secretRef: input.secretRef,
        description: input.description,
        enabledMcpServers: input.enabledMcpServers,
      };
      const cm: k8s.V1ConfigMap = {
        metadata: {
          name: qName,
          namespace,
          labels: {
            [LABEL_TYPE]: LABEL_INSTANCE,
            [LABEL_TEMPLATE_REF]: qTemplateName,
            [LABEL_OWNER]: owner,
          },
        },
        data: { [SPEC_KEY]: yaml.dump(spec) },
      };
      const created = await api.createNamespacedConfigMap({
        namespace,
        body: cm,
      });
      return parseInstance(created, ownerUsername);
    },

    async update(input: UpdateInstanceInput) {
      const cm = await readOwned(input.name);
      if (!cm) return null;

      const spec = yaml.load(cm.data?.[SPEC_KEY] ?? "") as InstanceSpec;
      if (input.env !== undefined) spec.env = input.env;
      if (input.secretRef !== undefined) spec.secretRef = input.secretRef;
      if (input.enabledMcpServers !== undefined) spec.enabledMcpServers = input.enabledMcpServers;

      cm.data = { ...cm.data, [SPEC_KEY]: yaml.dump(spec) };
      const updated = await api.replaceNamespacedConfigMap({
        name: cm.metadata!.name!,
        namespace,
        body: cm,
      });
      return parseInstance(updated, ownerUsername);
    },

    async wake(name) {
      const cm = await readOwned(name);
      if (!cm) return null;
      const spec = yaml.load(cm.data?.[SPEC_KEY] ?? "") as InstanceSpec;
      spec.desiredState = "running";
      cm.data = { ...cm.data, [SPEC_KEY]: yaml.dump(spec) };
      const updated = await api.replaceNamespacedConfigMap({
        name: cm.metadata!.name!,
        namespace,
        body: cm,
      });
      return parseInstance(updated, ownerUsername);
    },

    async delete(name) {
      const cm = await readOwned(name);
      if (!cm) return;
      const qName = cm.metadata!.name!;

      await api.deleteNamespacedConfigMap({ name: qName, namespace });

      try {
        const pvcs = await api.listNamespacedPersistentVolumeClaim({
          namespace,
          labelSelector: `${LABEL_INSTANCE_REF}=${qName}`,
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
        // PVC cleanup is best-effort; controller may not have labeled them yet
      }
    },
  };
}

function parseSchedule(cm: k8s.V1ConfigMap, ownerUsername: string): Schedule {
  const spec = yaml.load(cm.data?.[SPEC_KEY] ?? "") as ScheduleSpec;
  const statusYaml = cm.data?.[STATUS_KEY];
  let status: ScheduleStatus | undefined;
  if (statusYaml) {
    status = yaml.load(statusYaml) as ScheduleStatus;
  }
  const qInstanceName = cm.metadata!.labels![LABEL_INSTANCE_REF];
  return {
    name: userVisibleName(ownerUsername, cm.metadata!.name!),
    instanceName: userVisibleName(ownerUsername, qInstanceName),
    spec,
    status,
  };
}

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
  ownerUsername: string,
): SchedulesContext {
  async function readOwned(name: string): Promise<k8s.V1ConfigMap | null> {
    const qName = qualifiedName(ownerUsername, name);
    try {
      const cm = await api.readNamespacedConfigMap({ name: qName, namespace });
      return hasOwner(cm, owner) ? cm : null;
    } catch (err) {
      if (is404(err)) return null;
      throw err;
    }
  }

  async function readOwnedInstance(name: string): Promise<k8s.V1ConfigMap | null> {
    const qName = qualifiedName(ownerUsername, name);
    try {
      const cm = await api.readNamespacedConfigMap({ name: qName, namespace });
      return hasOwner(cm, owner) ? cm : null;
    } catch (err) {
      if (is404(err)) return null;
      throw err;
    }
  }

  return {
    async list(instanceName) {
      const qInstanceName = qualifiedName(ownerUsername, instanceName);
      const res = await api.listNamespacedConfigMap({
        namespace,
        labelSelector: `${LABEL_TYPE}=${LABEL_SCHEDULE},${LABEL_INSTANCE_REF}=${qInstanceName},${LABEL_OWNER}=${owner}`,
      });
      return (res.items ?? []).map((cm) => parseSchedule(cm, ownerUsername));
    },

    async get(name) {
      const cm = await readOwned(name);
      if (!cm) return null;
      return parseSchedule(cm, ownerUsername);
    },

    async createCron(input: CreateCronScheduleInput) {
      validateCron(input.cron);

      const qInstanceName = qualifiedName(ownerUsername, input.instanceName);
      // Read instance ConfigMap to get the real template ref label
      const instCm = await readOwnedInstance(input.instanceName);
      if (!instCm) {
        throw new Error(`Instance "${input.instanceName}" not found`);
      }
      const qTemplateName = instCm.metadata!.labels![LABEL_TEMPLATE_REF];

      const qName = qualifiedName(ownerUsername, `${input.instanceName}-${input.name}`);
      const spec: ScheduleSpec = {
        version: SPEC_VERSION,
        type: "cron",
        cron: input.cron,
        task: input.task,
        enabled: true,
      };
      const cm: k8s.V1ConfigMap = {
        metadata: {
          name: qName,
          namespace,
          labels: {
            [LABEL_TYPE]: LABEL_SCHEDULE,
            [LABEL_INSTANCE_REF]: qInstanceName,
            [LABEL_TEMPLATE_REF]: qTemplateName,
            [LABEL_OWNER]: owner,
          },
        },
        data: { [SPEC_KEY]: yaml.dump(spec) },
      };
      const created = await api.createNamespacedConfigMap({ namespace, body: cm });
      return parseSchedule(created, ownerUsername);
    },

    async createHeartbeat(input: CreateHeartbeatScheduleInput) {
      const qInstanceName = qualifiedName(ownerUsername, input.instanceName);
      const instCm = await readOwnedInstance(input.instanceName);
      if (!instCm) {
        throw new Error(`Instance "${input.instanceName}" not found`);
      }
      const qTemplateName = instCm.metadata!.labels![LABEL_TEMPLATE_REF];

      const qName = qualifiedName(ownerUsername, `${input.instanceName}-${input.name}`);
      const spec: ScheduleSpec = {
        version: SPEC_VERSION,
        type: "heartbeat",
        cron: minutesToCron(input.intervalMinutes),
        task: "",
        enabled: true,
      };
      const cm: k8s.V1ConfigMap = {
        metadata: {
          name: qName,
          namespace,
          labels: {
            [LABEL_TYPE]: LABEL_SCHEDULE,
            [LABEL_INSTANCE_REF]: qInstanceName,
            [LABEL_TEMPLATE_REF]: qTemplateName,
            [LABEL_OWNER]: owner,
          },
        },
        data: { [SPEC_KEY]: yaml.dump(spec) },
      };
      const created = await api.createNamespacedConfigMap({ namespace, body: cm });
      return parseSchedule(created, ownerUsername);
    },

    async delete(name) {
      const cm = await readOwned(name);
      if (!cm) return;
      await api.deleteNamespacedConfigMap({ name: cm.metadata!.name!, namespace });
    },

    async toggle(name) {
      const cm = await readOwned(name);
      if (!cm) return null;
      const spec = yaml.load(cm.data?.[SPEC_KEY] ?? "") as ScheduleSpec;
      spec.enabled = !spec.enabled;
      cm.data = { ...cm.data, [SPEC_KEY]: yaml.dump(spec) };
      const updated = await api.replaceNamespacedConfigMap({ name: cm.metadata!.name!, namespace, body: cm });
      return parseSchedule(updated, ownerUsername);
    },

    config() {
      return { defaultHeartbeatIntervalMinutes: DEFAULT_HEARTBEAT_INTERVAL_MINUTES };
    },
  };
}

export function podBaseUrl(instanceId: string, namespace: string): string {
  return `${instanceId}-0.${instanceId}.${namespace}.svc:8080`;
}

export async function patchPodAnnotation(
  api: k8s.CoreV1Api,
  namespace: string,
  instanceId: string,
  key: string,
  value: string,
): Promise<void> {
  await api.patchNamespacedPod({
    name: `${instanceId}-0`,
    namespace,
    body: { metadata: { annotations: { [key]: value } } },
  });
}

export async function removePodAnnotation(
  api: k8s.CoreV1Api,
  namespace: string,
  instanceId: string,
  key: string,
): Promise<void> {
  await api.patchNamespacedPod({
    name: `${instanceId}-0`,
    namespace,
    body: { metadata: { annotations: { [key]: null } } },
  });
}

export async function patchConfigMapAnnotation(
  api: k8s.CoreV1Api,
  namespace: string,
  name: string,
  key: string,
  value: string,
): Promise<void> {
  const cm = await api.readNamespacedConfigMap({ name, namespace });
  if (!cm.metadata!.annotations) cm.metadata!.annotations = {};
  cm.metadata!.annotations[key] = value;
  await api.replaceNamespacedConfigMap({ name, namespace, body: cm });
}

/** Verify that an instance ConfigMap is owned by the given user. Returns the qualified K8s name if owned. */
export async function verifyInstanceOwner(
  api: k8s.CoreV1Api,
  namespace: string,
  instanceName: string,
  owner: string,
  ownerUsername: string,
): Promise<string | null> {
  const qName = qualifiedName(ownerUsername, instanceName);
  try {
    const cm = await api.readNamespacedConfigMap({ name: qName, namespace });
    return hasOwner(cm, owner) ? qName : null;
  } catch {
    return null;
  }
}

export { createApi };
