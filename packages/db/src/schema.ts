import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  jsonb,
  uniqueIndex,
  primaryKey,
  timestamp,
  boolean,
  integer,
  uuid,
  customType,
  index,
  bigserial,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export const channels = pgTable("channels", {
  instanceId: text("instance_id").notNull(),
  owner: text("owner").notNull(),
  type: text("type").notNull(),
  config: jsonb("config").notNull(),
}, (table) => [
  uniqueIndex("channels_instance_type_idx").on(table.instanceId, table.type),
]);

export const identityLinks = pgTable("identity_links", {
  slackUserId: text("slack_user_id").primaryKey(),
  keycloakSub: text("keycloak_sub").notNull(),
  refreshToken: text("refresh_token"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const allowedUsers = pgTable("allowed_users", {
  instanceId: text("instance_id").notNull(),
  owner: text("owner").notNull(),
  keycloakSub: text("keycloak_sub").notNull(),
}, (table) => [
  primaryKey({ columns: [table.instanceId, table.keycloakSub] }),
]);

export const sessions = pgTable("sessions", {
  sessionId: text("session_id").primaryKey(),
  instanceId: text("instance_id").notNull(),
  type: text("type").notNull().default("regular"),
  scheduleId: text("schedule_id"),
  scheduleActive: boolean("schedule_active").default(true).notNull(),
  threadTs: text("thread_ts"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("sessions_instance_thread_idx")
    .on(table.instanceId, table.threadTs)
    .where(sql`${table.threadTs} IS NOT NULL`),
]);

// credentials-proxy tables (cp_*)
//
// Two DB roles operate on these:
//   cp_api     — full R/W, used by the API workload
//   cp_sidecar — SELECT on cp_agents, cp_secrets, cp_agent_secrets
//
// Per-agent DEK scoping: every agent gets a random 32-byte DEK; secret plaintext
// is encrypted with its own per-secret DEK. A grant row re-wraps the secret's
// DEK under the grantee agent's DEK, so the sidecar (which only holds its own
// agent's DEK) can only decrypt its own grants.

export const cpAgents = pgTable("cp_agents", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  identifier: text("identifier").notNull(),
  secretMode: text("secret_mode").notNull().default("selective"),
  ownerSub: text("owner_sub").notNull(),
  // Per-agent DEK wrapped by the global KEK. Stored for operational recovery;
  // the sidecar reads the raw DEK from a mounted K8s Secret, not this column.
  wrappedDek: bytea("wrapped_dek").notNull(),
  kekVersion: integer("kek_version").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("cp_agents_identifier_idx").on(table.identifier),
  index("cp_agents_owner_idx").on(table.ownerSub),
]);

export const cpSecrets = pgTable("cp_secrets", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  hostPattern: text("host_pattern").notNull(),
  // Plaintext encrypted with this row's per-secret DEK.
  ciphertext: bytea("ciphertext").notNull(),
  // Per-secret DEK wrapped under the global KEK (used by the API when granting;
  // unwrap KEK → re-wrap under grantee's agent DEK → write to cp_agent_secrets).
  wrappedDek: bytea("wrapped_dek").notNull(),
  kekVersion: integer("kek_version").notNull(),
  metadata: jsonb("metadata"),
  ownerSub: text("owner_sub").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("cp_secrets_owner_idx").on(table.ownerSub),
]);

export const cpAgentSecrets = pgTable("cp_agent_secrets", {
  agentId: uuid("agent_id").notNull().references(() => cpAgents.id, { onDelete: "cascade" }),
  secretId: uuid("secret_id").notNull().references(() => cpSecrets.id, { onDelete: "cascade" }),
  // The secret's per-secret DEK re-wrapped under the agent's DEK.
  dekWrappedByAgent: bytea("dek_wrapped_by_agent").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.agentId, table.secretId] }),
  index("cp_agent_secrets_agent_idx").on(table.agentId),
]);

export const cpAuditLog = pgTable("cp_audit_log", {
  id: bigserial("id", { mode: "bigint" }).primaryKey(),
  ts: timestamp("ts", { withTimezone: true }).defaultNow().notNull(),
  actorSub: text("actor_sub"),
  agentId: uuid("agent_id"),
  event: text("event").notNull(),
  target: text("target"),
  details: jsonb("details"),
}, (table) => [
  index("cp_audit_log_ts_idx").on(table.ts),
  index("cp_audit_log_agent_idx").on(table.agentId),
]);
