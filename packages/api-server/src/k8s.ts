import * as k8s from "@kubernetes/client-node";
import yaml from "js-yaml";
import type {
  Template,
  TemplateSpec,
  TemplatesContext,
  CreateTemplateInput,
} from "./modules/templates.js";

const LABEL_TYPE = "humr.ai/type";
const LABEL_TEMPLATE = "agent-template";
const SPEC_KEY = "spec.yaml";

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
      const cm: k8s.V1ConfigMap = {
        metadata: {
          name: input.name,
          namespace,
          labels: { [LABEL_TYPE]: LABEL_TEMPLATE },
        },
        data: { [SPEC_KEY]: yaml.dump(input.spec) },
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
