# Multi-User Support — Product Requirements Document

**Date:** 2026-04-09
**Status:** Draft
**Owner:** @tomkis
**ADR:** [DRAFT-multi-user-auth](../adrs/DRAFT-multi-user-auth.md)

## Problem Statement

Humr is currently single-tenant. There is no user identity, no authentication on the API server, no resource ownership, and OneCLI credentials are shared per-template across all instances. Any user with network access can see, modify, and delete every instance, schedule, and credential in the system.

This blocks:

- **Team adoption** — multiple developers cannot use the same Humr cluster without stepping on each other's work.
- **Credential safety** — a user's GitHub token or API key is visible to every instance, not just their own.
- **Audit accountability** — there is no way to attribute actions (instance creation, schedule triggers, credential usage) to a specific person.
- **Production readiness** — no enterprise environment will accept a platform without authentication and access control.

## User Personas

### Platform Administrator

Manages the Humr cluster. Deploys Helm chart, configures identity provider, manages shared templates, monitors system health. Needs visibility into all resources across all users for debugging and capacity planning.

### Developer (Agent Operator)

Primary user. Creates agent instances from templates, runs interactive sessions, configures schedules, manages their own credentials. Should only see their own instances and credentials. May belong to one or more teams.

### Team Lead

Creates and manages shared templates. Reviews agent activity across their team. Does not need admin-level cluster access but needs broader visibility than an individual developer.

## User Stories

### Authentication

| ID | Story | Priority |
|----|-------|----------|
| U-AUTH-1 | As a developer, I can log in to Humr via SSO (OIDC) so I don't need a separate password. | P0 |
| U-AUTH-2 | As a developer, my session persists across browser refreshes so I don't re-authenticate constantly. | P0 |
| U-AUTH-3 | As an admin, I can manage users and roles in the identity provider without modifying Humr code. | P0 |
| U-AUTH-4 | As a developer, I am redirected to the login page when my session expires. | P0 |

### Resource Ownership

| ID | Story | Priority |
|----|-------|----------|
| U-OWN-1 | As a developer, I can only see instances I created. | P0 |
| U-OWN-2 | As a developer, I can only see schedules attached to my instances. | P0 |
| U-OWN-3 | As a developer, I cannot modify or delete another user's instance. | P0 |
| U-OWN-4 | As an admin, I can list and inspect all instances across all users. | P1 |
| U-OWN-5 | As a team lead, I can see instances created by members of my team. | P2 |
| U-OWN-6 | As a developer, templates are shared and visible to all authenticated users. | P0 |

### Credential Isolation

| ID | Story | Priority |
|----|-------|----------|
| U-CRED-1 | As a developer, I can add my own credentials (e.g., GitHub token) and only my instances use them. | P0 |
| U-CRED-2 | As a developer, I cannot see or access another user's credentials. | P0 |
| U-CRED-3 | As a developer, I can connect external services (GitHub, Google) via OAuth and the tokens are scoped to me. | P1 |
| U-CRED-4 | As an admin, I can configure shared credentials available to all users (e.g., a shared LLM API key). | P1 |
| U-CRED-5 | As a developer, I can see an audit log of which of my credentials were used and when. | P2 |

### UI & Experience

| ID | Story | Priority |
|----|-------|----------|
| U-UX-1 | As a developer, I see my username in the UI header and can log out. | P0 |
| U-UX-2 | As a developer, the instance list only shows my instances (no clutter from other users). | P0 |
| U-UX-3 | As an admin, I can toggle between "my instances" and "all instances" views. | P1 |
| U-UX-4 | As a developer, I see a clear error when I try to access a resource I don't own (not a 500). | P0 |

## Scope

### In Scope (Phase 1 — Multi-User Foundation)

1. **Keycloak deployment** — added as a Helm subchart, using the existing PostgreSQL instance.
2. **OIDC authentication flow** — UI redirects to Keycloak, API server validates JWTs.
3. **Label-based resource ownership** — `humr.ai/owner` label on instance and schedule ConfigMaps. API server filters all queries by owner. Templates remain shared.
4. **API server auth middleware** — extracts and validates JWT from `Authorization` header. Rejects unauthenticated requests (except health checks and static UI assets).
5. **Per-user credential scoping in OneCLI** — fork OneCLI to support generic OIDC and scope credentials by user identity (`sub` claim).
6. **Token exchange** — API server uses RFC 8693 to exchange user JWTs for OneCLI-scoped tokens via Keycloak.
7. **Network isolation for OneCLI** — NetworkPolicy restricts OneCLI access to API server and controller only.
8. **UI login/logout** — OIDC redirect flow, session display, logout button.

### Out of Scope (Phase 1)

- **Role-based access control (RBAC)** — Phase 1 has two implicit roles: admin (all access) and user (own resources). Fine-grained roles (team lead, read-only) deferred to Phase 2.
- **Team/organization model** — no grouping of users into teams. Deferred to Phase 2.
- **Namespace-per-user isolation** — soft tenancy via labels is sufficient. Hard isolation deferred unless security review requires it.
- **Self-service user registration** — admin creates users in Keycloak. Self-service deferred.
- **External identity federation** — Keycloak supports LDAP/SAML/GitHub upstream IdPs, but configuring these is out of scope. Keycloak's local user store is sufficient for Phase 1.
- **Credential sharing between users** — no mechanism for a user to share their credentials with another user's instances.
- **Audit trail UI** — OneCLI audit logs exist but are not surfaced in the Humr UI.

### Phase 2 — Teams & RBAC (Future)

- Role definitions: `admin`, `team-lead`, `developer`, `viewer`.
- Team model: users belong to teams, team leads can see team resources.
- Shared credentials at team level.
- Audit trail surfaced in UI.
- Quotas per user/team (max instances, max PVC size).

### Phase 3 — Enterprise (Future)

- External IdP federation (LDAP, SAML, GitHub Enterprise).
- Namespace-per-team hard isolation (if required by security review).
- Self-service user registration with admin approval.
- SSO for CLI access (device authorization grant).

## Functional Requirements

### FR-1: Identity Provider

- Keycloak deployed as Helm subchart, sharing the existing PostgreSQL instance.
- Keycloak realm `humr` created automatically on first install.
- Default admin user configurable via Helm values.
- OIDC client `humr-ui` for the frontend (public client, PKCE).
- OIDC client `humr-api` for the API server (confidential client).
- Token exchange enabled in Keycloak for API server → OneCLI token delegation.

### FR-2: API Server Authentication

- All API endpoints require a valid JWT in the `Authorization: Bearer <token>` header.
- Exceptions: `GET /healthz`, static UI assets, OIDC callback endpoints.
- JWT validation: signature verification against Keycloak JWKS, issuer check, audience check (`humr-api`), expiry check.
- User identity extracted from `sub` claim; display name from `preferred_username` or `name` claim.
- 401 Unauthorized for missing/invalid/expired tokens.
- 403 Forbidden for valid tokens accessing resources they don't own.

### FR-3: Resource Ownership

- On create: API server sets `humr.ai/owner: <user-sub>` label on the ConfigMap.
- On list: API server adds `labelSelector=humr.ai/owner=<user-sub>` to K8s queries.
- On get/update/delete: API server verifies `humr.ai/owner` label matches the authenticated user before proceeding.
- Templates: no owner label. All authenticated users can list and read templates. Only admins can create/update/delete templates.
- Controller: no changes needed. It reconciles all ConfigMaps regardless of owner label.

### FR-4: Credential Isolation

- OneCLI fork accepts JWTs issued by Keycloak (generic OIDC, not Google-only).
- All OneCLI data (agents, credentials, policy rules) scoped by user identity from JWT `sub` claim.
- API server exchanges user JWT for OneCLI-scoped token via RFC 8693 token exchange.
- Exchanged tokens cached in API server with TTL matching token expiry (minus buffer).
- Credential CRUD exposed as tRPC procedures: `credentials.list`, `credentials.add`, `credentials.delete`.
- OAuth connector flows (GitHub, Google) initiated via API server, tokens stored in OneCLI under the user's scope.

### FR-5: Network Isolation

- NetworkPolicy on OneCLI pods: ingress only from API server and controller pods (by label selector).
- Users cannot reach OneCLI directly — all credential operations go through the API server.

### FR-6: UI Authentication Flow

- On load, UI checks for valid token in memory/storage.
- If no valid token, redirect to Keycloak login page (OIDC authorization code flow with PKCE).
- On callback, exchange code for tokens, store access token and refresh token.
- Attach access token to all API requests.
- Refresh token before expiry using the refresh token.
- On 401 response, redirect to login.
- Display username in header, provide logout button (Keycloak end-session endpoint + local token clear).

## Non-Functional Requirements

### Security

- **No credential leakage:** a user must never be able to access another user's credentials through any code path (API, WebSocket, K8s label manipulation, OneCLI direct access).
- **Token validation on every request:** no session cookies without server-side validation.
- **OneCLI unreachable from user network:** enforced by NetworkPolicy, not just convention.
- **Minimal token lifetime:** access tokens ≤ 5 minutes, refresh tokens ≤ 8 hours. Configurable via Helm values.

### Performance

- **Auth overhead < 10ms per request** (cached JWKS, no per-request Keycloak calls for validation).
- **Token exchange cached** — OneCLI-scoped tokens reused until near expiry.
- **No performance regression** on instance list/get operations from adding label-based filtering (K8s label selectors are indexed).

### Reliability

- **Keycloak downtime does not crash running agents.** Agents use OneCLI tokens already provisioned. New logins and credential operations fail gracefully with clear error messages.
- **Graceful degradation:** if Keycloak is unreachable, API server returns 503 on auth endpoints but continues serving health checks.

### Operability

- **Single `helm install`** — Keycloak, realm, and clients provisioned automatically.
- **Helm values for all tunables** — token lifetimes, admin credentials, OIDC client settings.
- **Migration path from single-tenant** — existing instances without `humr.ai/owner` label are visible only to admins. No data migration required.

## Data Model Changes

### ConfigMap Labels (additions)

```yaml
metadata:
  labels:
    humr.ai/owner: "<keycloak-user-sub>"  # UUID from Keycloak
```

Applied to: `agent-instance`, `agent-schedule` ConfigMaps.
Not applied to: `agent-template` ConfigMaps (shared).

### API Context

```typescript
interface ApiContext {
  // ... existing fields
  user: {
    sub: string;          // Keycloak subject (UUID)
    username: string;     // Display name
    roles: string[];      // Keycloak realm roles (future: admin, team-lead, etc.)
  } | null;               // null only for unauthenticated endpoints
}
```

### New API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/auth/userinfo` | Returns authenticated user's profile |
| GET | `/api/credentials` | List current user's credentials (via OneCLI) |
| POST | `/api/credentials` | Add a credential for current user |
| DELETE | `/api/credentials/:id` | Remove a credential |
| GET | `/api/oauth/start/:provider` | Start OAuth flow for external service |
| GET | `/api/oauth/callback/:provider` | OAuth callback (stores token in OneCLI) |

### Helm Values (additions)

```yaml
auth:
  enabled: true
  keycloak:
    adminUser: admin
    adminPassword: ""         # Required, no default
    realm: humr
    clients:
      ui:
        clientId: humr-ui
      api:
        clientId: humr-api
        clientSecret: ""      # Auto-generated if empty
    tokenLifespan:
      access: 300             # seconds
      refresh: 28800          # seconds
```

## Dependencies & Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| **OneCLI fork maintenance** | High — must track upstream changes, merge selectively | Keep fork minimal: only OIDC + per-user scoping changes. Upstream contributions where possible. |
| **Keycloak complexity** | Medium — Keycloak is a large dependency with its own PostgreSQL needs | Share existing PostgreSQL instance. Use Keycloak Helm chart with minimal config. Document admin tasks. |
| **Token exchange reliability** | Medium — RFC 8693 is less battle-tested than standard OIDC flows | Cache exchanged tokens aggressively. Implement retry with backoff. Monitor exchange failures. |
| **Migration from single-tenant** | Low — existing unlabeled resources need a policy | Unlabeled resources visible to admins only. Document migration (add labels to existing ConfigMaps). |
| **Performance at scale** | Low — label-based filtering is O(1) in K8s | Monitor API latency. If needed, add informer cache in API server. |

## Success Metrics

| Metric | Target |
|--------|--------|
| Users can log in via OIDC and see only their own instances | 100% of users |
| No cross-user credential access in security review | Zero findings |
| Auth overhead on API requests | < 10ms p99 |
| Time from `helm install` to working multi-user cluster | < 10 minutes |
| Existing single-tenant workflows continue working for admin users | No regressions |

## Open Questions

1. **Keycloak or lighter alternative?** Keycloak is full-featured but heavy. Alternatives: Zitadel, Authentik, Dex (OIDC-only, no user management). Decision: Keycloak for Phase 1 (token exchange support is critical). Revisit if operational overhead is too high.
2. **OneCLI PostgreSQL schema changes** — How invasive is per-user scoping in OneCLI's data model? Needs spike before committing to fork scope.
3. **WebSocket authentication** — JWT in query param (simple but logged) vs. first-message auth (cleaner but more complex)? Recommend first-message auth pattern.
4. **Admin role definition** — Keycloak realm role `humr-admin` vs. hardcoded list of admin subs in Helm values? Recommend realm role for flexibility.
5. **Quota enforcement** — Should Phase 1 include basic quotas (max instances per user) to prevent resource exhaustion? Recommend deferring to Phase 2 unless cluster is shared broadly.
