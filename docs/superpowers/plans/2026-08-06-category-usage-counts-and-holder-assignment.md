# Category Usage Counts and Holder Assignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show how many projects or items are filed under each category in `/admin/categories`, and replace the three-mode inventory holder assignment with a single email-or-label rule that lets one student request an item and a teammate collect it.

**Architecture:** Part A adds a `usage_count` scalar subquery to a new staff-gated server function, leaving the ungated `listCategories` (which feeds two dropdowns) untouched. Part B keeps `holderId` on the internal `TransitionInput` but removes it from the wire schema, so the dialog can only assign by address or label while `approveRequestItemAs` keeps passing an id it already holds; `resolveHolder` derives the missing half of the pair either way, which is what keeps `current_holder_email` populated on every person hold.

**Tech Stack:** TanStack Start server functions, Drizzle ORM on Postgres, React 19, shadcn/ui, Vitest (unit + integration), Zod.

**Spec:** `docs/superpowers/specs/2026-08-06-category-usage-counts-and-holder-assignment-design.md`

## Global Constraints

- **Prose contains no emdashes.** Use commas, colons, or parentheses. Applies to comments, commit messages, and UI copy.
- **No back-compat shims.** The app is pre-production. Delete and restructure rather than adding aliases, redirects, or parallel columns. No data backfills.
- **Test commands need the sandbox disabled and a raised fd limit.** Vitest binds `127.0.0.1` and sets up watchers.
  - Unit: `ulimit -n 8192; CI=true npm test`
  - Integration: `ulimit -n 8192; CI=true npm run test:integration`
  - Integration runs truncate every table in `beforeEach`, wiping dev seed data.
- **Before every commit:** `npm run check` and `npm run typecheck` in full, never per-file. `npm run check` includes the formatter, and a line that grew by one argument can fail CI on width alone.
- **`npm exec -- ultracite fix`** resolves most formatting failures automatically.
- Migrations are generated with `npm run db:generate` and applied with `npm run db:migrate`. Never hand-write a migration file that drizzle-kit can generate.

## File Structure

**Part A**

| File | Responsibility |
| --- | --- |
| `src/db/schema.ts` | add `project_categories_category_idx` |
| `src/server/_internal/categories.ts` | `listCategoriesWithUsageAs`, the `usageCount` SQL fragment |
| `src/server/categories.ts` | `listCategoriesWithUsage` server function |
| `src/routes/_authed/admin/categories/index.tsx` | count column per tab, CSV column, loader switch |
| `src/server/__tests__/categories.integration.test.ts` | count semantics |

**Part B**

| File | Responsibility |
| --- | --- |
| `src/db/schema.ts` | five new nullable text columns |
| `src/server/_internal/inventory-transitions.ts` | `resolveHolder`, the new invariant, history writes |
| `src/server/_internal/inventory.ts` | `submitCartAs` address, `holderNameOf`, `listMyItemsAs` guard, overdue scan, `collectedByForRequestItems`, `getItemHistoryAs` projection |
| `src/server/inventory.ts` | `transitionSchema` loses `holderId`, gains name and program |
| `src/components/holder-field.tsx` | **new**: the email-or-label input, replaces `user-picker.tsx` |
| `src/components/inventory-lifecycle-panel.tsx` | dialog rewrite, holder display, history holder line |
| `src/components/admin-request-queue-row.tsx` | "Collected by" line |
| `src/routes/_authed/admin/inventory/requests.tsx` | pass `collectedBy` through |
| `src/routes/_authed/my/items.tsx` | "Collected by" on active and history entries |
| `src/routes/_authed/admin/inventory/index.tsx` | CSV column for `currentHolderProgram` |
| `src/test/holder-field.test.tsx` | **new**, replaces `src/test/user-picker.test.tsx` |
| `src/server/__tests__/inventory.integration.test.ts` | cross-person checkout, overdue, collected-by |
| `docs/QUIRKS.md` | overdue-scan disjointness entry rewritten |

Part A (Tasks 1 to 2) and Part B (Tasks 3 to 10) are independent and may be done in either order.

---

## Task 1: Category usage counts on the server

**Files:**
- Modify: `src/db/schema.ts:187-198` (the `projectCategories` table)
- Modify: `src/server/_internal/categories.ts` (add after `listCategoriesImpl`, which ends at line 55)
- Modify: `src/server/categories.ts` (add after `listCategories`, which ends at line 59)
- Test: `src/server/__tests__/categories.integration.test.ts`

**Interfaces:**
- Consumes: `assertStaff(viewer)` and the `AuthUser` interface, both already in `src/server/_internal/categories.ts:21-34`.
- Produces: `listCategoriesWithUsage` server function, returning `{ rows: Array<{ id: string; name: string; domain: "project" | "inventory"; type: string | null; createdAt: Date; usageCount: number }> }`. Task 2 consumes this exact shape.

- [ ] **Step 1: Write the failing test**

Add to `src/server/__tests__/categories.integration.test.ts`. Note the imports at the top of that file need `projects` and `inventoryItems` and `inventoryItemCategories` added to the `#/db/schema` import, and `listCategoriesWithUsageAs` added to the `#/server/_internal/categories` import.

```ts
describe("listCategoriesWithUsageAs", () => {
  it("counts published and archived projects but not drafts or deleted ones", async () => {
    const admin = await makeUser("usage-admin@x.com", "admin");
    const { id: categoryId } = await createCategoryAs(admin, {
      domain: "project",
      name: "Robotics",
      type: "technology",
    });

    const inserted = await db
      .insert(projects)
      .values([
        { title: "Published", status: "published" },
        { title: "Archived", status: "archived" },
        { title: "Draft", status: "draft" },
        { title: "Deleted", status: "published", deletedAt: new Date() },
      ])
      .returning({ id: projects.id });
    await db
      .insert(projectCategories)
      .values(inserted.map((p) => ({ projectId: p.id, categoryId })));

    const { rows } = await listCategoriesWithUsageAs(admin, {
      domain: "project",
    });
    const row = rows.find((r) => r.id === categoryId);
    expect(row?.usageCount).toBe(2);
  });

  it("counts inventory items for an inventory category", async () => {
    const admin = await makeUser("usage-admin-2@x.com", "admin");
    const { id: categoryId } = await createCategoryAs(admin, {
      domain: "inventory",
      name: "Cables",
      type: null,
    });
    const items = await db
      .insert(inventoryItems)
      .values([{ name: "USB-C" }, { name: "HDMI" }])
      .returning({ id: inventoryItems.id });
    await db
      .insert(inventoryItemCategories)
      .values(items.map((i) => ({ itemId: i.id, categoryId })));

    const { rows } = await listCategoriesWithUsageAs(admin, {
      domain: "inventory",
    });
    expect(rows.find((r) => r.id === categoryId)?.usageCount).toBe(2);
  });

  it("returns a number, not a bigint string", async () => {
    const admin = await makeUser("usage-admin-3@x.com", "admin");
    await createCategoryAs(admin, {
      domain: "inventory",
      name: "Empty",
      type: null,
    });
    const { rows } = await listCategoriesWithUsageAs(admin, {
      domain: "inventory",
    });
    expect(typeof rows[0].usageCount).toBe("number");
  });

  it("refuses a non-staff viewer", async () => {
    const student = await makeUser("usage-student@x.com", "user");
    await expect(
      listCategoriesWithUsageAs(student, { domain: "project" })
    ).rejects.toThrow("Forbidden");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run with the sandbox disabled:

```bash
ulimit -n 8192; CI=true npm run test:integration -- categories
```

Expected: FAIL, `listCategoriesWithUsageAs is not a function` (or an import error).

- [ ] **Step 3: Add the index to the schema**

`project_categories` today has only its composite primary key, which leads with `project_id`. Counting by `category_id` has no supporting index, while `inventory_item_categories` already has `inventory_item_categories_category_idx`.

In `src/db/schema.ts`, replace the `projectCategories` definition's final argument:

```ts
  (t) => [
    primaryKey({ columns: [t.projectId, t.categoryId] }),
    // The primary key only serves project -> categories. Counting "how many
    // projects carry this category" reads the other way, exactly as
    // inventory_item_categories_category_idx already serves the item side.
    index("project_categories_category_idx").on(t.categoryId),
  ]
```

- [ ] **Step 4: Generate and apply the migration**

```bash
npm run db:generate
npm run db:migrate
```

Expected: a new `drizzle/00NN_*.sql` containing `CREATE INDEX "project_categories_category_idx"`. Read the generated file before applying; if it contains anything other than that index, stop and investigate.

- [ ] **Step 5: Write the count query**

Append to `src/server/_internal/categories.ts`. The `inventoryItems`, `projects` and `sql` imports may already be present; add whatever is missing.

Note the doubled `sql` wrapper on `usageCount`. It is not decoration. Drizzle's
single-table selection builder strips table qualifiers from every column inside
a computed field when the outer query has no joins, so the single-layer form
emits `where "category_id" = "id"`, where `"id"` binds to `projects.id` rather
than the correlated `categories.id`, and the count silently returns 0. One more
`sql` layer preserves the qualifiers, emitting
`where "project_categories"."category_id" = "categories"."id"`. The SQL text is
otherwise identical. Do not "simplify" this by removing the outer layer.

```ts
/**
 * Counts what is filed under each category, in the same round trip that
 * fetches the rows.
 *
 * A CASE with both domains named explicitly, rather than one aggregate per
 * junction table joined onto every row: `categories.domain` is immutable
 * (see updateCategoryAs), so a project category can never have inventory
 * rows and Postgres evaluates only the arm its domain selects. `else 0`
 * rather than falling through to the inventory count, so a third domain
 * added later reports zero instead of silently reporting the wrong table.
 *
 * `::int` because count() returns bigint, which node-postgres hands back as
 * a string: without the cast the column arrives as "12" and sorts
 * lexicographically, putting 9 after 12.
 */
const usageCount = sql<number>`${sql`(
  case ${categories.domain}
    when 'project' then (
      select count(*)::int
      from ${projectCategories}
      join ${projects}
        on ${projects.id} = ${projectCategories.projectId}
       and ${projects.deletedAt} is null
       and ${projects.status} <> 'draft'
      where ${projectCategories.categoryId} = ${categories.id})
    when 'inventory' then (
      select count(*)::int
      from ${inventoryItemCategories}
      where ${inventoryItemCategories.categoryId} = ${categories.id})
    else 0
  end
)`}`;

/**
 * The staff-only sibling of listCategoriesImpl. Deliberately a separate
 * function rather than a flag: listCategories is reachable without a session
 * (the public project filter bar calls it), and it feeds two dropdowns that
 * have no use for an aggregate.
 *
 * A draft project is not counted. It is visible only to its owner, so
 * counting it would inflate the answer to "how much is filed here".
 */
export async function listCategoriesWithUsageAs(
  viewer: AuthUser,
  data: { domain?: CategoryDomain | null; type?: string | null }
) {
  assertStaff(viewer);
  const conditions: SQL[] = [];
  if (data.domain) {
    conditions.push(eq(categories.domain, data.domain));
  }
  if (data.type) {
    conditions.push(eq(categories.type, data.type));
  }
  const rows = await db
    .select({
      id: categories.id,
      name: categories.name,
      domain: categories.domain,
      type: categories.type,
      createdAt: categories.createdAt,
      usageCount,
    })
    .from(categories)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(categories.type, categories.name);
  return { rows };
}

export async function listCategoriesWithUsageForCurrentUser(data: {
  domain?: CategoryDomain | null;
  type?: string | null;
}) {
  const viewer = await requireUser();
  return listCategoriesWithUsageAs(viewer, data);
}
```

- [ ] **Step 6: Add the server function**

Append to `src/server/categories.ts`:

```ts
export const listCategoriesWithUsage = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => listSchema.parse(data ?? {}))
  .handler(async ({ data }) => {
    const { listCategoriesWithUsageForCurrentUser } = await import(
      "./_internal/categories"
    );
    return listCategoriesWithUsageForCurrentUser(data);
  });
```

- [ ] **Step 7: Run the tests to verify they pass**

```bash
ulimit -n 8192; CI=true npm run test:integration -- categories
```

Expected: PASS, all four new cases green, and every pre-existing case in the file still green.

- [ ] **Step 8: Check and commit**

```bash
npm run check
npm run typecheck
git add src/db/schema.ts drizzle/ src/server/_internal/categories.ts src/server/categories.ts src/server/__tests__/categories.integration.test.ts
git commit -m "feat(categories): count what is filed under each category

A staff-gated sibling of listCategories rather than a flag on it: the
public filter bar and two dropdowns call the existing function and have no
use for an aggregate. Drafts and soft-deleted projects are excluded. Adds
the project_categories(category_id) index the count reads through, which
the inventory junction table already had."
```

---

## Task 2: Usage count column in /admin/categories

**Files:**
- Modify: `src/routes/_authed/admin/categories/index.tsx`

**Interfaces:**
- Consumes: `listCategoriesWithUsage` from Task 1, returning rows with `usageCount: number`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Switch the loader and row type**

In `src/routes/_authed/admin/categories/index.tsx`, change the import at line 45-50 to pull `listCategoriesWithUsage` instead of `listCategories`, keeping `listCategoryTypes` and the `listSchema` type import:

```ts
import {
  createCategory,
  listCategoriesWithUsage,
  listCategoryTypes,
  type listSchema,
} from "#/server/categories";
```

Then the loader body (line 76-79):

```ts
    const [{ rows }, { types }] = await Promise.all([
      listCategoriesWithUsage({ data: listData }),
      listCategoryTypes(),
    ]);
```

And the row type (line 85):

```ts
type Row = Awaited<ReturnType<typeof listCategoriesWithUsage>>["rows"][number];
```

- [ ] **Step 2: Run typecheck to see the export column fail**

```bash
npm run typecheck
```

Expected: FAIL in `src/routes/_authed/admin/categories/index.tsx` with `MISSING_CSV_COLUMN_FOR: "usageCount"`. This is `defineCsvColumns<Row>()` doing its job: a field of `Row` with no CSV column is a compile error, so a projection can never silently miss the export file.

- [ ] **Step 3: Add the two count columns and the CSV column**

Insert after `NAME_COLUMN` (which ends at line 96):

```ts
// One column definition per tab rather than one shared "Usage": the header
// has to name what was counted, and the domain decides which junction table
// the count came from.
const PROJECT_USAGE_COLUMN: AdminColumn<Row> = {
  accessorFn: (row) => row.usageCount,
  cell: ({ row }) => row.original.usageCount,
  header: "Projects",
  id: "usageCount",
  // Numeric, not the locale-compare default, which would compare String(n)
  // and sort 10 before 2.
  sortingFn: "basic",
};

const INVENTORY_USAGE_COLUMN: AdminColumn<Row> = {
  ...PROJECT_USAGE_COLUMN,
  header: "Items",
};
```

Then the two column lists (lines 134-145):

```ts
const PROJECT_COLUMNS: AdminColumn<Row>[] = [
  NAME_COLUMN,
  PROJECT_USAGE_COLUMN,
  TYPE_COLUMN,
  CREATED_COLUMN,
  ACTIONS_COLUMN,
];

const INVENTORY_COLUMNS: AdminColumn<Row>[] = [
  NAME_COLUMN,
  INVENTORY_USAGE_COLUMN,
  CREATED_COLUMN,
  ACTIONS_COLUMN,
];
```

And add to `EXPORT_COLUMNS`, after the Domain entry:

```ts
  { header: "Usage", key: "usageCount", value: (row) => row.usageCount },
```

- [ ] **Step 4: Run typecheck and the unit suite**

```bash
npm run typecheck
ulimit -n 8192; CI=true npm test
```

Expected: both PASS.

- [ ] **Step 5: Verify in the browser**

```bash
npm run db:seed:dev
npm run dev
```

Open `http://localhost:3000/admin/categories`. Expected: a `Projects` column on the project tab and an `Items` column on the inventory tab, both sortable and both present in the exported CSV. Sort by the count and confirm 10 sorts after 9, not before it.

- [ ] **Step 6: Check and commit**

```bash
npm run check
npm run typecheck
git add src/routes/_authed/admin/categories/index.tsx
git commit -m "feat(categories): show usage counts in the admin table

Projects on the project tab, Items on the inventory tab, both numerically
sorted and both in the CSV export."
```

---

## Task 3: Holder columns migration

**Files:**
- Modify: `src/db/schema.ts:325-370` (`inventoryItems`) and `:466-494` (`inventoryItemStatusHistory`)
- Create: `drizzle/00NN_*.sql` (generated)

**Interfaces:**
- Produces: `inventoryItems.currentHolderName`, `inventoryItems.currentHolderProgram`, `inventoryItemStatusHistory.holderEmail`, `.holderName`, `.holderProgram`. Every later Part B task reads or writes these.

- [ ] **Step 1: Add the item columns**

In `src/db/schema.ts`, in `inventoryItems`, directly after `currentHolderLabel` (line 345):

```ts
    // Only meaningful for a hold whose address matched no account: when there
    // is an account, it is authoritative for both and these stay null.
    // Program is free text, not a reference to `programs`, because a walk-in
    // may name a course the table does not have and staff should not be
    // blocked at the counter by that.
    currentHolderName: text("current_holder_name"),
    currentHolderProgram: text("current_holder_program"),
```

- [ ] **Step 2: Add the history columns**

In `inventoryItemStatusHistory`, directly after `holderLabel` (line 486):

```ts
    // Recording the address separately is what lets holder_label go back to
    // meaning a label. Before this, an address that matched no account was
    // written into holder_label, so history could not tell "assigned to an
    // address with no account" from "assigned to the label bob@example.com".
    holderEmail: text("holder_email"),
    holderName: text("holder_name"),
    holderProgram: text("holder_program"),
```

- [ ] **Step 3: Generate and read the migration**

```bash
npm run db:generate
```

Expected: a new `drizzle/00NN_*.sql` with five `ALTER TABLE ... ADD COLUMN` statements and nothing else. Read it. In particular confirm it does **not** drop and recreate `inventory_items.search_vector`: that column is `GENERATED ALWAYS AS ... STORED`, and dropping it also drops its GIN index without warning (see `docs/QUIRKS.md:229`). Adding unrelated nullable columns should not touch it.

- [ ] **Step 4: Apply the migration**

```bash
npm run db:migrate
```

- [ ] **Step 5: Verify the search vector index survived**

```bash
psql "$DATABASE_URL" -c "SELECT indexname FROM pg_indexes WHERE tablename = 'inventory_items';"
```

Expected: `inventory_items_search_vector_idx` is present, alongside the status and holder indexes.

- [ ] **Step 6: Run the inventory integration suite unchanged**

```bash
ulimit -n 8192; CI=true npm run test:integration -- inventory
```

Expected: PASS. The columns are additive and nullable, so nothing should change behavior yet.

- [ ] **Step 7: Check and commit**

```bash
npm run check
npm run typecheck
git add src/db/schema.ts drizzle/
git commit -m "feat(inventory): add holder name, program and history email columns

Name and program describe a holder whose address matched no account.
holder_email on the history table ends the conflation where an unmatched
address was written into holder_label."
```

---

## Task 4: resolveHolder and the email-or-label invariant

**Files:**
- Modify: `src/server/_internal/inventory-transitions.ts:22-33` (`TransitionInput`), `:46-97` (`validateInvariants`), `:99-119` (`resolveHolderId`), `:150-228` (`transitionItemInTx`), `:280-300` (`maybeNotify`)
- Test: `src/server/__tests__/inventory.integration.test.ts`

**Interfaces:**
- Consumes: the columns from Task 3.
- Produces: `TransitionInput` with `holderName` and `holderProgram` added and `holderId` retained; `resolveHolder(tx, input): Promise<{ email: string | null; id: string | null }>`. Tasks 5 through 10 depend on `transitionItem` writing `current_holder_email` for every person hold.

**The invariant this establishes:** `current_holder_label` is non-null if and only if `current_holder_email` is null. A hold is on a person (an address) or on a thing (a label), never both and never neither. `current_holder_id` is not a third identity; it is the account the address resolved to.

- [ ] **Step 1: Write the failing tests**

Append to `src/server/__tests__/inventory.integration.test.ts`. The file's existing `makeUser` and `makeItem` helpers are at lines 41-60.

```ts
describe("holder resolution", () => {
  it("stores the address when only an account id is given", async () => {
    const admin = await makeUser("resolve-admin@x.com", "admin");
    const holder = await makeUser("resolve-holder@x.com", "user");
    const item = await makeItem();

    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "checked_out",
      holderId: holder.id,
      dueAt: new Date(Date.now() + 86_400_000),
    });

    const [row] = await db
      .select()
      .from(inventoryItems)
      .where(eq(inventoryItems.id, item.id));
    expect(row.currentHolderId).toBe(holder.id);
    expect(row.currentHolderEmail).toBe("resolve-holder@x.com");
    expect(row.currentHolderLabel).toBeNull();
  });

  it("resolves an address to an account and ignores a supplied name", async () => {
    const admin = await makeUser("resolve-admin-2@x.com", "admin");
    const holder = await makeUser("resolve-holder-2@x.com", "user");
    const item = await makeItem();

    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "checked_out",
      holderEmail: "resolve-holder-2@x.com",
      holderName: "Typed Name",
      holderProgram: "CS 461",
      dueAt: new Date(Date.now() + 86_400_000),
    });

    const [row] = await db
      .select()
      .from(inventoryItems)
      .where(eq(inventoryItems.id, item.id));
    expect(row.currentHolderId).toBe(holder.id);
    expect(row.currentHolderName).toBeNull();
    expect(row.currentHolderProgram).toBeNull();
  });

  it("keeps name and program for an address with no account", async () => {
    const admin = await makeUser("resolve-admin-3@x.com", "admin");
    const item = await makeItem();

    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "checked_out",
      holderEmail: "walkin@nowhere.test",
      holderName: "Walk In",
      holderProgram: "CS 462",
      dueAt: new Date(Date.now() + 86_400_000),
    });

    const [row] = await db
      .select()
      .from(inventoryItems)
      .where(eq(inventoryItems.id, item.id));
    expect(row.currentHolderId).toBeNull();
    expect(row.currentHolderEmail).toBe("walkin@nowhere.test");
    expect(row.currentHolderName).toBe("Walk In");
    expect(row.currentHolderProgram).toBe("CS 462");
    expect(row.currentHolderLabel).toBeNull();
  });

  it("records the address on the history row instead of the label", async () => {
    const admin = await makeUser("resolve-admin-4@x.com", "admin");
    const item = await makeItem();

    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "checked_out",
      holderEmail: "history@nowhere.test",
      dueAt: new Date(Date.now() + 86_400_000),
    });

    const [h] = await db
      .select()
      .from(inventoryItemStatusHistory)
      .where(eq(inventoryItemStatusHistory.itemId, item.id));
    expect(h.holderEmail).toBe("history@nowhere.test");
    expect(h.holderLabel).toBeNull();
  });

  it("rejects a hold with both an address and a label", async () => {
    const admin = await makeUser("resolve-admin-5@x.com", "admin");
    const item = await makeItem();
    await expect(
      transitionItem(admin, {
        itemId: item.id,
        nextStatus: "checked_out",
        holderEmail: "both@nowhere.test",
        holderLabel: "Lab 204",
        dueAt: new Date(Date.now() + 86_400_000),
      })
    ).rejects.toThrow();
  });

  it("rejects a hold with neither", async () => {
    const admin = await makeUser("resolve-admin-6@x.com", "admin");
    const item = await makeItem();
    await expect(
      transitionItem(admin, {
        itemId: item.id,
        nextStatus: "checked_out",
        dueAt: new Date(Date.now() + 86_400_000),
      })
    ).rejects.toThrow();
  });

  it("still notifies the requester on approve", async () => {
    const admin = await makeUser("approve-admin@x.com", "admin");
    const student = await makeUser("approve-student@x.com", "user");
    const item = await makeItem();
    await addToCartAs(student, { itemId: item.id });
    const { requestId } = await submitCartAs(student, { note: null });
    expect(requestId).not.toBeNull();
    const [line] = await db
      .select()
      .from(inventoryRequestItems)
      .where(eq(inventoryRequestItems.itemId, item.id));

    await approveRequestItemAs(admin, {
      requestItemId: line.id,
      pickupBy: null,
    });

    const notes = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, student.id));
    expect(
      notes.some((n) => n.type === "inventory_request_approved")
    ).toBe(true);
  });
});
```

The last case is the regression the id-derives-address path exists to prevent: `approveRequestItemAs` passes only `holderId`, and if `resolveHolder` failed to produce an id from it, `maybeNotify` would silently stop firing.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
ulimit -n 8192; CI=true npm run test:integration -- inventory
```

Expected: the six new holder cases FAIL (`currentHolderEmail` is null, name and program columns are undefined on the input type). The approve case should PASS already, since it is asserting current behavior that must survive.

- [ ] **Step 3: Widen TransitionInput**

Replace `src/server/_internal/inventory-transitions.ts:22-33`:

```ts
export interface TransitionInput {
  comment?: string | null;
  dueAt?: Date | null;
  /** Assigns the hold to an address, with or without a matching account. */
  holderEmail?: string | null;
  /**
   * An already-resolved account. Not reachable from the dialog: transitionSchema
   * omits it, so staff cannot assign a hold by id. Only approveRequestItemAs
   * and submitCartAs pass it, because they already hold the id and the address
   * is derived from it.
   */
  holderId?: string | null;
  holderLabel?: string | null;
  /** Describes a holder with no account. Discarded when one is resolved. */
  holderName?: string | null;
  holderProgram?: string | null;
  itemId: string;
  nextStatus: ItemStatus;
  pickupBy?: Date | null;
  requestItemId?: string | null;
}
```

- [ ] **Step 4: Rewrite validateInvariants**

Replace `src/server/_internal/inventory-transitions.ts:46-97`:

```ts
function validateInvariants(input: TransitionInput) {
  const {
    nextStatus,
    holderId,
    holderEmail,
    holderLabel,
    holderName,
    holderProgram,
    requestItemId,
    pickupBy,
    dueAt,
  } = input;

  switch (nextStatus) {
    case "available":
    case "maintenance":
    case "retired":
      if (
        holderId ||
        holderEmail ||
        holderLabel ||
        holderName ||
        holderProgram ||
        requestItemId
      ) {
        throw new Error(
          `Cannot set holder or request on transition to ${nextStatus}`
        );
      }
      if (pickupBy || dueAt) {
        throw new Error(
          `pickupBy / dueAt not allowed on transition to ${nextStatus}`
        );
      }
      return;
    case "requested":
      if (!(requestItemId && holderId) || holderEmail || holderLabel) {
        throw new Error(
          "requested status requires requestItemId + holderId, no email or label"
        );
      }
      return;
    case "reserved":
    case "checked_out": {
      // A hold is on a person or on a thing, never both and never neither.
      // An id and an address both identify the same person, so they count as
      // one; name and program are attributes of that person, not a third
      // identity, and are excluded from the test entirely.
      const onAPerson = Boolean(holderId || holderEmail);
      const onAThing = Boolean(holderLabel);
      if (onAPerson === onAThing) {
        throw new Error(
          `${nextStatus} requires either a holder email or a holder label, not both and not neither`
        );
      }
      if (nextStatus === "checked_out" && !dueAt) {
        throw new Error("checked_out requires dueAt");
      }
      return;
    }
    default:
      return;
  }
}
```

The `requested` arm is left exactly as it was. Nothing reaches it today: `submitCartAs` performs the requested transition inline rather than through `transitionItem`, because it runs as the student and `transitionItem` asserts staff. Tightening a dead arm would be theater.

- [ ] **Step 5: Replace resolveHolderId with resolveHolder**

Replace `src/server/_internal/inventory-transitions.ts:99-119`:

```ts
interface ResolvedHolder {
  email: string | null;
  id: string | null;
}

/**
 * Completes the (account, address) pair from whichever half the caller had,
 * the same way a project's proposerEmail resolves to a proposerId.
 *
 * An address supplied by the caller always wins over a supplied id, because
 * it is the address the hold was actually assigned to. Deriving the address
 * in the id-only direction is what keeps current_holder_email populated for
 * callers that never had one to give (approveRequestItemAs), which is what
 * makes "a person hold always has an address" true on every write path.
 */
async function resolveHolder(
  tx: Tx,
  input: TransitionInput
): Promise<ResolvedHolder> {
  if (input.holderEmail) {
    const [match] = await tx
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, input.holderEmail));
    return { email: input.holderEmail, id: match?.id ?? null };
  }
  if (input.holderId) {
    const [account] = await tx
      .select({ email: user.email })
      .from(user)
      .where(eq(user.id, input.holderId));
    return { email: account?.email ?? null, id: input.holderId };
  }
  return { email: null, id: null };
}
```

- [ ] **Step 6: Rewrite the transition body**

Replace `src/server/_internal/inventory-transitions.ts:150-228` (`transitionItemInTx`) entirely:

```ts
async function transitionItemInTx(
  tx: Tx,
  viewer: Viewer,
  input: TransitionInput
) {
  const holder = await resolveHolder(tx, input);
  // The account is authoritative for anyone who has one, so a typed name or
  // program is dropped rather than stored alongside it and left to drift.
  const holderName = holder.id ? null : (input.holderName ?? null);
  const holderProgram = holder.id ? null : (input.holderProgram ?? null);

  const [current] = await tx
    .select()
    .from(inventoryItems)
    .where(eq(inventoryItems.id, input.itemId))
    .for("update");

  if (!current) {
    throw new Error("Item not found");
  }

  // Guard: a fresh request can only attach to an item that is currently
  // free. Without this, callers could orphan an existing pending line by
  // overwriting current_request_item_id silently.
  if (input.nextStatus === "requested" && current.status !== "available") {
    throw new Error(
      `Cannot move item to requested from ${current.status}; release the existing hold first`
    );
  }

  await tx
    .update(inventoryItems)
    .set({
      status: input.nextStatus,
      currentHolderId: holder.id,
      currentHolderEmail: holder.email,
      currentHolderLabel: input.holderLabel ?? null,
      currentHolderName: holderName,
      currentHolderProgram: holderProgram,
      // Writing the hold's dates here on every transition means releasing an
      // item clears them for free, with no separate reset path.
      currentPickupBy: input.pickupBy ?? null,
      currentDueAt: input.dueAt ?? null,
      currentRequestItemId: input.requestItemId ?? null,
      updatedAt: new Date(),
    })
    .where(eq(inventoryItems.id, input.itemId));

  await tx.insert(inventoryItemStatusHistory).values({
    itemId: input.itemId,
    oldStatus: current.status,
    newStatus: input.nextStatus,
    changedBy: viewer.id,
    comment: input.comment ?? null,
    requestItemId: input.requestItemId ?? null,
    holderId: holder.id,
    holderEmail: holder.email,
    holderLabel: input.holderLabel ?? null,
    holderName,
    holderProgram,
  });

  if (input.requestItemId) {
    await syncRequestItem(tx, input);
  } else if (current.currentRequestItemId) {
    // Item is leaving a hold context; close the line.
    await closeRequestItemOnRelease(
      tx,
      current.currentRequestItemId,
      viewer.id,
      current.status,
      input.comment ?? null
    );
  }

  await maybeNotify(tx, current, input, holder.id);
}
```

Note what disappeared: the `const input = { ...rawInput, holderId: await resolveHolderId(...) }` reassignment, and the `holderLabel ?? (holderId ? null : holderEmail)` expression that used to smuggle an address into the label column.

- [ ] **Step 7: Take the resolved id as a parameter in maybeNotify**

In `maybeNotify`, change the signature to accept the resolved id and stop reading it off the input. Replace the signature and the `recipientId` line:

```ts
async function maybeNotify(
  tx: Tx,
  prev: {
    id: string;
    name: string;
    status: ItemStatus;
    currentHolderId: string | null;
    currentRequestItemId: string | null;
  },
  input: TransitionInput,
  holderId: string | null
) {
```

and:

```ts
  const recipientId =
    holderId ?? (isReleaseFromHold ? prev.currentHolderId : null);
```

The rest of the function is unchanged.

- [ ] **Step 8: Run the tests to verify they pass**

```bash
ulimit -n 8192; CI=true npm run test:integration -- inventory
```

Expected: PASS, including all roughly 50 pre-existing `transitionItem` calls. The 25 that pass `holderId` keep working: that is the whole reason the cut was made at the wire schema instead of at `TransitionInput`.

- [ ] **Step 9: Check and commit**

```bash
npm run check
npm run typecheck
git add src/server/_internal/inventory-transitions.ts src/server/__tests__/inventory.integration.test.ts
git commit -m "feat(inventory): a hold is an address or a label, never both

resolveHolder completes the (account, address) pair from whichever half the
caller had, so current_holder_email is populated on every person hold even
when the caller only had an id. Name and program are stored only when no
account matched. History records the address in its own column instead of
smuggling it into holder_label."
```

---

## Task 5: Request holds carry an address too

**Files:**
- Modify: `src/server/_internal/inventory.ts:708-816` (`submitCartAs`), `:99-128` (`fullForStaff`, `holderEmailOf`), `:212-221` and `:273-279` (the two staff projections)
- Modify: `src/routes/_authed/admin/inventory/index.tsx` (`EXPORT_COLUMNS`)
- Test: `src/server/__tests__/inventory.integration.test.ts`

**Interfaces:**
- Consumes: Task 3's columns, Task 4's invariant.
- Produces: `holderNameOf(row)`; `InventoryItemStaff` gains `currentHolderProgram: string | null`. Task 10 renders it.

- [ ] **Step 1: Write the failing test**

```ts
it("gives a self-submitted request hold an address", async () => {
  const student = await makeUser("cart-address@x.com", "user");
  const item = await makeItem();
  await addToCartAs(student, { itemId: item.id });
  await submitCartAs(student, { note: null });

  const [row] = await db
    .select()
    .from(inventoryItems)
    .where(eq(inventoryItems.id, item.id));
  expect(row.currentHolderId).toBe(student.id);
  expect(row.currentHolderEmail).toBe("cart-address@x.com");

  const [h] = await db
    .select()
    .from(inventoryItemStatusHistory)
    .where(eq(inventoryItemStatusHistory.itemId, item.id));
  expect(h.holderEmail).toBe("cart-address@x.com");
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
ulimit -n 8192; CI=true npm run test:integration -- inventory
```

Expected: FAIL, `currentHolderEmail` is null.

- [ ] **Step 3: Fetch the requester's address once in submitCartAs**

`submitCartAs` writes the requested transition inline rather than through `transitionItem`, so it has to satisfy the invariant itself. Add the lookup immediately after the survivors loop and before the request envelope insert (around line 762):

```ts
    // The invariant applies to every person hold, including one a student
    // created for themselves. Fetched once here rather than as a correlated
    // subselect inside each item update below.
    const [requester] = await tx
      .select({ email: user.email })
      .from(user)
      .where(eq(user.id, viewer.id));
```

Then in the per-line loop, change the item update and the history insert:

```ts
      await tx
        .update(inventoryItems)
        .set({
          status: "requested",
          currentHolderId: viewer.id,
          currentHolderEmail: requester?.email ?? null,
          currentHolderLabel: null,
          currentHolderName: null,
          currentHolderProgram: null,
          currentPickupBy: null,
          currentDueAt: null,
          currentRequestItemId: line.id,
          updatedAt: new Date(),
        })
        .where(eq(inventoryItems.id, line.itemId));
      await tx.insert(inventoryItemStatusHistory).values({
        itemId: line.itemId,
        oldStatus: survivor.oldStatus,
        newStatus: "requested",
        changedBy: viewer.id,
        requestItemId: line.id,
        holderId: viewer.id,
        holderEmail: requester?.email ?? null,
      });
```

- [ ] **Step 4: Surface the stored name and program to staff**

In `src/server/_internal/inventory.ts`, add beside `holderEmailOf` (line 118):

```ts
/**
 * Mirrors holderEmailOf. The joined account's name wins, because someone who
 * renamed their account is still the same holder; the stored name is
 * authoritative only for a hold that matched no account.
 */
function holderNameOf(row: {
  holderName: string | null;
  item: { currentHolderName: string | null };
}): string | null {
  return row.holderName ?? row.item.currentHolderName;
}
```

In `fullForStaff`, add one line beside `currentHolderLabel`:

```ts
    currentHolderProgram: row.currentHolderProgram,
```

`currentHolderName` is deliberately **not** added there: it is already a member of `InventoryItemStaffDetail`, resolved from the join, and adding a second source of the same field would leave two values to keep in sync.

Then in both staff projections, use the new helper. In `listInventoryAs` (line 214-218):

```ts
      return {
        ...fullForStaff(r.item, r.categories),
        currentHolderName: holderNameOf(r),
        currentHolderEmail: holderEmailOf(r),
      };
```

and identically in `toStaffDetail` (line 274-278):

```ts
  return {
    ...fullForStaff(row.item, row.categories),
    currentHolderName: holderNameOf(row),
    currentHolderEmail: holderEmailOf(row),
  };
```

`listAdminInventoryAs` (around line 355) carries the same `currentHolderName: r.holderName` mapping; change it to `holderNameOf(r)` too.

- [ ] **Step 5: Run typecheck to see the inventory CSV column fail**

```bash
npm run typecheck
```

Expected: FAIL in `src/routes/_authed/admin/inventory/index.tsx` with `MISSING_CSV_COLUMN_FOR: "currentHolderProgram"`.

- [ ] **Step 6: Add the CSV column**

In `EXPORT_COLUMNS` in `src/routes/_authed/admin/inventory/index.tsx`, after the "Holder label" entry:

```ts
  {
    header: "Holder program",
    key: "currentHolderProgram",
    value: (row) => row.currentHolderProgram,
  },
```

- [ ] **Step 7: Run everything**

```bash
npm run typecheck
ulimit -n 8192; CI=true npm run test:integration -- inventory
ulimit -n 8192; CI=true npm run test:integration -- admin-exports
```

Expected: all PASS.

- [ ] **Step 8: Check and commit**

```bash
npm run check
npm run typecheck
git add src/server/_internal/inventory.ts src/routes/_authed/admin/inventory/index.tsx src/server/__tests__/inventory.integration.test.ts
git commit -m "feat(inventory): give request holds an address and surface holder program

submitCartAs writes the requested transition inline, so it has to satisfy
the address invariant itself. holderNameOf mirrors holderEmailOf: the
account's name wins, the stored one covers a holder with no account."
```

---

## Task 6: The picker sees the item in /my/items

**Files:**
- Modify: `src/server/_internal/inventory.ts:1179-1203` (the holds query inside `listMyItemsAs`)
- Test: `src/server/__tests__/inventory.integration.test.ts`

**Interfaces:**
- Consumes: Task 4's invariant.
- Produces: nothing new; changes which rows `listMyItemsAs` returns.

- [ ] **Step 1: Write the failing test**

```ts
describe("a teammate collects a requested item", () => {
  it("shows the request to the requester and the hold to the picker", async () => {
    const admin = await makeUser("cross-admin@x.com", "admin");
    const requester = await makeUser("cross-requester@x.com", "user");
    const picker = await makeUser("cross-picker@x.com", "user");
    const item = await makeItem();

    await addToCartAs(requester, { itemId: item.id });
    await submitCartAs(requester, { note: null });
    const [line] = await db
      .select()
      .from(inventoryRequestItems)
      .where(eq(inventoryRequestItems.itemId, item.id));
    await approveRequestItemAs(admin, {
      requestItemId: line.id,
      pickupBy: null,
    });

    // The teammate walks in. Staff replace the prefilled address.
    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "checked_out",
      requestItemId: line.id,
      holderEmail: "cross-picker@x.com",
      dueAt: new Date(Date.now() + 86_400_000),
    });

    const requesterView = await listMyItemsAs(requester);
    const requesterEntries = requesterView.active.filter(
      (e) => e.item.id === item.id
    );
    expect(requesterEntries).toHaveLength(1);
    expect(requesterEntries[0].kind).toBe("request");

    const pickerView = await listMyItemsAs(picker);
    const pickerEntries = pickerView.active.filter(
      (e) => e.item.id === item.id
    );
    expect(pickerEntries).toHaveLength(1);
    expect(pickerEntries[0].kind).toBe("hold");
  });

  it("leaves the request line approved so the requester keeps seeing it", async () => {
    const admin = await makeUser("cross-admin-2@x.com", "admin");
    const requester = await makeUser("cross-requester-2@x.com", "user");
    const item = await makeItem();

    await addToCartAs(requester, { itemId: item.id });
    await submitCartAs(requester, { note: null });
    const [line] = await db
      .select()
      .from(inventoryRequestItems)
      .where(eq(inventoryRequestItems.itemId, item.id));
    await approveRequestItemAs(admin, {
      requestItemId: line.id,
      pickupBy: null,
    });
    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "checked_out",
      requestItemId: line.id,
      holderEmail: "someone-else@nowhere.test",
      dueAt: new Date(Date.now() + 86_400_000),
    });

    const [after] = await db
      .select()
      .from(inventoryRequestItems)
      .where(eq(inventoryRequestItems.id, line.id));
    // listMyItemsAs only puts pending and approved lines in the Active tab,
    // and syncRequestItem's checked_out arm sets dueAt without touching
    // status. Asserted directly, because the requester's whole view of a
    // teammate's pickup depends on that arm continuing to leave it alone.
    expect(after.status).toBe("approved");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
ulimit -n 8192; CI=true npm run test:integration -- inventory
```

Expected: the first case FAILS with `pickerEntries` length 0. The item has a `currentRequestItemId`, and the holds query excludes any item that has one.

- [ ] **Step 3: Replace the disjointness guard**

Add `notExists` to the `drizzle-orm` import at the top of `src/server/_internal/inventory.ts`. Then in `listMyItemsAs`, replace `isNull(inventoryItems.currentRequestItemId)` (line 1190) and its comment:

```ts
          // The point of this condition was always "an item must not appear
          // twice on one person's page", not "a held item has no request".
          // Stated that way it also lets a teammate who collected someone
          // else's requested item see the hold they are actually carrying.
          notExists(
            db
              .select({ one: sql`1` })
              .from(inventoryRequestItems)
              .innerJoin(
                inventoryRequests,
                eq(inventoryRequestItems.requestId, inventoryRequests.id)
              )
              .where(
                and(
                  eq(
                    inventoryRequestItems.id,
                    inventoryItems.currentRequestItemId
                  ),
                  eq(inventoryRequests.userId, viewer.id)
                )
              )
          ),
```

A plain staff hold still passes: `current_request_item_id` is null, the correlated comparison is null, the subquery returns nothing, `NOT EXISTS` is true.

- [ ] **Step 4: Run to verify it passes**

```bash
ulimit -n 8192; CI=true npm run test:integration -- inventory
```

Expected: PASS, including the pre-existing "staff hold appears in my items" cases, which must not have started double-counting.

- [ ] **Step 5: Check and commit**

```bash
npm run check
npm run typecheck
git add src/server/_internal/inventory.ts src/server/__tests__/inventory.integration.test.ts
git commit -m "fix(inventory): show a collected item to whoever is carrying it

The holds query excluded any item with a request line, which was written
when the holder was always the requester. Restated as \"not my own request
line\", it keeps the no-duplicates guarantee and stops hiding a teammate's
pickup from the person holding it."
```

---

## Task 7: Both parties hear that an item is overdue

**Files:**
- Modify: `src/server/_internal/inventory.ts:1517-1614` (`recordOverdueNotificationsAs`)
- Modify: `docs/QUIRKS.md:537-539`
- Test: `src/server/__tests__/inventory.integration.test.ts`

**Interfaces:**
- Consumes: Task 6's read path.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing test**

```ts
describe("overdue notifications with two parties", () => {
  async function checkedOutToSomeoneElse(prefix: string) {
    const admin = await makeUser(`${prefix}-admin@x.com`, "admin");
    const requester = await makeUser(`${prefix}-requester@x.com`, "user");
    const picker = await makeUser(`${prefix}-picker@x.com`, "user");
    const item = await makeItem();
    await addToCartAs(requester, { itemId: item.id });
    await submitCartAs(requester, { note: null });
    const [line] = await db
      .select()
      .from(inventoryRequestItems)
      .where(eq(inventoryRequestItems.itemId, item.id));
    await approveRequestItemAs(admin, {
      requestItemId: line.id,
      pickupBy: null,
    });
    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "checked_out",
      requestItemId: line.id,
      holderEmail: `${prefix}-picker@x.com`,
      dueAt: new Date(Date.now() - 86_400_000),
    });
    return { admin, item, picker, requester };
  }

  it("notifies the requester and the picker", async () => {
    const { admin, item, picker, requester } =
      await checkedOutToSomeoneElse("overdue-two");
    await recordOverdueNotificationsAs(admin);

    const notes = await db
      .select()
      .from(notifications)
      .where(eq(notifications.link, `/inventory/${item.id}`));
    const overdue = notes.filter(
      (n) => n.type === "inventory_checkout_overdue"
    );
    expect(overdue.map((n) => n.userId).sort()).toEqual(
      [requester.id, picker.id].sort()
    );
  });

  it("notifies a requester who collected their own item exactly once", async () => {
    const admin = await makeUser("overdue-one-admin@x.com", "admin");
    const student = await makeUser("overdue-one-student@x.com", "user");
    const item = await makeItem();
    await addToCartAs(student, { itemId: item.id });
    await submitCartAs(student, { note: null });
    const [line] = await db
      .select()
      .from(inventoryRequestItems)
      .where(eq(inventoryRequestItems.itemId, item.id));
    await approveRequestItemAs(admin, {
      requestItemId: line.id,
      pickupBy: null,
    });
    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "checked_out",
      requestItemId: line.id,
      holderEmail: "overdue-one-student@x.com",
      dueAt: new Date(Date.now() - 86_400_000),
    });

    await recordOverdueNotificationsAs(admin);

    const notes = await db
      .select()
      .from(notifications)
      .where(eq(notifications.link, `/inventory/${item.id}`));
    expect(
      notes.filter((n) => n.type === "inventory_checkout_overdue")
    ).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
ulimit -n 8192; CI=true npm run test:integration -- inventory
```

Expected: the two-party case FAILS with only the requester's id present.

- [ ] **Step 3: Widen the hold scan**

In `recordOverdueNotificationsAs`, replace `holdConditions` (lines 1554-1558) and the comment above it:

```ts
  // The hold scan and the request scan used to be disjoint, because a held
  // item always had either a request line or a holder, never both meaningfully.
  // Now that a teammate can collect someone else's requested item, the two
  // deliberately overlap: the requester is accountable for the request and the
  // picker is holding the thing, so both are told. Restricted to holds with a
  // resolved account (current_holder_id IS NOT NULL): notifications.userId is
  // a foreign key, and an email-matched hold has no id to attribute a message
  // to. Resolving the address here would reintroduce, on a write path, the
  // impersonation risk the read path in listMyItemsAs guards against.
  const holdConditions = [
    isNotNull(inventoryItems.currentHolderId),
    inArray(inventoryItems.status, ["reserved", "checked_out"]),
  ];
```

- [ ] **Step 4: Dedupe before inserting**

The unique index on `(user_id, type, link)` cannot collapse the two-party case, because the user ids differ, and it should not: that case wants two rows. It also cannot be relied on to collapse the same-person case cleanly, so do that explicitly. Replace the `values` construction (lines 1582-1603):

```ts
  const values: (typeof notifications.$inferInsert)[] = [];
  const seen = new Set<string>();
  const push = (row: typeof notifications.$inferInsert) => {
    // Requester and picker are the same person on most checkouts, so the two
    // scans return the same row twice. One notice, not two.
    const key = `${row.userId}|${row.type}|${row.link}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    values.push(row);
  };

  for (const r of candidates) {
    const { pickupOverdue, checkoutOverdue } = deriveDeadlineFlags(r);
    if (pickupOverdue) {
      push({
        userId: r.userId,
        type: "inventory_pickup_overdue",
        title: `Pickup window passed: ${r.itemName}`,
        message: "Your reserved item is past its pickup window.",
        link: `/inventory/${r.itemId}`,
      });
    }
    if (checkoutOverdue) {
      push({
        userId: r.userId,
        type: "inventory_checkout_overdue",
        title: `Overdue: ${r.itemName}`,
        message: "Your checked-out item is past its due date.",
        link: `/inventory/${r.itemId}`,
      });
    }
  }
```

- [ ] **Step 5: Run to verify it passes**

```bash
ulimit -n 8192; CI=true npm run test:integration -- inventory
```

Expected: PASS, including every pre-existing overdue case.

- [ ] **Step 6: Rewrite the QUIRKS entry**

`docs/QUIRKS.md:537-539` currently claims the two scans are "disjoint by construction", resting on `current_request_item_id IS NULL`. That is no longer true and the overlap is the feature. Replace the disjointness sentences in that entry with:

```markdown
The two scans deliberately overlap. A request line and a hold can describe two
different people, because a teammate can collect an item someone else
requested: the requester is accountable for the request and the picker is
holding the thing, so both are notified. `notifications_overdue_unique_idx` on
`(user_id, type, link)` does not collapse that case, and must not, because the
user ids differ. The far more common case, where requester and picker are the
same person and both scans return them, is collapsed in JS on
`(userId, type, link)` before the insert rather than being left to the index.
```

Leave the rest of the entry, including the note about `listMyItemsAs` matching an unlinked hold by verified email, exactly as it is: it is still accurate.

- [ ] **Step 7: Check and commit**

```bash
npm run check
npm run typecheck
git add src/server/_internal/inventory.ts src/server/__tests__/inventory.integration.test.ts docs/QUIRKS.md
git commit -m "feat(inventory): notify both the requester and the holder when overdue

The hold scan skipped any item with a request line, so a teammate holding
someone else's requested item was never told it was late. The scans now
overlap on purpose, with same-person duplicates collapsed in JS."
```

---

## Task 8: Who collected it, read from history

**Files:**
- Modify: `src/server/_internal/inventory.ts` (new export beside `listInventoryRequestsAs` at line 1241; wire into `listInventoryRequestsAs` and `listMyItemsAs`)
- Test: `src/server/__tests__/inventory.integration.test.ts`

**Interfaces:**
- Consumes: Task 4's `holder_email` history column.
- Produces:
  - `export interface CollectedBy { email: string | null; name: string | null }`
  - `collectedByForRequestItems(lineIds: string[]): Promise<Map<string, CollectedBy>>`
  - `listInventoryRequestsAs` batches whose `lines[]` entries each gain `collectedBy: CollectedBy | null`
  - `ActiveEntry`'s `request` variant and every `history` entry gain `collectedBy: CollectedBy | null`

  Tasks 9 and 10 render these.

- [ ] **Step 1: Write the failing test**

Add `collectedByForRequestItems` to the `#/server/_internal/inventory` import block at the top of `src/server/__tests__/inventory.integration.test.ts` first; every other identifier below is already imported there.

```ts
describe("collected by", () => {
  it("survives the return", async () => {
    const admin = await makeUser("collected-admin@x.com", "admin");
    const requester = await makeUser("collected-requester@x.com", "user");
    const item = await makeItem();
    await addToCartAs(requester, { itemId: item.id });
    await submitCartAs(requester, { note: null });
    const [line] = await db
      .select()
      .from(inventoryRequestItems)
      .where(eq(inventoryRequestItems.itemId, item.id));
    await approveRequestItemAs(admin, {
      requestItemId: line.id,
      pickupBy: null,
    });
    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "checked_out",
      requestItemId: line.id,
      holderEmail: "walkin-collector@nowhere.test",
      holderName: "Walk In Collector",
      dueAt: new Date(Date.now() + 86_400_000),
    });
    // Returned: the item's holder columns are cleared, the line is closed.
    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "available",
    });

    const collected = await collectedByForRequestItems([line.id]);
    expect(collected.get(line.id)?.email).toBe(
      "walkin-collector@nowhere.test"
    );
    expect(collected.get(line.id)?.name).toBe("Walk In Collector");
  });

  it("prefers the account's name over the typed one", async () => {
    const admin = await makeUser("collected-admin-2@x.com", "admin");
    // Created so the address below resolves to an account; the returned
    // handle is not needed, and an unused binding fails the linter.
    await makeUser("collected-picker@x.com", "user");
    const requester = await makeUser("collected-requester-2@x.com", "user");
    const item = await makeItem();
    await addToCartAs(requester, { itemId: item.id });
    await submitCartAs(requester, { note: null });
    const [line] = await db
      .select()
      .from(inventoryRequestItems)
      .where(eq(inventoryRequestItems.itemId, item.id));
    await approveRequestItemAs(admin, {
      requestItemId: line.id,
      pickupBy: null,
    });
    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "checked_out",
      requestItemId: line.id,
      holderEmail: "collected-picker@x.com",
      dueAt: new Date(Date.now() + 86_400_000),
    });

    const collected = await collectedByForRequestItems([line.id]);
    expect(collected.get(line.id)?.email).toBe("collected-picker@x.com");
    expect(collected.get(line.id)?.name).toBe("collected-picker@x.com");
  });

  it("returns an empty map for no ids without querying", async () => {
    const collected = await collectedByForRequestItems([]);
    expect(collected.size).toBe(0);
  });
});
```

(The seeded accounts are created with `name` equal to their email, per `makeUser`.)

- [ ] **Step 2: Run to verify it fails**

```bash
ulimit -n 8192; CI=true npm run test:integration -- inventory
```

Expected: FAIL, `collectedByForRequestItems is not a function`.

- [ ] **Step 3: Write the helper**

Add to `src/server/_internal/inventory.ts`, just above `listInventoryRequestsAs`:

```ts
export interface CollectedBy {
  email: string | null;
  name: string | null;
}

/**
 * Who physically collected each request line, read off the checked_out row in
 * the status history.
 *
 * History is the record rather than a pair of picked_up_by columns on
 * inventory_request_items: transitionItem is already the single writer of
 * that table, so there is nothing to keep in sync, and the fact survives the
 * return, which clears the item's own holder columns.
 *
 * One DISTINCT ON for a whole page of lines, not one query per line. The
 * ORDER BY must lead with the same column as the DISTINCT ON; the createdAt
 * DESC that follows is what picks the most recent checkout when a line was
 * checked out more than once.
 */
export async function collectedByForRequestItems(
  lineIds: string[]
): Promise<Map<string, CollectedBy>> {
  if (lineIds.length === 0) {
    return new Map();
  }
  const rows = await db
    .selectDistinctOn([inventoryItemStatusHistory.requestItemId], {
      requestItemId: inventoryItemStatusHistory.requestItemId,
      holderEmail: inventoryItemStatusHistory.holderEmail,
      holderName: inventoryItemStatusHistory.holderName,
      accountEmail: user.email,
      accountName: user.name,
    })
    .from(inventoryItemStatusHistory)
    .leftJoin(user, eq(inventoryItemStatusHistory.holderId, user.id))
    .where(
      and(
        eq(inventoryItemStatusHistory.newStatus, "checked_out"),
        inArray(inventoryItemStatusHistory.requestItemId, lineIds)
      )
    )
    .orderBy(
      inventoryItemStatusHistory.requestItemId,
      desc(inventoryItemStatusHistory.createdAt)
    );

  const map = new Map<string, CollectedBy>();
  for (const r of rows) {
    if (!r.requestItemId) {
      continue;
    }
    // Same rule as holderEmailOf and holderNameOf: the account wins, the
    // stored values cover a collector who had no account.
    map.set(r.requestItemId, {
      email: r.accountEmail ?? r.holderEmail,
      name: r.accountName ?? r.holderName,
    });
  }
  return map;
}
```

- [ ] **Step 4: Attach it in the admin queue**

In `listInventoryRequestsAs`, after the `rows` query and before the grouping loop:

```ts
  const collected = await collectedByForRequestItems(rows.map((r) => r.line.id));
  const enriched = rows.map((r) => ({
    ...r,
    collectedBy: collected.get(r.line.id) ?? null,
  }));
```

Change the `byRequest` map's value type from `lines: typeof rows` to `lines: typeof enriched`, and iterate `enriched` instead of `rows` in the grouping loop.

- [ ] **Step 5: Attach it in /my/items**

In `listMyItemsAs`, after the `Promise.all` destructuring:

```ts
  const collected = await collectedByForRequestItems([
    ...activeLines.map((r) => r.line.id),
    ...history.map((r) => r.line.id),
  ]);
```

Change the `ActiveEntry` union's request variant to carry it:

```ts
export type ActiveEntry =
  | {
      kind: "request";
      collectedBy: CollectedBy | null;
      line: typeof inventoryRequestItems.$inferSelect;
      item: typeof inventoryItems.$inferSelect;
      request: typeof inventoryRequests.$inferSelect;
    }
  | { kind: "hold"; item: typeof inventoryItems.$inferSelect };
```

and build the arrays with it:

```ts
  const active: ActiveEntry[] = [
    ...activeLines.map(
      (row): ActiveEntry => ({
        kind: "request",
        collectedBy: collected.get(row.line.id) ?? null,
        ...row,
      })
    ),
    ...holds.map((row): ActiveEntry => ({ kind: "hold", item: row.item })),
  ].sort(byDeadline);

  return {
    cart,
    active,
    history: history.map((row) => ({
      ...row,
      collectedBy: collected.get(row.line.id) ?? null,
    })),
  };
```

- [ ] **Step 6: Run to verify it passes**

```bash
ulimit -n 8192; CI=true npm run test:integration -- inventory
```

Expected: PASS.

- [ ] **Step 7: Check and commit**

```bash
npm run check
npm run typecheck
git add src/server/_internal/inventory.ts src/server/__tests__/inventory.integration.test.ts
git commit -m "feat(inventory): report who collected each request line

Read off the checked_out history row through one DISTINCT ON, so the fact
survives the return that clears the item's holder columns, with no second
copy on inventory_request_items to keep in sync."
```

---

## Task 9: The email-or-label assign dialog

**Files:**
- Create: `src/components/holder-field.tsx`
- Delete: `src/components/user-picker.tsx`
- Delete: `src/test/user-picker.test.tsx`
- Create: `src/test/holder-field.test.tsx`
- Modify: `src/components/inventory-lifecycle-panel.tsx`
- Modify: `src/server/inventory.ts:241-260` (`transitionSchema`)

**Interfaces:**
- Consumes: Task 4's server-side invariant.
- Produces: `HolderField` with props `{ email, label, name, program, onEmailChange, onLabelChange, onNameChange, onProgramChange }`, all strings and string callbacks.

- [ ] **Step 1: Write the failing component test**

Create `src/test/holder-field.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("#/server/users", () => ({ searchUsers: vi.fn() }));

import { HolderField } from "#/components/holder-field";

afterEach(cleanup);

const noop = () => {
  // no-op
};

function renderField(overrides: Partial<Parameters<typeof HolderField>[0]>) {
  return render(
    <HolderField
      email=""
      label=""
      name=""
      onEmailChange={noop}
      onLabelChange={noop}
      onNameChange={noop}
      onProgramChange={noop}
      program=""
      {...overrides}
    />
  );
}

describe("HolderField", () => {
  it("asks for a label only when the email is blank", () => {
    renderField({});
    expect(screen.getByLabelText(/label/i)).toBeTruthy();
    expect(screen.queryByLabelText(/^name$/i)).toBeNull();
  });

  it("hides the label field once an address is typed", () => {
    renderField({ email: "someone@nowhere.test" });
    expect(screen.queryByLabelText(/label/i)).toBeNull();
  });

  it("offers name and program for an address with no account", () => {
    renderField({ email: "someone@nowhere.test" });
    expect(screen.getByLabelText(/^name$/i)).toBeTruthy();
    expect(screen.getByLabelText(/program/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
ulimit -n 8192; CI=true npm test -- holder-field
```

Expected: FAIL, cannot resolve `#/components/holder-field`.

- [ ] **Step 3: Write the component**

Create `src/components/holder-field.tsx`:

```tsx
import { useEffect, useState } from "react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "#/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "#/components/ui/popover";
import { searchUsers } from "#/server/users";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

const SEARCH_DEBOUNCE_MS = 250;

interface Account {
  email: string;
  id: string;
  name: string | null;
}

interface Props {
  email: string;
  label: string;
  name: string;
  onEmailChange: (value: string) => void;
  onLabelChange: (value: string) => void;
  onNameChange: (value: string) => void;
  onProgramChange: (value: string) => void;
  program: string;
}

/** The account whose address is exactly what is typed, if there is one. */
function exactMatch(rows: Account[], email: string): Account | null {
  const wanted = email.trim().toLowerCase();
  return rows.find((r) => r.email.toLowerCase() === wanted) ?? null;
}

function AccountSearch({ onPick }: { onPick: (email: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<Account[]>([]);

  useEffect(() => {
    if (!query.trim()) {
      setMatches([]);
      return;
    }
    const handle = setTimeout(() => {
      void (async () => {
        try {
          setMatches((await searchUsers({ data: { q: query } })) as Account[]);
        } catch {
          setMatches([]);
        }
      })();
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [query]);

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <Button size="sm" type="button" variant="outline">
          Search accounts
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <Command shouldFilter={false}>
          <CommandInput
            onValueChange={setQuery}
            placeholder="Search by name or email..."
            value={query}
          />
          <CommandList>
            <CommandEmpty>No accounts found.</CommandEmpty>
            <CommandGroup>
              {matches.map((m) => (
                <CommandItem
                  key={m.id}
                  onSelect={() => {
                    onPick(m.email);
                    setOpen(false);
                    setQuery("");
                  }}
                  value={`${m.name ?? ""} ${m.email}`}
                >
                  <span className="font-medium">{m.name ?? m.email}</span>
                  <span className="ml-2 text-muted-foreground text-xs">
                    {m.email}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/**
 * One field decides everything: an address means the hold is on a person, a
 * blank address means it is on a thing and needs a label. The search popover
 * writes into the same address field rather than holding a separate account
 * object, so picking Ada from the list and typing her address produce
 * identical input, and therefore identical rows.
 */
export function HolderField({
  email,
  label,
  name,
  onEmailChange,
  onLabelChange,
  onNameChange,
  onProgramChange,
  program,
}: Props) {
  const [account, setAccount] = useState<Account | null>(null);
  const trimmed = email.trim();

  useEffect(() => {
    if (!trimmed) {
      setAccount(null);
      return;
    }
    const handle = setTimeout(() => {
      void (async () => {
        try {
          const rows = (await searchUsers({ data: { q: trimmed } })) as
            | Account[]
            | undefined;
          setAccount(exactMatch(rows ?? [], trimmed));
        } catch {
          setAccount(null);
        }
      })();
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [trimmed]);

  return (
    <div className="space-y-3">
      <div>
        <Label htmlFor="holder-email">Email</Label>
        <div className="mt-1 flex gap-2">
          <Input
            id="holder-email"
            onChange={(e) => onEmailChange(e.target.value)}
            placeholder="holder@oregonstate.edu"
            type="email"
            value={email}
          />
          <AccountSearch onPick={onEmailChange} />
        </div>
        {account && (
          <p className="mt-1 text-muted-foreground text-xs">
            Matches account: {account.name ?? account.email}
          </p>
        )}
      </div>

      {trimmed && !account && (
        <>
          <div>
            <Label htmlFor="holder-name">Name</Label>
            <Input
              className="mt-1"
              id="holder-name"
              onChange={(e) => onNameChange(e.target.value)}
              value={name}
            />
          </div>
          <div>
            <Label htmlFor="holder-program">Program</Label>
            <Input
              className="mt-1"
              id="holder-program"
              onChange={(e) => onProgramChange(e.target.value)}
              placeholder="e.g. CS 461"
              value={program}
            />
          </div>
          <p className="text-muted-foreground text-xs">
            No account matches this address yet. The hold is still recorded,
            and it links itself if that address signs up later.
          </p>
        </>
      )}

      {!trimmed && (
        <div>
          <Label htmlFor="holder-label">Label</Label>
          <Input
            className="mt-1"
            id="holder-label"
            onChange={(e) => onLabelChange(e.target.value)}
            placeholder="e.g. Lab 204"
            value={label}
          />
          <p className="mt-1 text-muted-foreground text-xs">
            Required when the item is not going to a person.
          </p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the component test**

```bash
ulimit -n 8192; CI=true npm test -- holder-field
```

Expected: PASS all three cases.

- [ ] **Step 5: Delete the old picker**

```bash
git rm src/components/user-picker.tsx src/test/user-picker.test.tsx
```

`HolderField` fully replaces it, and the lifecycle panel was its only consumer.

- [ ] **Step 6: Rewrite the dialog**

In `src/components/inventory-lifecycle-panel.tsx`:

Delete `AssignMode`, `initialAssignMode`, `selectedHolder`, `AssignFields`, and the `UserPicker`/`SelectedUser` import. Import `HolderField` instead.

Replace the assign state (lines 321-324):

```ts
  const [assignEmail, setAssignEmail] = useState("");
  const [assignName, setAssignName] = useState("");
  const [assignProgram, setAssignProgram] = useState("");
  const [assignLabel, setAssignLabel] = useState("");
```

Replace `runTransition`'s input type and body to send the new fields (lines 336-368), dropping `holderId` entirely:

```ts
  async function runTransition(input: {
    nextStatus: Status;
    requestItemId?: string | null;
    holderEmail?: string | null;
    holderLabel?: string | null;
    holderName?: string | null;
    holderProgram?: string | null;
    pickupBy?: Date | null;
    dueAt?: Date | null;
    comment?: string | null;
  }) {
    setBusy(true);
    setError(null);
    try {
      await transitionInventoryItem({
        data: {
          itemId: item.id,
          nextStatus: input.nextStatus,
          requestItemId: input.requestItemId ?? null,
          holderEmail: input.holderEmail ?? null,
          holderLabel: input.holderLabel ?? null,
          holderName: input.holderName ?? null,
          holderProgram: input.holderProgram ?? null,
          pickupBy: input.pickupBy ?? null,
          dueAt: input.dueAt ?? null,
          comment: input.comment ?? null,
        },
      });
      await router.invalidate();
    } catch (e) {
      setError((e as Error)?.message || "Transition failed");
    } finally {
      setBusy(false);
    }
  }
```

Replace `openDialogFor`'s prefill block (lines 370-392):

```ts
  function openDialogFor(target: Status) {
    setDlgTargetStatus(target);
    // Prefilled with whoever the item is already associated with, so a
    // reserved to checked-out step does not silently reassign the hold, and
    // a teammate's pickup starts from the requester's address rather than a
    // blank field.
    setAssignEmail(item.currentHolderEmail ?? "");
    setAssignName(item.currentHolderName ?? "");
    setAssignProgram(item.currentHolderProgram ?? "");
    setAssignLabel(item.currentHolderLabel ?? "");
    setDueDate(toDateInput(item.dueAt));
    setPickupDate(toDateInput(item.pickupBy));
    setDlgComment("");
    setError(null);
    setDlgOpen(true);
  }
```

Replace `onConfirmDialog`'s validation and payload (lines 394-430):

```ts
  async function onConfirmDialog() {
    const needsHolder =
      dlgTargetStatus === "reserved" || dlgTargetStatus === "checked_out";
    const email = assignEmail.trim();
    const label = assignLabel.trim();
    if (needsHolder && !(email || label)) {
      setError(
        "Enter an email address, or a label if the item is not going to a person."
      );
      return;
    }
    if (dlgTargetStatus === "checked_out" && !dueDate) {
      setError("A due date is required to check out an item.");
      return;
    }
    await runTransition({
      nextStatus: dlgTargetStatus,
      requestItemId: needsHolder ? item.currentRequestItemId : null,
      holderEmail: email || null,
      // The label input is only rendered while the address is blank, so these
      // are mutually exclusive by construction as well as by validation.
      holderLabel: email ? null : label || null,
      holderName: email ? assignName.trim() || null : null,
      holderProgram: email ? assignProgram.trim() || null : null,
      pickupBy:
        dlgTargetStatus === "reserved" && pickupDate
          ? new Date(pickupDate)
          : null,
      dueAt:
        dlgTargetStatus === "checked_out" && dueDate ? new Date(dueDate) : null,
      comment: dlgComment || null,
    });
    setDlgOpen(false);
  }
```

Replace the radio fieldset and `AssignFields` in the dialog body (lines 567-605) with:

```tsx
            <HolderField
              email={assignEmail}
              label={assignLabel}
              name={assignName}
              onEmailChange={setAssignEmail}
              onLabelChange={setAssignLabel}
              onNameChange={setAssignName}
              onProgramChange={setAssignProgram}
              program={assignProgram}
            />
```

And update the dialog description (line 561-564):

```tsx
            <DialogDescription>
              Assign the item to a person by email address, or to a place or
              team by label. No prior request is needed.
            </DialogDescription>
```

Finally add `currentHolderProgram?: string | null;` to the `item` prop type (around line 63-74).

- [ ] **Step 7: Drop holderId from the wire schema**

In `src/server/inventory.ts`, replace `transitionSchema` (lines 241-260):

```ts
const transitionSchema = z.object({
  itemId: z.string().uuid(),
  nextStatus: z.enum([
    "available",
    "requested",
    "reserved",
    "checked_out",
    "maintenance",
    "retired",
  ]),
  requestItemId: z.string().uuid().nullable().default(null),
  // No holderId. Staff assign a hold by address or by label; the account is
  // resolved from the address server-side. Only the two internal callers that
  // already hold an account id pass one, and they never come through here.
  holderEmail: z
    .union([z.string().email("Must be a valid email").max(200), z.null()])
    .default(null),
  holderLabel: z.string().max(200).nullable().default(null),
  holderName: z.string().max(200).nullable().default(null),
  holderProgram: z.string().max(200).nullable().default(null),
  pickupBy: z.coerce.date().nullable().default(null),
  dueAt: z.coerce.date().nullable().default(null),
  comment: z.string().max(2000).nullable().default(null),
});
```

- [ ] **Step 8: Run the unit suite and typecheck**

```bash
npm run typecheck
ulimit -n 8192; CI=true npm test
```

Expected: PASS. Typecheck also confirms no stale `UserPicker` import survives.

- [ ] **Step 9: Verify in the browser**

```bash
npm run db:seed:dev
npm run dev
```

As an admin, open an item at `/inventory/<id>` and press "Check out". Expected: one Email field with a Search accounts button; typing a seeded address shows "Matches account"; typing an unknown address reveals Name and Program; clearing the address reveals Label. Check out to an unknown address and confirm the Holder line shows it.

- [ ] **Step 10: Check and commit**

```bash
npm run check
npm run typecheck
git add -A src/components src/test src/server/inventory.ts
git commit -m "feat(inventory): assign a hold by address or label, not three radios

The user picker and the email field produced different rows for the same
person, which every read path then compensated for. One address field, with
account search writing into it, plus a label field that appears only when
the address is blank. transitionSchema no longer accepts a holder id."
```

---

## Task 10: Show the second person everywhere they matter

**Files:**
- Modify: `src/server/_internal/inventory.ts:1319-1344` (`getItemHistoryAs`)
- Modify: `src/components/inventory-lifecycle-panel.tsx` (`HistoryRow`, `formatHolderDisplay`, the history list)
- Modify: `src/components/staff-inventory-panel.tsx` (`StaffPanelItem`, the props it forwards)
- Modify: `src/components/admin-request-queue-row.tsx`
- Modify: `src/routes/_authed/admin/inventory/requests.tsx`
- Modify: `src/routes/_authed/my/items.tsx`

**Interfaces:**
- Consumes: `CollectedBy` and the enriched shapes from Task 8; the history columns from Task 3.

- [ ] **Step 1: Project the new history columns**

In `getItemHistoryAs`, add to the select:

```ts
      holderEmail: inventoryItemStatusHistory.holderEmail,
      holderName: inventoryItemStatusHistory.holderName,
      holderProgram: inventoryItemStatusHistory.holderProgram,
```

- [ ] **Step 2: Render a readable holder in the history list**

In `src/components/inventory-lifecycle-panel.tsx`, add to `HistoryRow` (line 48-58):

```ts
  holderEmail: string | null;
  holderName: string | null;
  holderProgram: string | null;
```

Replace the history holder line (lines 206-210), which prints a raw user id today whenever the hold came from the account picker:

```tsx
                {(h.holderEmail || h.holderLabel) && (
                  <p className="mt-1 text-muted-foreground text-xs">
                    Holder: {h.holderName ?? h.holderEmail ?? h.holderLabel}
                    {h.holderName && h.holderEmail ? ` (${h.holderEmail})` : ""}
                  </p>
                )}
```

- [ ] **Step 3: Simplify the current-holder display**

Replace `formatHolderDisplay` (lines 152-171). The `"(user)"` branch existed only because an account-assigned hold stored no address; there is no such hold now.

```ts
function formatHolderDisplay(
  item: Props["item"],
  holderName?: string | null
): string | null {
  const name = holderName ?? item.currentHolderName;
  if (item.currentHolderEmail) {
    return name ? `${name} (${item.currentHolderEmail})` : item.currentHolderEmail;
  }
  return item.currentHolderLabel ?? null;
}
```

- [ ] **Step 4: Forward the program through the staff panel**

In `src/components/staff-inventory-panel.tsx`, add `currentHolderProgram?: string | null;` to `StaffPanelItem` and pass `currentHolderProgram: item.currentHolderProgram ?? null` in the `InventoryLifecyclePanel` props at line 81-90.

- [ ] **Step 5: Show the collector in the admin queue**

In `src/components/admin-request-queue-row.tsx`, add to `Props`:

```ts
  collectedBy: { email: string | null; name: string | null } | null;
  requesterEmail: string;
```

and render it inside the existing metadata row (after the `line: {line.status}` span):

```tsx
            {collectedBy && collectedBy.email !== requesterEmail && (
              <span>
                collected by {collectedBy.name ?? collectedBy.email}
              </span>
            )}
```

Destructure `collectedBy` and `requesterEmail` in the component signature.

In `src/routes/_authed/admin/inventory/requests.tsx`, pass them:

```tsx
                <AdminRequestQueueRow
                  collectedBy={row.collectedBy}
                  item={{
                    id: row.item.id,
                    name: row.item.name,
                    status: row.item.status,
                  }}
                  key={row.line.id}
                  line={{ id: row.line.id, status: row.line.status }}
                  requesterEmail={batch.requester.email}
                />
```

- [ ] **Step 6: Show the collector in /my/items**

In `src/routes/_authed/my/items.tsx`, inside the active-tab request branch, after the due date paragraph:

```tsx
                  {entry.collectedBy && (
                    <p className="text-muted-foreground text-xs">
                      Collected by{" "}
                      {entry.collectedBy.name ?? entry.collectedBy.email}
                    </p>
                  )}
```

and in the history tab, after the status line:

```tsx
              {collectedBy && (
                <p className="text-muted-foreground text-xs">
                  Collected by {collectedBy.name ?? collectedBy.email}
                </p>
              )}
```

destructuring it in the map: `{data.history.map(({ line, item, collectedBy }) => (`.

- [ ] **Step 7: Run everything**

```bash
npm run typecheck
ulimit -n 8192; CI=true npm test
ulimit -n 8192; CI=true npm run test:integration
```

Expected: all PASS.

- [ ] **Step 8: Verify the whole flow in the browser**

```bash
npm run db:seed:dev
npm run dev
```

As a student, cart an item and submit. As an admin, approve it at `/admin/inventory/requests`, then open the item and check it out to a *different* student's address. Expected:
- The queue's "All" tab shows "collected by" the second student.
- The first student's `/my/items` Active tab shows the request with "Collected by".
- The second student's `/my/items` Active tab shows the item as a hold.
- Returning the item leaves the collector visible on the first student's History tab.

- [ ] **Step 9: Check and commit**

```bash
npm run check
npm run typecheck
git add -A src
git commit -m "feat(inventory): surface the collector wherever the request appears

The admin queue, both /my/items tabs, and the item's status history, which
until now printed a raw user id for any hold assigned through the account
picker."
```

---

## Self-Review Notes

**Spec coverage.** Every section of the spec maps to a task: Part A's query, index, table and export to Tasks 1 and 2; Part B's migration to Task 3; `resolveHolder`, `validateInvariants` and the history writes to Task 4; `submitCartAs` and the staff projections to Task 5; `listMyItemsAs` to Task 6; `recordOverdueNotificationsAs` and the QUIRKS rewrite to Task 7; `collectedByForRequestItems` to Task 8; the dialog, `HolderField` and `transitionSchema` to Task 9; every remaining read surface to Task 10.

**One deliberate deviation from the spec.** The spec proposed a correlated scalar subselect for `submitCartAs`'s address. Task 5 fetches the address once before the loop instead: same result, one query rather than one per cart line, and readable without knowing Drizzle's `sql` interpolation rules.

**Two forcing functions will fire.** `defineCsvColumns<Row>()` fails typecheck in Task 2 (`usageCount`) and Task 5 (`currentHolderProgram`). Both are expected and each has its own step.
