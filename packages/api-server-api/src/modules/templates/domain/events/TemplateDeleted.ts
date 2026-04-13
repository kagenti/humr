import type { DomainEvent } from "../../../../shared/domain/event.js";

export type TemplateDeleted = DomainEvent & {
  type: "TemplateDeleted";
  templateName: string;
};

export const isTemplateDeleted = (event: DomainEvent): event is TemplateDeleted =>
  event.type === "TemplateDeleted";
