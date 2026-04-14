export interface ScheduleSpec {
  version: string;
  type: "heartbeat" | "cron" | "improvement";
  cron: string;
  task?: string;
  enabled: boolean;
}

export interface ScheduleStatus {
  lastRun?: string;
  nextRun?: string;
  lastResult?: string;
}

/** Improvement-specific runtime state, computed from the agent pod at read time.
 * Not persisted in the schedule ConfigMap — populated by the API server for
 * improvement-type schedules. */
export type ImprovementRuntimeState =
  | "idle"
  | "running"
  | "completed"
  | "timed-out"
  | "failed";

export interface ImprovementSkippedInfo {
  at: string;
  schedule: string;
  reason: string;
}

export interface ImprovementState {
  state: ImprovementRuntimeState;
  finishedAt?: string;
  detail?: string;
  /** Most recent skipped-trigger event, if any. Independent of `state` —
   * a skip does not become the run state. */
  lastSkipped?: ImprovementSkippedInfo;
}

export interface Schedule {
  id: string;
  name: string;
  instanceId: string;
  spec: ScheduleSpec;
  status?: ScheduleStatus;
}

export interface CreateCronScheduleInput {
  name: string;
  instanceId: string;
  cron: string;
  task: string;
}

export interface CreateHeartbeatScheduleInput {
  name: string;
  instanceId: string;
  intervalMinutes: number;
}

export interface CreateImprovementScheduleInput {
  name: string;
  instanceId: string;
  cron: string;
  task: string;
}

export interface ScheduleConfig {
  defaultHeartbeatIntervalMinutes: number;
}

export interface SchedulesService {
  list: (instanceId: string) => Promise<Schedule[]>;
  get: (id: string) => Promise<Schedule | null>;
  createCron: (input: CreateCronScheduleInput) => Promise<Schedule>;
  createHeartbeat: (input: CreateHeartbeatScheduleInput) => Promise<Schedule>;
  createImprovement: (input: CreateImprovementScheduleInput) => Promise<Schedule>;
  delete: (id: string) => Promise<void>;
  toggle: (id: string) => Promise<Schedule | null>;
  config: () => ScheduleConfig;
  /** Fetch the current improvement runtime state from the agent pod.
   * Returns `{ state: "idle" }` if the pod is unreachable or has no state yet. */
  getImprovementState: (instanceId: string) => Promise<ImprovementState>;
}
