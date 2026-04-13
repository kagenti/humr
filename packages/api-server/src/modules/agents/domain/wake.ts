import type { InstanceSpec } from "api-server-api";

export function canWake(spec: InstanceSpec): boolean {
  return spec.desiredState === "hibernated";
}
