import { spawn } from "node:child_process";
import { config } from "./modules/config.js";

console.log = console.error;
console.info = console.error;
console.warn = console.error;
console.debug = console.error;

const child = spawn(config.AGENT_COMMAND, [], {
  env: process.env,
  stdio: "inherit",
});

child.on("error", (err) => {
  process.stderr.write(`[${config.AGENT_COMMAND}] Spawn error: ${err.message}\n`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    if (!child.killed) {
      child.kill(sig);
    }
  });
}
