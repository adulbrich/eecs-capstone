# Admin CSV export, stored inventory categories, staff holds in My Items: design

Date: 2026-08-05

Clears three roadmap items from the README:

1. **CSV export of admin tables.** Staff can export any `/admin` table to CSV.
2. **Inventory categories in the categories store.** `inventory_items.category`
   stops being free text and becomes a foreign key into `categories`, managed
   in `/admin/categories` like every other category.
3. **Staff-assigned holds in `/my/items`.** An item staff reserved or checked
   out to someone, with no request line behind it, appears in that person's
   Active tab.

The three are independent. They share this document because they land together;
nothing in one blocks another, and they can be implemented and reviewed in any
order.

---

## 1. CSV export

### Governing rule

> **Rows follow the current filters. Columns are the full record. Column
> visibility is a screen concern and never affects the file.**

The Columns menu answers "what do I want to look at"; an export answers "give me
the data". Conflating them produces a file whose contents depend on invisible
menu state, which is exactly the surprise a spreadsheet user cannot debug.

Export exists only on `/admin/*` pages, and each table's export carries exactly
the gate its own listing carries: staff for five of them, admin-only for
`/admin/users`. There is no export surface anywhere else in the app.

### Current behavior

Six routes render `AdminDataTable`. Their loaders differ in ways that matter:

| Route | Rows fetched | Projection | Gate | Export needs a server function? |
| --- | --- | --- | --- | --- |
| `/admin/projects` | all matching | `adminProjectSummarySelect` (partial) | staff | **yes** — projection is a summary |
| `/admin/users` | one page of 25 | six columns only | **admin** | **yes** — pagination truncates, projection is partial |
| `/admin/mentors` | all matching | five columns only | staff | **yes** — projection is a summary |
| `/admin/inventory` | all matching | `fullForStaff`, complete | staff | no |
| `/admin/programs` | all | `select()`, complete | staff | no |
| `/admin/categories` | all | `select()`, complete | staff | no |

Each row above was read rather than assumed, because the projections do not
match what the page appears to show:

- **`/admin/users` is the odd one out twice over.** Its `beforeLoad` requires
  `role === "admin"` exactly, where every other admin route accepts
  `["admin", "instructor"]`, and `listUsersForCurrentUser` backs that with
  `assertAdmin`. Its projection is also narrower than it looks: `listUsersImpl`
  selects only `id`, `email`, `name`, `role`, `banned`, `createdAt`.
- **`/admin/mentors` looks complete but is not.** `listMentorsAs` selects only
  `id`, `name`, `email`, `affiliation`, `mentorTeamCount` — no `role`, no
  `createdAt`.
- **`/admin/inventory` is not paginated.** `listAdminInventoryAs` has no
  `limit`/`offset`; it returns the whole filtered set ordered by
  `updatedAt desc`. This is the change
  `2026-07-31-admin-data-tables-design.md` describes: "Only inventory changes
  behavior here, from 20 rows per request to the whole filtered set." And
  `fullForStaff` already carries `serial`, `label`, `location`, `notes`, and
  every `current*` hold column, with the route adding the resolved
  `currentHolderName`/`currentHolderEmail` on top. The only item column it
  omits is `search_vector`, a machine artifact. Inventory therefore needs no
  export function.

The three "no" rows already hold every field of every matching record in the
browser. Adding a server round-trip for them would buy nothing.

### `src/lib/csv.ts`

A pure module with no DOM and no React, so it unit-tests like
`project-workflow.ts` and `table-state.ts` do.

```ts
export interface CsvColumn<T> {
  header: string;
  value: (row: T) => unknown;
}

export function toCsv<T>(columns: CsvColumn<T>[], rows: T[]): string;
```

Serialization rules, in order of application per cell:

| Input | Output |
| --- | --- |
| `null`, `undefined` | empty string |
| `Date` | ISO 8601 (`toISOString()`) |
| `boolean` | `true` / `false` |
| array | elements joined with `"; "` |
| anything else | `String(value)` |

Then two escapes:

1. **Formula injection.** A value whose first character is `=`, `+`, `-`, `@`,
   tab, or CR is prefixed with a single apostrophe. Without this, an inventory
   item named `=HYPERLINK("http://evil","click")` executes when an admin opens
   the file in Excel or Sheets. The data is attacker-influenced: item names,
   project titles, and user names all come from user input.
2. **RFC 4180 quoting.** A value containing `"`, `,`, `\r`, or `\n` is wrapped
   in double quotes with inner `"` doubled. Applied after step 1, so the
   apostrophe is inside the quotes.

Rows are joined with `\r\n` per RFC 4180. The header row comes from
`column.header`.

`toCsv` deliberately does **not** emit a UTF-8 BOM. The BOM is a consumer
concern, not a property of the CSV, and including it would make every unit test
assert against an invisible character. It is added at download time instead.

### `src/components/export-csv-button.tsx`

Owns everything the browser needs and nothing else.

```tsx
interface Props {
  /** Base filename, no extension. The current date is appended. */
  filename: string;
  /** Produces the CSV text. Async so it can hit a server function. */
  load: () => Promise<string>;
}
```

On click: set pending, `await load()`, build
`new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" })`, create an
object URL, click a synthetic anchor with
`download = ${filename}-${YYYY-MM-DD}.csv`, then revoke the URL.

The BOM is what makes Excel read the file as UTF-8 rather than the system
codepage. Without it, an accented name renders as mojibake. This app already
cares about that case: `admin-data-table.tsx:46` pins an `Intl.Collator` partly
so "Émile" sorts correctly.

Accessibility: the button carries `aria-busy` while pending and is disabled to
prevent a double download. Completion and failure are announced through an
`aria-live="polite"` region, matching the pattern `AdminDataTable` already uses
for its row-count announcement. A failure renders its message inline rather
than throwing, since a failed export must not blank the table.

### `AdminDataTable` change

One new optional prop:

```ts
actions?: ReactNode;
```

It renders in the existing right-hand control group, immediately before the
Columns dropdown, so the button sits in the same place on all six tables. This
is deliberately a slot rather than an `onExport` callback: the button needs
per-route column definitions and filter state, and threading those through the
table's props would make the table know about exports. The table only knows it
has a place to put controls.

The existing `toolbar` prop is left alone. It is the left-hand group and holds
filters.

### Server export functions

Each export function lives beside the listing it mirrors, takes the **same
filter input type**, and reuses the **same `WHERE` builder**.

This is the load-bearing decision of the whole feature.
`listAdminProjectsAs` builds its conditions with rules that are not obvious:
the `q` search spans the tsvector plus five `ILIKE`s across contact and
proposer fields, and the proposer filter is deliberately excluded from the
scope used to build the proposer dropdown. A second, hand-copied condition list
in an export function would drift from that within one change, and the symptom
would be a CSV that quietly disagrees with the table above it about which rows
match.

So each affected module extracts its condition builder first:

| Module | Extract | New export function | Gate |
| --- | --- | --- | --- |
| `src/server/_internal/projects-queries.ts` | `buildAdminProjectListConditions(data)` from `listAdminProjectsAs` | `exportAdminProjectsAs(viewer, data)` | `isStaff` throw |
| `src/server/_internal/users.ts` | `buildUserConditions(data)` from `listUsersImpl` | `exportUsersImpl(data)` + `exportUsersForCurrentUser(data)` | `assertAdmin` |
| `src/server/_internal/users.ts` | `buildMentorConditions(data)` from `listMentorsAs` | `exportMentorsAs(viewer, data)` | `assertStaff` |

Three module-specific notes:

- **Extract `listConditions`, not `scope`.** `listAdminProjectsAs` maintains
  *two* condition lists: `scope` (status, soft-delete, program), which also
  feeds the proposer dropdown and deliberately excludes both `q` and the
  proposer filter, and `listConditions` (`scope` plus proposer plus `q`), which
  selects the rows. The export takes **`listConditions`**, which is why the
  extracted function is named for it. `scope` stays inline; the dropdown is the
  only thing that wants it.
- **Users follows a different convention.** That module has no `*As(viewer, …)`
  variant for its listing: it pairs an ungated `…Impl(data)` with a
  `…ForCurrentUser(data)` wrapper that calls `requireUser()` then
  `assertAdmin`. The users export matches its immediate neighbours rather than
  importing the `*As` convention into a function that does not use it, and the
  gate is `assertAdmin`, **not** `assertStaff` — an instructor must not be able
  to export the user table when they cannot even open the page.
- **Mentors live in the same module but use `*As`.** `listMentorsAs(viewer,
  data)` does take a viewer and does use `assertStaff`, so `exportMentorsAs`
  mirrors it. The two conventions coexisting inside `users.ts` is pre-existing;
  this spec follows whichever the neighbouring function uses rather than
  unifying them, which is out of scope.

Every export function otherwise:

- applies the extracted conditions;
- applies the same `ORDER BY` the listing uses, so the file's order is
  predictable;
- takes **no** `limit`/`offset`.

Public wrappers follow the existing `createServerFn({ method: "GET" })` shape in
`src/server/projects-queries.ts`, `src/server/users.ts`, and
`src/server/inventory.ts`, each dynamically importing its `_internal` module
like its neighbours do.

Where a module already uses `*As(viewer, …)`, the export keeps that name: it is
the seam the integration tests use, per the convention in `README.md`.

### Export projections

**Projects** widen `adminProjectSummarySelect` with every remaining meaningful
column: `problemStatement`, `objectives`, `minQualifications`,
`prefQualifications`, `url`, `licenseRestrictions`, `notes`, `archivedAt`,
`programManagerId`. Categories come from a correlated `string_agg` over
`project_categories` joined to `categories`, producing one `"; "`-joined cell.

`projects.notes` is commented "Staff-visible only; never returned in public
queries". It is included here because the export is staff-only and staff-gated,
and an export that silently omitted the staff notes column would be the more
surprising behavior. The gate is what makes this safe, so it is not optional.

`searchVector`, `embedding`, `embeddingSourceHash`, and `embeddingUpdatedAt` are
excluded: they are machine artifacts, and a 1024-dimension vector in a
spreadsheet cell is noise.

**Users** export the full user record minus credentials: `id`, `name`, `email`,
`emailVerified`, `role`, `banned`, `banReason`, `banExpires`, `isMentor`,
`createdAt`, `updatedAt`. Nothing from `account` or `session` is joined; those
hold authentication material.

**Mentors** widen the five-column listing with `role`, `wantsToMentor`, and
`createdAt`. `wantsToMentor` is constant `true` across the whole result set by
construction, so it is included only because a spreadsheet that gets filtered
and re-sorted should still say what it is a list of.

**Inventory, programs, categories** export their loader rows directly. For
inventory that means `fullForStaff` plus the route's resolved
`currentHolderName`/`currentHolderEmail`, and — after item 2 lands — the joined
category name that the table already displays.

Export column lists are defined as module constants in their route files,
beside the existing `COLUMNS` constant. The table and its export are one
concern and belong together; a shared module would need each route's `Row`
type and would invert the dependency.

### Scale

No row cap. The `2026-07-31-admin-data-tables-design.md` steady-state
expectation is under roughly 500 rows per table, and every table except users
and inventory already ships its whole filtered set to the browser on page load.
An unpaginated export of a few hundred rows is smaller than the page that
launched it. If a table later approaches thousands of rows, the export is one
of several things that would need revisiting, and it is not the first.

---

## 2. Inventory categories in the categories store

### Current behavior

`inventory_items.category` is a nullable `text` column. It is typed by hand into
a bare `<Field>` in `inventory-form.tsx:146`, indexed at
`inventory_items_category_idx`, weighted `'C'` in the generated `search_vector`,
and read back as `SELECT DISTINCT` to populate the public filter dropdown
(`src/server/_internal/inventory.ts:339`).

Meanwhile `categories` is `(id, name, type)` and is wired only to projects
through `project_categories`.

The free-text column has the usual failure mode: "Electronics", "electronics",
and "Electronic" are three categories, and nothing can rename them together.

### Target model

`inventory_items.category_id uuid REFERENCES categories(id) ON DELETE SET NULL`.

Inventory categories are rows in the shared `categories` table with
`type = 'inventory'`. They are managed in `/admin/categories` alongside the
project category types, which is the README's requirement. `ON DELETE SET NULL`
means deleting a category uncategorizes its items rather than blocking the
delete or cascading into item loss.

Single-valued, not many-to-many: the public filter bar and the admin table
column are both single-category, and nothing in the product asks an item to be
two things at once.

### Migration

Hand-written, following the precedent in `docs/QUIRKS.md` for tsvector changes.
Order matters and the middle two statements are the reason this cannot be a
plain `drizzle-kit generate` output.

```sql
ALTER TABLE inventory_items
  ADD COLUMN category_id uuid REFERENCES categories(id) ON DELETE SET NULL;

-- Promote every distinct existing string to a real category.
INSERT INTO categories (name, type)
SELECT DISTINCT trim(category), 'inventory'
FROM inventory_items
WHERE category IS NOT NULL AND trim(category) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM categories c
    WHERE c.name = trim(inventory_items.category) AND c.type = 'inventory'
  );

UPDATE inventory_items i
SET category_id = c.id
FROM categories c
WHERE c.type = 'inventory' AND c.name = trim(i.category);

DROP INDEX IF EXISTS inventory_items_category_idx;

-- The generated column must be dropped before the column it reads.
ALTER TABLE inventory_items DROP COLUMN search_vector;
ALTER TABLE inventory_items DROP COLUMN category;

ALTER TABLE inventory_items
  ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'B')
  ) STORED NOT NULL;

-- Dropping the column dropped this index with it. Recreate it.
CREATE INDEX inventory_items_search_vector_idx
  ON inventory_items USING GIN (search_vector);

CREATE INDEX inventory_items_category_id_idx ON inventory_items (category_id);
```

Two traps this encodes:

- **The GIN index disappears silently.** `drizzle/0003_last_invaders.sql:103`
  creates `inventory_items_search_vector_idx`. Dropping the generated column
  drops the index with it, with no error. Forgetting the recreate leaves
  inventory search working but unindexed, which is invisible until the table
  grows.
- **The category weight is gone on purpose.** The new `search_vector` covers
  `name` and `description` only. A generated column cannot reach through a join
  to read the category's name, and category filtering is already a separate
  dropdown rather than something users type into the search box.

`src/db/schema.ts` is updated to match: `category` removed, `categoryId` added,
`searchVector`'s `generatedAlwaysAs` expression updated, and the index list
updated.

### Keeping inventory categories out of the project pickers

`CategoryMultiSelect` (`src/components/category-multi-select.tsx:23`) and
`projects-filter-bar.tsx:57` both call `listCategories({ data: {} })` with no
type filter. Left alone, every inventory category would appear in the project
category picker the moment the migration runs.

- New pure module `src/lib/category-types.ts` exporting
  `export const INVENTORY_CATEGORY_TYPE = "inventory" as const;`
- `listCategoriesImpl` gains an optional `excludeTypes?: string[]`, applied as
  `NOT IN` when present.
- Both project consumers pass
  `excludeTypes: [INVENTORY_CATEGORY_TYPE]`.
- `/admin/categories` keeps calling it unfiltered, so it manages every type.
  That is the "managed in /admin/categories as well" requirement.

`listCategoryTypesImpl` derives its types from existing rows, which leaves a
chicken-and-egg gap: on a database where no inventory item ever had a category
string, the migration's backfill inserts zero rows, no `type = 'inventory'`
exists, and `inventory` never appears in the `CategoryTypeCombobox`. Staff would
have to know to type the magic string to create the first one, and a typo
("Inventory") would silently produce a type that nothing reads.

The fix stays in the UI rather than seeding fake data: `/admin/categories`
passes the combobox the **union of the derived types and
`INVENTORY_CATEGORY_TYPE`**, deduplicated. The option is always offerable, the
first inventory category is created through the existing New category dialog,
and no placeholder row is invented to prop up a dropdown. `listCategoryTypesImpl`
itself is unchanged.

### Consumers

**`inventory-form.tsx`** — the `category` text field becomes a `Select` over
inventory categories with an explicit "No category" option. The Zod schema
changes from `z.string().max(120).default("")` to
`z.string().uuid().nullable().default(null)`. The categories list is a new prop,
loaded in the `new` and `edit` route loaders via
`listCategories({ data: { type: INVENTORY_CATEGORY_TYPE } })` and passed down,
matching how `program-select` and `proposer-picker` already receive their
options.

**Public filter bar** — `categories: string[]` becomes
`categories: { id: string; name: string }[]`. `listInventoryCategories`
(`inventory.ts:339`) changes from `SELECT DISTINCT category` to a join against
`categories`, still restricted to categories actually in use so the dropdown
never offers a filter that returns nothing.

**`/inventory` search params** — `?category=` carries a UUID instead of a name.
`searchSchema` changes from `z.string().nullable()` to
`z.string().uuid().nullable()`. Old links break. That is intended: the app is
pre-production and this project does not add back-compat aliases.

**Admin inventory table and item detail** — the category column reads the
joined name.

**`scripts/seed-dev.ts`** — seeds a handful of `type = 'inventory'` categories
and assigns them to seeded items, so a fresh dev database exercises the picker.

---

## 3. Staff-assigned holds in `/my/items`

### The bug

`inventory_items` already carries the current hold denormalized:
`currentHolderId`, `currentHolderEmail`, `currentHolderLabel`,
`currentPickupBy`, `currentDueAt`, `currentRequestItemId`. The schema comment at
`src/db/schema.ts:331` says why: "A hold does not need a request line (staff can
reserve or check out an item that was never carted), so the current hold's dates
live here."

The write side honors that. `resolveHolderId`
(`src/server/_internal/inventory-transitions.ts:104`) resolves a hold email to an
account, so "an email that matches an account behaves exactly like a hold
assigned through the user picker."

The read side does not. `listMyItemsAs` (`inventory.ts:959`) builds all three
tabs from `inventory_request_items`. An item with no request line behind it
cannot appear, whoever holds it.

This is therefore a read-side fix. No schema change.

### Query

A fourth query joins the existing three:

```ts
db.select({ item: inventoryItems })
  .from(inventoryItems)
  .where(and(
    isNull(inventoryItems.currentRequestItemId),
    inArray(inventoryItems.status, ["reserved", "checked_out"]),
    holderMatch
  ))
```

`currentRequestItemId IS NULL` is what makes this disjoint from the request-line
query. An item held *through* a request line is already in `active` and must not
appear twice.

Statuses are `reserved` and `checked_out` only. `requested` implies a request
line by definition, and `maintenance`/`retired`/`available` are not holds.

### Holder matching

```ts
const holderMatch = or(
  eq(inventoryItems.currentHolderId, viewer.id),
  verifiedEmail
    ? and(
        isNull(inventoryItems.currentHolderId),
        eq(inventoryItems.currentHolderEmail, verifiedEmail)
      )
    : undefined
);
```

The first arm is the normal case. The second covers the walk-in whose account
was created *after* staff assigned the hold: `resolveHolderId` found no match at
write time, so `currentHolderId` stayed null and would stay null forever.

`verifiedEmail` comes from a single lookup on `user` by `viewer.id`, selecting
`email` where `emailVerified` is true, and is `null` otherwise. **The
`emailVerified` condition is a security control, not a nicety.** Without it,
anyone could claim someone else's hold by editing their own email address to
match. The email arm is additionally restricted to rows where
`currentHolderId IS NULL`, so it can never override an explicit account
assignment.

This keeps the `listMyItemsAs(viewer)` signature unchanged, preserving the
`*As(viewer, ...)` test seam.

### Return shape

`active` becomes a discriminated union, merged and sorted on the server:

```ts
type ActiveEntry =
  | { kind: "request"; line: InventoryRequestItem; item: InventoryItem }
  | { kind: "hold"; item: InventoryItem };
```

Server-side merging, rather than returning a separate `holds` array for the
client to interleave, means the tab renders one list from one array and the
`Active (n)` count is one number. `cart` and `history` are unchanged.

Sort key: earliest deadline first — `line.dueAt ?? line.pickupBy` for requests,
`item.currentDueAt ?? item.currentPickupBy` for holds — ascending, with entries
having no deadline last, then by item name for a stable order. "What is due
soonest" is the question this tab answers.

### Rendering

In `src/routes/_authed/my/items.tsx`, the Active tab maps over `ActiveEntry`
and branches on `kind`:

- A **hold** shows the item name, status badge, its pickup/due dates from the
  item's `current*` columns, and the text "Assigned by staff". It has **no
  Cancel button**: `cancelRequestItem` needs a `requestItemId` that does not
  exist, and releasing a hold is a staff action.
- A **request** renders exactly as it does today, including the existing
  `canCancel` logic.

The empty-state copy changes from "No active requests." to "Nothing active."
since the tab is no longer only requests.

### Overdue notifications

`recordOverdueNotificationsAs` (`inventory.ts:1285`) scans
`inventory_request_items` with `status = 'approved'`, so a staff hold never
produces an overdue notice either. Same root cause, and fixing the display
without this would leave a hold that is visibly overdue in the UI while silently
never notifying.

A second scan is added over held items, reusing `deriveDeadlineFlags`, which
takes `{ status, pickupBy, dueAt }` structurally and works unchanged against
`currentPickupBy`/`currentDueAt`.

**The hold scan requires `currentHolderId IS NOT NULL`**, which makes it
narrower than the read path above. `notifications.userId` is a foreign key to an
account, and an email-matched hold has no account id on the row by definition —
there is nothing to attribute the notification to. Widening the scan to resolve
the email back to an account would reintroduce, on a write path, exactly the
unverified-address impersonation the read path guards against.

The resulting asymmetry is deliberate and should be understood before someone
"fixes" it: a walk-in hold matched only by verified email **appears** in
`/my/items` but **never fires** an overdue notice, until staff reassign it
through the user picker or a future write-side linking job populates
`currentHolderId`. Showing someone their own item is safe; sending mail based on
an address match is where the risk lives.

The existing dedupe needs no change. `onConflictDoNothing` targets
`(userId, type, link)` where `link` is `/inventory/${itemId}` — it keys on the
**item**, not the request line. So hold-derived notifications collapse into the
same key space, and an item that somehow had both a hold and a line could not
produce two notices.

---

## Testing

**Unit** (`src/lib/__tests__/csv.test.ts`): quoting of embedded commas, quotes,
and newlines; `Date` and `null` rendering; array joining; formula-injection
escaping for each of `= + - @`, tab, CR; header row; `\r\n` terminators; empty
row set yields a header-only file.

**Integration** (`src/server/__tests__/`, alongside the existing suites):

- Each of the three export functions respects the active filters, asserted by
  seeding rows that do and do not match and comparing against what the listing
  returns for the same filter.
- `exportUsersImpl` returns every match rather than one page: seed more than
  `pageSize` users and assert the export count equals the listing's `total`.
- Gates, per function rather than as one blanket assertion, because they differ:
  `exportAdminProjectsAs` and `exportMentorsAs` succeed for `admin` and
  `instructor` and throw for `student`; `exportUsersForCurrentUser` succeeds for
  `admin` and **throws for `instructor`** as well as `student`. That last case
  is the regression test for the gate mismatch this spec exists to avoid.
- `listMyItemsAs` surfaces a hold with no request line; does not duplicate an
  item that has both; does not leak another user's hold; matches an unlinked
  hold by verified email; **does not** match it when `emailVerified` is false.
- `recordOverdueNotificationsAs` fires for an overdue hold and does not double
  up when a line exists for the same item.
- `categories.integration.test.ts` gains coverage for `excludeTypes`.

**Updated by the migration**: `inventory.integration.test.ts` and
`admin-inventory.integration.test.ts` reference `category` as text and move to
`categoryId`.

Per `docs/QUIRKS.md` and the README, integration tests read the schema as it
exists, so `npm run db:migrate` must run before them or every inventory test
fails on the missing column.

Accessibility (`npm run test:accessibility`) covers the new export button
through the existing admin page specs.

## Out of scope

- Row-selection checkboxes in `AdminDataTable`. Export follows filters, and no
  other feature currently wants per-row selection.
- Export formats other than CSV.
- Many-to-many inventory categories.
- Backfilling `currentHolderId` on unlinked holds at sign-in. The verified-email
  match handles the read path; a write-side linking job is a separate concern
  from the one the README raises.
