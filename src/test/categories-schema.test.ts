import { describe, expect, it } from "vitest";
import { categorySchema, listSchema } from "#/server/categories";

// listCategoriesImpl is exercised through this schema by every server call;
// the integration suite calls the impl directly and never proves the schema
// itself keeps domain. If a future edit dropped the field from listSchema,
// zod would silently strip it on the way in and both project category
// pickers would regress to leaking inventory categories, unnoticed.
describe("categories listSchema", () => {
  it("keeps domain through the list schema", () => {
    expect(listSchema.parse({ domain: "inventory" })).toEqual({
      domain: "inventory",
    });
  });
});

// categorySchema is a discriminated union so the domain/type pairing is
// enforced at the zod boundary, independent of the runtime assertion in
// _internal/categories.ts. Both must independently refuse to let a supplied
// inventory type reach the database.
describe("categorySchema domain shape", () => {
  it("rejects an inventory category carrying a type", () => {
    const r = categorySchema.safeParse({
      domain: "inventory",
      name: "Electronics",
      type: "technology",
    });
    expect(r.success).toBe(false);
  });
});
