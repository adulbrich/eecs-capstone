ALTER TABLE "projects" ADD COLUMN "teams_supported" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "wants_to_mentor" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "mentor_team_count" integer DEFAULT 1 NOT NULL;