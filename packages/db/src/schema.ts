import { pgTable, text, jsonb, uniqueIndex } from "drizzle-orm/pg-core";

export const channels = pgTable("channels", {
  instanceId: text("instance_id").notNull(),
  owner: text("owner").notNull(),
  type: text("type").notNull(),
  config: jsonb("config").notNull(),
}, (table) => [
  uniqueIndex("channels_instance_type_idx").on(table.instanceId, table.type),
]);
