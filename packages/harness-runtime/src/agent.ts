import { runAcp } from "@agentclientprotocol/claude-agent-acp";

console.log = console.error;
console.info = console.error;
console.warn = console.error;
console.debug = console.error;

runAcp();
process.stdin.resume();
