-- #373: mentorship becomes a three-state enum. `seeking_mentor = true`
-- carries over as 'seeking' so no "Seeking mentor" badge appears or
-- disappears on deploy; everything else is 'unspecified', which is what an
-- off flag with no address meant before, since it could not say "none".

CREATE TYPE "public"."mentor_need" AS ENUM('unspecified', 'seeking', 'none');--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "mentor_need" "mentor_need" DEFAULT 'unspecified' NOT NULL;--> statement-breakpoint
UPDATE "projects"
SET "mentor_need" = 'seeking'
WHERE "seeking_mentor";--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN "seeking_mentor";
