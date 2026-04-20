CREATE TABLE IF NOT EXISTS "templates" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "spec" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "agents" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "owner" text NOT NULL,
  "template_id" text,
  "spec" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "agents_owner_idx" ON "agents" ("owner");

CREATE TABLE IF NOT EXISTS "instances" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "agent_id" text NOT NULL,
  "owner" text NOT NULL,
  "description" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "instances_owner_idx" ON "instances" ("owner");
CREATE INDEX IF NOT EXISTS "instances_agent_idx" ON "instances" ("agent_id");

CREATE TABLE IF NOT EXISTS "schedules" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "instance_id" text NOT NULL,
  "agent_id" text NOT NULL,
  "owner" text NOT NULL,
  "spec" jsonb NOT NULL,
  "last_run" timestamp with time zone,
  "last_result" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "schedules_instance_idx" ON "schedules" ("instance_id");
