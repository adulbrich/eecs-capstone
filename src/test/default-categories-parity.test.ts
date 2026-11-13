import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CATEGORY_DESCRIPTION_MAX_LENGTH,
  DEFAULT_CATEGORIES,
  DEFAULT_CATEGORY_TYPES,
} from "#/lib/default-categories";

/**
 * The default category list lives twice: in `src/lib/default-categories.ts`,
 * which the dev seed reads, and in the data migration that put it in
 * production, which cannot import anything. This pins the copy to the list,
 * the pattern ADR-0024 uses for a copied declaration. A drift is silent: a
 * fresh dev database and production would carry different definitions, and
 * the categorizer would read one in development and the other live.
 *
 * Read as text, since a migration is SQL. The `it` names are the inventory of
 * what is pinned.
 */
const MIGRATION = readFileSync("drizzle/0043_default_categories.sql", "utf8");

/** A single-quoted SQL literal, whose only escape is a doubled quote. */
const LITERAL = "'((?:[^']|'')*)'";
const ROW = new RegExp(
  String.raw`\(\s*${LITERAL},\s*${LITERAL},\s*${LITERAL}\s*\)`,
  "gu"
);

function unquote(literal: string): string {
  return literal.replaceAll("''", "'");
}

/** The `(type, name, description)` rows of the migration's VALUES list. */
function migrationRows() {
  const start = MIGRATION.indexOf("FROM (VALUES");
  const end = MIGRATION.indexOf(') AS v ("type", "name", "description")');
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const block = MIGRATION.slice(start + "FROM (VALUES".length, end);
  return [...block.matchAll(ROW)].map(([, type, name, description]) => ({
    type: unquote(type),
    name: unquote(name),
    description: unquote(description),
  }));
}

describe("the default categories migration", () => {
  it("inserts exactly the rows of the default list, in its order", () => {
    expect(migrationRows()).toEqual(
      DEFAULT_CATEGORIES.map(({ type, name, description }) => ({
        type,
        name,
        description,
      }))
    );
  });

  it("parses every row of its VALUES list", () => {
    // A row the pattern above cannot read would drop out of both sides of a
    // comparison built from it. Counting the row openers catches that.
    const start = MIGRATION.indexOf("FROM (VALUES");
    const end = MIGRATION.indexOf(') AS v ("type", "name", "description")');
    const openers = MIGRATION.slice(start, end).match(/^\s+\('/gmu) ?? [];
    expect(openers).toHaveLength(migrationRows().length);
  });
});

describe("the default category list", () => {
  it("has 24 Field, 14 Technology, 15 Industry and 4 Kind of work categories", () => {
    // Against a literal, since a change made to both copies passes the
    // comparison above (ADR-0024).
    const counts = Object.fromEntries(
      DEFAULT_CATEGORY_TYPES.map((type) => [
        type,
        DEFAULT_CATEGORIES.filter((c) => c.type === type).length,
      ])
    );
    expect(counts).toEqual({
      Field: 24,
      Technology: 14,
      Industry: 15,
      "Kind of work": 4,
    });
  });

  it("orders Kind of work by precedence, the first that fits winning", () => {
    expect(
      DEFAULT_CATEGORIES.filter((c) => c.type === "Kind of work").map(
        (c) => c.name
      )
    ).toEqual(["Competition", "Research", "Existing System", "New Build"]);
  });

  it("never repeats a name, ignoring case", () => {
    // Stricter than the unique index, which allows a name under two types:
    // the dev seed resolves a project's categories by name alone.
    const names = DEFAULT_CATEGORIES.map((c) => c.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
  });

  it("gives every category one sentence that fits the description field", () => {
    for (const { name, description } of DEFAULT_CATEGORIES) {
      expect({ name, description }).toEqual({
        name,
        description: expect.stringMatching(/^[A-Z][^.]*(?:\.[^\s.][^.]*)*\.$/u),
      });
      expect(description.length).toBeLessThanOrEqual(
        CATEGORY_DESCRIPTION_MAX_LENGTH
      );
    }
  });
});
