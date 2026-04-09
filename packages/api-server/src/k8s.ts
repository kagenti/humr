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

function parseTemplate(cm: k8s.V1ConfigMap): Template {
  const spec = yaml.load(cm.data?.[SPEC_KEY] ?? "") as TemplateSpec;
  return { name: cm.metadata!.name!, spec };
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
  return { name: cm.metadata!.name!, spec, status };
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
): TemplatesContext {
  return {
    async list() {
      const res = await api.listNamespacedConfigMap({
        namespace,
        labelSelector: `${LABEL_TYPE}=${LABEL_TEMPLATE}`,
      });
      return (res.items ?? []).map(parseTemplate);
    },

    async get(name) {
      try {
        const cm = await api.readNamespacedConfigMap({ name, namespace });
        return parseTemplate(cm);
      } catch (err) {
        if (is404(err)) return null;
        throw err;
      }
    },

    async create(input: CreateTemplateInput) {
      const spec: TemplateSpec = {
        version: SPEC_VERSION,
        image: input.image,
        description: input.description,
        ...DEFAULT_TEMPLATE_SPEC,
        mcpServers: input.mcpServers,
      };
      const cm: k8s.V1ConfigMap = {
        metadata: {
          name: input.name,
          namespace,
          labels: { [LABEL_TYPE]: LABEL_TEMPLATE },
        },
        data: { [SPEC_KEY]: yaml.dump(spec) },
      };
      const created = await api.createNamespacedConfigMap({
        namespace,
        body: cm,
      });
      return parseTemplate(created);
    },

    async delete(name) {
      await api.deleteNamespacedConfigMap({ name, namespace });
    },
  };
}

export function createK8sInstancesContext(
  namespace: string,
  api: k8s.CoreV1Api,
  templates: TemplatesContext,
  owner: string,
): InstancesContext {
  /** Read a ConfigMap and verify ownership. Returns null if not found or not owned. */
  async function readOwned(name: string): Promise<k8s.V1ConfigMap | null> {
    try {
      const cm = await api.readNamespacedConfigMap({ name, namespace });
      return hasOwner(cm, owner) ? cm : null;
    } catch (err) {
      if (is404(err)) return null;
      throw err;
    }
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
        const inst = parseInstance(cm);
        const pod = podMap.get(inst.name);
        return enrichWithPodStatus(inst, pod);
      });
    },

    async get(name) {
      const cm = await readOwned(name);
      if (!cm) return null;
      const inst = parseInstance(cm);
      let pod: k8s.V1Pod | undefined;
      try {
        pod = await api.readNamespacedPod({ name: `${name}-0`, namespace });
      } catch {}
      return enrichWithPodStatus(inst, pod);
    },

    async create(input: CreateInstanceInput) {
      const tmpl = await templates.get(input.templateName);
      if (!tmpl) {
        throw new Error(`Template "${input.templateName}" not found`);
      }

      const spec: InstanceSpec = {
        version: SPEC_VERSION,
        templateName: input.templateName,
        desiredState: "running",
        env: input.env,
        secretRef: input.secretRef,
        description: input.description,
        enabledMcpServers: input.enabledMcpServers,
      };
      const cm: k8s.V1ConfigMap = {
        metadata: {
          name: input.name,
          namespace,
          labels: {
            [LABEL_TYPE]: LABEL_INSTANCE,
            [LABEL_TEMPLATE_REF]: input.templateName,
            [LABEL_OWNER]: owner,
          },
        },
        data: { [SPEC_KEY]: yaml.dump(spec) },
      };
      const created = await api.createNamespacedConfigMap({
        namespace,
        body: cm,
      });
      return parseInstance(created);
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
        name: input.name,
        namespace,
        body: cm,
      });
      return parseInstance(updated);
    },

    async wake(name) {
      const cm = await readOwned(name);
      if (!cm) return null;
      const spec = yaml.load(cm.data?.[SPEC_KEY] ?? "") as InstanceSpec;
      spec.desiredState = "running";
      cm.data = { ...cm.data, [SPEC_KEY]: yaml.dump(spec) };
      const updated = await api.replaceNamespacedConfigMap({
        name,
        namespace,
        body: cm,
      });
      return parseInstance(updated);
    },

    async delete(name) {
      const cm = await readOwned(name);
      if (!cm) return;

      await api.deleteNamespacedConfigMap({ name, namespace });

      try {
        const pvcs = await api.listNamespacedPersistentVolumeClaim({
          namespace,
          labelSelector: `${LABEL_INSTANCE_REF}=${name}`,
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

function parseSchedule(cm: k8s.V1ConfigMap): Schedule {
  const spec = yaml.load(cm.data?.[SPEC_KEY] ?? "") as ScheduleSpec;
  const statusYaml = cm.data?.[STATUS_KEY];
  let status: ScheduleStatus | undefined;
  if (statusYaml) {
    status = yaml.load(statusYaml) as ScheduleStatus;
  }
  const instanceName = cm.metadata!.labels![LABEL_INSTANCE_REF];
  return { name: cm.metadata!.name!, instanceName, spec, status };
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
  instances: InstancesContext,
  owner: string,
): SchedulesContext {
  async function readOwned(name: string): Promise<k8s.V1ConfigMap | null> {
    try {
      const cm = await api.readNamespacedConfigMap({ name, namespace });
      return hasOwner(cm, owner) ? cm : null;
    } catch (err) {
      if (is404(err)) return null;
      throw err;
    }
  }

  return {
    async list(instanceName) {
      const res = await api.listNamespacedConfigMap({
        namespace,
        labelSelector: `${LABEL_TYPE}=${LABEL_SCHEDULE},${LABEL_INSTANCE_REF}=${instanceName},${LABEL_OWNER}=${owner}`,
      });
      return (res.items ?? []).map(parseSchedule);
    },

    async get(name) {
      const cm = await readOwned(name);
      if (!cm) return null;
      return parseSchedule(cm);
    },

    async createCron(input: CreateCronScheduleInput) {
      validateCron(input.cron);

      const inst = await instances.get(input.instanceName);
      if (!inst) {
        throw new Error(`Instance "${input.instanceName}" not found`);
      }

      const cmName = `${input.instanceName}-${input.name}`;
      const spec: ScheduleSpec = {
        version: SPEC_VERSION,
        type: "cron",
        cron: input.cron,
        task: input.task,
        enabled: true,
      };
      const cm: k8s.V1ConfigMap = {
        metadata: {
          name: cmName,
          namespace,
          labels: {
            [LABEL_TYPE]: LABEL_SCHEDULE,
            [LABEL_INSTANCE_REF]: input.instanceName,
            [LABEL_TEMPLATE_REF]: inst.spec.templateName,
            [LABEL_OWNER]: owner,
          },
        },
        data: { [SPEC_KEY]: yaml.dump(spec) },
      };
      const created = await api.createNamespacedConfigMap({ namespace, body: cm });
      return parseSchedule(created);
    },

    async createHeartbeat(input: CreateHeartbeatScheduleInput) {
      const inst = await instances.get(input.instanceName);
      if (!inst) {
        throw new Error(`Instance "${input.instanceName}" not found`);
      }

      const cmName = `${input.instanceName}-${input.name}`;
      const spec: ScheduleSpec = {
        version: SPEC_VERSION,
        type: "heartbeat",
        cron: minutesToCron(input.intervalMinutes),
        task: "",
        enabled: true,
      };
      const cm: k8s.V1ConfigMap = {
        metadata: {
          name: cmName,
          namespace,
          labels: {
            [LABEL_TYPE]: LABEL_SCHEDULE,
            [LABEL_INSTANCE_REF]: input.instanceName,
            [LABEL_TEMPLATE_REF]: inst.spec.templateName,
            [LABEL_OWNER]: owner,
          },
        },
        data: { [SPEC_KEY]: yaml.dump(spec) },
      };
      const created = await api.createNamespacedConfigMap({ namespace, body: cm });
      return parseSchedule(created);
    },

    async delete(name) {
      const cm = await readOwned(name);
      if (!cm) return;
      await api.deleteNamespacedConfigMap({ name, namespace });
    },

    async toggle(name) {
      const cm = await readOwned(name);
      if (!cm) return null;
      const spec = yaml.load(cm.data?.[SPEC_KEY] ?? "") as ScheduleSpec;
      spec.enabled = !spec.enabled;
      cm.data = { ...cm.data, [SPEC_KEY]: yaml.dump(spec) };
      const updated = await api.replaceNamespacedConfigMap({ name, namespace, body: cm });
      return parseSchedule(updated);
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

/** Verify that an instance ConfigMap is owned by the given user. */
export async function verifyInstanceOwner(
  api: k8s.CoreV1Api,
  namespace: string,
  instanceId: string,
  owner: string,
): Promise<boolean> {
  try {
    const cm = await api.readNamespacedConfigMap({ name: instanceId, namespace });
    return hasOwner(cm, owner);
  } catch {
    return false;
  }
}

export { createApi };
