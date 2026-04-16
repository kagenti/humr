/** K8s label keys and well-known values used across the agents module. */

// ---- Label keys ----
export const LABEL_TYPE = "humr.ai/type";
export const LABEL_TEMPLATE_REF = "humr.ai/template";
export const LABEL_AGENT_REF = "humr.ai/agent";
export const LABEL_INSTANCE_REF = "humr.ai/instance";
export const LABEL_OWNER = "humr.ai/owner";

// ---- Label values for LABEL_TYPE ----
export const TYPE_TEMPLATE = "agent-template";
export const TYPE_AGENT = "agent";
export const TYPE_INSTANCE = "agent-instance";
export const TYPE_SCHEDULE = "agent-schedule";

// ---- ConfigMap data keys ----
export const SPEC_KEY = "spec.yaml";
export const STATUS_KEY = "status.yaml";

// ---- Annotation keys ----
export const LAST_ACTIVITY_KEY = "humr.ai/last-activity";
