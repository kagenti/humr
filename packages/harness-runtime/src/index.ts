import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { randomBytes, createHash } from "node:crypto";
import { writeFileSync, readFileSync, mkdirSync, chmodSync, existsSync, watch, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { WebSocketServer } from "ws";

const PORT = Number(process.env.PORT ?? 3000);
const agentScript = join(dirname(fileURLToPath(import.meta.url)), "agent.ts");
const WORKING_DIR = join(dirname(fileURLToPath(import.meta.url)), "../working-dir");

let fileVersion = 0;
try { watch(WORKING_DIR, { recursive: true }, () => { fileVersion++; }); } catch {}

const EXCLUDE = new Set([".git", ".claude", "node_modules", ".DS_Store"]);

function buildTree(dir: string, base = ""): { path: string; type: "file" | "dir" }[] {
  const entries: { path: string; type: "file" | "dir" }[] = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDE.has(ent.name) || ent.name.startsWith(".")) continue;
    const rel = base ? `${base}/${ent.name}` : ent.name;
    if (ent.isDirectory()) {
      entries.push({ path: rel, type: "dir" });
      entries.push(...buildTree(join(dir, ent.name), rel));
    } else {
      entries.push({ path: rel, type: "file" });
    }
  }
  return entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.path.localeCompare(b.path);
  });
}

function safePath(rel: string): string | null {
  const resolved = resolve(WORKING_DIR, rel);
  if (!resolved.startsWith(resolve(WORKING_DIR))) return null;
  return resolved;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

let pendingOAuth: { codeVerifier: string; state: string; clientId: string; redirectUri: string; tokenUrl: string } | null = null;

function extractOAuthParams(): Promise<{ authorizeUrl: string; clientId: string; redirectUri: string; scope: string; tokenUrl: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn("claude", ["auth", "login"], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    proc.stdout.on("data", (d) => (out += d));
    proc.stderr.on("data", (d) => (out += d));
    const timer = setTimeout(() => { proc.kill(); tryParse(); }, 5000);
    proc.on("close", tryParse);
    function tryParse() {
      clearTimeout(timer);
      proc.kill();
      const match = out.match(/https?:\/\/\S+/);
      if (!match) { reject(new Error("could not extract OAuth URL from claude auth login")); return; }
      const url = new URL(match[0]);
      const clientId = url.searchParams.get("client_id")!;
      const redirectUri = url.searchParams.get("redirect_uri")!;
      const scope = url.searchParams.get("scope")!;
      const tokenUrl = new URL("/v1/oauth/token", redirectUri.startsWith("https://platform.claude.com") ? "https://platform.claude.com" : url.origin).toString();
      resolve({ authorizeUrl: url.origin + url.pathname, clientId, redirectUri, scope, tokenUrl });
    }
  });
}

function getCredentialsPath() {
  const configDir = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
  return { configDir, credPath: join(configDir, ".credentials.json") };
}

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS).end();
    return;
  }

  if (req.method === "GET" && req.url === "/api/config") {
    res.writeHead(200, { ...CORS, "Content-Type": "application/json" }).end(JSON.stringify({ cwd: WORKING_DIR }));
    return;
  }

  if (req.method === "GET" && req.url === "/api/auth/status") {
    const proc = spawn("claude", ["auth", "status"], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    proc.stdout.on("data", (d) => (out += d));
    proc.stderr.on("data", (d) => (out += d));
    proc.on("close", () => {
      try {
        const status = JSON.parse(out);
        res.writeHead(200, { ...CORS, "Content-Type": "application/json" }).end(
          JSON.stringify({ authenticated: status.loggedIn === true, ...status }),
        );
      } catch {
        res.writeHead(200, { ...CORS, "Content-Type": "application/json" }).end(
          JSON.stringify({ authenticated: false }),
        );
      }
    });
    return;
  }

  if (req.method === "POST" && req.url === "/api/auth/login") {
    res.writeHead(200, { ...CORS, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
    const send = (obj: object) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
    extractOAuthParams().then((params) => {
      const codeVerifier = base64url(randomBytes(32));
      const codeChallenge = base64url(createHash("sha256").update(codeVerifier).digest());
      const state = base64url(randomBytes(32));
      pendingOAuth = { codeVerifier, state, clientId: params.clientId, redirectUri: params.redirectUri, tokenUrl: params.tokenUrl };

      const url = new URL(params.authorizeUrl);
      url.searchParams.set("code", "true");
      url.searchParams.set("client_id", params.clientId);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("redirect_uri", params.redirectUri);
      url.searchParams.set("scope", params.scope);
      url.searchParams.set("code_challenge", codeChallenge);
      url.searchParams.set("code_challenge_method", "S256");
      url.searchParams.set("state", state);

      send({ type: "login_url", url: url.toString() });
      send({ type: "paste_ready" });
      res.end();
    }).catch((err: any) => {
      send({ type: "login_error", message: err.message });
      res.end();
    });
    return;
  }

  if (req.method === "POST" && req.url === "/api/auth/code") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      if (!pendingOAuth) {
        res.writeHead(400, { ...CORS, "Content-Type": "application/json" }).end(JSON.stringify({ ok: false, error: "no login in progress" }));
        return;
      }

      const { code: rawCode } = JSON.parse(body);
      const [authorizationCode, codeState] = rawCode.trim().split("#");

      if (!authorizationCode || !codeState) {
        res.writeHead(400, { ...CORS, "Content-Type": "application/json" }).end(
          JSON.stringify({ ok: false, error: "invalid code format, expected code#state" }),
        );
        return;
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
          process.stderr.write(`[auth/code] token exchange failed: ${tokenRes.status} ${errText}\n`);
          res.writeHead(400, { ...CORS, "Content-Type": "application/json" }).end(
            JSON.stringify({ ok: false, error: "token exchange failed" }),
          );
          return;
        }

        const tokens: any = await tokenRes.json();
        const scopes = tokens.scope?.split(" ").filter(Boolean) ?? [];

        const { configDir, credPath } = getCredentialsPath();
        if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true });

        let existing: any = {};
        try { existing = JSON.parse(readFileSync(credPath, "utf8")); } catch {}

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
        res.writeHead(200, { ...CORS, "Content-Type": "application/json" }).end(JSON.stringify({ ok: true }));
      } catch (err: any) {
        process.stderr.write(`[auth/code] error: ${err.message}\n`);
        res.writeHead(500, { ...CORS, "Content-Type": "application/json" }).end(
          JSON.stringify({ ok: false, error: err.message }),
        );
      }
    });
    return;
  }

  if (req.method === "GET" && req.url === "/api/files/version") {
    res.writeHead(200, { ...CORS, "Content-Type": "application/json" }).end(JSON.stringify({ version: fileVersion }));
    return;
  }

  if (req.method === "GET" && req.url === "/api/files/tree") {
    const entries = buildTree(WORKING_DIR);
    res.writeHead(200, { ...CORS, "Content-Type": "application/json" }).end(JSON.stringify({ version: fileVersion, entries }));
    return;
  }

  if (req.method === "GET" && req.url?.startsWith("/api/files/read?")) {
    const params = new URL(req.url, "http://localhost").searchParams;
    const filePath = params.get("path");
    if (!filePath) { res.writeHead(400, CORS).end(); return; }
    const abs = safePath(filePath);
    if (!abs) { res.writeHead(403, CORS).end(); return; }
    try {
      const stat = statSync(abs);
      if (!stat.isFile()) { res.writeHead(400, CORS).end(); return; }
      if (stat.size > 1024 * 1024) {
        res.writeHead(200, { ...CORS, "Content-Type": "application/json" }).end(JSON.stringify({ path: filePath, binary: true, version: fileVersion }));
        return;
      }
      const content = readFileSync(abs, "utf8");
      res.writeHead(200, { ...CORS, "Content-Type": "application/json" }).end(JSON.stringify({ path: filePath, content, version: fileVersion }));
    } catch {
      res.writeHead(404, CORS).end();
    }
    return;
  }

  res.writeHead(405).end();
});

const wss = new WebSocketServer({ server, path: "/api/acp" });

wss.on("connection", (ws) => {
  const agent = spawn("npx", ["tsx", agentScript], {
    stdio: ["pipe", "pipe", "inherit"],
    cwd: WORKING_DIR,
  });

  let buf = "";
  agent.stdout!.on("data", (chunk: Buffer) => {
    buf += chunk.toString();
    const lines = buf.split("\n");
    buf = lines.pop()!;
    for (const line of lines) {
      if (line.trim() && ws.readyState === ws.OPEN) {
        ws.send(line);
      }
    }
  });

  ws.on("message", (data: Buffer) => {
    if (agent.stdin!.writable) {
      agent.stdin!.write(data.toString() + "\n");
    }
  });

  ws.on("close", () => agent.kill());
  agent.on("exit", () => {
    if (ws.readyState === ws.OPEN) ws.close();
  });
});

server.listen(PORT, () => process.stderr.write(`ACP over HTTP on http://localhost:${PORT}\n`));
