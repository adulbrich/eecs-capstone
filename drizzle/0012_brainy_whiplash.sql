ALTER TABLE "inventory_item_status_history" ADD COLUMN "holder_email" text;--> statement-breakpoint
ALTER TABLE "inventory_item_status_history" ADD COLUMN "holder_name" text;--> statement-breakpoint
ALTER TABLE "inventory_item_status_history" ADD COLUMN "holder_program" text;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD COLUMN "current_holder_name" text;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD COLUMN "current_holder_program" text;