import { readFileSync } from "node:fs";
import { join } from "node:path";
import { asc, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "#/db";
import {
  categories,
  inventoryItemCategories,
  inventoryItems,
  projectCategories,
  projects,
} from "#/db/schema";
import { findUniqueViolation } from "#/server/_internal/pg-errors";

/**
 * The constraint from #99, tested against the database rather than the schema
 * file. Drizzle renders the index expression; only Postgres decides what it
 * actually rejects, and the three details that make this index different from
 * a plain `UNIQUE (domain, type, name)` are all things Postgres does, not
 * things TypeScript can state.
 */

const INDEX = "categories_domain_type_name_unique_idx";
const MIGRATION = join(
  process.cwd(),
  "drizzle",
  "0015_categories_unique_name.sql"
);

function insert(row: {
  domain: "project" | "inventory";
  name: string;
  type: string | null;
}) {
  return db.insert(categories).values(row);
}

/**
 * Asserts the insert was refused by this index, not merely that it failed.
 * `findUniqueViolation` walks the cause chain for SQLSTATE 23505 on exactly
 * this constraint; see its doc for why matching the message is wrong.
 */
async function expectRejectedByTheIndex(pending: Promise<unknown>) {
  const thrown = await pending.then(
    () => undefined,
    (error: unknown) => error
  );
  const violation = findUniqueViolation(thrown, INDEX);
  expect({
    code: violation?.code,
    constraint: violation?.constraint,
  }).toEqual({ code: "23505", constraint: INDEX });
}

describe("the categories unique index", () => {
  it("rejects the same name twice in one domain and type", async () => {
    await insert({ domain: "project", name: "Robotics", type: "field" });

    await expectRejectedByTheIndex(
      insert({ domain: "project", name: "Robotics", type: "field" })
    );
  });

  it("allows the same name in a different domain", async () => {
    await insert({ domain: "project", name: "Sensors", type: "field" });

    await expect(
      insert({ domain: "inventory", name: "Sensors", type: null })
    ).resolves.toBeDefined();
  });

  it("allows the same name under a different type in one domain", async () => {
    await insert({ domain: "project", name: "Robotics", type: "field" });

    await expect(
      insert({ domain: "project", name: "Robotics", type: "technology" })
    ).resolves.toBeDefined();
  });

  it("rejects names that differ only in case", async () => {
    await insert({ domain: "project", name: "Robotics", type: "field" });

    await expectRejectedByTheIndex(
      insert({ domain: "project", name: "robotics", type: "field" })
    );
  });

  it("rejects two inventory categories with the same name and a null type", async () => {
    // The case a plain UNIQUE (domain, type, name) would let through: Postgres
    // treats NULLs as distinct, and every inventory category carries type null.
    await insert({ domain: "inventory", name: "Multimeter", type: null });

    await expectRejectedByTheIndex(
      insert({ domain: "inventory", name: "Multimeter", type: null })
    );
  });
});

describe("the dedupe step in migration 0015", () => {
  /**
   * The migration runs against an empty database in CI, so the dedupe is a
   * no-op there and nothing exercises it. Reproducing the duplicates it exists
   * for means dropping the index first, since the index is what makes them
   * impossible.
   *
   * The statements come out of the migration file rather than being restated
   * here. A copy would let this pass while the SQL that actually ships is
   * broken, which is the shape of defect this suite is meant to catch.
   */
  const statements = readFileSync(MIGRATION, "utf8")
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);

  const dedupe = statements[0];
  const createIndex = statements[1];

  it("reads two statements out of the migration", () => {
    // If the migration is ever restructured, the test below would silently run
    // the wrong statement. Pin the shape instead.
    expect(statements).toHaveLength(2);
    expect(dedupe).toMatch(/DELETE FROM "categories"/);
    expect(createIndex).toMatch(/CREATE UNIQUE INDEX/);
  });

  it("keeps the oldest row and leaves a project carrying it exactly once", async () => {
    await db.execute(sql.raw(`DROP INDEX "${INDEX}";`));

    try {
      const [older] = await db
        .insert(categories)
        .values({
          createdAt: new Date("2020-01-01T00:00:00Z"),
          domain: "project",
          name: "Robotics",
          type: "field",
        })
        .returning();
      const [newer] = await db
        .insert(categories)
        .values({
          createdAt: new Date("2021-01-01T00:00:00Z"),
          domain: "project",
          // Differs only in case, so it collides under lower(name).
          name: "robotics",
          type: "field",
        })
        .returning();
      const [project] = await db
        .insert(projects)
        .values({ title: "Carries both" })
        .returning();

      // The case a naive UPDATE would break on: this project already holds the
      // survivor, so repointing the loser onto it collides with the composite
      // primary key.
      await db.insert(projectCategories).values([
        { categoryId: older.id, projectId: project.id },
        { categoryId: newer.id, projectId: project.id },
      ]);

      // The other junction, which is a separate INSERT in the migration and
      // would otherwise never run in any test. This item carries only the
      // loser, so it exercises the plain move rather than the conflict.
      const [item] = await db
        .insert(inventoryItems)
        .values({ name: "Also tagged" })
        .returning();
      await db
        .insert(inventoryItemCategories)
        .values({ categoryId: newer.id, itemId: item.id });

      await db.execute(sql.raw(dedupe));

      const remaining = await db
        .select()
        .from(categories)
        .orderBy(asc(categories.createdAt));
      expect(remaining.map((row) => row.id)).toEqual([older.id]);

      const links = await db
        .select()
        .from(projectCategories)
        .where(eq(projectCategories.projectId, project.id));
      expect(links).toEqual([{ categoryId: older.id, projectId: project.id }]);

      const itemLinks = await db
        .select()
        .from(inventoryItemCategories)
        .where(eq(inventoryItemCategories.itemId, item.id));
      expect(itemLinks).toEqual([{ categoryId: older.id, itemId: item.id }]);
    } finally {
      // Restore it even on failure: the index is schema state, and db-reset
      // only truncates, so leaving it dropped would disarm every assertion in
      // the describe block above for the rest of the run.
      //
      // Clear the table first. If the body threw before the dedupe ran, the
      // duplicates are still there and CREATE UNIQUE INDEX would throw too,
      // replacing the real failure with a confusing one.
      await db.execute(sql.raw('TRUNCATE TABLE "categories" CASCADE;'));
      await db.execute(sql.raw(createIndex));
    }
  });
});
