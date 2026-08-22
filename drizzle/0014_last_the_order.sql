CREATE TABLE "ai_review_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"project_id" uuid,
	"model" text NOT NULL,
	"reasoning_effort" text NOT NULL,
	"input_tokens" integer,
	"reasoning_tokens" integer,
	"output_tokens" integer,
	"reviewed_field_count" integer,
	"outcome" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_review_usage" ADD CONSTRAINT "ai_review_usage_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_review_usage" ADD CONSTRAINT "ai_review_usage_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_review_usage_user_idx" ON "ai_review_usage" USING btree ("user_id","created_at");