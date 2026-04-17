ALTER TABLE "identity_links" ADD COLUMN "provider" text NOT NULL DEFAULT 'slack';--> statement-breakpoint
ALTER TABLE "identity_links" ADD COLUMN "external_user_id" text;--> statement-breakpoint
UPDATE "identity_links" SET "external_user_id" = "slack_user_id";--> statement-breakpoint
ALTER TABLE "identity_links" ALTER COLUMN "external_user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "identity_links" ALTER COLUMN "provider" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "identity_links" DROP CONSTRAINT "identity_links_pkey";--> statement-breakpoint
ALTER TABLE "identity_links" DROP COLUMN "slack_user_id";--> statement-breakpoint
ALTER TABLE "identity_links" ADD CONSTRAINT "identity_links_provider_external_user_id_pk" PRIMARY KEY("provider","external_user_id");
