# DRAFT: Unified HITL UX — live-consumer model, no durable approval state

**Date:** 2026-04-27
**Status:** Proposed
**Owner:** @jezekra1

## Context

[`DRAFT-envoy-credential-gateway`](DRAFT-envoy-credential-gateway.md) introduces an Envoy `ext_authz` HITL gate for credential-injected egress and commits to a stored-decision-retry durability shape. Independently, the platform already supports ACP-native permission requests: the harness emits `session/request_permission`, the wrapper at [`agent-runtime`](../../packages/agent-runtime/src/modules/acp/services/acp-runtime.ts) parks them in `pendingFromAgent`, fans out to engaged ACP clients ([acp-runtime.ts:580](../../packages/agent-runtime/src/modules/acp/services/acp-runtime.ts#L580)), and resolves on response.

The two gates protect different threats and are not substitutable. ACP-permission gates run before tool execution and see the *tool invocation*; ext_authz gates run on outbound HTTP and see the *resolved upstream + credential*. Either layer pre-empting the other would require data the other layer fundamentally lacks. Both gates remain.

If both ship with their own user surface, the user gets two parallel approval systems in the UI: ACP permission dialogs from the harness, and a separate ext_authz-driven egress prompt. Same user, same shape of decision, two unrelated UI components and two notification channels. That's the user-visible problem this ADR addresses.

A second constraint sits underneath: **the API Server must be horizontally scalable.** [ADR-007](007-acp-relay.md) names it a per-connection relay bottleneck for ACP traffic. Adding HITL coordinator state that's pinned to a specific replica — long-lived blocking promises across user think-time — would compound the problem: a 30-minute wait pins a replica for 30 minutes, and a replica restart drops the verdict mid-flight. Whatever this ADR commits to has to work with multiple stateless replicas behind a load balancer.

### What HITL actually looks like in this codebase today

Reading the current code surfaces a useful constraint. Permission prompts only surface to a user when there's a live UI ACP relay attached. Every other path — Slack channel, Telegram channel, scheduled triggers, harness-API-server probes — drives the agent through [`acp-client.ts`](../../packages/api-server/src/core/acp-client.ts), which implements `requestPermission` as auto-select-first-option ([acp-client.ts:72-73](../../packages/api-server/src/core/acp-client.ts#L72-L73)):

```ts
async requestPermission(params: any) {
  return { outcome: { outcome: "selected" as const, optionId: params.options[0].optionId } };
},
```

`params.options[0]` is `allow_always` for the standard Claude Code permission set ([acp-agent.js:756-762](../../node_modules/.pnpm/@agentclientprotocol+claude-agent-acp@0.24.2/node_modules/@agentclientprotocol/claude-agent-acp/dist/acp-agent.js#L756-L762)) — so callers of `createAcpClient` not only auto-approve but also tell the harness to remember the approval permanently for the rest of the session. The current platform contract is effectively:

- **Live UI attached** → user sees and answers permission prompts.
- **Slack / Telegram / scheduler / harness-API** → all permissions bypassed, harness records `allow_always`.

So today's *actual* HITL is "is a UI session live?" — nothing else. The platform has no async-approval, no inbox, no Slack-with-prompt-buttons. The parent ADR's stored-decision-retry mechanism is designed to extend HITL to non-interactive contexts, but that capability does not exist today and has not been demanded by the use cases that actually run on the platform.

## Decision

**ext_authz HITL approvals are emitted as ACP `session/request_permission` frames through the wrapper, so the user-visible primitive is exactly one: an ACP permission prompt. All HITL state lives wrapper-local in `pendingFromAgent`. A live consumer must exist for any approval to happen — there is no durable approval store, no async inbox, no DB persistence.**

### Architectural shape

Three layers, each with a clear ownership boundary:

| Layer | Holds | Replication |
|---|---|---|
| **Wrapper** (per-agent-pod) | `pendingFromAgent` (in-memory, today's behavior) is the single source of truth for both ACP-native and synthesized ext_authz entries. | Per-pod; never replicated. |
| **Consumers** (UI ACP relay, Slack adapter, Telegram adapter, …) | Each connects to the wrapper as an ACP client, receives permission requests via fan-out, returns ACP responses. | Per-channel-instance; one or more may be live concurrently. |
| **API Server** (N replicas) | No HITL state. Hosts adapters and stateless HTTP endpoints. ext_authz HITL endpoint is a thin stateless query against the wrapper. | Stateless; HPA-friendly. |

The unification primitive is `session/request_permission` itself — an existing, well-understood ACP message. ext_authz approvals are emitted in the same shape as harness-originated ones, fan out through the same wrapper code path, and are resolved through the same response handling.

### Live-consumer model

Each delivery channel is an ACP client connected to the wrapper:

- **UI ACP relay** is already this. UI WS → API Server → wrapper WS, JSON-RPC frames flow both ways including `requestPermission`.
- **Slack adapter** today uses [`acp-client.ts`](../../packages/api-server/src/core/acp-client.ts) and auto-approves. Under this ADR, two modes:
  - `auto-approve` (today's default) — preserves existing platform behavior for users who don't want to be interrupted.
  - `interactive` — adapter receives the `requestPermission`, surfaces it as a Slack DM with `[Approve] [Deny]` buttons, returns the user's response as the ACP response. The Slack adapter is itself a live process subscribed to the wrapper; the user clicking a button is just a roundtrip *through* that already-live channel.
- **Telegram adapter, future channels** — same pattern, same configuration choice.

When the wrapper fans out a `requestPermission`, every connected consumer for that session receives it. The first verdict wins; late responses from other consumers are silently dropped (existing wrapper behavior, [acp-runtime.ts:727-728](../../packages/agent-runtime/src/modules/acp/services/acp-runtime.ts#L727-L728)). If no consumer is connected, the entry sits in `pendingFromAgent` until the orphan TTL fires (default 10 min) and the harness gets a denial — also today's behavior.

"Live session required" is not a new restriction; it's the platform's *current* contract made explicit and applied uniformly to ext_authz too.

### ext_authz mechanics — stateless against the wrapper

The API Server's HITL endpoint is a thin query against the wrapper, no DB involved:

```
ext_authz call from Envoy (any API Server replica)
  │
  ├─ POST wrapper /internal/external-permission/check { fingerprint }
  │     ├─ wrapper has no entry         → wrapper synthesizes requestPermission, fans out, returns "pending"
  │     ├─ wrapper has pending entry    → returns "pending"
  │     └─ wrapper has resolved verdict → returns "allow" / "deny"
  │
  └─ replica returns to Envoy:
       pending  → 202 + Retry-After (agent retries)
       allow    → ALLOW (Envoy forwards the request)
       deny     → DENY (Envoy fails the request)
```

The wrapper is the rendezvous. Each ext_authz call is a stateless query; multiple replicas can serve the same instance's ext_authz traffic interchangeably because they all hit the same wrapper. Any agent retry resolves against the wrapper's now-up-to-date local state. There is no replica-affine state, no DB write, no cross-replica coordination.

Resolution lifecycle for synthesized entries:

1. ext_authz creates entry in wrapper via `postExternalPermission` (or implicitly via the `check` call's first invocation).
2. Wrapper synthesizes ACP `requestPermission`, fans out to live consumers.
3. Some consumer's user responds; ACP response flows back to wrapper; wrapper records the verdict in its local map (replacing the pending placeholder with `resolved + verdict`).
4. Next ext_authz `check` call returns the verdict.
5. Wrapper TTLs resolved entries after a short window (~30s) so retries within that window match; later retries get `unknown` and trigger a fresh prompt.
6. Pending entries TTL out via the existing orphan timer; orphan-TTL on a synthesized entry resolves it as `denied` for the next `check`.

### Flow

```
ACP-native gate                        Egress gate (ext_authz)
═══════════════                        ═══════════════════════

Harness                                Agent egress
  │                                      │
  │ requestPermission                    │ HTTP via HTTP_PROXY=Envoy
  ▼                                      ▼
                                       Envoy ext_authz
                                         │
                                         │ gRPC check
                                         ▼
                                       ┌─────────────────────────┐
                                       │ API Server (any replica)│
                                       │ — stateless query       │
                                       └────────────┬────────────┘
                                                    │ /internal/check
                                                    │ + maybe synth
                                                    ▼
  │                                                 │
  └─────────────────────┬───────────────────────────┘
                        ▼
              ┌─────────────────────────────────┐
              │  Wrapper: pendingFromAgent      │
              │  (per-pod, in-memory,           │
              │   THE source of truth)          │
              └────────────────┬────────────────┘
                               │ fan-out to connected ACP consumers
                               │
       ┌───────────────────────┼───────────────────────┐
       ▼                       ▼                       ▼
  UI ACP relay         Slack adapter           Telegram / future /
  (user dialog)        (DM buttons OR          inbox / mobile
                        auto-approve)
       │                       │                       │
       │ user responds via ANY connected consumer
       └───────────────────────┴───────────────────────┘
                               │
                               ▼
                  Wrapper: handleClientMessage
                  matches by JSON-RPC id
                               │
                  ┌────────────┴────────────┐
                  ▼                         ▼
            ACP-native:             Egress (synthesized):
            agent.send(response)    record verdict in
            harness unblocks        local map; next
                                    ext_authz check
                                    returns ALLOW/DENY
```

The "correct producer" question: for ACP-native, the producer is co-located with the wrapper; for ext_authz, the producer is whichever Envoy retry happens next, served by any replica querying the same wrapper. No producer routing problem.

### Scope — what this ADR explicitly does *not* do

- **No durable approval store.** Wrapper-local is the only state. Pod restart loses pending entries; consistent with today's ACP behavior.
- **No async/offline approval inbox.** A live consumer must be connected to deliver and respond to a prompt. Approval-while-offline is not supported.
- **No fingerprint-based pre-approval beyond the wrapper's short resolved-cache window.** The harness's own permission model (`allow_always`, `addRules`) handles "remember this decision" at the harness level; we do not duplicate it at the wrapper.
- **No new server-side persistence.** The platform DB (ADR-017) is not extended for this. No new schema.
- **Does not extend HITL to non-interactive contexts** (scheduled jobs running while user is offline, fork Jobs without an attached parent session). Those continue today's de facto behavior — auto-approve via `acp-client.ts` for whichever adapter drives them, with `interactive` as an opt-in per-adapter config when a user is reachable on that channel.

The scope is **UI/UX unification + stateless API Server**. Each gate keeps its own correctness story; this ADR adds no new durability story.

### Implication for the parent ADR

The parent ADR (`DRAFT-envoy-credential-gateway`) commits to a stored-decision-retry durability shape for ext_authz HITL. Under this ADR's wrapper-local-only model, that durability is unused — agent retries resolve against the wrapper's in-memory state, not a durable store. The parent ADR can simplify its HITL design accordingly: drop the persisted-pending-decision table, simplify the ext_authz endpoint to "query the wrapper, return ALLOW/DENY/202." This is recommended but is the parent ADR's call. If the parent retains stored-decision-retry as a future-facing capability, this ADR's contract is unaffected — the wrapper-local model is correct in either case.

## Alternatives Considered

**Durable approval store with multi-class entries.** Persist both ACP-native and ext_authz pending entries to a DB-backed table, expose them via a connection-independent inbox, support approve-while-offline. Rejected as overengineering: the platform has zero current use cases that require offline approval. Slack/Telegram/scheduled flows currently auto-approve entirely. Building durability for capabilities nobody is asking for would land complexity (DB schema, housekeeping, replica coordination, TTL logic, multi-source-of-truth reconciliation between wrapper memory and DB) without proportional benefit. The wrapper-local design is forward-compatible: a durable store can be added as a strict additive layer later if a real use case emerges.

**Replica-affine in-memory state (API Server holds the verdict-promise).** The natural-looking shape: ext_authz call blocks on `await postExternalPermission(...)`. Rejected because it pins a replica per pending decision, fails on replica restart, and conflicts with the platform's stateless API Server requirement.

**Two parallel approval UIs.** The default trajectory if the credential-gateway ADR ships without UX unification. Rejected — same user faces same shape of decision through two different surfaces.

**Wrapper as outbound HTTP proxy in front of Envoy.** Make agent-runtime the agent's `HTTP_PROXY` target and intercept ext_authz 202s. Rejected — meaningful scope creep with no benefit over the synthesized-permission approach.

**Fingerprint-based unified pre-approval store.** Mirror both kinds into a durable store and auto-resolve future requests by fingerprint. Rejected — duplicates the harness's own permission model for the ACP case (introducing two competing "have I already approved this?" memories), and reintroduces the durable store this ADR is trying to avoid.

## Consequences

- **One approval primitive in the UI**, one rendering component. ACP `session/request_permission` is what the user sees, regardless of which gate fired.
- **API Server is genuinely stateless for HITL.** No replica-affine state, no DB writes, no in-memory promises across user think-time. HPA-friendly, restart-tolerant; the only HITL-related thing in API Server memory is the open ACP relay WS to the wrapper, which already exists per ADR-007.
- **Slack / Telegram / future channels become first-class HITL consumers.** Each can run in `auto-approve` (today's default, preserves existing behavior) or `interactive` mode (delivers prompts as DMs/buttons, returns user response). Net new capability for users who want it; zero regression for users who don't.
- **Wrapper additions are minimal.** A `kind` discriminator on `pendingFromAgent` entries, an in-cluster HTTP endpoint for ext_authz `check` queries, an ID-namespace scheme so synthesized JSON-RPC IDs don't collide with harness-allocated ones, and a short resolved-cache window so agent retries within ~30s match. ~150 lines.
- **Hibernated agents:** ACP-native dies with the turn (same as today); ext_authz HITL has no durable answer either — the agent's egress request gets `denied` if no live consumer responded before the wrapper's orphan TTL. For scheduled jobs, this matches the current pattern: agent fails-closed, next scheduled tick retries from scratch.
- **Pod restart behavior:** wrapper-local entries are lost; agent retries trigger fresh prompts. Acceptable because ACP-native has the same property today, and the platform's durability for completed work lives elsewhere (session log per ADR-026, PVC per ADR-027).
- **Pending capabilities not delivered, with names:**
  - "Approve later, agent retries when I'm back" — not supported. Use a live channel (UI / interactive Slack) when the agent runs.
  - "Inbox of all pending approvals across instances" — not supported. Out of scope.
  - These can be added later as a strict additive durable layer; the wrapper-local model does not preclude them.
- **Parent ADR is implied to simplify** (drop stored-decision-retry persistence). Captured as a note on PR #313; parent owners decide whether to accept the simplification or keep the future-facing durability hook in place.
- **Internal endpoint authentication.** ext_authz `check` calls from API Server replicas to the wrapper need pod-identity auth (mTLS or SA-token-based, consistent with ADR-022's harness-API surface).

## Related ADRs

- [`DRAFT-envoy-credential-gateway`](DRAFT-envoy-credential-gateway.md) — establishes the ext_authz HITL gate; this ADR builds the unified UX on top and recommends a simplification of the parent's durability shape.
- [ADR-007 — ACP traffic always proxied through the API Server](007-acp-relay.md) — wrapper as canonical relay; this ADR adds HITL UX-hub responsibility.
- [ADR-018 — Slack integration](018-slack-integration.md) — the Slack adapter that becomes a first-class HITL consumer.
- [ADR-022 — Harness API server](022-harness-api-server.md) — pattern for in-cluster authenticated HTTP between API Server and pods.
- [ADR-027 — Slack per-turn user impersonation](027-slack-user-impersonation.md) — fork-Job pods use the same wrapper integration; the parent instance's wrapper handles the synthesized permission for the fork's egress.
