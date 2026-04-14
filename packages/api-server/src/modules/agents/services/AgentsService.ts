import type {
  AgentsService,
  CreateAgentInput,
  UpdateAgentInput,
  TemplateSpec,
} from "api-server-api";
import type { K8sClient } from "../infrastructure/k8s.js";
import {
  LABEL_TYPE, TYPE_AGENT, LABEL_OWNER,
} from "../domain/labels.js";
import {
  parseAgent, isOwnedBy, hasType,
  buildAgentConfigMap, patchSpecField,
} from "../domain/configmap-mappers.js";
import { assembleSpecFromTemplate, assembleSpecFromImage } from "../domain/spec-assembly.js";

export function createAgentsService(deps: {
  k8s: K8sClient;
  owner: string;
  readTemplateSpec: (id: string) => Promise<{ spec: TemplateSpec; isOwned: boolean } | null>;
}): AgentsService {
  return {
    async list() {
      const cms = await deps.k8s.listConfigMaps(
        `${LABEL_TYPE}=${TYPE_AGENT},${LABEL_OWNER}=${deps.owner}`,
      );
      return cms.map(parseAgent);
    },

    async get(id) {
      const cm = await deps.k8s.getConfigMap(id);
      if (!cm || !isOwnedBy(cm, deps.owner) || !hasType(cm, TYPE_AGENT)) return null;
      return parseAgent(cm);
    },

    async create(input: CreateAgentInput) {
      if (input.templateId) {
        const tmpl = await deps.readTemplateSpec(input.templateId);
        if (!tmpl || tmpl.isOwned) throw new Error(`Template "${input.templateId}" not found`);
        const spec = assembleSpecFromTemplate(input.name, tmpl.spec, {
          description: input.description,
          mcpServers: input.mcpServers,
        });
        const body = buildAgentConfigMap(spec, deps.owner, input.templateId);
        const created = await deps.k8s.createConfigMap(body);
        return parseAgent(created);
      }
      const spec = assembleSpecFromImage(input.name, {
        image: input.image,
        description: input.description,
        mcpServers: input.mcpServers,
      });
      const body = buildAgentConfigMap(spec, deps.owner);
      const created = await deps.k8s.createConfigMap(body);
      return parseAgent(created);
    },

    async update(input: UpdateAgentInput) {
      const cm = await deps.k8s.getConfigMap(input.id);
      if (!cm || !isOwnedBy(cm, deps.owner) || !hasType(cm, TYPE_AGENT)) return null;

      cm.data = patchSpecField(cm, {
        description: input.description,
        mcpServers: input.mcpServers,
      });
      const updated = await deps.k8s.replaceConfigMap(input.id, cm);
      return parseAgent(updated);
    },

    async delete(id) {
      const cm = await deps.k8s.getConfigMap(id);
      if (!cm || !isOwnedBy(cm, deps.owner) || !hasType(cm, TYPE_AGENT)) return;
      await deps.k8s.deleteConfigMap(id);
    },
  };
}
