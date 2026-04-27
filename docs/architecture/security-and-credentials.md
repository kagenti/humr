# Security and credentials

Last verified: 2026-04-27

## Motivated by

- [ADR-005 — Gateway pattern for credentials](../adrs/005-credential-gateway.md) — the agent never sees a real upstream token; a gateway injects them on the wire
- [ADR-010 — OneCLI deployment](../adrs/010-onecli-deployment.md) — OneCLI is the credential gateway; runs as a single Deployment with two Services, MITMs agent traffic with a cluster-issued CA
- [ADR-015 — Multi-user authentication via Keycloak + OneCLI fork with token exchange](../adrs/015-multi-user-auth.md) — Keycloak is the IdP; api-server exchanges user JWTs for OneCLI-scoped tokens (RFC 8693); resources are owner-labelled
- [ADR-024 — Connector-declared envs and per-agent overrides](../adrs/024-connector-declared-envs.md) — env composition at pod start; the credential owner declares the env names, not the platform
- [ADR-028 — Configurable injection on generic secrets](../adrs/028-generic-secret-injection-config.md) — generic secrets carry their own host/path/header injection rules

## Overview

Three rules carry the security model:

1. **Agents never hold upstream credentials.** The only token an agent pod has is a delegated **OneCLI access token** scoped to the user and the instance. Real upstream tokens (GitHub, Anthropic, Slack, internal gateways) live inside OneCLI and are injected into outbound traffic on the wire.
2. **Identity flows from Keycloak through token exchange.** Browser users authenticate against Keycloak; the api-server exchanges the user's JWT (RFC 8693) for a OneCLI-scoped token before calling OneCLI on the user's behalf. OneCLI enforces per-user scoping itself — it does not trust the api-server's word for who the caller is.
3. **The trust line is the agent pod's network egress.** Everything outside the pod is the platform; everything inside the pod is least-privileged. NetworkPolicy keeps the pod off the K8s API, off OneCLI's admin port, and off any host without an explicit grant. The MITM gateway then enforces what each grant actually permits on the wire.

Workspace contents are explicitly outside the trust boundary — see the security note on [persistence](persistence.md).

## Diagram

```mermaid
flowchart LR
  browser[browser]

  subgraph platform[Platform plane]
    api-server[api-server]
    controller[controller]
    keycloak[Keycloak]
  end

  subgraph credplane[Credential plane]
    onecli-api[OneCLI<br/>API + dashboard]
    onecli-gw[OneCLI<br/>MITM gateway]
  end

  subgraph agentpod[Agent pod - least privileged]
    agent-runtime[agent-runtime]
  end

  external[external services<br/>GitHub / Anthropic / Slack / ...]

  browser -->|OIDC| keycloak
  browser -->|user JWT| api-server

  api-server -->|RFC 8693<br/>token exchange| keycloak
  api-server -->|exchanged token| onecli-api
  controller -->|service account| onecli-api

  controller -->|provisions per-agent<br/>OneCLI access token| agentpod
  agent-runtime -->|access token + CA trust| onecli-gw
  onecli-gw -->|injected credentials| external

  agent-runtime -. blocked by NetworkPolicy .-> onecli-api
```

## Identity

**Keycloak** is the only identity authority. It runs in-cluster as a Helm subchart and is the OIDC provider for every authenticated surface. The user agent flow:

1. Browser authenticates against Keycloak and obtains a JWT with audience `humr-api`.
2. UI sends the JWT to the api-server on every tRPC and ACP call. The api-server validates it against Keycloak's JWKS.
3. When the api-server needs to call OneCLI on the user's behalf, it performs an **RFC 8693 token exchange** at Keycloak's token endpoint to obtain a token with audience `onecli` for the same `sub`. OneCLI validates the exchanged token itself — it scopes every read and write to the `sub` claim and does not trust the calling api-server to assert who the user is.

The api-server caches exchanged tokens to avoid a Keycloak round-trip on every request; cache lifetime is bounded by the exchanged token's expiry.

OneCLI's own dashboard is not exposed to users. Credential management is a tRPC surface on the api-server, which proxies to OneCLI's API with the exchanged token. This keeps OneCLI an implementation detail and lets the api-server own the OAuth callback dance for external services like GitHub and Google.

## Resource ownership

Multi-tenancy is **soft** — a single Kubernetes namespace, with a `humr.ai/owner` label on every owned resource carrying the authenticated user's `sub`. The api-server is the sole writer of `spec.yaml` and stamps the label on create; every list and get filters by it. There is no namespace-per-user.

| Resource | Ownership |
|---|---|
| `agent-instance` ConfigMap, owned StatefulSet/Service/NetworkPolicy/Secret | Per-user (`humr.ai/owner`) |
| `agent-schedule` ConfigMap | Per-user |
| `agent-fork` ConfigMap | Per-user (forker, not the parent's owner) |
| `agent` ConfigMap (template) | Shared, no owner label |
| Channel bindings, identity links, allow-list rows in Postgres | Per-user, by `sub` |
| Credentials, app connections, policy rules in OneCLI | Per-user, scoped by `sub` claim on the exchanged token |

Templates are deliberately team-level: they describe what an agent image *can* do, not who runs it.

The auth allow-list is a separate gate. Keycloak issues tokens to anyone in the configured realm; the api-server enforces a per-deployment allow-list of `sub`s on its public port and rejects users who are not on it. Postgres holds the list — see [persistence](persistence.md).

## Identity linking

A platform user is one Keycloak `sub`. A channel user (Slack `U…`, Telegram chat id) is a separate identity issued by an external system. Bridging the two is what makes a Slack mention from `U05ABC` resolve to a specific Humr user with their own credentials and resources.

Identity links live in Postgres, owned by the api-server. Each link binds a channel-typed external id (`{channel: "slack", workspaceId, userId}`) to a Humr `sub`. The link is established interactively — the channel adapter prompts the user, the user authenticates via Keycloak in a browser, and the resulting `sub` is bound to the channel id under the user's confirmation. After that, every channel-driven prompt for that channel id runs as that Humr user: same allow-list check, same OneCLI scoping, same `humr.ai/owner` filtering on resources.

A user who has not linked their channel identity gets no platform access from that channel. The channel adapter is not a privileged identity — it carries the channel-side id forward, the api-server resolves it against the link table, and a missing link is a hard reject. Channel-routing details (which thread maps to which session, how outbound replies are addressed) live on [channels](channels.md).

## Credential plane

OneCLI is the platform's credential gateway ([ADR-005](../adrs/005-credential-gateway.md), [ADR-010](../adrs/010-onecli-deployment.md)). It runs as one Deployment with two Services on the same pod: a **gateway port** that agent pods proxy through, and an **admin port** that hosts OneCLI's API and dashboard. Only the api-server and controller can reach the admin port; agent pods cannot. PostgreSQL is OneCLI's internal dependency and is reachable only from the OneCLI pod itself.

### MITM with a cluster-issued CA

cert-manager issues a self-signed ECDSA CA in PKCS8 format. The CA cert is mounted into every agent pod as `SSL_CERT_FILE`. OneCLI's gateway terminates the agent's outbound TLS, inspects the request, optionally injects a credential, and re-establishes TLS to the real upstream. Because the agent trusts the cert-manager CA, the MITM is transparent to the harness — an `https://api.github.com/...` call from the agent goes through OneCLI without code changes.

### What gets injected

Each stored secret carries a host pattern (and optionally a path prefix per [ADR-028](../adrs/028-generic-secret-injection-config.md)) and an injection rule: which header to write and how to format the value. When an agent's outbound request matches a secret it has access to, OneCLI rewrites the named header before forwarding. The agent never sees the plaintext token.

Two secret shapes coexist:

- **Generic secrets.** User-declared `{ hostPattern, pathPattern?, injectionConfig? }`. Default injection is `Authorization: Bearer {value}`; users override `headerName` and `valueFormat` for providers that deviate (`x-api-key`, `RITS_API_KEY`, `Token {value}`, etc.). This is what makes Humr provider-agnostic — adding support for a new internal gateway is a user action, not a platform PR.
- **Anthropic secrets.** Special-cased because the auth shape (OAuth vs API key) and env names are not user-tunable. The tRPC router rejects `hostPattern`, `pathPattern`, or `injectionConfig` on Anthropic secrets.

### App connections

OAuth-style integrations (GitHub, Google, …) live in OneCLI's app registry — a hardcoded list of providers, each declaring the env names it needs ([ADR-024](../adrs/024-connector-declared-envs.md)). The api-server drives the OAuth callback dance and stores the resulting token via OneCLI's API. The provider, not the platform, is the source of truth for env names; the Configure Agent UI populates the agent's editable env list at grant time using the connection's `envMappings` and removes those entries on ungrant when still untouched.

Pod env at start is the composition of platform defaults, connector-declared envs, template envs, agent-level envs, and instance-level envs — last occurrence wins, with `PORT` server-enforced. Editing any of these takes effect on the next pod restart; the StatefulSet rolls automatically when agent envs change.

### Human-in-the-loop

OneCLI does not yet support HITL approval mid-request — the gateway either has a matching grant or it doesn't. ADR-005 calls HITL out as a future requirement; ADR-010 keeps the door open to replacing OneCLI with an in-house gateway if upstream HITL doesn't land. There is no enforcement point at which a user can approve a single outbound call today; granular control is per-secret (host/path/header) at provisioning time, not per-request.

## Per-instance access token and pod identity

For each `agent-instance`, the controller mints a per-agent OneCLI access token and stores it in a per-instance Secret that is mounted into the pod. The token authorizes the gateway to look up secrets and grants attributed to that user and instance — it does not authorize the OneCLI admin API. The Secret is reconciled by the controller, regenerated on instance updates, and removed on instance delete.

Effectively, **the OneCLI access token *is* the pod's identity to the credential plane.** The pod has no service-account credentials to talk to the K8s API, no Keycloak credentials of its own, and no upstream credentials. Every real-world capability the agent has is mediated by the gateway.

## Network boundary

NetworkPolicy is reconciled per instance by the controller and pins what an agent pod is allowed to reach:

- **Allowed:** OneCLI gateway port (egress for upstream calls), api-server harness port (trigger receipt and MCP tool access — see [platform-topology](platform-topology.md)), DNS.
- **Blocked:** OneCLI admin port, Keycloak, K8s API, Postgres, every other pod in the namespace, every internet host that does not match an OneCLI grant.

The gateway is what makes "blocked except for grants" enforceable on the egress side. NetworkPolicy alone would permit traffic to grant-able hosts even without grants; the gateway is the layer that distinguishes "you have a grant for this host" from "this host happens to be reachable."

## Forks

A fork (see [agent-lifecycle § Forks](agent-lifecycle.md#forks)) reconciles to a Kubernetes Job and runs to completion under the **forker's identity**, not the parent instance owner's. The fork's secrets and grants are the forker's; the workspace PVC is shared `ReadWriteMany` with the parent. This is how a foreign user can run a derivative against someone else's workspace without inheriting their credentials — the workspace files are visible, but every outbound call is gated by the forker's OneCLI policy.

Cross-user PVC sharing is intentional and documented on [persistence](persistence.md). The credential boundary stays clean even when the data boundary is permissive: a fork can read parent state but cannot exfiltrate it through any upstream the forker doesn't have a grant for.

## Threat model

What the agent **cannot** do, structurally:

- **Exfiltrate upstream tokens.** No upstream token ever enters the pod. A compromised harness can read `SSL_CERT_FILE` and the OneCLI access token; neither lets it talk to GitHub/Anthropic/Slack outside OneCLI's grants. The OneCLI access token is scoped to that user and instance and is useless on a different pod.
- **Reach the K8s API or impersonate the controller.** No service account, blocked at NetworkPolicy.
- **Pivot to other users.** Per-user scoping in OneCLI is enforced by the exchanged token's `sub` claim; the api-server cannot lie about user identity to OneCLI. K8s resources are owner-labelled and api-server-filtered.
- **Reuse credentials beyond their granted scope.** Secrets are matched by host (and optionally path) at the gateway. A grant for `api.github.com/repos/foo/*` does not let a request to `api.github.com/repos/bar/*` succeed.
- **Persist a backdoor across hibernation through the OS.** Container filesystem outside the persisted mounts is reset on each pod start.

What the agent **can** do, deliberately:

- Read and write its workspace and `$HOME`. The PVC is plain disk to the agent process. Workspace residue is adversarial input on the *next* turn (see [persistence § Security boundary](persistence.md#security-boundary)).
- Make any outbound HTTP call that NetworkPolicy doesn't block — but without a matching OneCLI grant the call goes out without injected credentials and fails at the upstream.
- Spend time and tokens on the user's LLM budget. Cost is not a security boundary.

What an attacker outside the cluster needs in order to act as a user:

- A Keycloak-issued JWT for that user, which requires Keycloak credentials or session, plus the api-server's allow-list entry for that `sub`. Compromising the api-server alone does not let an attacker impersonate users to OneCLI — the exchanged-token check at OneCLI is the second wall.

What is **not** in the threat model:

- Defense against the LLM provider itself reading prompts and outputs. That is a procurement decision (which provider, which contract), not a platform control.
- Sandboxing of code the agent executes inside the workspace. The platform contains blast radius via NetworkPolicy and the credential gateway; it does not prevent a compromised agent from corrupting its own workspace or burning compute.
