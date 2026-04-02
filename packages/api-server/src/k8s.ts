import * as k8s from "@kubernetes/client-node";
import yaml from "js-yaml";
import type {
  Template,
  TemplateSpec,
  TemplatesContext,
  CreateTemplateInput,
  Instance,
  InstanceSpec,
  InstancesContext,
  CreateInstanceInput,
  UpdateInstanceInput,
} from "api-server-api";


const LABEL_TYPE = "humr.ai/type";
const LABEL_TEMPLATE = "agent-template";
const LABEL_INSTANCE = "agent-instance";
const LABEL_TEMPLATE_REF = "humr.ai/template";
const LABEL_INSTANCE_REF = "humr.ai/instance";
const SPEC_KEY = "spec.yaml";

const DEFAULT_TEMPLATE_SPEC = {
  mounts: [
    { path: "/workspace", persist: true },
    { path: "/home/agent", persist: true },
    { path: "/tmp", persist: false },
  ],
  resources: {
    requests: { cpu: "250m", memory: "512Mi" },
    limits: { cpu: "1", memory: "2Gi" },
  },
  securityContext: {
    runAsNonRoot: true,
    readOnlyRootFilesystem: false,
  },
};

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
  return { name: cm.metadata!.name!, spec };
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
        image: input.image,
        description: input.description,
        ...DEFAULT_TEMPLATE_SPEC,
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
): InstancesContext {
  return {
    async list() {
      const res = await api.listNamespacedConfigMap({
        namespace,
        labelSelector: `${LABEL_TYPE}=${LABEL_INSTANCE}`,
      });
      return (res.items ?? []).map(parseInstance);
    },

    async get(name) {
      try {
        const cm = await api.readNamespacedConfigMap({ name, namespace });
        return parseInstance(cm);
      } catch (err) {
        if (is404(err)) return null;
        throw err;
      }
    },

    async create(input: CreateInstanceInput) {
      const tmpl = await templates.get(input.templateName);
      if (!tmpl) {
        throw new Error(`Template "${input.templateName}" not found`);
      }

      const spec: InstanceSpec = {
        templateName: input.templateName,
        desiredState: "running",
        env: input.env,
        secretRef: input.secretRef,
        description: input.description,
      };
      const cm: k8s.V1ConfigMap = {
        metadata: {
          name: input.name,
          namespace,
          labels: {
            [LABEL_TYPE]: LABEL_INSTANCE,
            [LABEL_TEMPLATE_REF]: input.templateName,
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
      let cm: k8s.V1ConfigMap;
      try {
        cm = await api.readNamespacedConfigMap({
          name: input.name,
          namespace,
        });
      } catch (err) {
        if (is404(err)) return null;
        throw err;
      }

      const spec = yaml.load(cm.data?.[SPEC_KEY] ?? "") as InstanceSpec;
      if (input.env !== undefined) spec.env = input.env;
      if (input.secretRef !== undefined) spec.secretRef = input.secretRef;

      cm.data = { ...cm.data, [SPEC_KEY]: yaml.dump(spec) };
      const updated = await api.replaceNamespacedConfigMap({
        name: input.name,
        namespace,
        body: cm,
      });
      return parseInstance(updated);
    },

    async delete(name) {
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

export { createApi };
