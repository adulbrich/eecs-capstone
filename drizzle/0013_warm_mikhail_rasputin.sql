ALTER TABLE "projects" ADD COLUMN "requires_nda_ip" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "is_sponsored" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Hand-added. A project that already carries restrictions prose requires an
-- agreement; an empty field means none. That is the same rule the form now
-- enforces going forward, applied once to the rows that predate the column.
UPDATE "projects" SET "requires_nda_ip" = true
WHERE "license_restrictions" IS NOT NULL AND btrim("license_restrictions") <> '';
