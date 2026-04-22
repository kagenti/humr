import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

declare const process: { env: Record<string, string | undefined> };

export default function register(pi: ExtensionAPI): void {
	const url = env("RITS_URL")?.replace(/\/+$/, "");
	const model = env("RITS_MODEL");
	if (!url || !model) return;

	const compat: Record<string, unknown> = {
		// vLLM (what RITS runs) doesn't speak these.
		supportsDeveloperRole: false,
		supportsReasoningEffort: false,
		supportsUsageInStreaming: false,
		maxTokensField: "max_tokens",
	};
	const thinkingFormat = env("RITS_THINKING_FORMAT");
	if (thinkingFormat) compat.thinkingFormat = thinkingFormat;

	const provider = {
		baseUrl: /\/v\d+$/.test(url) ? url : `${url}/v1`,
		api: "openai-completions",
		// Auth is injected by OneCLI at the HTTP-proxy layer; the key set here only
		// exists to satisfy pi-acp's per-session auth gate (reads models.json.apiKey).
		apiKey: "injected-by-onecli",
		authHeader: false,
		compat,
		models: [
			{
				id: model,
				name: model,
				input: ["text"],
				reasoning: boolEnv("RITS_REASONING", false),
				contextWindow: intEnv("RITS_CONTEXT_WINDOW", 128000),
				maxTokens: intEnv("RITS_MAX_TOKENS", 16384),
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			},
		],
	};

	pi.registerProvider("rits", provider);

	// pi-acp re-checks auth against ~/.pi/agent/models.json on every session/prompt.
	// Runtime registerProvider() is invisible to that check, so mirror to disk.
	// Upstream: https://github.com/svkozak/pi-acp/issues/15
	const dir = join(homedir(), ".pi", "agent");
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "models.json"), `${JSON.stringify({ providers: { rits: provider } }, null, 2)}\n`);
}

function env(name: string): string | undefined {
	const v = process.env[name]?.trim();
	return v ? v : undefined;
}
function boolEnv(name: string, def: boolean): boolean {
	const v = env(name)?.toLowerCase();
	return v === undefined ? def : v === "true" || v === "1" || v === "yes" || v === "on";
}
function intEnv(name: string, def: number): number {
	const n = Number.parseInt(env(name) ?? "", 10);
	return Number.isFinite(n) && n > 0 ? n : def;
}
