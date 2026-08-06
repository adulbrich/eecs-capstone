import { describe, expect, it } from "vitest";
import { listSchema } from "#/server/categories";

// listCategoriesImpl is exercised through this schema by every server call;
// the integration suite calls the impl directly and never proves the schema
// itself keeps excludeTypes. If a future edit dropped the field from
// listSchema, zod would silently strip it on the way in and both project
// category pickers would regress to leaking inventory categories, unnoticed.
describe("categories listSchema", () => {
  it("keeps excludeTypes through the zod boundary", () => {
    const parsed = listSchema.parse({ excludeTypes: ["inventory"] });
    expect(parsed.excludeTypes).toEqual(["inventory"]);
  });
});
