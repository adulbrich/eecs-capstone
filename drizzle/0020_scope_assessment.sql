ALTER TABLE "programs" ADD COLUMN "term_count" integer;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "scope_assessment" jsonb;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "scope_assessment_source_hash" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "scope_assessment_updated_at" timestamp with time zone;