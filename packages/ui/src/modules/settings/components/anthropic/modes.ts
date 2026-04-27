import {
  ANTHROPIC_API_KEY_ENV_MAPPING,
  ANTHROPIC_OAUTH_ENV_MAPPING,
  type EnvMapping,
} from "../../../../types.js";

/** Ordered Mode keys — single source of truth for the toggle's left→right
 *  order, the Zod enum, and Object.keys-style iteration without a cast. */
export const MODE_KEYS = ["oauth", "api-key"] as const;
export type Mode = (typeof MODE_KEYS)[number];

export const MODES = {
  oauth: {
    label: "OAuth Token",
    placeholder: "sk-ant-oat-…",
    prefix: "sk-ant-oat-",
    mapping: ANTHROPIC_OAUTH_ENV_MAPPING,
  },
  "api-key": {
    label: "API Key",
    placeholder: "sk-ant-api-…",
    prefix: "sk-ant-api-",
    mapping: ANTHROPIC_API_KEY_ENV_MAPPING,
  },
} as const satisfies Record<
  Mode,
  {
    label: string;
    placeholder: string;
    prefix: string;
    mapping: EnvMapping;
  }
>;

export function detectMode(envName?: string): Mode {
  return envName === ANTHROPIC_API_KEY_ENV_MAPPING.envName ? "api-key" : "oauth";
}

// `claude setup-token` output often gets a newline inserted mid-string when
// copied from a terminal, so strip all whitespace rather than just trimming
// the ends.
export function stripWhitespace(value: string): string {
  return value.replace(/\s+/g, "");
}
