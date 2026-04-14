CREATE TABLE "sessions" (
	"session_id" text PRIMARY KEY NOT NULL,
	"instance_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
