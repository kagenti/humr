import type { DomainEvent } from "../../../../shared/domain/event.js";

export type ScheduleDeleted = DomainEvent & {
  type: "ScheduleDeleted";
  scheduleName: string;
};

export const isScheduleDeleted = (event: DomainEvent): event is ScheduleDeleted =>
  event.type === "ScheduleDeleted";
