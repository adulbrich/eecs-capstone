CREATE TABLE "project_ai_refreshes" (
	"project_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"trigger" text NOT NULL,
	"outcome" text NOT NULL,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_ai_refreshes_project_id_kind_pk" PRIMARY KEY("project_id","kind")
);
--> statement-breakpoint
ALTER TABLE "project_ai_refreshes" ADD CONSTRAINT "project_ai_refreshes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;