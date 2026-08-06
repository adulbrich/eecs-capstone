CREATE TYPE "category_domain" AS ENUM ('project', 'inventory');--> statement-breakpoint

-- Every existing category is a project category, so backfill with a default,
-- then drop it so future inserts must state the domain explicitly.
ALTER TABLE "categories" ADD COLUMN "domain" "category_domain" NOT NULL DEFAULT 'project';--> statement-breakpoint
ALTER TABLE "categories" ALTER COLUMN "domain" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "categories" ALTER COLUMN "type" DROP NOT NULL;--> statement-breakpoint

CREATE TABLE "inventory_item_categories" (
  "item_id" uuid NOT NULL,
  "category_id" uuid NOT NULL,
  CONSTRAINT "inventory_item_categories_item_id_category_id_pk" PRIMARY KEY("item_id","category_id"),
  CONSTRAINT "inventory_item_categories_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "inventory_item_categories_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action
);--> statement-breakpoint

-- Promote each distinct existing string to an inventory category.
-- The literal must be cast explicitly: DISTINCT forces Postgres to resolve
-- the SELECT list's types before any INSERT-target assignment cast applies,
-- so an unqualified 'inventory' resolves to text and then fails to convert
-- to category_domain (text -> enum has no implicit or assignment cast).
INSERT INTO "categories" ("name", "domain", "type")
SELECT DISTINCT trim("category"), 'inventory'::"category_domain", NULL
FROM "inventory_items"
WHERE "category" IS NOT NULL AND trim("category") <> ''
  AND NOT EXISTS (
    SELECT 1 FROM "categories" c
    WHERE c."name" = trim("inventory_items"."category") AND c."domain" = 'inventory'
  );--> statement-breakpoint

INSERT INTO "inventory_item_categories" ("item_id", "category_id")
SELECT i."id", c."id"
FROM "inventory_items" i
JOIN "categories" c ON c."domain" = 'inventory' AND c."name" = trim(i."category")
WHERE i."category" IS NOT NULL AND trim(i."category") <> '';--> statement-breakpoint

-- The generated column must go before the column it reads.
ALTER TABLE "inventory_items" DROP COLUMN "search_vector";--> statement-breakpoint
DROP INDEX IF EXISTS "inventory_items_category_idx";--> statement-breakpoint
ALTER TABLE "inventory_items" DROP COLUMN "category";--> statement-breakpoint

ALTER TABLE "inventory_items" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', coalesce(name, '')), 'A') || setweight(to_tsvector('english', coalesce(description, '')), 'B')) STORED NOT NULL;--> statement-breakpoint

-- Dropping the generated column dropped this with it, silently.
CREATE INDEX "inventory_items_search_vector_idx" ON "inventory_items" USING GIN ("search_vector");--> statement-breakpoint

CREATE INDEX "inventory_item_categories_category_idx" ON "inventory_item_categories" ("category_id");
