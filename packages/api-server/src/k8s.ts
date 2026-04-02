import * as k8s from "@kubernetes/client-node";
import yaml from "js-yaml";
import type {
  Template,
  TemplateSpec,
  TemplatesContext,
  CreateTemplateInput,
} from "api-server-api";

const LABEL_TYPE = "humr.ai/type";
const LABEL_TEMPLATE = "agent-template";
const SPEC_KEY = "spec.yaml";

const DEFAULT_SPEC = {
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

function parseTemplate(cm: k8s.V1ConfigMap): Template {
  const spec = yaml.load(cm.data?.[SPEC_KEY] ?? "") as TemplateSpec;
  return { name: cm.metadata!.name!, spec };
}

export function createK8sTemplatesContext(
  namespace: string,
): TemplatesContext {
  const kc = new k8s.KubeConfig();
  kc.loadFromDefault();
  const api = kc.makeApiClient(k8s.CoreV1Api);

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
        if (err instanceof Error && "code" in err && (err as { code: number }).code === 404) {
          return null;
        }
        throw err;
      }
    },

    async create(input: CreateTemplateInput) {
      const spec: TemplateSpec = {
        image: input.image,
        description: input.description,
        ...DEFAULT_SPEC,
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
