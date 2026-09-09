CREATE TYPE "public"."inventory_custom_line_status" AS ENUM('pending', 'sourcing', 'fulfilled', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TABLE "inventory_custom_line_items" (
	"custom_line_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	CONSTRAINT "inventory_custom_line_items_custom_line_id_item_id_pk" PRIMARY KEY("custom_line_id","item_id")
);
--> statement-breakpoint
CREATE TABLE "inventory_custom_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"name" text NOT NULL,
	"reason" text NOT NULL,
	"quantity" integer NOT NULL,
	"link" text,
	"status" "inventory_custom_line_status" DEFAULT 'pending' NOT NULL,
	"sourcing_note" text,
	"outcome_note" text,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"closed_by" text,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inventory_custom_line_items" ADD CONSTRAINT "inventory_custom_line_items_custom_line_id_inventory_custom_lines_id_fk" FOREIGN KEY ("custom_line_id") REFERENCES "public"."inventory_custom_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_custom_line_items" ADD CONSTRAINT "inventory_custom_line_items_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_custom_lines" ADD CONSTRAINT "inventory_custom_lines_request_id_inventory_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."inventory_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_custom_lines" ADD CONSTRAINT "inventory_custom_lines_reviewed_by_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_custom_lines" ADD CONSTRAINT "inventory_custom_lines_closed_by_user_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_custom_line_items_item_idx" ON "inventory_custom_line_items" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "inventory_custom_lines_request_idx" ON "inventory_custom_lines" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "inventory_custom_lines_status_idx" ON "inventory_custom_lines" USING btree ("status");