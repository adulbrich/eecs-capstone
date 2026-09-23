import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PROJECTS_FILTER_DEFAULTS } from "#/components/projects-filters";
import { OFFICE_TIME_ZONE } from "#/lib/day-range";
import { TRAFFIC_FILTERS } from "#/lib/traffic-filters";
import { searchSchema as inventorySearch } from "#/routes/_public/inventory/index";
import { searchSchema as projectsSearch } from "#/routes/_public/projects/index";

/**
 * `traffic-filters.ts` writes the listings' filter defaults out rather than
 * importing them, so the server can build its filter-use query without a
 * component module. These hold the copy to the source: a default changed on
 * a listing and not here would count every visit as setting the filter.
 */
const SCHEMAS = {
  "/inventory": inventorySearch,
  "/projects": projectsSearch,
} as const;

describe("the traffic filter list", () => {
  for (const [listing, filters] of Object.entries(TRAFFIC_FILTERS)) {
    const schema = SCHEMAS[listing as keyof typeof SCHEMAS];
    const defaults = schema.parse({}) as Record<string, unknown>;

    it(`names only keys ${listing}'s schema defines`, () => {
      for (const filter of filters) {
        expect(Object.keys(schema.shape), filter.key).toContain(filter.key);
      }
    });

    it(`counts nothing as set on a ${listing} visit that left every default`, () => {
      for (const filter of filters) {
        const value = defaults[filter.key];
        switch (filter.test.kind) {
          case "switch":
            expect(value, filter.key).toBe(filter.test.default);
            break;
          case "text":
            expect(value ?? "", filter.key).toBe("");
            break;
          case "list":
            expect(value ?? [], filter.key).toEqual([]);
            break;
          case "choice":
            expect(value ?? null, filter.key).toBeNull();
            break;
          case "equals":
            expect(value, filter.key).not.toBe(filter.test.value);
            break;
          default:
            throw new Error(`untested filter kind for ${filter.key}`);
        }
      }
    });
  }

  it("has the /projects switch defaults the filters panel uses", () => {
    for (const filter of TRAFFIC_FILTERS["/projects"]) {
      if (filter.test.kind === "switch") {
        expect(filter.test.default, filter.key).toBe(
          PROJECTS_FILTER_DEFAULTS[
            filter.key as keyof typeof PROJECTS_FILTER_DEFAULTS
          ]
        );
      }
    }
  });
});

describe("traffic_events.day", () => {
  it("is generated in the office's zone, which a migration can only spell as a literal", () => {
    const dir = join(process.cwd(), "drizzle");
    const migration = readdirSync(dir).find((f) =>
      f.startsWith("0038_add_the_traffic_visit_rollup")
    );
    expect(migration).toBeDefined();
    const text = readFileSync(join(dir, migration as string), "utf8");
    const zone = /AT TIME ZONE '([^']+)'/.exec(text)?.[1];
    expect(zone).toBe(OFFICE_TIME_ZONE);
    const schema = readFileSync(
      join(process.cwd(), "src/db/schema.ts"),
      "utf8"
    );
    expect(schema).toContain(`AT TIME ZONE '${OFFICE_TIME_ZONE}'`);
  });
});
