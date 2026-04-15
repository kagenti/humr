# Ubiquitous Language

Domain terms used across this project. Each term is scoped to its bounded context.

## Agents (bounded context)

| Term | Definition |
|------|-----------|
| Template | A read-only catalog blueprint that defines the base image, mounts, env, and resources for creating an agent |
| Agent | A user-owned definition of a runnable AI harness, optionally derived from a template |
| Instance | A running (or hibernated) deployment of an agent with its own state and environment; aggregate root assembled from infra state (ConfigMap) and application state (PostgreSQL) |
| Infra State | The subset of instance data stored in a ConfigMap and consumed by the Controller (desiredState, env, secretRef) |
| Application State | The subset of instance data stored in PostgreSQL and consumed only by the API Server (channels, session metadata) |
| Session | One conversation with the agent harness, with its own lifecycle and metadata |
| Schedule | A time-triggered task attached to an instance — either cron-based or heartbeat |
| Desired State | The target lifecycle state of an instance: running or hibernated |
| Wake | Transitioning an instance from hibernated to running |
| Heartbeat | A recurring schedule type defined by interval, internally converted to cron |

## Channels (bounded context)

| Term | Definition |
|------|-----------|
| Channel | An external communication pathway connecting users to an agent instance (e.g., Slack) |
| Channel Worker | A long-running process that bridges an external service to an agent instance |

## Secrets (bounded context)

| Term | Definition |
|------|-----------|
| Secret | A user-owned credential (e.g., an Anthropic API key) stored in OneCLI that can be injected into agent egress traffic by the credential gateway |
| Secret Type | The provider taxonomy for a secret — currently `anthropic` (hostPattern fixed) or `generic` (user-supplied host/path patterns) |
| Host Pattern | The hostname pattern that identifies which outbound requests the credential gateway should inject this secret into |
| Secret Assignment | The linkage between a Secret and an Agent that makes the secret available to that agent's egress; OneCLI owns this linkage as a bulk set per agent |
| Provider | The external service a secret authenticates against (e.g., Anthropic); for typed secrets the provider determines default routing rules |
