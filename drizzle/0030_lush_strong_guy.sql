CREATE TABLE "project_programs" (
	"project_id" uuid NOT NULL,
	"program_id" uuid NOT NULL,
	CONSTRAINT "project_programs_project_id_program_id_pk" PRIMARY KEY("project_id","program_id")
);
--> statement-breakpoint
ALTER TABLE "projects" DROP CONSTRAINT "projects_program_id_programs_id_fk";
--> statement-breakpoint
DROP INDEX "projects_program_id_idx";--> statement-breakpoint
ALTER TABLE "project_programs" ADD CONSTRAINT "project_programs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_programs" ADD CONSTRAINT "project_programs_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_programs_program_idx" ON "project_programs" USING btree ("program_id");--> statement-breakpoint
-- Hand written (#462). drizzle-kit generate emits the CREATE TABLE above and
-- the DROP COLUMN below with nothing between them; without this insert every
-- existing placement, the imported legacy rows included, is dropped on the
-- floor. Runs after both foreign keys exist so a stale program_id cannot slip
-- through. Same reason the notifications.type retype in docs/QUIRKS.md has its
-- index drop and recreate written by hand.
INSERT INTO "project_programs" ("project_id", "program_id")
SELECT "id", "program_id" FROM "projects" WHERE "program_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN "program_id";