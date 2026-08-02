ALTER TABLE "inventory_items" ADD COLUMN "current_holder_email" text;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD COLUMN "current_pickup_by" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD COLUMN "current_due_at" timestamp with time zone;