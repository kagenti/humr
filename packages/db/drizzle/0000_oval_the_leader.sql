CREATE TABLE "channels" (
	"instance_id" text NOT NULL,
	"owner" text NOT NULL,
	"type" text NOT NULL,
	"config" jsonb NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "channels_instance_type_idx" ON "channels" USING btree ("instance_id","type");