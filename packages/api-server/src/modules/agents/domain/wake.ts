import type { Instance } from "api-server-api";

export function canWake(instance: Instance): boolean {
  return instance.state === "hibernated";
}
