import type {
  Schedule,
  SchedulesService,
  CreateCronScheduleInput,
  CreateHeartbeatScheduleInput,
} from "api-server-api";
import { SPEC_VERSION } from "api-server-api";
import { validateCron, minutesToCron } from "../domain/cron.js";
import { DEFAULT_HEARTBEAT_INTERVAL_MINUTES } from "../domain/defaults.js";

export function createSchedulesService(deps: {
  list: (instanceId: string) => Promise<Schedule[]>;
  get: (id: string) => Promise<Schedule | null>;
  create: (instanceId: string, agentRef: string, spec: Record<string, unknown>) => Promise<Schedule>;
  delete: (id: string) => Promise<void>;
  toggle: (id: string) => Promise<Schedule | null>;
  readAgentRef: (instanceId: string) => Promise<string | null>;
}): SchedulesService {
  return {
    list: deps.list,
    get: deps.get,

    async createCron(input: CreateCronScheduleInput) {
      validateCron(input.cron);
      const agentRef = await deps.readAgentRef(input.instanceId);
      if (!agentRef) throw new Error(`Instance "${input.instanceId}" not found`);

      const spec = {
        name: input.name,
        version: SPEC_VERSION,
        type: "cron" as const,
        cron: input.cron,
        task: input.task,
        enabled: true,
      };
      return deps.create(input.instanceId, agentRef, spec);
    },

    async createHeartbeat(input: CreateHeartbeatScheduleInput) {
      const agentRef = await deps.readAgentRef(input.instanceId);
      if (!agentRef) throw new Error(`Instance "${input.instanceId}" not found`);

      const spec = {
        name: input.name,
        version: SPEC_VERSION,
        type: "heartbeat" as const,
        cron: minutesToCron(input.intervalMinutes),
        task: "",
        enabled: true,
      };
      return deps.create(input.instanceId, agentRef, spec);
    },

    delete: deps.delete,
    toggle: deps.toggle,

    config() {
      return { defaultHeartbeatIntervalMinutes: DEFAULT_HEARTBEAT_INTERVAL_MINUTES };
    },
  };
}
