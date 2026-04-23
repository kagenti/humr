ALTER TABLE "identity_links" ADD COLUMN "provider" text DEFAULT 'slack' NOT NULL;--> statement-breakpoint
ALTER TABLE "identity_links" ALTER COLUMN "provider" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "identity_links" RENAME COLUMN "slack_user_id" TO "external_user_id";--> statement-breakpoint
ALTER TABLE "identity_links" DROP CONSTRAINT "identity_links_pkey";--> statement-breakpoint
ALTER TABLE "identity_links" ADD CONSTRAINT "identity_links_provider_external_user_id_pk" PRIMARY KEY ("provider","external_user_id");--> statement-breakpoint
CREATE TABLE "telegram_threads" (
	"instance_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"authorized_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "telegram_threads_instance_id_thread_id_pk" PRIMARY KEY("instance_id","thread_id")
);
