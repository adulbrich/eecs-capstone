-- #402: mentorship is the mentor address alone. The three-state column
-- from #373 goes, and its enum type with it; pre-production, so nothing
-- to carry over.

ALTER TABLE "projects" DROP COLUMN "mentor_need";--> statement-breakpoint
DROP TYPE "public"."mentor_need";