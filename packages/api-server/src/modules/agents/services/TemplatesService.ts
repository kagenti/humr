import type { TemplatesService } from "api-server-api";
import type { TemplatesRepository } from "../infrastructure/TemplatesRepository.js";

export function createTemplatesService(deps: {
  repo: TemplatesRepository;
}): TemplatesService {
  return {
    list: () => deps.repo.list(),
    get: (id) => deps.repo.get(id),
  };
}
