import type { DomainEvent } from "../../../../shared/domain/event.js";

export type InstanceCreated = DomainEvent & {
  type: "InstanceCreated";
  instanceName: string;
  templateName: string;
};

export const isInstanceCreated = (event: DomainEvent): event is InstanceCreated =>
  event.type === "InstanceCreated";
