ALTER TABLE "sessions" ADD COLUMN "thread_ts" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_instance_thread_idx" ON "sessions" USING btree ("instance_id","thread_ts") WHERE "sessions"."thread_ts" IS NOT NULL;