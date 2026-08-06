ALTER TABLE "inventory_items" ADD COLUMN "category_id" uuid REFERENCES "categories"("id") ON DELETE SET NULL;--> statement-breakpoint

INSERT INTO "categories" ("name", "type")
SELECT DISTINCT trim("category"), 'inventory'
FROM "inventory_items"
WHERE "category" IS NOT NULL AND trim("category") <> ''
  AND NOT EXISTS (
    SELECT 1 FROM "categories" c
    WHERE c."name" = trim("inventory_items"."category") AND c."type" = 'inventory'
  );--> statement-breakpoint

UPDATE "inventory_items" i
SET "category_id" = c."id"
FROM "categories" c
WHERE c."type" = 'inventory' AND c."name" = trim(i."category");--> statement-breakpoint

DROP INDEX IF EXISTS "inventory_items_category_idx";--> statement-breakpoint

ALTER TABLE "inventory_items" DROP COLUMN "search_vector";--> statement-breakpoint
ALTER TABLE "inventory_items" DROP COLUMN "category";--> statement-breakpoint

ALTER TABLE "inventory_items" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', coalesce(name, '')), 'A') || setweight(to_tsvector('english', coalesce(description, '')), 'B')) STORED NOT NULL;--> statement-breakpoint

CREATE INDEX "inventory_items_search_vector_idx" ON "inventory_items" USING GIN ("search_vector");--> statement-breakpoint

CREATE INDEX "inventory_items_category_id_idx" ON "inventory_items" ("category_id");
