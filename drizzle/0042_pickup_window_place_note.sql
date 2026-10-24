ALTER TABLE "inventory_items" ADD COLUMN "current_pickup_from" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD COLUMN "current_pickup_place" text;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD COLUMN "current_pickup_note" text;--> statement-breakpoint
ALTER TABLE "inventory_request_items" ADD COLUMN "pickup_from" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "inventory_request_items" ADD COLUMN "pickup_place" text;--> statement-breakpoint
ALTER TABLE "inventory_request_items" ADD COLUMN "pickup_note" text;