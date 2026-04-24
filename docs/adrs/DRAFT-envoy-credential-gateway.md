# DRAFT: Envoy-based credential gateway with ext_authz HITL — drop OneCLI

**Date:** 2026-04-24
**Status:** Proposed
**Owner:** @pilartomas

## Context

ADR-005 established the credential-gateway pattern: the agent never sees tokens; a gateway outside the agent boundary injects credentials into outbound requests, enforces per-service rules, and audits traffic. ADR-010 chose OneCLI as the reference implementation and documented the operational cost: a two-service Deployment running a Rust MITM gateway plus a Node.js dashboard, a hard PostgreSQL dependency, a cert-manager CA volume-mounted into every agent pod, and a Controller-to-REST-API coupling for token provisioning. ADR-010 also flagged the gap that drives this draft: **OneCLI does not yet support human-in-the-loop (HITL) approval flows**, which ADR-005 explicitly calls out as a requirement ("supports human-in-the-loop approval for sensitive operation classes"). ADR-028 further shows the direction we are already pulling OneCLI toward: declarative `hostPattern` / `pathPattern` / `injectionConfig` for generic secrets — mechanics any competent HTTP proxy can express natively.

In parallel, Anthropic's own secure-deployment guidance ([code.claude.com/docs/en/agent-sdk/secure-deployment](https://code.claude.com/docs/en/agent-sdk/secure-deployment)) now names **Envoy with the `credential_injector` filter** as the recommended proxy for agent deployments. Envoy is a CNCF-graduated, production-grade proxy we already run implicitly (Traefik sits in front today, but Envoy is the ecosystem default), with first-class primitives for exactly what OneCLI hand-rolled:

- `envoy.filters.http.credential_injector` — generic-secret and OAuth2 credential sources, custom header injection with prefix templates, overwrite control. Per-route via `typed_per_filter_config` so one listener can cover many hosts/paths with different credentials.
- Secret Discovery Service (SDS) — secrets loaded from Kubernetes Secrets with hot-reload on rotation; no Controller REST poking required.
- `envoy.filters.http.ext_authz` — async HTTP/gRPC call-out per request, configurable timeout, passes request headers (and optionally body bytes) to an external service, which returns allow/deny plus custom denied status/headers/body.

`ext_authz` is the primitive that unlocks HITL. The auth service can hold the request while it notifies the user (Slack, UI) and waits for a decision, or — more robustly — return a structured "pending approval" denial that the agent surfaces and retries against a polling endpoint. Either shape lives in a small HTTP service we already know how to write; it does not require forking OneCLI or waiting on its roadmap.

The question this ADR answers: **can we replace OneCLI with Envoy + a small HITL ext_authz service, and is it worth doing?**

## Decision

**Yes on feasibility. Replace OneCLI with an Envoy-based credential gateway. HITL is handled by an ext_authz service owned by the API Server.**

### Topology

One Envoy Deployment (per namespace) fronting all agent egress. Agents reach Envoy via `HTTP_PROXY` / `HTTPS_PROXY` + a platform CA trusted through `SSL_CERT_FILE` (same injection point as OneCLI — ADR-010's pattern carries over unchanged). Egress flow per request:

```
agent → Envoy (TLS-terminate with platform CA)
      → ext_authz filter  → HITL service (API Server)
      → credential_injector filter (SDS-loaded secret)
      → dynamic_forward_proxy → upstream service
```

### Credential injection

Envoy route table matches on `host` + `:path` prefix (ADR-028's `hostPattern` / `pathPattern`). Per-route `typed_per_filter_config` selects a `credential_injector` config with `header_name` and `header_prefix` (ADR-028's `injectionConfig`). Secrets come from Kubernetes Secrets via SDS — one `Secret` per credential, labeled by instance. No PostgreSQL.

The `api-server` translates the existing ConfigMap/Secret model into Envoy xDS (LDS/RDS/SDS) either by writing an Envoy bootstrap + reloading, or by running a tiny xDS server. The former is simpler and fits our ConfigMap-reconcile loop; the latter scales better once we have many instances.

### Human in the loop

An `ext_authz` HTTP service lives in the API Server. Sensitive request classes (declared per-secret via a new `requiresApproval` flag, or per-route rule) hit this service, which:

1. Persists a pending-decision record keyed by `(instance, request fingerprint)`.
2. Notifies the user via the existing UI/Slack channels (ADR-018, ADR-020).
3. Returns **HTTP 202 + structured JSON** as a denied response (ext_authz supports custom denied status + body). The agent sees a deterministic error shape it can surface in-session.
4. The human approves in the UI; the next retry from the agent matches the stored decision and is allowed through.

Rationale for retry-based HITL over long-held requests: Envoy `ext_authz` timeouts in the minutes range are possible but fragile (timeouts, retries, sampling-API interaction). A stored-decision pattern is stateless from Envoy's side, survives Envoy restarts, and composes cleanly with the ACP session (the "please approve" prompt becomes a normal session event).

### Scope

This ADR replaces ADR-010 (OneCLI deployment) and the OneCLI implementation choice in ADR-005. ADR-005's gateway *pattern* is preserved verbatim. ADR-028's declarative injection model carries over directly onto Envoy's native capabilities. ADR-015's Keycloak token-exchange flow is the one piece that OneCLI's fork did for us — it moves into either the ext_authz service or a dedicated OAuth2 credential-source plugin (Envoy's OAuth2 credential injector is a starting point but does not speak token exchange; this is net-new work).

## Alternatives Considered

**Keep OneCLI; wait for upstream HITL.** ADR-010's stated fallback. Rejected now: ADR-015 already required a fork for Keycloak token exchange, ADR-028 is already pushing injection config into OneCLI's schema, and there is no public commitment on HITL timing. We are paying integration cost on a dependency that is becoming more of a fork per quarter.

**Fork OneCLI to add HITL.** Technically feasible — the MITM plumbing is already there. Rejected: compounds the ADR-015 fork divergence and leaves us owning a Rust codebase we otherwise would not. The HITL decision logic is a small HTTP service; putting it behind a language boundary and a PostgreSQL schema inside OneCLI is the wrong shape.

**Build credential injection from scratch (no Envoy).** ADR-010 considered and rejected this because MITM + credential plumbing from zero is significant work. Envoy changes that calculus: the MITM + injection is already a production-grade filter, and we are not writing proxy code — we are writing config and a small ext_authz service.

**Use ANTHROPIC_BASE_URL / HTTP_PROXY without TLS interception.** The secure-deployment doc notes that `ANTHROPIC_BASE_URL` lets a proxy inspect plaintext sampling traffic without MITM, and that `HTTP_PROXY` alone (without a trusted CA) only gives the proxy opaque CONNECT tunnels. Rejected as the general solution: we need credential injection for arbitrary upstream services (GitHub, Slack, internal gateways per ADR-028), not only the Claude API. However, this *is* the right shape for sampling-only deployments and the Envoy config can degrade to it cleanly.

**Sidecar per agent pod instead of one Envoy per namespace.** Stronger isolation — a compromised Envoy config blast-radius is one pod instead of the namespace. Rejected for the first cut: doubles the data plane, complicates xDS, and the gateway already sits outside the agent's trust boundary. Revisit if multi-tenant threat modeling demands it.

## Consequences

- **Operational simplification.** One component (Envoy) replaces three (OneCLI gateway, OneCLI dashboard, PostgreSQL). Deployment surface shrinks; no database to back up. cert-manager stays — the CA distribution pattern from ADR-010 is unchanged.
- **HITL is a first-class capability.** ADR-005's stated goal is reachable without vendor roadmap dependency. Unblocks sensitive-class policy work (destructive git operations, Cloudflare project deletion, etc.) that ADR-005 uses as motivating examples.
- **xDS glue is net-new work.** The Controller/API-Server must translate ConfigMap/Secret state into Envoy config. Two paths: bootstrap-file regeneration (simple, disruptive on reload) or a minimal xDS server (complex, zero-downtime). Prototype with the former.
- **Keycloak token-exchange (ADR-015) loses its OneCLI-fork home.** Needs reimplementation as either an ext_authz plugin or a custom Envoy credential-source. Estimate: same order of magnitude as the current fork maintenance, but in our own language (Go or TypeScript) and repo.
- **Dashboard capability is lost temporarily.** OneCLI's web dashboard is visible to users; Envoy has no equivalent. Audit/inspection moves into our own UI, fed by Envoy access logs. Net reduction of UI surface area that's not ours; net increase in UI we need to build.
- **Migration cost.** Every agent template and every integration test that assumes OneCLI (pod env, CA mount, REST provisioning) changes shape. ADR-010's PostgreSQL stateful set is deleted; ADR-028's JSON columns become Envoy route-config fields. Non-trivial but bounded — the agent-pod surface (`SSL_CERT_FILE`, `HTTP_PROXY`) is stable.
- **Upstream investment.** Bugs and missing features (e.g. header-prefix templates — tracked in [envoyproxy/envoy#37001](https://github.com/envoyproxy/envoy/issues/37001)) become upstream contributions rather than forks of a less-active project.
