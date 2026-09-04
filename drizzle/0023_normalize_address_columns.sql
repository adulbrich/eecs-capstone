-- Backfill for #249: the four address columns this app writes are lowercase.
--
-- The write paths normalize from this release on (normalizeEmailAddress in
-- src/lib/email-address.ts, reached through holdToColumns and the three
-- project writers), so this catches only rows written before it. Every row is
-- rewritten rather than only the mixed-case ones being selected: the WHERE
-- clause keeps the update off rows that are already lowercase, which on these
-- table sizes is most of them.
--
-- The reads still fold. Dropping a lower() on one of these columns is a
-- separate change that may only land after this migration has actually run
-- against a deployed database, which is why it is not in this release.
--
-- user.email is deliberately absent. It belongs to Better Auth, which stores
-- what a person typed, and a comparison against it folds both sides forever.

UPDATE "inventory_items"
SET "current_holder_email" = lower("current_holder_email")
WHERE "current_holder_email" IS NOT NULL
  AND "current_holder_email" <> lower("current_holder_email");
--> statement-breakpoint
UPDATE "inventory_item_status_history"
SET "holder_email" = lower("holder_email")
WHERE "holder_email" IS NOT NULL
  AND "holder_email" <> lower("holder_email");
--> statement-breakpoint
UPDATE "projects"
SET "proposer_email" = lower("proposer_email")
WHERE "proposer_email" IS NOT NULL
  AND "proposer_email" <> lower("proposer_email");
--> statement-breakpoint
UPDATE "projects"
SET "mentor_email" = lower("mentor_email")
WHERE "mentor_email" IS NOT NULL
  AND "mentor_email" <> lower("mentor_email");
