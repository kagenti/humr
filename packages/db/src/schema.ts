import { sql } from "drizzle-orm";
import { pgTable, text, jsonb, uniqueIndex, primaryKey, timestamp, boolean } from "drizzle-orm/pg-core";

export const channels = pgTable("channels", {
  instanceId: text("instance_id").notNull(),
  owner: text("owner").notNull(),
  type: text("type").notNull(),
  config: jsonb("config").notNull(),
}, (table) => [
  uniqueIndex("channels_instance_type_idx").on(table.instanceId, table.type),
]);

export const identityLinks = pgTable("identity_links", {
  provider: text("provider").notNull(),
  externalUserId: text("external_user_id").notNull(),
  keycloakSub: text("keycloak_sub").notNull(),
  refreshToken: text("refresh_token"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.provider, table.externalUserId] }),
]);

export const allowedUsers = pgTable("allowed_users", {
  instanceId: text("instance_id").notNull(),
  owner: text("owner").notNull(),
  keycloakSub: text("keycloak_sub").notNull(),
}, (table) => [
  primaryKey({ columns: [table.instanceId, table.keycloakSub] }),
]);

export const telegramThreads = pgTable("telegram_threads", {
  instanceId: text("instance_id").notNull(),
  threadId: text("thread_id").notNull(),
  authorizedBy: text("authorized_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.instanceId, table.threadId] }),
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
