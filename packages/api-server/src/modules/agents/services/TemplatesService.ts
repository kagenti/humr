import type { TemplatesService, TemplateSpec } from "api-server-api";
import type { K8sClient } from "../infrastructure/k8s.js";
import {
  LABEL_TYPE, TYPE_TEMPLATE, LABEL_OWNER, SPEC_KEY,
} from "../domain/labels.js";
import { parseTemplate, hasType } from "../domain/configmap-mappers.js";
import yaml from "js-yaml";

export function createTemplatesService(deps: {
  k8s: K8sClient;
}): TemplatesService {
  return {
    async list() {
      const cms = await deps.k8s.listConfigMaps(`${LABEL_TYPE}=${TYPE_TEMPLATE}`);
      return cms
        .filter((cm) => !cm.metadata?.labels?.[LABEL_OWNER])
        .map(parseTemplate);
    },

    async get(id) {
      const cm = await deps.k8s.getConfigMap(id);
      if (!cm || !hasType(cm, TYPE_TEMPLATE)) return null;
      if (cm.metadata?.labels?.[LABEL_OWNER]) return null;
      return parseTemplate(cm);
    },
  };
}

export function readTemplateSpec(deps: { k8s: K8sClient }) {
  return async (id: string): Promise<{ spec: TemplateSpec; isOwned: boolean } | null> => {
    const cm = await deps.k8s.getConfigMap(id);
    if (!cm || !hasType(cm, TYPE_TEMPLATE)) return null;
    return {
      spec: yaml.load(cm.data?.[SPEC_KEY] ?? "") as TemplateSpec,
      isOwned: !!cm.metadata?.labels?.[LABEL_OWNER],
    };
  };
}
