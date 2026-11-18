ALTER TABLE "project_edit_log" ADD COLUMN "staff_email_due" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "project_edit_log" ADD COLUMN "staff_email_claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "project_edit_log" ADD COLUMN "staff_emailed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "project_edit_log_staff_email_unsent_idx" ON "project_edit_log" USING btree ("project_id","created_at") WHERE staff_email_due and staff_emailed_at is null;