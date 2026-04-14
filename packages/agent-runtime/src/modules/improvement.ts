import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  ImprovementService,
  ImprovementLast,
  ImprovementSkipped,
} from "agent-runtime-api";

const IMPROVEMENT_LOCK = ".humr-improvement-lock";
const IMPROVEMENT_LAST = ".humr-improvement-last.json";
const IMPROVEMENT_SKIPPED = ".humr-improvement-skipped.json";

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

export function createImprovementService(workingDir: string): ImprovementService {
  return {
    getStatus: () => ({
      running: existsSync(join(workingDir, IMPROVEMENT_LOCK)),
      last: readJson<ImprovementLast>(join(workingDir, IMPROVEMENT_LAST)),
      lastSkipped: readJson<ImprovementSkipped>(join(workingDir, IMPROVEMENT_SKIPPED)),
    }),
  };
}
