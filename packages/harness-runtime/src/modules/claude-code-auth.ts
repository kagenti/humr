import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomBytes, createHash } from "node:crypto";
import {
  writeFileSync,
  readFileSync,
  mkdirSync,
  chmodSync,
  existsSync,
} from "node:fs";
import type { ClaudeCodeAuthContext } from "harness-runtime-api";

function base64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

let pendingOAuth: {
  codeVerifier: string;
  state: string;
  clientId: string;
  redirectUri: string;
  tokenUrl: string;
} | null = null;

function extractOAuthParams(): Promise<{
  authorizeUrl: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  tokenUrl: string;
}> {
  return new Promise((resolve, reject) => {
    const proc = spawn("claude", ["auth", "login"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    proc.stdout.on("data", (d) => (out += d));
    proc.stderr.on("data", (d) => (out += d));
    const timer = setTimeout(() => {
      proc.kill();
      tryParse();
    }, 5000);
    proc.on("close", tryParse);
    function tryParse() {
      clearTimeout(timer);
      proc.kill();
      const match = out.match(/https?:\/\/\S+/);
      if (!match) {
        reject(
          new Error("could not extract OAuth URL from claude auth login"),
        );
        return;
      }
      const url = new URL(match[0]);
      const clientId = url.searchParams.get("client_id")!;
      const redirectUri = url.searchParams.get("redirect_uri")!;
      const scope = url.searchParams.get("scope")!;
      const tokenUrl = new URL(
        "/v1/oauth/token",
        redirectUri.startsWith("https://platform.claude.com")
          ? "https://platform.claude.com"
          : url.origin,
      ).toString();
      resolve({
        authorizeUrl: url.origin + url.pathname,
        clientId,
        redirectUri,
        scope,
        tokenUrl,
      });
    }
  });
}

function getCredentialsPath() {
  const configDir =
    process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
  return { configDir, credPath: join(configDir, ".credentials.json") };
}

export function createClaudeCodeAuthContext(): ClaudeCodeAuthContext {
  return {
    getAuthStatus: () =>
      new Promise((resolve) => {
        const proc = spawn("claude", ["auth", "status"], {
          stdio: ["ignore", "pipe", "pipe"],
        });
        let out = "";
        proc.stdout.on("data", (d: Buffer) => (out += d));
        proc.stderr.on("data", (d: Buffer) => (out += d));
        proc.on("close", () => {
          try {
            const status = JSON.parse(out);
            resolve({
              authenticated: status.loggedIn === true,
              ...status,
            });
          } catch {
            resolve({ authenticated: false });
          }
        });
      }),

    startLogin: async () => {
      const params = await extractOAuthParams();
      const codeVerifier = base64url(randomBytes(32));
      const codeChallenge = base64url(
        createHash("sha256").update(codeVerifier).digest(),
      );
      const state = base64url(randomBytes(32));
      pendingOAuth = {
        codeVerifier,
        state,
        clientId: params.clientId,
        redirectUri: params.redirectUri,
        tokenUrl: params.tokenUrl,
      };

      const url = new URL(params.authorizeUrl);
      url.searchParams.set("code", "true");
      url.searchParams.set("client_id", params.clientId);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("redirect_uri", params.redirectUri);
      url.searchParams.set("scope", params.scope);
      url.searchParams.set("code_challenge", codeChallenge);
      url.searchParams.set("code_challenge_method", "S256");
      url.searchParams.set("state", state);

      return { url: url.toString() };
    },

    submitAuthCode: async (rawCode) => {
      if (!pendingOAuth) {
        return { ok: false, error: "no login in progress" };
      }

      const [authorizationCode, codeState] = rawCode.trim().split("#");
      if (!authorizationCode || !codeState) {
        return {
          ok: false,
          error: "invalid code format, expected code#state",
        };
      }

      try {
        const tokenRes = await fetch(pendingOAuth.tokenUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            grant_type: "authorization_code",
            code: authorizationCode,
            redirect_uri: pendingOAuth.redirectUri,
            client_id: pendingOAuth.clientId,
            code_verifier: pendingOAuth.codeVerifier,
            state: codeState,
          }),
        });

        if (!tokenRes.ok) {
          const errText = await tokenRes.text();
          process.stderr.write(
            `[auth/code] token exchange failed: ${tokenRes.status} ${errText}\n`,
          );
          return { ok: false, error: "token exchange failed" };
        }

        const tokens: any = await tokenRes.json();
        const scopes =
          tokens.scope?.split(" ").filter(Boolean) ?? [];

        const { configDir, credPath } = getCredentialsPath();
        if (!existsSync(configDir))
          mkdirSync(configDir, { recursive: true });

        let existing: any = {};
        try {
          existing = JSON.parse(readFileSync(credPath, "utf8"));
        } catch {}

        existing.claudeAiOauth = {
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          expiresAt: Date.now() + tokens.expires_in * 1000,
          scopes,
        };

        writeFileSync(credPath, JSON.stringify(existing, null, 2), "utf8");
        chmodSync(credPath, 0o600);

        pendingOAuth = null;
        process.stderr.write(`[auth/code] tokens saved to ${credPath}\n`);
        return { ok: true };
      } catch (err: any) {
        process.stderr.write(`[auth/code] error: ${err.message}\n`);
        return { ok: false, error: err.message };
      }
    },
  };
}
