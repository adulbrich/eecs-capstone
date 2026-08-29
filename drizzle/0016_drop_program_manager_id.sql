-- Nothing in the application ever wrote this column: no UI set it and no server
-- function updated it, so it is null on every production row. Only seed-dev.ts
-- populated it, which meant a seeded instructor could not be deleted by
-- scripts/delete-user.mjs because of a restrict edge no application code could
-- clear. See #95.
ALTER TABLE "projects" DROP CONSTRAINT "projects_program_manager_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN "program_manager_id";