import type { DomainEvent } from "../../../../shared/domain/event.js";

export type ScheduleCreated = DomainEvent & {
  type: "ScheduleCreated";
  scheduleName: string;
  instanceName: string;
};

export const isScheduleCreated = (event: DomainEvent): event is ScheduleCreated =>
  event.type === "ScheduleCreated";
