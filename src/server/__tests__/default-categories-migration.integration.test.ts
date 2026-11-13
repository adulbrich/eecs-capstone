import { readFileSync } from "node:fs";
import { join } from "node:path";
import { asc, eq, isNull, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "#/db";
import { categories, projectCategories, projects } from "#/db/schema";
import { DEFAULT_CATEGORIES } from "#/lib/default-categories";

/**
 * Migration 0043 against a database shaped like production on 2026-11-12,
 * whose project categories were exactly `Technology: Web` and four `Type`
 * rows. CI migrates an empty database, so without this nothing runs the move
 * or the delete against a row they exist for.
 *
 * The statements come out of the migration file rather than being restated,
 * as in `categories-unique.integration.test.ts`: a copy would pass while the
 * SQL that ships is broken. The first statement, the new column, has already
 * run, since the suite migrates before it starts.
 */
const statements = readFileSync(
  join(process.cwd(), "drizzle", "0043_default_categories.sql"),
  "utf8"
)
  .split("--> statement-breakpoint")
  .map((s) => s.trim())
  .filter(Boolean);

const [, insertDefaults, moveLinks, deleteLive] = statements;

async function runDataStatements() {
  for (const statement of [insertDefaults, moveLinks, deleteLive]) {
    await db.execute(sql.raw(statement));
  }
}

async function projectCategoryNames(projectId: string) {
  const rows = await db
    .select({ type: categories.type, name: categories.name })
    .from(projectCategories)
    .innerJoin(categories, eq(categories.id, projectCategories.categoryId))
    .where(eq(projectCategories.projectId, projectId))
    .orderBy(asc(categories.name));
  return rows.map((r) => `${r.type}: ${r.name}`);
}

/** The five live rows, in a given spelling of their types. */
async function seedLiveRows(technology: string, typeFacet: string) {
  const live = await db
    .insert(categories)
    .values([
      { domain: "project", type: technology, name: "Web" },
      { domain: "project", type: typeFacet, name: "Research" },
      { domain: "project", type: typeFacet, name: "Consultancy" },
      { domain: "project", type: typeFacet, name: "FOSS" },
      { domain: "project", type: typeFacet, name: "New Product or Game" },
    ])
    .returning();
  const id = (name: string) => live.find((c) => c.name === name)?.id ?? "";
  const [web, research, foss] = await db
    .insert(projects)
    .values([
      { title: "Web consultancy" },
      { title: "Research product" },
      { title: "Open source" },
    ])
    .returning();
  await db.insert(projectCategories).values([
    { projectId: web.id, categoryId: id("Web") },
    { projectId: web.id, categoryId: id("Consultancy") },
    { projectId: research.id, categoryId: id("Research") },
    { projectId: research.id, categoryId: id("New Product or Game") },
    { projectId: foss.id, categoryId: id("FOSS") },
  ]);
  return { web, research, foss };
}

describe("migration 0043, the default categories", () => {
  it("reads four statements out of the migration", () => {
    // Restructuring the file would otherwise run the wrong statement below.
    expect(statements).toHaveLength(4);
    expect(statements[0]).toMatch(/ADD COLUMN "description"/u);
    expect(insertDefaults).toMatch(/INSERT INTO "categories"/u);
    expect(moveLinks).toMatch(/INSERT INTO "project_categories"/u);
    expect(deleteLive).toMatch(/DELETE FROM "categories"/u);
  });

  it.each([
    ["Technology", "Type"],
    ["technology", "type"],
  ])(
    "moves Web and Research with their projects and deletes the rest of %s / %s",
    async (technology, typeFacet) => {
      const { web, research, foss } = await seedLiveRows(technology, typeFacet);
      // An inventory category may share a name with a project one, and the
      // delete must not reach it.
      await db
        .insert(categories)
        .values({ domain: "inventory", type: null, name: "Research" });

      await runDataStatements();

      expect(await projectCategoryNames(web.id)).toEqual([
        "Field: Web Development",
      ]);
      expect(await projectCategoryNames(research.id)).toEqual([
        "Kind of work: Research",
      ]);
      expect(await projectCategoryNames(foss.id)).toEqual([]);

      const projectRows = await db
        .select()
        .from(categories)
        .where(eq(categories.domain, "project"));
      expect(projectRows.map((c) => `${c.type}: ${c.name}`).sort()).toEqual(
        DEFAULT_CATEGORIES.map((c) => `${c.type}: ${c.name}`).sort()
      );
      // The two moved categories included: a row renamed in place would have
      // been skipped by the insert and kept no description.
      expect(projectRows.filter((c) => c.description === null)).toEqual([]);

      const inventory = await db
        .select({ name: categories.name })
        .from(categories)
        .where(eq(categories.domain, "inventory"));
      expect(inventory).toEqual([{ name: "Research" }]);
    }
  );

  it("adds nothing when the insert runs twice", async () => {
    await db.execute(sql.raw(insertDefaults));
    await db.execute(sql.raw(insertDefaults));

    const rows = await db.select({ id: categories.id }).from(categories);
    expect(rows).toHaveLength(DEFAULT_CATEGORIES.length);
  });

  it("leaves a category staff already keep under a default's type and name", async () => {
    const [kept] = await db
      .insert(categories)
      .values({ domain: "project", type: "Industry", name: "healthcare" })
      .returning();

    await db.execute(sql.raw(insertDefaults));

    const healthcare = await db
      .select()
      .from(categories)
      .where(sql`lower(${categories.name}) = 'healthcare'`);
    expect(healthcare.map((c) => c.id)).toEqual([kept.id]);
    const blank = await db
      .select({ id: categories.id })
      .from(categories)
      .where(isNull(categories.description));
    expect(blank).toEqual([{ id: kept.id }]);
  });
});
