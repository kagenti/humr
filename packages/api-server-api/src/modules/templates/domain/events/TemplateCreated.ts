import type { DomainEvent } from "../../../../shared/domain/event.js";

export type TemplateCreated = DomainEvent & {
  type: "TemplateCreated";
  templateName: string;
};

export const isTemplateCreated = (event: DomainEvent): event is TemplateCreated =>
  event.type === "TemplateCreated";
