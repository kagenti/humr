import { pgTable, text, jsonb, uniqueIndex, primaryKey, timestamp, boolean, index } from "drizzle-orm/pg-core";

// --- Platform resources (previously ConfigMaps) ---

export const templates = pgTable("templates", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  spec: jsonb("spec").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const agents = pgTable("agents", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  owner: text("owner").notNull(),
  templateId: text("template_id"),
  spec: jsonb("spec").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("agents_owner_idx").on(table.owner),
]);

export const instances = pgTable("instances", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  agentId: text("agent_id").notNull(),
  owner: text("owner").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("instances_owner_idx").on(table.owner),
  index("instances_agent_idx").on(table.agentId),
]);

export const schedules = pgTable("schedules", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  instanceId: text("instance_id").notNull(),
  agentId: text("agent_id").notNull(),
  owner: text("owner").notNull(),
  spec: jsonb("spec").notNull(),
  lastRun: timestamp("last_run", { withTimezone: true }),
  lastResult: text("last_result"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("schedules_instance_idx").on(table.instanceId),
]);

// --- Existing tables ---

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
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
