# ADR-DRAFT: Replace OneCLI with first-party `credentials-proxy`

**Date:** 2026-04-21
**Status:** Proposed
**Owner:** @pilartomas

**Supersedes:** [ADR-010](010-onecli-deployment.md), [ADR-015](015-multi-user-auth.md) (partially — the token-exchange model it describes still applies, but the fork-of-OneCLI premise goes away)

## Context

[ADR-005](005-credential-gateway.md) committed to the credential-gateway pattern: agents never see real tokens; a MITM proxy injects credentials on outbound requests. [ADR-010](010-onecli-deployment.md) implemented that pattern with OneCLI — an external image (`ghcr.io/kagenti/onecli`) containing a Rust gateway and a Node.js dashboard. That choice carried explicit reservations even at the time ("build in-house" was listed as a "future option if OneCLI's roadmap doesn't deliver HITL").

The premise held for an MVP, but tension has accumulated:

- **Fork maintenance burden.** [ADR-015](015-multi-user-auth.md) required forking OneCLI to add RFC 8693 token exchange and per-user scoping — upstream had no plans for multi-tenant auth. Every OneCLI release now requires a rebase.
- **Dashboard duplication.** OneCLI ships its own web dashboard, which the Humr UI already replicates for parity. Users see two UIs for the same concept; the dashboard has to be auth-wired separately.
- **Opaque security posture.** OneCLI's loopback/SSRF protections live in upstream Rust code and are hard to audit or extend from our side. The existing `NetworkPolicy` [explicitly notes](../../deploy/helm/humr/templates/onecli/networkpolicy.yaml) that it cannot defend against in-pod loopback — that hole is assumed to be plugged upstream, but we can't enforce it.
- **Shared blast radius.** OneCLI runs as a single Deployment serving the whole cluster. A gateway compromise = all agents' credentials exposed.
- **Schema and API surface are bolted together.** OneCLI's `POST /api/agents` doesn't return the access token, so the controller makes three round-trips to provision one agent. `findAgentByIdentifier` does a list-scan. These are minor, but they compound.
- **Encryption model is opaque.** OneCLI uses a single `SECRET_ENCRYPTION_KEY`; rotation requires re-wrapping every row with downtime.

OneCLI solved the hard "write a MITM proxy" problem in 2026, which was the right trade then. With a year of experience it's become the single component that consistently surprises us, and the one we can least inspect or evolve.

## Decision

Replace OneCLI with a first-party TypeScript service in `packages/credentials-proxy`. The service is structured as **two workloads, one package, two container images**, with credential isolation enforced cryptographically rather than only by network policy.

### 1. Two workloads with different trust boundaries

**API (`packages/credentials-proxy/src/api`, image `humr/credentials-proxy-api`)**
Deployment. Control plane. Holds the global KEK, DB R/W credentials, OAuth client secrets, and Keycloak validation keys. Exposes:
- `GET /api/gateway/ca` (public) — serves the MITM CA public cert
- `/api/agents`, `/api/secrets`, `/api/agents/:id/secrets` — Keycloak-JWT gated (audience `credentials-proxy`)
- `/api/oauth/start`, `/api/oauth/callback` — OAuth Authorization Code flow with HMAC-signed stateless `state`

**Gateway (`packages/credentials-proxy/src/gateway`, image `humr/credentials-proxy-gateway`)**
Sidecar injected into every agent pod by the controller. Data plane. Listens on `127.0.0.1:10255` only — localhost co-tenancy is the auth boundary, no per-agent bearer token. Holds the CA cert + key, its agent's DEK (mounted K8s Secret), and read-only DB access. Does not hold the global KEK. Never calls the API — it's autonomous and survives API outages.

Two Dockerfiles (`Dockerfile.api`, `Dockerfile.gateway`), two tsup bundles from one source tree. Shared modules (`crypto/`, `gateway/ssrf.ts`) compile into both; each image ships only the closure reachable from its entrypoint.

### 2. Sidecar topology

The gateway runs as **one sidecar container per agent pod**, not as a Deployment or DaemonSet.

Consequences:
- Blast radius of a gateway compromise = exactly one agent.
- Gateway only ever loads its own agent's granted secrets (no multi-tenant cache).
- Auth to the gateway is implicit (localhost-only) — no proxy-auth bearer, no token rotation.
- Agent env: `HTTPS_PROXY=http://127.0.0.1:10255` (no `ONECLI_ACCESS_TOKEN` needed).
- The CA fetch init container goes away — CA cert is mounted directly from a ConfigMap the Helm chart provisions.

### 3. Cryptographic scoping (per-agent DEK)

Every agent has its own 32-byte DEK. Every secret has its own per-secret DEK. Wiring:

- `cp_secrets.ciphertext` is the plaintext encrypted with the per-secret DEK (AES-256-GCM).
- `cp_secrets.wrapped_dek` is the per-secret DEK wrapped under the global KEK (API-side only).
- `cp_agents.wrapped_dek` is the per-agent DEK wrapped under the global KEK (for operational recovery).
- `cp_agent_secrets.dek_wrapped_by_agent` is the per-secret DEK re-wrapped under the grantee agent's DEK.

The sidecar holds its agent's raw DEK (mounted K8s Secret) but not the global KEK. A compromised sidecar can decrypt only the grants whose DEKs were wrapped for its agent — structurally unable to reach other agents' credentials even with full DB read access.

KEK is envelope-lite: `SECRET_ENCRYPTION_KEY_V1`, `..._V2`, … loaded as a `{version → key}` map; rows store `kek_version`; lazy re-wrap on read. Rotation does not require downtime.

### 4. SSRF defense at the application layer

The NetworkPolicy cannot block in-pod loopback (kernel bypasses CNI for 127.0.0.0/8). The gateway therefore enforces at CONNECT time:

- IPv4 blocked CIDRs: `127.0.0.0/8`, `0.0.0.0/8`, RFC1918 (10/8, 172.16/12, 192.168/16), CGNAT (`100.64/10`), link-local (`169.254/16` — AWS/GCP/Azure metadata), `192.0.0.0/24` (OCI metadata), multicast, reserved.
- IPv6: `::1`, `::ffff:*` (v4-mapped, normalized to v4 before check), `fc00::/7`, `fe80::/10`, multicast, documentation.
- Explicit IP denylist: `169.254.169.254`, `100.100.100.200`, `192.0.0.192` (defense-in-depth over CIDR checks).
- Hostname denylist (literal + suffix): `localhost`, `metadata.google.internal`, `.internal`, `.local`.
- Port denylist: `53`, `853`, `5353` (prevents DoT-based data exfiltration through CONNECT).
- DNS re-pinning: resolve the hostname inside the proxy process; reject if **any** A/AAAA record is blocked; dial upstream with the resolved IP bound into the `lookup` callback so DNS rebinding between check and connect is defeated.

The CIDR list in Helm values is a single source of truth — same list fed to the NetworkPolicy template and to the gateway's `EXTRA_BLOCKED_CIDRS` env.

### 5. REST wire shape stays close to OneCLI

The controller's `Client` interface (`CreateAgent`, `CreateSecret`, `SetAgentSecrets`, etc.) remains 1:1 compatible except that `CreateAgent` now returns a `dek` field (the new per-agent DEK). The controller stages this into a per-instance K8s Secret the sidecar mounts.

This keeps the migration mechanical: rename `pkg/onecli` → `pkg/credentials`, rename `ONECLI_BASE_URL` → `CREDENTIALS_API_BASE_URL`, flip `HTTPS_PROXY` to localhost, add the sidecar container. No reconciler rewrite.

### 6. Keycloak audience `credentials-proxy`

A new audience rather than aliasing `onecli`. Forces a clean cutover and prevents stale `onecli`-audience tokens from working on the new service during migration. Adds ~10 lines to `realm-configmap.yaml` for `humr-api` and `humr-controller` audience mappings.

### 7. No shared "sentinel" literal

OneCLI matches a magic `humr:sentinel` string in outbound requests to decide whether to swap. In the sidecar model the agent has no source of real credentials, so there's nothing for a marker to defend against. The gateway force-injects based on `hostPattern` + `headerName` only. The controller still stuffs a placeholder value (`humr:managed`) into env vars so agent CLIs don't crash on empty vars, but the value is cosmetic.

## Alternatives Considered

**Keep OneCLI and upstream the missing features.** Rejected. RFC 8693 token exchange was pitched upstream and declined. Each fork rebase burns engineering time. The fork-only situation is already the status quo after ADR-015; this decision just stops trying to reconcile.

**Rewrite in Go (match controller) or Rust (match OneCLI).** Rejected. The rest of the service tier is TypeScript (`api-server`, `agent-runtime`, UI, agent images). Reusing the `jose`, `drizzle`, `hono`, and `@peculiar/x509` ecosystems eliminates duplicated JWT/DB/HTTP code. The controller stays Go; nothing here argues for a third language.

**Build the credentials-proxy as a drop-in replacement including its own dashboard.** Rejected in favor of reusing the Humr UI via new tRPC routes in `api-server-api`. One UI, one Keycloak client for users.

**API and gateway in a single container (original plan).** Rejected after review. The gateway is hit by every agent request and is a natural target; the API holds the KEK and OAuth client secrets. Collapsing their blast radius into one pod was the main concrete issue the design review found.

**Gateway calls the API synchronously on every request (option (1) in the design Q&A).** Rejected. Makes the API a hard dependency for every agent HTTP call; API outage = all agents silently lose egress. The "autonomous sidecar with DB access" option was chosen for availability.

**DaemonSet gateway (one per node).** Rejected. Restores the multi-tenant auth problem (one gateway serves many agents on a node), re-introduces per-agent bearer tokens, and widens blast radius to all agents on that node.

**Standalone gateway Deployment.** Rejected. This is the OneCLI model we're moving away from. Cluster-wide blast radius; largest cache; per-agent auth surface.

**Single global encryption key, per-agent row filter.** Rejected. A compromised sidecar with DB access could issue unfiltered queries and decrypt every secret. Per-agent DEK scoping makes the isolation property structural rather than query-filter-based.

**Keycloak audience alias (`onecli`) shared across old and new services.** Rejected. During migration both services would be deployed; aliased audience means a stolen token works on either. New audience forces a clean boundary.

**TLS-inspecting library off the shelf (`http-mitm-proxy`, `mockttp`).** Rejected. `http-mitm-proxy` has no first-class HTTP/2 upstream support (modern APIs negotiate h2; the library silently downgrades); `mockttp` is test-fixture-shaped and isn't hardened for a forward proxy. Build the CONNECT handler on `node:http2` + `node:tls` directly (~200 lines), use `@peculiar/x509` only for leaf cert minting.

**cert-manager for the MITM CA (as ADR-010 described).** Rejected. The existing ADR-010 text already diverges from reality — OneCLI self-manages its CA today. We standardize on the simpler path: a Helm pre-install,pre-upgrade Job runs openssl once to generate an ECDSA P-256 PKCS8 CA into a K8s Secret (+ a cert-only ConfigMap). No cert-manager dependency for this piece; the CA is long-lived (10-year validity) and rotation is a deliberate operator action.

## Consequences

**Easier:**

- One codebase, one language, one dependency story for the credential plane.
- Auditable SSRF and encryption logic in our repo.
- Per-agent cryptographic isolation — a compromised sidecar cannot see other agents' credentials even with full DB read access.
- No init-container CA fetch — agent pods come up faster and don't block on the gateway web port being reachable.
- Multi-replica API is straightforward (no PVC; CA in a K8s Secret).
- Key rotation without downtime (envelope-lite + lazy re-wrap).
- OAuth flow lives in code we own; adding a new provider is a ~30-line config block.

**Harder / new obligations:**

- We now own a MITM proxy implementation. TLS bugs are ours. HTTP/2 and WebSocket support have to be driven to completion (MVP ships HTTP/1.1 only).
- Every agent pod gets +1 container. At high agent counts, ~128Mi overhead per pod stacks up.
- Rolling the gateway image rolls every agent — there's no way to update the data plane in place.
- The sidecar holds the CA private key. A sidecar compromise can mint valid-looking certs for any host, but they're only trusted inside that one agent pod (the CA is scoped to Humr's agent trust store), so the blast radius is the same single-agent scope as the DEK.
- Each sidecar opens a Postgres connection. 100 agents = 100-200 connections. PgBouncer is an easy future mitigation but not day-one.
- Migration is a cutover: OneCLI and credentials-proxy can coexist during staging, but production deployments switch atomically. A one-shot `migrate-from-onecli` CLI re-encrypts existing secrets.

**Unchanged (and intentionally so):**

- The credential-gateway principle from ADR-005 — agents still don't see real tokens.
- The RFC 8693 multi-user model from ADR-015 — the API is still called with a user-scoped token obtained via token exchange; per-user resource ownership via `owner_sub` stays the same.
- The connector-declared env mapping model from ADR-024 — `metadata.envMappings` on secrets works identically.
- The controller's Go `Client` interface shape.

## References

- [ADR-005](005-credential-gateway.md) — Gateway pattern for credentials
- [ADR-010](010-onecli-deployment.md) — OneCLI deployment (superseded)
- [ADR-015](015-multi-user-auth.md) — Multi-user auth via Keycloak + token exchange
- [ADR-024](024-connector-declared-envs.md) — Connector-declared pod envs
- [Anthropic — Securely deploying AI agents, "The proxy pattern"](https://code.claude.com/docs/en/agent-sdk/secure-deployment#the-proxy-pattern) — confirms the general shape (TLS-terminating proxy outside the agent's boundary, CA in agent's trust store, credential injection at the proxy)
