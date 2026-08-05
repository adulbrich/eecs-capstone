# Inventory Categories in the Categories Store Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `inventory_items.category` free text with a foreign key into the `categories` table, so inventory categories are managed in `/admin/categories` and picked from a dropdown in the inventory new/edit forms.

**Architecture:** Inventory categories become rows in the existing shared `categories` table with `type = 'inventory'`. `inventory_items` gains `category_id` with `ON DELETE SET NULL`. A hand-written migration promotes every distinct existing string to a real category, backfills the key, and rebuilds the generated `search_vector` without the category term. Project category pickers gain a type exclusion so inventory categories never leak into them.

**Tech Stack:** TypeScript, Drizzle ORM, PostgreSQL, TanStack Start, Zod, Vitest.

Spec: [`docs/superpowers/specs/2026-08-05-admin-export-inventory-categories-holds-design.md`](../specs/2026-08-05-admin-export-inventory-categories-holds-design.md) §2.

## Global Constraints

- **This app is pre-production. No back-compat shims.** Change search params, break old links, delete the old column. Do not add redirects, aliases, or parallel columns.
- Inventory categories are single-valued per item, not many-to-many.
- The rebuilt `search_vector` covers `name` and `description` only. The category term is dropped deliberately.
- `INVENTORY_CATEGORY_TYPE` is the single source of the string `"inventory"`. Never write that literal anywhere else.
- Run `npm run db:migrate` before any integration test run, or every inventory test fails on the missing column.
- Run `npm run check` before every commit.
- Prose in comments and docs uses no emdashes.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/lib/category-types.ts` (create) | `INVENTORY_CATEGORY_TYPE` constant. Pure, no imports. |
| `drizzle/XXXX_*.sql` (create) | The migration. Hand-written, not generated. |
| `src/db/schema.ts` (modify) | `categoryId` replaces `category`; new `searchVector` expression; index list. |
| `src/server/_internal/categories.ts` (modify) | `excludeTypes` support in `listCategoriesImpl`. |
| `src/server/categories.ts` (modify) | `excludeTypes` in the list schema. |
| `src/components/category-multi-select.tsx` (modify) | Exclude inventory categories. |
| `src/components/projects-filter-bar.tsx` (modify) | Exclude inventory categories. |
| `src/routes/_authed/admin/categories/index.tsx` (modify) | Offer `inventory` in the type combobox union. |
| `src/components/inventory-form.tsx` (modify) | Category text input becomes a Select. |
| `src/routes/_authed/inventory/new.tsx`, `.../$itemId/edit.tsx` (modify) | Load and pass the category list. |
| `src/server/_internal/inventory.ts` (modify) | Join for the category name; rewrite `listInventoryCategoriesImpl`. |
| `src/routes/inventory/index.tsx`, `src/components/inventory-filter-bar.tsx` (modify) | `?category=` carries a UUID. |
| `scripts/seed-dev.ts` (modify) | Seed inventory categories. |

---

### Task 1: The constant and the migration

**Files:**
- Create: `src/lib/category-types.ts`
- Create: `drizzle/XXXX_inventory_category_fk.sql`
- Modify: `src/db/schema.ts:309-356`

**Interfaces:**
- Consumes: nothing.
- Produces: `INVENTORY_CATEGORY_TYPE` (the literal `"inventory"`), and `inventoryItems.categoryId` on the Drizzle schema. Every later task depends on both.

Two traps this task encodes. **The generated `search_vector` must be dropped before the column it reads**, or the `DROP COLUMN category` fails. And **dropping `search_vector` silently drops the GIN index** `inventory_items_search_vector_idx` created in `drizzle/0003_last_invaders.sql:103`, with no error. Forgetting to recreate it leaves inventory search working but unindexed, which stays invisible until the table grows.

- [ ] **Step 1: Add the constant**

Create `src/lib/category-types.ts`:

```ts
/**
 * The `categories.type` value that marks a category as belonging to inventory
 * rather than to projects.
 *
 * Inventory categories live in the same table as the project category types
 * (project_type, technology, industry, field) but are a different domain: the
 * project pickers exclude this type, and the inventory form selects only it.
 * Single source of the string so a typo cannot silently create a second,
 * invisible domain.
 */
export const INVENTORY_CATEGORY_TYPE = "inventory" as const;
```

- [ ] **Step 2: Update the Drizzle schema**

In `src/db/schema.ts`, in the `inventoryItems` table:

Replace `category: text("category"),` with:

```ts
    categoryId: uuid("category_id").references(() => categories.id, {
      onDelete: "set null",
    }),
```

Replace the `searchVector` generated expression with one that no longer reads `category`:

```ts
    searchVector: tsvector("search_vector")
      .notNull()
      .generatedAlwaysAs(
        sql`setweight(to_tsvector('english', coalesce(name, '')), 'A') || setweight(to_tsvector('english', coalesce(description, '')), 'B')`
      ),
```

In the index list, replace `index("inventory_items_category_idx").on(t.category),` with:

```ts
    index("inventory_items_category_id_idx").on(t.categoryId),
```

`categories` is declared above `inventoryItems` in this file, so the reference resolves without reordering.

- [ ] **Step 3: Write the migration by hand**

Find the next migration number: `ls drizzle/*.sql | tail -3`. Create `drizzle/XXXX_inventory_category_fk.sql` using that number, with `--> statement-breakpoint` between statements exactly as the existing files do:

```sql
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
```

Register it in `drizzle/meta/_journal.json` the way the existing entries are registered. Read the last entry and copy its shape, incrementing `idx` and setting a `when` timestamp.

Do **not** run `npm run db:generate` for this. Drizzle would emit the column add and drop but not the two backfill statements, and would order the drops wrongly.

- [ ] **Step 4: Apply and verify the migration**

```bash
docker compose up -d
npm run db:migrate
```

Then verify the index actually came back, which is the trap this task exists to avoid:

```bash
docker compose exec -T postgres psql -U postgres -d eecs_capstone -c "\d inventory_items"
```

Expected: a `category_id` column, no `category` column, a `search_vector` generated column, and **both** `inventory_items_search_vector_idx` (gin) and `inventory_items_category_id_idx` in the index list.

If your Postgres runs on a non-default port per the README's port-conflict section, use the port from your `.env`.

- [ ] **Step 5: Typecheck to find every consumer**

Run: `npm run typecheck`
Expected: FAIL, with errors at every site that reads `.category` on an inventory item. Save this list; Tasks 3 through 5 work through it. The compiler is the checklist here.

- [ ] **Step 6: Commit**

```bash
npm run check
git add src/lib/category-types.ts src/db/schema.ts drizzle/
git commit -m "feat(inventory)!: make category a foreign key into categories

Promotes every distinct category string to a categories row with
type='inventory' and backfills category_id.

The generated search_vector is dropped before the column it reads, then
rebuilt from name and description only. Dropping it also drops the GIN
index from 0003 silently, so the migration recreates that explicitly.

Typecheck fails after this commit until the consumers are updated."
```

---

### Task 2: Keep inventory categories out of the project pickers

**Files:**
- Modify: `src/server/_internal/categories.ts:27-39`
- Modify: `src/server/categories.ts` (the `listSchema`, near line 19)
- Modify: `src/components/category-multi-select.tsx:23`
- Modify: `src/components/projects-filter-bar.tsx:57`
- Modify: `src/routes/_authed/admin/categories/index.tsx`
- Test: `src/server/__tests__/categories.integration.test.ts` (extend)

**Interfaces:**
- Consumes: `INVENTORY_CATEGORY_TYPE` from Task 1.
- Produces: `listCategoriesImpl({ type?, excludeTypes? })`. Task 3 calls it with `{ type: INVENTORY_CATEGORY_TYPE }`.

`CategoryMultiSelect` and `projects-filter-bar` both call `listCategories({ data: {} })` with no type filter, so without this task every inventory category appears in the project category picker the moment the migration runs.

- [ ] **Step 1: Write the failing test**

Append to `src/server/__tests__/categories.integration.test.ts`:

```ts
it("excludes types the caller asked to omit", async () => {
  const admin = await makeUser(`ex-${Date.now()}@x.com`, "admin");
  await createCategoryAs(admin, { name: "React", type: "technology" });
  await createCategoryAs(admin, { name: "Electronics", type: "inventory" });

  const all = await listCategoriesImpl({});
  const projectOnly = await listCategoriesImpl({
    excludeTypes: ["inventory"],
  });

  expect(all.rows.map((r) => r.name)).toContain("Electronics");
  expect(projectOnly.rows.map((r) => r.name)).not.toContain("Electronics");
  expect(projectOnly.rows.map((r) => r.name)).toContain("React");
});
```

Add `listCategoriesImpl` to the existing `#/server/_internal/categories` import.

- [ ] **Step 2: Run to verify it fails**

Run: `ulimit -n 8192 && npx vitest run --config vitest.integration.config.ts src/server/__tests__/categories.integration.test.ts`
Expected: FAIL, `excludeTypes` is not a valid argument / the assertion on `not.toContain` fails.

- [ ] **Step 3: Implement `excludeTypes`**

Replace `listCategoriesImpl` in `src/server/_internal/categories.ts`:

```ts
export async function listCategoriesImpl(data: {
  type?: string | null;
  excludeTypes?: string[] | null;
}) {
  const conditions: SQL[] = [];
  if (data.type) {
    conditions.push(eq(categories.type, data.type));
  }
  if (data.excludeTypes?.length) {
    conditions.push(notInArray(categories.type, data.excludeTypes));
  }
  const rows = await db
    .select()
    .from(categories)
    .where(conditions.length ? and(...conditions) : undefined)
    // Ordering by type first is what groups the project pickers; a single
    // type filter makes the first key a no-op, which is harmless.
    .orderBy(categories.type, categories.name);
  return { rows };
}
```

Add `and`, `notInArray`, and the `SQL` type to the `drizzle-orm` import at the top of the file.

Note this collapses the previous two-branch implementation, which ordered by `name` alone when a type was given and by `type, name` otherwise. Within a single type the two orders are identical, so no caller changes behavior.

In `src/server/categories.ts`, widen the list schema:

```ts
const listSchema = z.object({
  type: z.string().nullable().optional(),
  excludeTypes: z.array(z.string()).max(20).nullable().optional(),
});
```

- [ ] **Step 4: Run to verify it passes**

Run: `ulimit -n 8192 && npx vitest run --config vitest.integration.config.ts src/server/__tests__/categories.integration.test.ts`
Expected: PASS.

- [ ] **Step 5: Update the two project consumers**

In `src/components/category-multi-select.tsx`, change the fetch to:

```tsx
        const { rows } = await listCategories({
          data: { excludeTypes: [INVENTORY_CATEGORY_TYPE] },
        });
```

In `src/components/projects-filter-bar.tsx`, change the `listCategories({ data: {} })` call the same way. Import `INVENTORY_CATEGORY_TYPE` from `#/lib/category-types` in both.

Leave `/admin/categories` calling it unfiltered. That page manages every type, which is the requirement.

- [ ] **Step 6: Make `inventory` offerable in the type combobox**

`listCategoryTypesImpl` derives types from existing rows. On a database where no item ever had a category string, the backfill inserted nothing, so `inventory` would never appear and staff would have to guess the magic string, with a typo silently creating a dead type.

In `src/routes/_authed/admin/categories/index.tsx`, inside the component, replace the bare `types` passed to `CategoryTypeCombobox` with a union:

```tsx
  // The inventory type must be offerable even before the first inventory
  // category exists, since listCategoryTypes only knows types already in use.
  const offeredTypes = useMemo(
    () => [...new Set([...types, INVENTORY_CATEGORY_TYPE])].sort(),
    [types]
  );
```

Pass `types={offeredTypes}` to the combobox. Import `useMemo` from React and `INVENTORY_CATEGORY_TYPE` from `#/lib/category-types`.

- [ ] **Step 7: Verify in the running app**

Run: `npm run dev`
- On `/admin/categories`, open New category: the Type combobox offers `inventory` even on a database with none.
- Create an inventory category, then open `/projects/new`: it must **not** appear in the project category picker.
- On the public `/projects` listing, it must not appear in the category filter.

- [ ] **Step 8: Commit**

```bash
npm run check
git add src/server/_internal/categories.ts src/server/categories.ts src/components/category-multi-select.tsx src/components/projects-filter-bar.tsx src/routes/_authed/admin/categories/index.tsx src/server/__tests__/categories.integration.test.ts
git commit -m "feat(categories): add excludeTypes and keep inventory out of project pickers

Both project pickers listed every category regardless of type. Also
offers the inventory type in the admin combobox before any inventory
category exists, since listCategoryTypes only knows types already in use."
```

---

### Task 3: The inventory form picks from the store

**Files:**
- Modify: `src/components/inventory-form.tsx:25,59,88,146`
- Modify: `src/routes/_authed/inventory/new.tsx`
- Modify: `src/routes/_authed/inventory/$itemId/edit.tsx:14,65`

**Interfaces:**
- Consumes: `INVENTORY_CATEGORY_TYPE`, `listCategoriesImpl` with a `type` filter.
- Produces: `InventoryForm` gains a required `categories: { id: string; name: string }[]` prop; `inventoryFormSchema.categoryId` is `string | null`.

- [ ] **Step 1: Change the form schema and values**

In `src/components/inventory-form.tsx`, in `inventoryFormSchema`, replace
`category: z.string().max(120).default(""),` with:

```ts
  categoryId: z.string().uuid().nullable().default(null),
```

In `defaultValues`, replace `category: initial?.category ?? "",` with:

```ts
      categoryId: initial?.categoryId ?? null,
```

In the submit handler (near line 88), replace `category: value.category || null,` with:

```ts
          categoryId: value.categoryId,
```

The `|| null` coercion is gone on purpose: the value is already `string | null`, and an empty string is no longer representable.

- [ ] **Step 2: Add the prop and swap the field**

Add to `interface Props`:

```ts
  /** Inventory categories from /admin/categories, for the picker. */
  categories: { id: string; name: string }[];
```

Destructure `categories` in the component signature. Replace the
`<Field form={form} label="Category" name="category" />` line with a Select
bound to the form field, following the file's existing `Field` pattern for
label and error wiring:

```tsx
      <form.Field name="categoryId">
        {(field) => (
          <div className="flex flex-col gap-2">
            <Label htmlFor="item-category">Category</Label>
            <Select
              onValueChange={(value) =>
                field.handleChange(value === NO_CATEGORY ? null : value)
              }
              value={field.state.value ?? NO_CATEGORY}
            >
              <SelectTrigger className="w-full" id="item-category">
                <SelectValue placeholder="No category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_CATEGORY}>No category</SelectItem>
                {categories.map((category) => (
                  <SelectItem key={category.id} value={category.id}>
                    {category.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </form.Field>
```

Add above the component:

```tsx
// Radix Select cannot hold an empty-string value, so "no category" needs a
// sentinel that is mapped back to null on change.
const NO_CATEGORY = "_none_";
```

Import `Label` (already imported) and the Select parts from `./ui/select`. Read how `program-select.tsx` renders its Select and match it, including the `_all_`-style sentinel convention already used in `inventory-filter-bar.tsx`.

- [ ] **Step 3: Load the categories in both routes**

In `src/routes/_authed/inventory/new.tsx`, add to the loader:

```tsx
  loader: async () => {
    const { rows } = await listCategories({
      data: { type: INVENTORY_CATEGORY_TYPE },
    });
    return { categories: rows };
  },
```

If the route already has a loader, merge this into it with `Promise.all`, following the pattern in `src/routes/_authed/admin/categories/index.tsx:67`. Pass `categories={categories}` to `<InventoryForm>`.

In `src/routes/_authed/inventory/$itemId/edit.tsx`, do the same, and change the `category: string | null;` field in its local loaded-item type (line 14) to `categoryId: string | null;`, and the `category: loaded.category ?? "",` initial value (line 65) to:

```tsx
            categoryId: loaded.categoryId,
```

- [ ] **Step 4: Verify in the running app**

Run: `npm run dev`
- Create an inventory item: the Category field is a dropdown listing the categories created in Task 2, plus "No category".
- Save, reopen the edit form: the saved category is preselected.
- Save with "No category": the item persists with a null category.

- [ ] **Step 5: Commit**

```bash
npm run check
git add src/components/inventory-form.tsx src/routes/_authed/inventory/
git commit -m "feat(inventory): pick the item category from the categories store

Replaces the free-text field, which let Electronics, electronics and
Electronic coexist as three categories that nothing could rename together."
```

---

### Task 4: The public listing filters by category ID

**Files:**
- Modify: `src/server/_internal/inventory.ts` (`stripForPublic` near line 73, `fullForStaff` near line 90, the listing joins, and `listInventoryCategoriesImpl` near line 330)
- Modify: `src/server/inventory.ts` (the `category` field in `listInventorySchema`, line 30)
- Modify: `src/components/inventory-filter-bar.tsx:23,66-73`
- Modify: `src/routes/inventory/index.tsx:32,48,91-93`

**Interfaces:**
- Consumes: the `categoryId` column from Task 1.
- Produces: item rows carrying `categoryId` and a joined `categoryName`; `listInventoryCategoriesImpl` returning `{ categories: { id: string; name: string }[] }`.

- [ ] **Step 1: Carry the category name through the projections**

In `src/server/_internal/inventory.ts`, every listing query already joins `user` for the holder. Add a second left join for the category:

```ts
    .leftJoin(categories, eq(inventoryItems.categoryId, categories.id))
```

Left, not inner: `categoryId` is nullable and an inner join would silently drop every uncategorized item.

Add `categoryName: categories.name` to each of those `select` projections, then thread it through `stripForPublic` and `fullForStaff`. Those two helpers currently take a raw row; give them a second parameter for the joined name rather than widening the row type:

```ts
function stripForPublic(
  row: typeof inventoryItems.$inferSelect,
  categoryName: string | null
): InventoryItemPublic {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    categoryId: row.categoryId,
    categoryName,
    imageUrl: row.imageUrl,
    status: row.status,
    // The hold's dates live on the item itself, so they are the same whether
    // the hold came from a cart request or from staff assigning it directly.
    pickupBy: row.currentPickupBy,
    dueAt: row.currentDueAt,
  };
}
```

Update the `InventoryItemPublic` and `InventoryItemStaff` types to match, and update every call site the compiler flags.

- [ ] **Step 2: Filter by ID**

Find where `buildInventoryScope` filters on category and change it from a text equality to `eq(inventoryItems.categoryId, data.category)`.

In `src/server/inventory.ts`, change the listing schema field:

```ts
  category: z.string().uuid().nullable().default(null),
```

- [ ] **Step 3: Rewrite the category list**

Replace `listInventoryCategoriesImpl`:

```ts
export async function listInventoryCategoriesImpl() {
  // Restricted to categories actually in use, so the dropdown never offers a
  // filter that returns nothing.
  const rows = await db
    .selectDistinct({ id: categories.id, name: categories.name })
    .from(inventoryItems)
    .innerJoin(categories, eq(inventoryItems.categoryId, categories.id))
    .where(ne(inventoryItems.status, "retired"))
    .orderBy(categories.name);
  return { categories: rows };
}
```

- [ ] **Step 4: Update the filter bar and the route**

In `src/components/inventory-filter-bar.tsx`, change the prop type:

```ts
  categories: { id: string; name: string }[];
```

and render each option as `<SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>`.

In `src/routes/inventory/index.tsx`, change the search schema field to `category: z.string().uuid().nullable().default(null),`. The rest of the wiring is unchanged: the param already flows through `loaderDeps` to the server.

Old `?category=Electronics` links now fail validation and fall back to the default. That is intended; this project does not add back-compat aliases.

- [ ] **Step 5: Verify in the running app**

Run: `npm run dev`
- On `/inventory`, the Category dropdown lists categories by name and filtering works.
- The URL now carries a UUID.
- An item with no category still appears when no filter is set.
- Search still finds items by name and description.

- [ ] **Step 6: Run the inventory tests**

Run: `ulimit -n 8192 && npx vitest run --config vitest.integration.config.ts src/server/__tests__/inventory.integration.test.ts src/server/__tests__/admin-inventory.integration.test.ts`

These will fail where they set or assert `category` as text. Update each to create a real category and use its id. Expected after updating: PASS.

- [ ] **Step 7: Commit**

```bash
npm run check
git add src/server/_internal/inventory.ts src/server/inventory.ts src/components/inventory-filter-bar.tsx src/routes/inventory/index.tsx src/server/__tests__/
git commit -m "feat(inventory)!: filter the public listing by category id

The ?category= search param now carries a UUID instead of a name, so
existing links break. Intended: pre-production, no back-compat aliases."
```

---

### Task 5: Admin table, seeds, and the full sweep

**Files:**
- Modify: `src/routes/_authed/admin/inventory/index.tsx`
- Modify: `src/components/inventory-card.tsx`, `inventory-row.tsx`, `src/routes/inventory/$itemId.tsx` (wherever the compiler still flags `.category`)
- Modify: `scripts/seed-dev.ts`

**Interfaces:**
- Consumes: `categoryName` on item rows from Task 4.
- Produces: nothing new.

- [ ] **Step 1: Let the compiler find the rest**

Run: `npm run typecheck`
Work through every remaining `.category` error, replacing each read with `.categoryName` for display and `.categoryId` for identity. The admin inventory table's category column and its filter dropdown are both in this list.

If the sibling CSV export plan has already landed, its `EXPORT_COLUMNS` in that route has a `Category` line reading `row.category`; change it to `row.categoryName`.

- [ ] **Step 2: Seed inventory categories**

In `scripts/seed-dev.ts`, insert a few categories with `type: INVENTORY_CATEGORY_TYPE` (for example Electronics, Test equipment, Tools, Cables), then assign `categoryId` on the seeded items by picking from those. Follow the file's existing idempotency approach so re-running stays safe, as the README promises.

- [ ] **Step 3: Verify end to end**

```bash
npm run db:seed:dev
npm run dev
```

- `/admin/inventory` shows category names and filters by them.
- `/inventory` shows category names on cards and rows.
- An item detail page shows its category.
- `/admin/categories` lists the inventory categories alongside the project ones.
- Renaming a category in `/admin/categories` changes it everywhere at once. This is the whole point of the change; confirm it explicitly.
- Deleting a category leaves its items intact and uncategorized.

- [ ] **Step 4: Full verification**

```bash
npm run check
npm run typecheck
ulimit -n 8192 && npm run test
ulimit -n 8192 && npm run test:integration
```

Expected: all pass, with zero remaining references to `inventoryItems.category`.

Confirm that last claim: `grep -rn "\.category\b" src | grep -v categoryId | grep -v categoryName`
Expected: no hits on inventory code.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(inventory): show category names from the store and seed them

Completes the FK migration: renaming a category in /admin/categories now
changes it on every item at once."
```

---

## Done when

- No code references `inventory_items.category`; the column no longer exists.
- Both `inventory_items_search_vector_idx` and `inventory_items_category_id_idx` exist in the database.
- Inventory categories appear in `/admin/categories` and never in the project category pickers.
- `npm run check`, `npm run typecheck`, `npm run test` and `npm run test:integration` all pass.
- Update `README.md`: remove the "categories for inventory items should be managed in /admin/categories" roadmap line.
- Consider a `docs/QUIRKS.md` note that this migration is the second precedent for dropping and rebuilding a generated tsvector column, including the silent GIN index loss.
