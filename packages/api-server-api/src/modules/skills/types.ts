/** An installed skill on an instance, keyed by source + name. Version is a commit SHA. */
export interface SkillRef {
  source: string;
  name: string;
  version: string;
}

/** A connected skill source (e.g. a public git repo). */
export interface SkillSource {
  id: string;
  name: string;
  gitUrl: string;
  /** True when the source is managed by the cluster admin (Helm-seeded). Users can't delete it. */
  system?: boolean;
  /** True when the current user has a publish credential stored for this source. */
  canPublish?: boolean;
}

/** A skill available from a connected source. Version is the last-touching commit SHA. */
export interface Skill {
  source: string;
  name: string;
  description: string;
  version: string;
}

export interface CreateSkillSourceInput {
  name: string;
  gitUrl: string;
}

export interface InstallSkillInput {
  instanceId: string;
  source: string;
  name: string;
  version: string;
}

export interface UninstallSkillInput {
  instanceId: string;
  source: string;
  name: string;
}

/** A skill authored directly on the instance's PVC (not installed from a remote source). */
export interface LocalSkill {
  name: string;
  description: string;
  skillPath: string;
}

export interface PublishSkillInput {
  instanceId: string;
  sourceId: string;
  name: string;
  title?: string;
  body?: string;
}

export interface PublishSkillResult {
  prUrl: string;
  branch: string;
}

export interface SkillsService {
  listSources: () => Promise<SkillSource[]>;
  getSource: (id: string) => Promise<SkillSource | null>;
  createSource: (input: CreateSkillSourceInput) => Promise<SkillSource>;
  deleteSource: (id: string) => Promise<void>;
  refreshSource: (id: string) => Promise<void>;
  listSkills: (sourceId: string) => Promise<Skill[]>;
  installSkill: (input: InstallSkillInput) => Promise<SkillRef[]>;
  uninstallSkill: (input: UninstallSkillInput) => Promise<SkillRef[]>;
  listLocal: (instanceId: string) => Promise<LocalSkill[]>;
  publishSkill: (input: PublishSkillInput) => Promise<PublishSkillResult>;
}
