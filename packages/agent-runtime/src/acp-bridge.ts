import { spawn } from "node:child_process";

export interface AcpSession {
  /** Send a JSON-RPC message to the agent process stdin */
  send(msg: object): void;
  /** Register a handler for NDJSON lines from agent process stdout */
  onMessage(handler: (line: string) => void): void;
  /** Kill the agent child process */
  kill(): void;
  /** Resolves when the child process exits */
  exited: Promise<void>;
}

export function spawnAcpSession(options: {
  agentScript: string;
  workingDir: string;
  isDev: boolean;
}): AcpSession {
  const { agentScript, workingDir, isDev } = options;

  // Strip pnpm-injected npm_config_* vars so npx doesn't emit warnings
  const cleanEnv = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !k.startsWith("npm_")),
  );

  const agentEnv = {
    ...cleanEnv,
    ANTHROPIC_API_KEY: cleanEnv.ANTHROPIC_API_KEY ?? "placeholder",
    CLAUDE_CODE_OAUTH_TOKEN: cleanEnv.CLAUDE_CODE_OAUTH_TOKEN ?? "placeholder",
    CODEX_API_KEY: cleanEnv.CODEX_API_KEY ?? "placeholder",
    OPENAI_API_KEY: cleanEnv.OPENAI_API_KEY ?? "placeholder",
  };

  const child = isDev
    ? spawn("npx", ["tsx", agentScript], {
        stdio: ["pipe", "pipe", "inherit"],
        cwd: workingDir,
        env: agentEnv,
      })
    : spawn("node", [agentScript], {
        stdio: ["pipe", "pipe", "inherit"],
        cwd: workingDir,
        env: agentEnv,
      });

  child.on("error", (err) => {
    process.stderr.write(`[acp-bridge] Spawn error: ${err.message}\n`);
  });

  const handlers: ((line: string) => void)[] = [];

  let buf = "";
  child.stdout!.on("data", (chunk: Buffer) => {
    buf += chunk.toString();
    const lines = buf.split("\n");
    buf = lines.pop()!;
    for (const line of lines) {
      if (line.trim()) {
        for (const handler of handlers) {
          handler(line);
        }
      }
    }
  });

  const exited = new Promise<void>((resolve) => {
    child.on("exit", () => resolve());
  });

  return {
    send(msg: object) {
      if (child.stdin!.writable) {
        child.stdin!.write(JSON.stringify(msg) + "\n");
      }
    },
    onMessage(handler: (line: string) => void) {
      handlers.push(handler);
    },
    kill() {
      child.kill();
    },
    exited,
  };
}
