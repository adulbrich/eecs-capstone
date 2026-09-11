CREATE TYPE "public"."notification_type" AS ENUM('status_change', 'soft_delete', 'comment', 'proposer_reassigned', 'projects_claimed', 'inventory_request_approved', 'inventory_request_rejected', 'inventory_item_checked_out', 'inventory_item_returned', 'inventory_request_closed', 'inventory_custom_sourcing', 'inventory_custom_sourcing_note', 'inventory_custom_fulfilled', 'inventory_custom_rejected', 'inventory_pickup_overdue', 'inventory_checkout_overdue');--> statement-breakpoint
-- The partial unique index from 0004 is SQL-only (Drizzle's builder cannot
-- express its predicate), and its predicate was parsed against a text column.
-- Retyping the column underneath it fails with "operator does not exist:
-- notification_type = text", so the index is dropped and recreated around the
-- change with the same definition.
DROP INDEX "notifications_overdue_unique_idx";--> statement-breakpoint
ALTER TABLE "notifications" ALTER COLUMN "type" SET DATA TYPE "public"."notification_type" USING "type"::"public"."notification_type";--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_overdue_unique_idx"
  ON "notifications" ("user_id", "type", "link")
  WHERE "type" IN ('inventory_pickup_overdue', 'inventory_checkout_overdue');
