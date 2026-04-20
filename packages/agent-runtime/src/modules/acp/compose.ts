import { createChildAgentProcess } from "./infrastructure/create-child-agent-process.js";
import { createAcpRuntime, type AcpRuntime } from "./services/acp-runtime.js";

export interface ComposeAcpOptions {
  command: string[];
  workingDir: string;
  env?: Record<string, string | undefined>;
  log?: (msg: string) => void;
}

export function composeAcp(opts: ComposeAcpOptions): { runtime: AcpRuntime } {
  const runtime = createAcpRuntime({
    spawnAgent: () =>
      createChildAgentProcess({
        command: opts.command,
        workingDir: opts.workingDir,
        env: opts.env,
      }),
    workingDir: opts.workingDir,
    log: opts.log,
  });
  return { runtime };
}
