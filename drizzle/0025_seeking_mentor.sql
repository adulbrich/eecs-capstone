-- #304: "looking for a mentor" becomes its own staff-set flag instead of being
-- read off student_proposed. The backfill copies student_proposed so no
-- "Seeking mentor" badge appears or disappears on deploy: before this, the
-- badge showed for exactly the student-proposed projects with no address, and
-- seekingMentor is now seeking_mentor AND mentor_email IS NULL.

ALTER TABLE "projects" ADD COLUMN "seeking_mentor" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
UPDATE "projects"
SET "seeking_mentor" = "student_proposed"
WHERE "student_proposed";
