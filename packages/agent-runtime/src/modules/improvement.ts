import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ImprovementService, ImprovementLast } from "agent-runtime-api";

const IMPROVEMENT_LOCK = ".humr-improvement-lock";
const IMPROVEMENT_LAST = ".humr-improvement-last.json";

export function createImprovementService(workingDir: string): ImprovementService {
  return {
    getStatus: () => {
      const running = existsSync(join(workingDir, IMPROVEMENT_LOCK));
      let last: ImprovementLast | null = null;
      const lastPath = join(workingDir, IMPROVEMENT_LAST);
      if (existsSync(lastPath)) {
        try {
          last = JSON.parse(readFileSync(lastPath, "utf8")) as ImprovementLast;
        } catch {
          last = null;
        }
      }
      return { running, last };
    },
  };
}
