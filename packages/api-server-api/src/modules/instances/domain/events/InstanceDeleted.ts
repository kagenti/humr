import type { DomainEvent } from "../../../../shared/domain/event.js";

export type InstanceDeleted = DomainEvent & {
  type: "InstanceDeleted";
  instanceName: string;
};

export const isInstanceDeleted = (event: DomainEvent): event is InstanceDeleted =>
  event.type === "InstanceDeleted";
