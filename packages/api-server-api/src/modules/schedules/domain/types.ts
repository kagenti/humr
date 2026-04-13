export interface ScheduleSpec {
  version: string;
  type: "heartbeat" | "cron";
  cron: string;
  task?: string;
  enabled: boolean;
}

export interface ScheduleStatus {
  lastRun?: string;
  nextRun?: string;
  lastResult?: string;
}

export interface Schedule {
  name: string;
  instanceName: string;
  spec: ScheduleSpec;
  status?: ScheduleStatus;
}

export interface CreateCronScheduleInput {
  name: string;
  instanceName: string;
  cron: string;
  task: string;
}

export interface CreateHeartbeatScheduleInput {
  name: string;
  instanceName: string;
  intervalMinutes: number;
}

export interface ScheduleConfig {
  defaultHeartbeatIntervalMinutes: number;
}
