import * as k8s from "@kubernetes/client-node";
import yaml from "js-yaml";
import type { SkillSource } from "api-server-api";
import { SPEC_VERSION } from "api-server-api";
import type { K8sClient } from "../../agents/infrastructure/k8s.js";
import {
  LABEL_OWNER,
  LABEL_SYSTEM,
  LABEL_TYPE,
  SPEC_KEY,
  TYPE_SKILL_SOURCE,
} from "../../agents/infrastructure/labels.js";
import {
  generateK8sName,
  hasType,
  isOwnedBy,
} from "../../agents/infrastructure/configmap-mappers.js";

interface SkillSourceSpecYaml {
  version: string;
  name?: string;
  gitUrl: string;
}

function isSystem(cm: k8s.V1ConfigMap): boolean {
  return cm.metadata?.labels?.[LABEL_SYSTEM] === "true";
}

function parseSkillSource(cm: k8s.V1ConfigMap): SkillSource {
  const spec = yaml.load(cm.data?.[SPEC_KEY] ?? "") as SkillSourceSpecYaml;
  const view: SkillSource = {
    id: cm.metadata!.name!,
    name: spec?.name ?? cm.metadata!.name!,
    gitUrl: spec?.gitUrl ?? "",
  };
  if (isSystem(cm)) view.system = true;
  return view;
}

function buildSkillSourceConfigMap(
  name: string,
  gitUrl: string,
  owner: string,
): k8s.V1ConfigMap {
  const spec: SkillSourceSpecYaml = { version: SPEC_VERSION, name, gitUrl };
  return {
    metadata: {
      name: generateK8sName("skill-src"),
      labels: {
        [LABEL_TYPE]: TYPE_SKILL_SOURCE,
        [LABEL_OWNER]: owner,
      },
    },
    data: { [SPEC_KEY]: yaml.dump(spec) },
  };
}

export interface SkillsRepository {
  list(owner: string): Promise<SkillSource[]>;
  get(id: string, owner: string): Promise<SkillSource | null>;
  create(input: { name: string; gitUrl: string }, owner: string): Promise<SkillSource>;
  delete(id: string, owner: string): Promise<void>;
}

export class SkillSourceProtectedError extends Error {
  constructor() {
    super("skill source is managed by the cluster admin and cannot be deleted");
    this.name = "SkillSourceProtectedError";
  }
}

export function createSkillsRepository(k8s: K8sClient): SkillsRepository {
  return {
    async list(owner) {
      const [owned, seeded] = await Promise.all([
        k8s.listConfigMaps(`${LABEL_TYPE}=${TYPE_SKILL_SOURCE},${LABEL_OWNER}=${owner}`),
        k8s.listConfigMaps(`${LABEL_TYPE}=${TYPE_SKILL_SOURCE},${LABEL_SYSTEM}=true`),
      ]);
      const seen = new Set<string>();
      const out: SkillSource[] = [];
      for (const cm of [...owned, ...seeded]) {
        const id = cm.metadata!.name!;
        if (seen.has(id)) continue;
        seen.add(id);
        out.push(parseSkillSource(cm));
      }
      return out;
    },

    async get(id, owner) {
      const cm = await k8s.getConfigMap(id);
      if (!cm || !hasType(cm, TYPE_SKILL_SOURCE)) return null;
      if (!isSystem(cm) && !isOwnedBy(cm, owner)) return null;
      return parseSkillSource(cm);
    },

    async create(input, owner) {
      const body = buildSkillSourceConfigMap(input.name, input.gitUrl, owner);
      const created = await k8s.createConfigMap(body);
      return parseSkillSource(created);
    },

    async delete(id, owner) {
      const cm = await k8s.getConfigMap(id);
      if (!cm || !hasType(cm, TYPE_SKILL_SOURCE)) return;
      if (isSystem(cm)) throw new SkillSourceProtectedError();
      if (!isOwnedBy(cm, owner)) return;
      await k8s.deleteConfigMap(id);
    },
  };
}
