-- Dedupe before the index, because CREATE UNIQUE INDEX fails outright if
-- duplicates already exist and `categories` has been unconstrained since 0000.
--
-- The survivor is the oldest row, tie-broken by id. `created_at` alone is not
-- deterministic: migration 0010 promoted every inventory category in one
-- INSERT..SELECT DISTINCT, so those rows share a timestamp and the survivor
-- would otherwise differ between one database and the next.
--
-- Junction rows move by insert-then-delete rather than UPDATE. Both junctions
-- have composite primary keys, so repointing a loser onto a pair that already
-- exists would violate one; ON CONFLICT DO NOTHING is how a project carrying
-- both duplicates is tolerated. Deleting the loser category then takes its own
-- junction rows with it, since both sides cascade on categories.id.
--
-- Data-modifying CTEs run exactly once and to completion whether or not the
-- outer query reads their output, so both inserts do happen. They are not
-- ordered against the delete, and do not need to be: every sub-statement sees
-- one snapshot, so each insert's SELECT reads the junction rows as they were
-- before the delete either way, and the cascade removes only rows carrying a
-- loser id while the inserted rows carry the survivor's.
WITH ranked AS (
  SELECT
    "id",
    first_value("id") OVER (
      PARTITION BY "domain", coalesce("type", ''), lower("name")
      ORDER BY "created_at", "id"
    ) AS survivor_id
  FROM "categories"
),
map AS (
  SELECT "id" AS loser_id, survivor_id FROM ranked WHERE "id" <> survivor_id
),
moved_projects AS (
  INSERT INTO "project_categories" ("project_id", "category_id")
  SELECT pc."project_id", m.survivor_id
  FROM "project_categories" pc
  JOIN map m ON pc."category_id" = m.loser_id
  -- Target named rather than bare, so a unique constraint added to this table
  -- later cannot be silently swallowed here. Same rule as the notifications
  -- upsert; see QUIRKS.
  ON CONFLICT ("project_id", "category_id") DO NOTHING
  RETURNING 1
),
moved_items AS (
  INSERT INTO "inventory_item_categories" ("item_id", "category_id")
  SELECT iic."item_id", m.survivor_id
  FROM "inventory_item_categories" iic
  JOIN map m ON iic."category_id" = m.loser_id
  ON CONFLICT ("item_id", "category_id") DO NOTHING
  RETURNING 1
)
DELETE FROM "categories" WHERE "id" IN (SELECT loser_id FROM map);--> statement-breakpoint

CREATE UNIQUE INDEX "categories_domain_type_name_unique_idx" ON "categories" USING btree ("domain",coalesce("type", ''),lower("name"));
