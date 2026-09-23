CREATE TYPE "public"."traffic_device" AS ENUM('desktop', 'mobile', 'tablet');--> statement-breakpoint
CREATE TYPE "public"."traffic_event_kind" AS ENUM('view', 'search');--> statement-breakpoint
CREATE TABLE "traffic_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "traffic_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" "traffic_event_kind" NOT NULL,
	"visitor_hash" text NOT NULL,
	"pathname" text NOT NULL,
	"search" jsonb,
	"referrer_host" text,
	"previous_path" text,
	"country" text,
	"browser" text,
	"os" text,
	"device" "traffic_device"
);
--> statement-breakpoint
-- Hand-edited: Drizzle cannot declare UNLOGGED. The salt must never reach the
-- WAL, so RDS backups and point-in-time restores bring this table back empty
-- and a TRUNCATE leaves no dead tuple behind (ADR-0048).
CREATE UNLOGGED TABLE "traffic_salt" (
	"id" smallint PRIMARY KEY NOT NULL,
	"day" date NOT NULL,
	"salt" text NOT NULL,
	CONSTRAINT "traffic_salt_single_row" CHECK ("traffic_salt"."id" = 1)
);
--> statement-breakpoint
CREATE INDEX "traffic_events_occurred_at_idx" ON "traffic_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "traffic_events_visitor_idx" ON "traffic_events" USING btree ("visitor_hash","occurred_at");--> statement-breakpoint
CREATE INDEX "traffic_events_pathname_idx" ON "traffic_events" USING btree ("pathname","occurred_at");