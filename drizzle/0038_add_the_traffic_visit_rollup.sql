CREATE TABLE "traffic_visits" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "traffic_visits_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"day" date NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"events" integer NOT NULL,
	"views" integer NOT NULL,
	"first_of_day" boolean NOT NULL,
	"entry_path" text,
	"entry_referrer" text,
	"country" text,
	"browser" text,
	"device" "traffic_device",
	"pages" text[] NOT NULL,
	"page_views" integer[] NOT NULL,
	"listings" text[] NOT NULL,
	"filters" text[] NOT NULL
);
--> statement-breakpoint
DROP INDEX "traffic_events_visitor_idx";--> statement-breakpoint
ALTER TABLE "traffic_events" ADD COLUMN "day" date GENERATED ALWAYS AS ((occurred_at AT TIME ZONE 'America/Los_Angeles')::date) STORED;--> statement-breakpoint
CREATE INDEX "traffic_visits_day_idx" ON "traffic_visits" USING btree ("day");--> statement-breakpoint
CREATE INDEX "traffic_events_visit_idx" ON "traffic_events" USING btree ("day","visitor_hash","occurred_at");