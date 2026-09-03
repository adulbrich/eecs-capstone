import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "#/db";
import { inventoryItems, projects } from "#/db/schema";
import { inventoryImageKeys, projectImageKeys } from "#/lib/_internal/storage";
// The script is plain .mjs on purpose: it runs from the production container,
// which carries the built server rather than TypeScript. See its header.
import {
  findLegacyImageUrls,
  nullImageUrls,
} from "../../../scripts/image-url-legacy.mjs";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

afterAll(async () => {
  await pool.end();
});

/**
 * One row per shape the column can hold, so the agreement asserted below is
 * over every case and not only the two obvious ones. The value is written
 * after the insert because an owned key contains the row's own id.
 */
const SHAPES = [
  {
    label: "owned key",
    value: (id: string, prefix: string) =>
      `${prefix}/${id}/${randomUUID()}.webp`,
  },
  { label: "absolute URL", value: () => "https://images.unsplash.com/photo-1" },
  {
    label: "traversal under the prefix",
    value: (id: string, prefix: string) =>
      `${prefix}/${id}/../${randomUUID()}/x.webp`,
  },
  {
    label: "another row's key",
    value: (_id: string, prefix: string) => `${prefix}/${randomUUID()}/x.webp`,
  },
  { label: "empty string", value: () => "" },
  { label: "null", value: () => null },
] as const;

async function seedProjects() {
  const rows: { id: string; label: string; value: string | null }[] = [];
  for (const shape of SHAPES) {
    const [row] = await db
      .insert(projects)
      .values({ title: `Legacy image ${shape.label}` })
      .returning({ id: projects.id });
    const value = shape.value(row.id, "projects");
    await db
      .update(projects)
      .set({ imageUrl: value })
      .where(eq(projects.id, row.id));
    rows.push({ id: row.id, label: shape.label, value });
  }
  return rows;
}

async function seedItems() {
  const rows: { id: string; label: string; value: string | null }[] = [];
  for (const shape of SHAPES) {
    const [row] = await db
      .insert(inventoryItems)
      .values({ name: `Legacy image ${shape.label}` })
      .returning({ id: inventoryItems.id });
    const value = shape.value(row.id, "inventory");
    await db
      .update(inventoryItems)
      .set({ imageUrl: value })
      .where(eq(inventoryItems.id, row.id));
    rows.push({ id: row.id, label: shape.label, value });
  }
  return rows;
}

async function projectImage(id: string) {
  const [row] = await db
    .select({ imageUrl: projects.imageUrl })
    .from(projects)
    .where(eq(projects.id, id));
  return row.imageUrl;
}

describe("image-url-legacy script", () => {
  it("reports exactly the rows KeySpace.owns would refuse, for both tables", async () => {
    const seededProjects = await seedProjects();
    const seededItems = await seedItems();
    const report = await findLegacyImageUrls(pool);
    const reported = new Set(report.map((row) => `${row.table}:${row.id}`));

    // The script restates `owns` as SQL because it cannot import it. This is
    // the assertion that keeps the two from drifting: for every seeded row,
    // "in the report" must equal "set, and not owned".
    for (const row of seededProjects) {
      const expected = !!row.value && !projectImageKeys(row.id).owns(row.value);
      expect([row.label, reported.has(`projects:${row.id}`)]).toEqual([
        row.label,
        expected,
      ]);
    }
    for (const row of seededItems) {
      const expected =
        !!row.value && !inventoryImageKeys(row.id).owns(row.value);
      expect([row.label, reported.has(`inventory_items:${row.id}`)]).toEqual([
        row.label,
        expected,
      ]);
    }

    // The report carries the full value, because a reader classifies by eye.
    const absolute = seededProjects.find((r) => r.label === "absolute URL");
    expect(report).toContainEqual({
      table: "projects",
      id: absolute?.id,
      imageUrl: "https://images.unsplash.com/photo-1",
    });
  });

  it("nulls only the named rows, and refuses an id the report does not carry", async () => {
    const seeded = await seedProjects();
    const byLabel = (label: string) =>
      seeded.find((r) => r.label === label) as {
        id: string;
        value: string | null;
      };
    const absolute = byLabel("absolute URL");
    const traversal = byLabel("traversal under the prefix");
    const owned = byLabel("owned key");
    const stranger = randomUUID();

    const { nulled, refused } = await nullImageUrls(pool, [
      absolute.id,
      owned.id,
      stranger,
    ]);

    expect(nulled.map((row) => row.id)).toEqual([absolute.id]);
    expect(refused).toEqual([owned.id, stranger]);
    expect(await projectImage(absolute.id)).toBeNull();
    // Legacy but not named: untouched. Owned: untouched. No flag nulls all.
    expect(await projectImage(traversal.id)).toBe(traversal.value);
    expect(await projectImage(owned.id)).toBe(owned.value);
  });
});
