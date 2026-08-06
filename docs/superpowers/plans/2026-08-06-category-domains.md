# Category Domains and Multi-Category Inventory Items Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `categories` an explicit `domain` column, make inventory items many-to-many like projects, and split `/admin/categories` into Project and Inventory tabs so the word "inventory" never appears as a selectable type.

**Architecture:** `categories.domain` becomes a `pgEnum` (closed set), while `type` stays free text and becomes nullable, meaning "facet within the project domain". `inventory_item_categories` mirrors `project_categories`. Migrations `0010` and `0011` are deleted and replaced by one clean migration, because neither has reached production. `INVENTORY_CATEGORY_TYPE` and `excludeTypes` are deleted outright; both were workarounds for the missing column.

**Tech Stack:** TypeScript, TanStack Start (React 19 SSR), TanStack Router/Table/Form, Drizzle ORM on PostgreSQL, Zod, Vitest, Playwright + axe.

Spec: [`docs/superpowers/specs/2026-08-06-category-domains-design.md`](../specs/2026-08-06-category-domains-design.md)

## Global Constraints

- **`domain` is a `pgEnum` with values `'project'` and `'inventory'`. `type` stays free text and becomes nullable.** That asymmetry is the correction: domains are closed and known at design time, facets are open because admins create them through `CategoryTypeCombobox`.
- **A project category requires a non-null `type`. An inventory category requires `type` to be null**, and a supplied one is rejected rather than silently stripped.
- **The string `"inventory"` must never appear as a selectable type in the UI.**
- Inventory category filtering uses **all selected categories must match**, matching `src/server/_internal/search.ts:46` (`HAVING count(*) = ${categoryIds.length}`). Do not invent "any" semantics.
- Join-table deletes **cascade** on both sides, matching `project_categories`. This reverses the `ON DELETE SET NULL` currently shipped.
- The edit log records category changes as **names**, joined with `"; "`, never UUIDs.
- `src/lib/category-types.ts` and `excludeTypes` are **deleted**, not deprecated.
- This project is pre-production: `?category=` links break by design. No back-compat aliases.
- Run `npm run check` before every commit. No emdashes.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `drizzle/0010_category_domains.sql` (create) | The one clean migration. Replaces deleted `0010`/`0011`. |
| `drizzle/meta/0010_snapshot.json` (create) | Its snapshot. `0010`/`0011` snapshots deleted. |
| `src/db/schema.ts` (modify) | `categoryDomainEnum`, `categories.domain`, nullable `type`, `inventoryItemCategories`, no `categoryId` on items. |
| `src/lib/category-types.ts` (**delete**) | Sentinel replaced by a real column. |
| `src/server/_internal/categories.ts` (modify) | `domain` filtering, validation, `setInventoryItemCategoriesAs`. |
| `src/server/categories.ts` (modify) | Discriminated-union zod schemas. |
| `src/server/_internal/inventory.ts` (modify) | `categoryIds` on write, categories on read, all-match filter. |
| `src/server/inventory.ts` (modify) | `categoryIds` payload, `categories` list param. |
| `src/components/category-multi-select.tsx` (modify) | `domain` prop, creatable affordance, null-type grouping. |
| `src/components/category-chip.tsx` (modify) | Render without a type. |
| `src/routes/_authed/admin/categories/index.tsx` (modify) | Project/Inventory tabs. |
| `src/components/inventory-form.tsx`, `inventory-filter-bar.tsx`, `inventory-card.tsx`, `inventory-row.tsx` (modify) | Multi-category UI. |

---

### Task 1: Schema, the replacement migration, and a clean database

**Files:**
- Delete: `drizzle/0010_inventory_category_fk.sql`, `drizzle/0011_talented_wallflower.sql`, `drizzle/meta/0010_snapshot.json`, `drizzle/meta/0011_snapshot.json`, `src/lib/category-types.ts`
- Create: `drizzle/0010_category_domains.sql`, `drizzle/meta/0010_snapshot.json`
- Modify: `src/db/schema.ts`, `drizzle/meta/_journal.json`

**Interfaces:**
- Consumes: nothing.
- Produces: `categoryDomainEnum`, `categories.domain`, nullable `categories.type`, and the `inventoryItemCategories` table. Every later task depends on these.

This task deliberately leaves `npm run typecheck` **failing**, and it stays failing until Task 6. Do not fix consumers here.

For reference, deleting `src/lib/category-types.ts` breaks these six production files, which later tasks own:

| File | Owned by |
| --- | --- |
| `src/components/category-multi-select.tsx` | Task 2 (mechanical swap), Task 5 (rework) |
| `src/components/projects-filter-bar.tsx` | Task 2 |
| `src/routes/_authed/admin/categories/index.tsx` | Task 4 |
| `src/routes/_authed/inventory/new.tsx` | Task 6 |
| `src/routes/_authed/inventory/$itemId/edit.tsx` | Task 6 |
| `src/test/categories-schema.test.ts` | Task 2 |

Plus `src/server/_internal/categories.ts` and `src/server/categories.ts` (Task 2), and `src/server/_internal/inventory.ts` and `src/server/inventory.ts` (Task 3).

- [ ] **Step 1: Delete the superseded migrations**

```bash
git rm drizzle/0010_inventory_category_fk.sql drizzle/0011_talented_wallflower.sql
git rm drizzle/meta/0010_snapshot.json drizzle/meta/0011_snapshot.json
git rm src/lib/category-types.ts
```

Then remove the `0010_inventory_category_fk` and `0011_talented_wallflower` entries from `drizzle/meta/_journal.json`, leaving `0009_warm_cammi` as the last entry (`idx: 9`).

Neither migration has reached production, so this is a clean replacement rather than a rewrite of applied history.

- [ ] **Step 2: Update the Drizzle schema**

In `src/db/schema.ts`, add the enum near the other `pgEnum` declarations:

```ts
export const categoryDomainEnum = pgEnum("category_domain", [
  "project",
  "inventory",
]);
```

Replace the `categories` table with:

```ts
export const categories = pgTable("categories", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  /**
   * What this category classifies. A closed set, unlike `type`: domains are
   * known at design time, facets are invented by staff. Conflating the two in
   * one column is what made "inventory" render as a fifth project facet.
   */
  domain: categoryDomainEnum("domain").notNull(),
  /**
   * The facet within the project domain: project_type, technology, industry,
   * field, or anything staff create. Null for inventory categories, which are
   * flat.
   */
  type: text("type"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
```

In `inventoryItems`, delete the `categoryId` column and the
`inventory_items_category_id_idx` index entry. The `searchVector` expression
already covers name and description only; leave it as it is.

Add the join table after `inventoryItems`:

```ts
export const inventoryItemCategories = pgTable(
  "inventory_item_categories",
  {
    itemId: uuid("item_id")
      .references(() => inventoryItems.id, { onDelete: "cascade" })
      .notNull(),
    categoryId: uuid("category_id")
      .references(() => categories.id, { onDelete: "cascade" })
      .notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.itemId, t.categoryId] }),
    // The primary key only serves item -> categories. "Which items have this
    // category" and "which categories are in use" both read the other way.
    index("inventory_item_categories_category_idx").on(t.categoryId),
  ]
);
```

- [ ] **Step 3: Hand-write the migration**

Create `drizzle/0010_category_domains.sql`, using `--> statement-breakpoint` between statements as `drizzle/0008_add_inventory_label.sql` does. Note this migration runs against a database where `inventory_items.category` is still `text`, because it replaces the migrations that changed it.

```sql
CREATE TYPE "category_domain" AS ENUM ('project', 'inventory');--> statement-breakpoint

-- Every existing category is a project category, so backfill with a default,
-- then drop it so future inserts must state the domain explicitly.
ALTER TABLE "categories" ADD COLUMN "domain" "category_domain" NOT NULL DEFAULT 'project';--> statement-breakpoint
ALTER TABLE "categories" ALTER COLUMN "domain" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "categories" ALTER COLUMN "type" DROP NOT NULL;--> statement-breakpoint

CREATE TABLE "inventory_item_categories" (
  "item_id" uuid NOT NULL REFERENCES "inventory_items"("id") ON DELETE CASCADE,
  "category_id" uuid NOT NULL REFERENCES "categories"("id") ON DELETE CASCADE,
  CONSTRAINT "inventory_item_categories_item_id_category_id_pk" PRIMARY KEY("item_id","category_id")
);--> statement-breakpoint

-- Promote each distinct existing string to an inventory category.
INSERT INTO "categories" ("name", "domain", "type")
SELECT DISTINCT trim("category"), 'inventory', NULL
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
```

Add a journal entry with `idx: 10`, `version: "7"`, `breakpoints: true`, `tag: "0010_category_domains"`, and a `when` timestamp greater than `0009`'s `1785642316169`.

- [ ] **Step 4: Rebuild the local database from scratch**

The old `0010`/`0011` hashes are recorded in `__drizzle_migrations`, so the database must be rebuilt rather than migrated forward. The project owner has approved this; dev data is regenerable.

```bash
docker compose down -v
docker compose up -d
sleep 8
npm run db:migrate
```

- [ ] **Step 5: Verify the database, which is the point of the two traps**

```bash
docker compose exec -T postgres psql -U postgres -d eecs_capstone -c "\d inventory_items"
docker compose exec -T postgres psql -U postgres -d eecs_capstone -c "\d inventory_item_categories"
docker compose exec -T postgres psql -U postgres -d eecs_capstone -c "\d categories"
```

Expected: `inventory_items` has no `category` and no `category_id`, has a generated `search_vector`, and **has** `inventory_items_search_vector_idx` (gin). `inventory_item_categories` exists with a composite primary key, two cascading foreign keys, and `inventory_item_categories_category_idx`. `categories` has a non-null `domain` of type `category_domain` with no default, and a nullable `type`.

Paste all three outputs into your report.

- [ ] **Step 6: Write the snapshot and prove it**

Hand-write `drizzle/meta/0010_snapshot.json` by copying `0009_snapshot.json`, bumping `id`/`prevId` to chain correctly, and editing the `categories` and `inventory_items` entries plus adding `inventory_item_categories` and the new enum.

Then prove it:

```bash
npm run db:generate
```

Expected: **"No schema changes, nothing to migrate"**. If it proposes a migration, the snapshot disagrees with `schema.ts`; fix the snapshot until it does not. Delete any file that run writes. That check is the only real proof the snapshot is correct.

- [ ] **Step 7: Confirm the deliberate typecheck failure**

```bash
npm run typecheck
```

Expected: FAIL. Capture the full error list; it is the checklist for Tasks 2 and 3. Do not fix any of it.

- [ ] **Step 8: Commit**

```bash
npm run check
git add -A
git commit -m "feat(categories)!: add a domain column and make inventory many-to-many

Replaces migrations 0010 and 0011, which never reached production, with
one migration that expresses the final design: categories.domain as a
closed pgEnum, type nullable and meaning facet-within-project, and
inventory_item_categories mirroring project_categories.

categories.type carried two perpendicular meanings, so the admin UI
rendered a domain and four facets as five peers. A whitelist over type
strings cannot fix that, because staff create new types.

Deletes INVENTORY_CATEGORY_TYPE. Typecheck fails after this commit until
the consumers are updated."
```

---

### Task 2: The categories server surface

**Files:**
- Modify: `src/server/_internal/categories.ts`, `src/server/categories.ts`
- Test: `src/server/__tests__/categories.integration.test.ts`, `src/test/categories-schema.test.ts`

**Interfaces:**
- Consumes: `categoryDomainEnum`, `categories.domain` from Task 1.
- Produces: `listCategoriesImpl({ domain?, type? })`, and `createCategoryAs`/`updateCategoryAs` accepting a discriminated `CategoryInput`. Tasks 4 and 5 call these.

- [ ] **Step 1: Write the failing tests**

Replace the `excludeTypes` test in `src/server/__tests__/categories.integration.test.ts` (it tests a mechanism this task deletes) and add:

```ts
it("lists only the requested domain", async () => {
  const admin = await makeUser(`dom-${Date.now()}@x.com`, "admin");
  await createCategoryAs(admin, {
    domain: "project",
    name: "React",
    type: "technology",
  });
  await createCategoryAs(admin, {
    domain: "inventory",
    name: "Electronics",
    type: null,
  });

  const projectOnly = await listCategoriesImpl({ domain: "project" });
  const inventoryOnly = await listCategoriesImpl({ domain: "inventory" });

  expect(projectOnly.rows.map((r) => r.name)).toEqual(["React"]);
  expect(inventoryOnly.rows.map((r) => r.name)).toEqual(["Electronics"]);
});

it("requires a type for a project category", async () => {
  const admin = await makeUser(`v1-${Date.now()}@x.com`, "admin");
  await expect(
    createCategoryAs(admin, { domain: "project", name: "Nope", type: null })
  ).rejects.toThrow();
});

it("rejects a type on an inventory category rather than stripping it", async () => {
  const admin = await makeUser(`v2-${Date.now()}@x.com`, "admin");
  await expect(
    createCategoryAs(admin, {
      domain: "inventory",
      name: "Nope",
      type: "technology",
    })
  ).rejects.toThrow();
});

it("derives types from project categories only", async () => {
  const admin = await makeUser(`t-${Date.now()}@x.com`, "admin");
  await createCategoryAs(admin, {
    domain: "project",
    name: "React",
    type: "technology",
  });
  await createCategoryAs(admin, {
    domain: "inventory",
    name: "Electronics",
    type: null,
  });

  const { types } = await listCategoryTypesImpl();
  expect(types).toEqual(["technology"]);
});
```

The third test is the one that matters most: silently discarding a supplied type is exactly the class of bug this whole redesign exists to remove.

- [ ] **Step 2: Run to verify they fail**

Run: `ulimit -n 8192 && npx vitest run --config vitest.integration.config.ts src/server/__tests__/categories.integration.test.ts`
Expected: FAIL, `domain` is not a known argument.

- [ ] **Step 3: Implement domain filtering and validation**

In `src/server/_internal/categories.ts`, replace `listCategoriesImpl`:

```ts
export async function listCategoriesImpl(data: {
  domain?: CategoryDomain | null;
  type?: string | null;
}) {
  const conditions: SQL[] = [];
  if (data.domain) {
    conditions.push(eq(categories.domain, data.domain));
  }
  if (data.type) {
    conditions.push(eq(categories.type, data.type));
  }
  const rows = await db
    .select()
    .from(categories)
    .where(conditions.length ? and(...conditions) : undefined)
    // Type first groups the project pickers. Inventory rows all have a null
    // type, so within that domain this collapses to name order.
    .orderBy(categories.type, categories.name);
  return { rows };
}
```

Scope `listCategoryTypesImpl` to the project domain:

```ts
export async function listCategoryTypesImpl() {
  const rows = await db
    .select({ type: categories.type })
    .from(categories)
    // Facets exist only in the project domain; inventory categories are flat.
    .where(and(eq(categories.domain, "project"), isNotNull(categories.type)))
    .groupBy(categories.type)
    .orderBy(categories.type);
  return { types: rows.map((r) => r.type).filter((t): t is string => !!t) };
}
```

Add validation used by both create and update:

```ts
/**
 * A project category is filed under a facet; an inventory category is flat.
 * Rejecting a supplied inventory type rather than discarding it is deliberate:
 * silent stripping is the failure class this redesign removes.
 */
function assertDomainShape(data: { domain: CategoryDomain; type: string | null }) {
  if (data.domain === "project" && !data.type?.trim()) {
    throw new Error("A project category requires a type");
  }
  if (data.domain === "inventory" && data.type !== null) {
    throw new Error("An inventory category cannot have a type");
  }
}
```

Call it at the top of `createCategoryAs` and `updateCategoryAs`, after the staff assertion, and write `domain` and `type` through to the insert and update.

- [ ] **Step 4: Update the zod boundary**

In `src/server/categories.ts`, replace `categorySchema` with a discriminated union so the pairing is enforced at the server-function boundary too:

```ts
const categorySchema = z.discriminatedUnion("domain", [
  z.object({
    domain: z.literal("project"),
    name: z.string().trim().min(1).max(100),
    type: z.string().trim().min(1).max(50),
  }),
  z.object({
    domain: z.literal("inventory"),
    name: z.string().trim().min(1).max(100),
    type: z.null(),
  }),
]);

export type CategoryInput = z.infer<typeof categorySchema>;
```

Replace the list schema's `excludeTypes` with `domain`:

```ts
export const listSchema = z.object({
  domain: z.enum(["project", "inventory"]).nullable().optional(),
  type: z.string().nullable().optional(),
});
```

`categoryUpdateSchema` extends the union with `id`; use
`z.discriminatedUnion` again rather than `.extend()`, which unions do not support.

- [ ] **Step 5: Swap the two picker consumers mechanically**

Deleting `excludeTypes` breaks `src/components/category-multi-select.tsx:25` and `src/components/projects-filter-bar.tsx:58`, which both pass `excludeTypes: [INVENTORY_CATEGORY_TYPE]`. Do the minimal swap now so this task does not leave a module referencing an option that no longer exists:

```tsx
const { rows } = await listCategories({ data: { domain: "project" } });
```

Remove the `INVENTORY_CATEGORY_TYPE` import from both. Task 5 reworks `category-multi-select.tsx` properly; this is only enough to keep it coherent. Note the component still groups by `type`, which is correct for the project domain and is fine until Task 5.

- [ ] **Step 6: Replace the schema-boundary test**

In `src/test/categories-schema.test.ts`, replace the `excludeTypes` case with one covering `domain`, and add one asserting the union rejects an inventory category carrying a type:

```ts
it("keeps domain through the list schema", () => {
  expect(listSchema.parse({ domain: "inventory" })).toEqual({
    domain: "inventory",
  });
});
```

- [ ] **Step 7: Run to verify they pass**

Run: `ulimit -n 8192 && npx vitest run --config vitest.integration.config.ts src/server/__tests__/categories.integration.test.ts`
Run: `ulimit -n 8192 && npx vitest run src/test/categories-schema.test.ts`
Expected: PASS.

`npm run typecheck` still fails at this point, in the four files Tasks 3, 4 and 6 own. That is expected.

**Prove the validation discriminates:** temporarily remove `assertDomainShape`'s inventory branch, confirm the "rejects a type" test fails, then restore it. Paste both runs.

- [ ] **Step 8: Commit**

```bash
npm run check
git add src/server/_internal/categories.ts src/server/categories.ts src/server/__tests__/categories.integration.test.ts src/test/categories-schema.test.ts src/components/category-multi-select.tsx src/components/projects-filter-bar.tsx
git commit -m "feat(categories): filter by domain and enforce the domain shape

Replaces excludeTypes, which existed only to subtract inventory
categories from the project pickers. Callers now ask for the domain they
want. An inventory category carrying a type is rejected rather than
silently stripped."
```

---

### Task 3: Inventory items take many categories

**Files:**
- Modify: `src/server/_internal/categories.ts` (add `setInventoryItemCategoriesAs`), `src/server/_internal/inventory.ts`, `src/server/inventory.ts`
- Test: `src/server/__tests__/inventory.integration.test.ts`, `src/server/__tests__/admin-inventory.integration.test.ts`

**Interfaces:**
- Consumes: `inventoryItemCategories` from Task 1, `listCategoriesImpl` from Task 2.
- Produces: item rows carrying `categories: { id, name }[]`; `createInventoryItemAs`/`updateInventoryItemAs` taking `categoryIds: string[]`. Tasks 5-7 consume these.

This task clears the **server-side** typecheck errors. `npm run typecheck` still fails afterwards in `src/routes/_authed/admin/categories/index.tsx` (Task 4) and the two inventory form routes (Task 6). It first reaches zero at the end of Task 6.

- [ ] **Step 1: Write the failing tests**

Add to `src/server/__tests__/inventory.integration.test.ts`, reusing that file's existing `makeUser`/`makeItem` helpers:

```ts
describe("inventory item categories", () => {
  it("round-trips two categories through create and read", async () => {
    const stamp = Date.now();
    const admin = await makeUser(`ic-${stamp}@x.com`, "admin");
    const a = await createCategoryAs(admin, {
      domain: "inventory",
      name: `Alpha-${stamp}`,
      type: null,
    });
    const b = await createCategoryAs(admin, {
      domain: "inventory",
      name: `Beta-${stamp}`,
      type: null,
    });

    const { id } = await createInventoryItemAs(admin, {
      ...baseItemInput(`Widget-${stamp}`),
      categoryIds: [a.id, b.id],
    });

    const { item } = await getInventoryItemAs(admin, { itemId: id });
    expect(item.categories.map((c) => c.name).sort()).toEqual(
      [`Alpha-${stamp}`, `Beta-${stamp}`].sort()
    );
  });

  it("removing one category leaves the other", async () => {
    const stamp = Date.now();
    const admin = await makeUser(`ic2-${stamp}@x.com`, "admin");
    const a = await createCategoryAs(admin, {
      domain: "inventory",
      name: `Keep-${stamp}`,
      type: null,
    });
    const b = await createCategoryAs(admin, {
      domain: "inventory",
      name: `Drop-${stamp}`,
      type: null,
    });
    const { id } = await createInventoryItemAs(admin, {
      ...baseItemInput(`Widget2-${stamp}`),
      categoryIds: [a.id, b.id],
    });

    await updateInventoryItemAs(admin, {
      id,
      ...baseItemInput(`Widget2-${stamp}`),
      categoryIds: [a.id],
    });

    const { item } = await getInventoryItemAs(admin, { itemId: id });
    expect(item.categories.map((c) => c.name)).toEqual([`Keep-${stamp}`]);
  });

  it("deleting a category removes the assignment and keeps the item", async () => {
    const stamp = Date.now();
    const admin = await makeUser(`ic3-${stamp}@x.com`, "admin");
    const a = await createCategoryAs(admin, {
      domain: "inventory",
      name: `Doomed-${stamp}`,
      type: null,
    });
    const { id } = await createInventoryItemAs(admin, {
      ...baseItemInput(`Widget3-${stamp}`),
      categoryIds: [a.id],
    });

    await deleteCategoryAs(admin, a.id);

    const { item } = await getInventoryItemAs(admin, { itemId: id });
    expect(item).toBeDefined();
    expect(item.categories).toEqual([]);
  });

  it("filters on ALL selected categories, not any", async () => {
    const stamp = Date.now();
    const admin = await makeUser(`ic4-${stamp}@x.com`, "admin");
    const a = await createCategoryAs(admin, {
      domain: "inventory",
      name: `A-${stamp}`,
      type: null,
    });
    const b = await createCategoryAs(admin, {
      domain: "inventory",
      name: `B-${stamp}`,
      type: null,
    });
    const both = await createInventoryItemAs(admin, {
      ...baseItemInput(`Both-${stamp}`),
      categoryIds: [a.id, b.id],
    });
    await createInventoryItemAs(admin, {
      ...baseItemInput(`OnlyA-${stamp}`),
      categoryIds: [a.id],
    });

    const result = await listInventoryAs(admin, {
      categories: [a.id, b.id],
      page: 1,
      pageSize: 24,
      q: "",
      status: null,
    });

    expect(result.rows.map((r) => r.id)).toEqual([both.id]);
  });
});
```

Add a local `baseItemInput(name: string)` helper returning the non-category fields `createInventoryItemAs` requires, so the four tests do not repeat them.

The fourth test is the one that pins `all` rather than `any`: the item carrying only one of the two selected categories must be **excluded**.

- [ ] **Step 2: Run to verify they fail**

Run: `ulimit -n 8192 && npx vitest run --config vitest.integration.config.ts src/server/__tests__/inventory.integration.test.ts`
Expected: FAIL, `categoryIds` is not a known property.

- [ ] **Step 3: Add the join-table writer**

In `src/server/_internal/categories.ts`, beside `setProjectCategoriesAs`, add a mirror. It takes an optional transaction so item create and update can write categories inside the transaction they already open:

```ts
export async function setInventoryItemCategoriesAs(
  viewer: AuthUser,
  data: { itemId: string; categoryIds: string[] },
  tx?: Tx
) {
  assertStaff(viewer);
  const run = async (executor: Tx) => {
    await executor
      .delete(inventoryItemCategories)
      .where(eq(inventoryItemCategories.itemId, data.itemId));
    if (data.categoryIds.length > 0) {
      await executor.insert(inventoryItemCategories).values(
        data.categoryIds.map((cid) => ({
          itemId: data.itemId,
          categoryId: cid,
        }))
      );
    }
  };
  if (tx) {
    await run(tx);
  } else {
    await db.transaction(run);
  }
  return { itemId: data.itemId, count: data.categoryIds.length };
}
```

Reuse the `Tx` type already exported from `src/server/_internal/inventory-transitions.ts` rather than declaring a second one.

- [ ] **Step 4: Thread categories through the item write path**

In `src/server/_internal/inventory.ts`:

- Replace `categoryId: string | null` with `categoryIds: string[]` on `CreateInventoryItemInput` (and therefore `UpdateInventoryItemInput`).
- In `createInventoryItemAs` and `updateInventoryItemAs`, call `setInventoryItemCategoriesAs(viewer, { itemId, categoryIds: data.categoryIds }, tx)` inside the existing transaction.
- Remove the category entry from `EDITABLE_FIELDS`; categories are no longer a column. Record the change as one edit-log entry whose before and after are the category **names**, joined with `"; "`, resolved inside the transaction. Never log UUIDs: the log previously held readable names.

In `src/server/inventory.ts`, replace `categoryId` in `itemPayloadSchema` with:

```ts
  categoryIds: z.array(z.string().uuid()).max(20).default([]),
```

- [ ] **Step 5: Thread categories through the read path**

Replace the single-category join with an aggregate so each row carries an array. Use a correlated subquery rather than a join, which would multiply item rows:

```ts
const categoriesForItem = sql<
  { id: string; name: string }[]
>`coalesce((
  SELECT json_agg(json_build_object('id', c.id, 'name', c.name) ORDER BY c.name)
  FROM inventory_item_categories iic
  JOIN categories c ON c.id = iic.category_id
  WHERE iic.item_id = ${inventoryItems.id}
), '[]'::json)`;
```

Add it to `stripForPublic` and `fullForStaff` as `categories`, replacing `categoryId`/`categoryName`, and to every listing that previously joined `categories`.

Rewrite `listInventoryCategoriesImpl` to read in-use categories through the join table, still excluding retired items.

Change the filter in `buildInventoryScope` from a single `eq` to all-match semantics, mirroring `src/server/_internal/search.ts:40-46`:

```ts
if (data.categories.length > 0) {
  const matching = db
    .select({ itemId: inventoryItemCategories.itemId })
    .from(inventoryItemCategories)
    .where(inArray(inventoryItemCategories.categoryId, data.categories))
    .groupBy(inventoryItemCategories.itemId)
    .having(sql`count(*) = ${data.categories.length}`);
  conditions.push(inArray(inventoryItems.id, matching));
}
```

Rename the input field from `category: string | null` to `categories: string[]` on both `ListInventoryInput` and `ListAdminInventoryInput`, and update both zod schemas in `src/server/inventory.ts` to `z.array(z.string().uuid()).max(20).default([])`.

- [ ] **Step 6: Update the existing inventory tests**

`inventory.integration.test.ts` and `admin-inventory.integration.test.ts` set and assert `categoryId`. Update each to create a real inventory category and pass `categoryIds`.

- [ ] **Step 7: Run everything**

```bash
ulimit -n 8192 && npx vitest run --config vitest.integration.config.ts src/server/__tests__/inventory.integration.test.ts src/server/__tests__/admin-inventory.integration.test.ts
npm run typecheck
```

Expected: tests PASS. `npm run typecheck` still fails, but only in `src/routes/_authed/admin/categories/index.tsx` and the two inventory form routes, which Tasks 4 and 6 own. Confirm no file under `src/server/` appears in that list; if one does, it is yours.

**Prove the all-match filter discriminates:** temporarily drop the `.having(...)` clause, confirm the fourth test fails because the one-category item is returned too, then restore it. Paste both runs.

- [ ] **Step 8: Commit**

```bash
npm run check
git add -A
git commit -m "feat(inventory)!: give items many categories

Mirrors project_categories. Filtering requires all selected categories
to match, matching the projects listing rather than inventing any-match.
The edit log records category names, not UUIDs."
```

---

### Task 4: Project and Inventory tabs on /admin/categories

**Files:**
- Modify: `src/routes/_authed/admin/categories/index.tsx`, `src/routes/_authed/admin/categories/$categoryId.tsx`

**Interfaces:**
- Consumes: `listCategoriesImpl({ domain })` and the discriminated `CategoryInput` from Task 2.
- Produces: nothing.

**Why tabs and not two tables on one page:** `useAdminTableState` puts `sort`, `dir` and `cols` in the URL. Two `AdminDataTable`s on one page collide on all three. Tabs mount one at a time, so the existing params work unchanged, and `parseSort` already falls back to the page default when a sort id does not exist in the other table. `/my/items` and `/admin/inventory/requests` establish the pattern.

- [ ] **Step 1: Add the tab to the search schema and loader**

```tsx
const searchSchema = z.object({
  cols: z.string().optional(),
  dir: z.enum(["asc", "desc"]).optional(),
  sort: z.string().optional(),
  tab: z.enum(["project", "inventory"]).default("project"),
});
```

Add `tab` to `loaderDeps` and load only that domain's rows:

```tsx
  loaderDeps: ({ search }) => ({ tab: search.tab }),
  loader: async ({ deps }) => {
    const [{ rows }, { types }] = await Promise.all([
      listCategories({ data: { domain: deps.tab } }),
      listCategoryTypes(),
    ]);
    return { rows, types };
  },
```

- [ ] **Step 2: Render the tabs**

Follow the tab markup in `src/routes/_authed/my/items.tsx:49-77`: a row of buttons with a bottom border on the active one, navigating with `navigate({ search: ... })`. Label them "Project categories" and "Inventory categories".

- [ ] **Step 3: Two column sets and two dialogs**

Define `PROJECT_COLUMNS` (Name, Type, Created, Actions) and `INVENTORY_COLUMNS` (Name, Created, Actions) as module constants, and pick between them on `tab`. The inventory set has **no Type column**.

Give each tab its own create dialog:
- Project: Name plus the existing `CategoryTypeCombobox`, submitting `{ domain: "project", name, type }`.
- Inventory: Name only, submitting `{ domain: "inventory", name, type: null }`. Its description should say what it makes, for example "Add a category for inventory items."

Delete the `offeredTypes` union and its `INVENTORY_CATEGORY_TYPE` import; there is nothing to offer any more.

Use distinct `storageKey`s (`"categories-project"`, `"categories-inventory"`) so column preferences do not bleed between tabs.

- [ ] **Step 4: Update the edit route and its delete warning**

`$categoryId.tsx` must not offer a type field for an inventory category. Read the category's domain and render accordingly.

The delete confirmation currently reads "Projects tagged with it will lose the tag, and inventory items using it will lose their category." Join-table deletes now **cascade**, so reword to state that the category is removed from any projects and inventory items using it. Both remain intact.

- [ ] **Step 5: Verify in the running app**

```bash
npm run db:seed:dev
npm run dev
```

As an admin on `/admin/categories`: the Inventory tab shows no Type column; its create dialog has no type field; the word "inventory" appears nowhere as a selectable type; the tab is in the URL and a link to it restores that tab; and column choices in one tab do not affect the other.

- [ ] **Step 6: Commit**

```bash
npm run check
git add src/routes/_authed/admin/categories/
git commit -m "feat(admin-categories): split project and inventory into tabs

The flat Type column rendered a domain and four facets as five peers.
The inventory tab has no Type column and no type field, so 'inventory'
is never a selectable value."
```

---

### Task 5: A creatable, domain-aware multi-select

**Files:**
- Modify: `src/components/category-multi-select.tsx`, `src/components/category-chip.tsx`
- Test: `src/test/category-multi-select.test.tsx` (create)

**Interfaces:**
- Consumes: `listCategories({ data: { domain } })` and `createCategory` from Task 2.
- Produces: `<CategoryMultiSelect domain={"project"|"inventory"} value={string[]} onChange={(ids) => void} />`. Tasks 6 and 7 use it.

Two existing details make this more than adding a prop:

- The component **groups by `type`** into `<fieldset>`s. Inventory categories have a null `type`, so grouping must degrade to a single flat list for that domain rather than rendering a fieldset legend of `null`.
- `CategoryChip` renders `category.type` unconditionally and would show an empty span for inventory.

- [ ] **Step 1: Write the failing test**

Create `src/test/category-multi-select.test.tsx`, matching the conventions in `src/test/user-picker.test.tsx` (the `// @vitest-environment jsdom` pragma, `@testing-library/react`, and mocking the server function module).

Cover: project categories render grouped by type; inventory categories render as one flat list with no legend; typing an unknown name offers a create option; choosing it calls `createCategory` with the component's own domain and selects the result; and typing an existing name offers no create option.

- [ ] **Step 2: Run to verify it fails**

Run: `ulimit -n 8192 && npx vitest run src/test/category-multi-select.test.tsx`
Expected: FAIL, the component takes no `domain` prop.

- [ ] **Step 3: Rework the component**

Add `domain: "project" | "inventory"` to `Props` and pass it to `listCategories`. Remove the `INVENTORY_CATEGORY_TYPE` import.

Render grouped fieldsets only when `domain === "project"`; for inventory render a single unlabelled list. Keep the checkbox interaction as it is.

Replace the dead-end empty state. Instead of "No categories yet. Create some in /admin/categories.", show the create affordance itself, so an empty state is a starting point rather than a wall.

Add creation, following the pattern `CategoryTypeCombobox` already uses for types: a text input whose non-matching trimmed value offers `Create "<name>"`.

The two domains need different payloads, because a project category requires a facet and an inventory one forbids it:

- **Inventory:** the create control is the name input alone. It calls `createCategory({ data: { domain: "inventory", name, type: null } })`.
- **Project:** the create control shows the name input **and** a `CategoryTypeCombobox` for the facet, and the Create action stays disabled until both are set. It calls `createCategory({ data: { domain: "project", name, type } })`.

After a successful create, add the new id to `value` via `onChange` and refresh the loaded list so the new option renders checked.

Server errors surface inline next to the control. Do not swallow them: a duplicate name or a rejected domain shape must be visible, since this control is now the primary way categories get made.

- [ ] **Step 4: Make the chip type-optional**

In `category-chip.tsx`, change `Category.type` to `string | null` and render the type span only when it is set.

- [ ] **Step 5: Run to verify it passes**

Run: `ulimit -n 8192 && npx vitest run src/test/category-multi-select.test.tsx`
Expected: PASS.

**Prove the create test discriminates:** temporarily hard-code the created domain to `"project"`, confirm the inventory create test fails, then restore it.

- [ ] **Step 6: Commit**

```bash
npm run check
git add src/components/category-multi-select.tsx src/components/category-chip.tsx src/test/category-multi-select.test.tsx
git commit -m "feat(categories): make the multi-select domain-aware and creatable

Replaces the 'create some in /admin/categories' dead end, which was a
dead end on the project form too. Inventory categories have no facet, so
that domain renders one flat list instead of grouped fieldsets."
```

---

### Task 6: The inventory item form and item displays

**Files:**
- Modify: `src/components/inventory-form.tsx`, `src/routes/_authed/inventory/new.tsx`, `src/routes/_authed/inventory/$itemId/edit.tsx`, `src/components/inventory-card.tsx`, `src/components/inventory-row.tsx`, `src/routes/inventory/$itemId.tsx`, `src/routes/_authed/admin/inventory/index.tsx`

**Interfaces:**
- Consumes: `CategoryMultiSelect` from Task 5; item rows carrying `categories` from Task 3.
- Produces: nothing.

- [ ] **Step 1: Swap the form field**

In `inventory-form.tsx`, replace `categoryId: z.string().uuid().nullable().default(null)` with:

```ts
  categoryIds: z.array(z.string().uuid()).max(20).default([]),
```

Replace the Select with `<CategoryMultiSelect domain="inventory" ... />` bound to that field. Delete the `NO_CATEGORY` sentinel and the `categories` prop, since the component loads its own options now. Update the `satisfies Required<z.input<typeof itemPayloadSchema>>` annotation's payload accordingly.

- [ ] **Step 2: Simplify both routes**

`new.tsx` and `$itemId/edit.tsx` no longer need to load categories, since the component does. Remove those loader calls and the `categories` prop. In `edit.tsx`, map the loaded item's `categories` to `categoryIds: item.categories.map((c) => c.id)` for the form's initial values.

- [ ] **Step 3: Render chips everywhere an item shows its category**

In `inventory-card.tsx`, `inventory-row.tsx`, `routes/inventory/$itemId.tsx` and the admin inventory table, replace the single category name with a list of `<CategoryChip>`. Render nothing when the array is empty rather than an empty container.

- [ ] **Step 4: Update the CSV export column**

In `src/routes/_authed/admin/inventory/index.tsx`, replace the `Category name`/`Category ID` columns with one `Categories` column joining the names with `"; "`, matching the projects export. The `defineCsvColumns<Row>()` exhaustiveness check will fail the build until the column set matches the row shape, which is the intended guard.

- [ ] **Step 5: Verify in the running app**

```bash
npm run db:seed:dev
npm run dev
```

Create an inventory item with two categories, save, reopen the edit form and confirm both are preselected. Remove one, save, confirm only the other remains. From the empty state, create a brand-new category directly in the form and confirm it is selected and appears in `/admin/categories`'s Inventory tab. Confirm cards, rows, the detail page and the admin table all render chips.

- [ ] **Step 6: Commit**

```bash
npm run check
npm run typecheck
git add -A
git commit -m "feat(inventory): pick many categories, and create them inline

The item form no longer dead-ends when no categories exist."
```

---

### Task 7: The public filter, the accessibility sweep, and the docs

**Files:**
- Modify: `src/components/inventory-filter-bar.tsx`, `src/routes/inventory/index.tsx`, `README.md`, `docs/QUIRKS.md`

**Interfaces:**
- Consumes: the `categories: string[]` list param from Task 3.
- Produces: nothing.

- [ ] **Step 1: Change the search param**

In `src/routes/inventory/index.tsx`, replace `category: z.string().uuid().nullable().default(null)` with:

```ts
  categories: z.array(z.string().uuid()).max(20).catch([]).default([]),
```

Use `.catch([])` so a stale `?category=Electronics` link degrades to no filter rather than a 500, matching how the current schema uses `.catch`.

Update `loaderDeps` and the server call to pass `categories`.

- [ ] **Step 2: Make the filter bar multi-select**

Change `categories: { id: string; name: string }[]` to stay as it is, and change the single `Select` to a multi-select control. Reuse the existing checkbox-list shape from `CategoryMultiSelect` rather than inventing a new control, or use the `Popover` + `Command` combination already used by `CategoryTypeCombobox`.

Label it so the semantics are visible, for example "Categories (matches all selected)", because all-match is not the default assumption a user brings.

- [ ] **Step 3: Verify the semantics in the app**

```bash
npm run db:seed:dev
npm run dev
```

On `/inventory`, select two categories and confirm only items carrying **both** appear. Confirm the URL carries both ids and that pasting it restores the selection. Confirm an old `?category=Electronics` link loads with no filter rather than erroring.

- [ ] **Step 4: Run the accessibility suite**

```bash
npm run db:seed:dev
npm run test:accessibility
```

Expected: 96/96 or better. This covers `/admin/categories`, `/inventory`, and both item form routes, all of which changed. If a new violation appears, fix it rather than adjusting the test.

- [ ] **Step 5: Update the docs**

In `docs/QUIRKS.md`, replace the inventory-category note from the previous design with one covering the current model: `domain` is a closed enum and `type` is an open, nullable facet that applies only to the project domain; and inventory filtering is all-match, matching projects.

In `README.md`, confirm the inventory-categories roadmap bullet is still absent (it was removed by earlier work) and add nothing new.

- [ ] **Step 6: Full verification**

```bash
npm run check
npm run typecheck
ulimit -n 8192 && npm run test
ulimit -n 8192 && npm run test:integration
npm run db:seed:dev && npm run test:accessibility
```

Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(inventory): filter the public listing by multiple categories

All selected categories must match, matching the projects listing."
```

---

## Done when

- `/admin/categories` has Project and Inventory tabs, and "inventory" never appears as a selectable type anywhere in the UI.
- An inventory item carries multiple categories, and a new one can be created from the item form.
- `grep -rn "INVENTORY_CATEGORY_TYPE\|excludeTypes" src` returns nothing.
- Exactly one migration covers this feature, `db:generate` reports no changes, and both `inventory_items_search_vector_idx` and `inventory_item_categories_category_idx` exist.
- `npm run check`, `npm run typecheck`, `npm run test`, `npm run test:integration` and `npm run test:accessibility` all pass.
