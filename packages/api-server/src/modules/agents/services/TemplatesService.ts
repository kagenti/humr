import type { TemplatesService } from "api-server-api";

export function createTemplatesService(deps: {
  list: () => Promise<ReturnType<TemplatesService["list"]> extends Promise<infer T> ? T : never>;
  get: TemplatesService["get"];
}): TemplatesService {
  return {
    list: deps.list,
    get: deps.get,
  };
}
