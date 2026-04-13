import type {
  Schedule,
  ScheduleConfig,
  CreateCronScheduleInput,
  CreateHeartbeatScheduleInput,
} from "../domain/types.js";

export interface SchedulesContext {
  list: (instanceName: string) => Promise<Schedule[]>;
  get: (name: string) => Promise<Schedule | null>;
  createCron: (input: CreateCronScheduleInput) => Promise<Schedule>;
  createHeartbeat: (input: CreateHeartbeatScheduleInput) => Promise<Schedule>;
  delete: (name: string) => Promise<void>;
  toggle: (name: string) => Promise<Schedule | null>;
  config: () => ScheduleConfig;
}
