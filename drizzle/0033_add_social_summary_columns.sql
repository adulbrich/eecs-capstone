ALTER TABLE "projects" ADD COLUMN "social_summary" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "social_summary_source_hash" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "social_summary_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "social_summary_is_manual" boolean DEFAULT false NOT NULL;