# Category domains, and multi-category inventory items: design

Date: 2026-08-06

Corrects the design shipped by
[`2026-08-05-admin-export-inventory-categories-holds-design.md`](./2026-08-05-admin-export-inventory-categories-holds-design.md)
§2, which put inventory categories into the shared `categories` table using the
existing `type` column as the discriminator. That worked mechanically and is
confusing in practice.

Nothing in this document has reached production: the branch carrying the
original work is unmerged, so the migration is replaced outright rather than
layered on top.

## The problem

`categories.type` carries two perpendicular meanings.

For projects it is a **facet**: which axis of a project is being tagged
(`project_type`, `technology`, `industry`, `field`). Every one of those values
describes a project.

For inventory it was made a **domain**: what kind of thing is being categorized
at all.

One column, two concepts, so the UI renders a domain and four facets as five
peers. `/admin/categories` shows a flat Type column in which `inventory` sits
beside `technology`, and the create dialog says "assign it a type. Pick an
existing type or create a new one" with `inventory` as an ordinary entry. A
reasonable admin concludes `inventory` is a fifth kind of project category.

Three consequences, all reported from real use:

1. Nothing tells an admin that `inventory` is the magic value that makes a
   category appear in the inventory item form. On a fresh deployment with no
   categories at all, there is no path to discovering it.
2. The item form offers a long flat dropdown and no way to create a category
   from where you need one. `CategoryMultiSelect` currently renders the dead end
   "No categories yet. Create some in /admin/categories." This is **pre-existing
   on the projects side too**, not introduced by the inventory work.
3. Inventory items took exactly one category while projects took many, so the
   two domains behaved differently for no reason a user could see.

### Why the discriminator must be a column

The obvious cheap fix is to group the UI by inspecting the type string: treat
`inventory` as one bucket and everything else as project facets.

That is unsafe. `CategoryTypeCombobox` lets an admin **create a new type by
typing it**. Project facets are open-ended, so the day someone adds
`methodology` the whitelist silently misclassifies it. A discriminator that
user input can defeat is not a discriminator.

Hence an explicit column.

## Schema

```ts
export const categoryDomainEnum = pgEnum("category_domain", [
  "project",
  "inventory",
]);

export const categories = pgTable("categories", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  /** What this category classifies. Closed set, unlike `type`. */
  domain: categoryDomainEnum("domain").notNull(),
  /**
   * The facet within the project domain: project_type, technology, industry,
   * field, or any facet staff invent. Null for inventory categories, which
   * are flat.
   */
  type: text("type"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
```

`domain` is a `pgEnum` and `type` stays free text, and that asymmetry is the
point: domains are closed and known at design time, facets are open and
user-created. Encoding both as the same kind of thing is what caused this.

`type` becomes nullable. Project categories keep a non-null facet; inventory
categories have none, because there is nothing to choose between. The
application enforces that pairing (see Validation); the database allows a null
`type` on either domain.

Inventory items become many-to-many, mirroring `project_categories` exactly:

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
    index("inventory_item_categories_category_idx").on(t.categoryId),
  ]
);
```

`onDelete: "cascade"` on both sides matches `project_categories`. Deleting a
category removes its assignments rather than uncategorizing items through a
null, which is a behavior change from the shipped `ON DELETE SET NULL` and is
the correct one for a join table.

The reverse index exists because "which categories are in use" and "which items
have this category" are both queried; the primary key only covers the forward
direction.

## Migration

One migration replaces `0010_inventory_category_fk.sql` and
`0011_talented_wallflower.sql`, which are deleted along with their snapshots
and journal entries. `inventory_items.category_id` never exists at any point,
and neither does the FK-rename migration that existed only to correct its
constraint name.

Ordering, with the same two traps the previous migration encoded:

1. `CREATE TYPE category_domain AS ENUM ('project', 'inventory')`.
2. Add `categories.domain` with a temporary `DEFAULT 'project'`, since every
   existing row is a project category, then drop the default so future inserts
   must state the domain.
3. `ALTER COLUMN type DROP NOT NULL`.
4. Create `inventory_item_categories`.
5. Promote each distinct non-empty `trim(inventory_items.category)` into
   `categories` with `domain = 'inventory'` and `type = NULL`, then insert the
   matching join rows.
6. Drop the generated `search_vector` **before** dropping `category`, or the
   drop fails.
7. Drop `category` and `inventory_items_category_idx`.
8. Recreate `search_vector` from `name` and `description` only, then
   **recreate the GIN index `inventory_items_search_vector_idx`**, which
   dropping the generated column takes with it silently.

Because the migration files are replaced rather than appended, the local
database must be dropped and rebuilt from scratch and re-seeded. The project
owner has approved that; dev data is regenerable through `db:seed:dev`.

Hand-written, not `db:generate`: that tool would emit neither backfill and
would order the drops wrongly. A matching snapshot must be written and verified
by confirming `db:generate` then reports no changes.

## What this deletes

Both are artifacts of the missing column and go away entirely:

- **`src/lib/category-types.ts` and `INVENTORY_CATEGORY_TYPE`.** A sentinel
  standing in for a domain.
- **`excludeTypes` on `listCategoriesImpl`.** It existed only to stop inventory
  categories leaking into the project pickers. Callers now ask for what they
  want (`domain: "project"`) instead of subtracting what they do not. Its zod
  boundary test is replaced by one covering `domain`.

The chicken-and-egg workaround in `/admin/categories` (unioning
`INVENTORY_CATEGORY_TYPE` into the offered types so it is selectable before any
inventory category exists) also disappears. There is nothing to offer: the
Inventory tab's create dialog has no type field.

## Validation

`createCategoryAs` and `updateCategoryAs` take a domain and enforce the pairing:

- `domain: "project"` requires a non-empty `type`.
- `domain: "inventory"` requires `type` to be null, and rejects a supplied one
  rather than silently discarding it.

Zod discriminated unions on `domain` express this at the server-function
boundary, so the rule lives in one place rather than in each caller.

## Server surface

| Function | Change |
| --- | --- |
| `listCategoriesImpl` | Takes `domain`, drops `excludeTypes` |
| `listCategoryTypesImpl` | Scoped to `domain = 'project'`; inventory has no facets |
| `setInventoryItemCategoriesAs` | New, mirroring `setProjectCategoriesAs` |
| `listInventoryCategoriesImpl` | Categories in use, via the join table |
| `createInventoryItemAs` / `updateInventoryItemAs` | Take `categoryIds: string[]`; write the join rows inside the existing transaction |

Item write paths replace their `categoryId` field with `categoryIds`. The join
rows are written in the same transaction as the item, using the delete-then-
insert shape `setProjectCategoriesAs` already uses.

`EDITABLE_FIELDS` no longer carries a category field, because categories are no
longer a column on the item.

The edit log records a category change as one entry whose before and after
values are the category **names**, resolved at write time and joined with
`"; "`. Not UUIDs: the log previously held readable names, nothing renders it
yet, and whoever builds that view should not inherit an audit trail of opaque
identifiers. Resolving names costs one query inside a transaction that is
already open.

## Filtering

The public inventory filter becomes multi-select, with **all selected
categories must match**, matching the projects listing exactly:
`src/server/_internal/search.ts:46` uses
`HAVING count(*) = ${categoryIds.length}`. Inventory reuses that shape rather
than inventing "any" semantics.

`?category=<uuid>` becomes `?categories=<uuid>,<uuid>`. Old links break, which
is intended: pre-production, no back-compat aliases.

## UI

**`/admin/categories` gets Project and Inventory tabs.** Tabs rather than two
sections on one page for a concrete reason: `useAdminTableState` puts `sort`,
`dir` and `cols` in the URL, so two `AdminDataTable`s on one page would collide
on all three and need per-table prefixes and a widened search schema. Tabs
mount one table at a time, so the existing params work unchanged, and
`parseSort` already falls back to the page default when a sort id does not
exist in the other table. `/my/items` and `/admin/inventory/requests` establish
the pattern.

- **Project tab**: Name, Type, Created, Actions. Create dialog keeps the facet
  combobox.
- **Inventory tab**: Name, Created, Actions. **No Type column, no type field in
  its create dialog.** The string `inventory` never appears as a selectable
  value anywhere in the UI.

The active tab lives in the URL (`?tab=project|inventory`) so a link to either
is shareable, consistent with the rest of this app's filter state.

**`CategoryMultiSelect` gains a domain and an optional create affordance.**
Typing a name that does not exist offers "Create «Sensors»", which creates it
in the field's own domain and selects it. This replaces the dead-end empty
state on both the inventory item form and the project form. Creation is
staff-gated; both forms already sit behind `["admin", "instructor"]` route
guards, and the server function enforces it independently.

**The inventory item form** swaps its single Select for `CategoryMultiSelect`.

**Item displays** (`inventory-card`, `inventory-row`, the detail page, the
admin table) render a chip list rather than a single name, reusing
`category-chip.tsx`, which projects already use.

**CSV export** emits a `"; "`-joined `Categories` column, exactly as the
projects export already does.

## Testing

- Migration: after replay on a clean database, both
  `inventory_items_search_vector_idx` and
  `inventory_item_categories_category_idx` exist, `search_vector` no longer
  references a category, and `db:generate` reports no changes.
- Domain isolation: a project picker never returns an inventory category and
  the reverse, asserted through the **zod boundary** and not only the impl, as
  the `excludeTypes` test learned to do.
- Validation: creating a project category without a type is rejected; creating
  an inventory category *with* one is rejected rather than silently stripped.
- Cardinality: an item with two categories round-trips through create, read and
  update; removing one leaves the other.
- Filter semantics: an item matching one of two selected categories is
  **excluded**, which is what pins `all` rather than `any`.
- Cascade: deleting a category removes its join rows and leaves items intact.
- Creatable multi-select: creating from the field produces a category in the
  correct domain and does not offer creation to a non-staff caller.

Every test that pins a guard must be shown to fail when the guard is removed.
This branch has repeatedly shipped assertions that passed against both correct
and broken implementations, and each was caught only by mutation.

## Out of scope

- Merging existing case-variant categories ("Electronics" vs "electronics").
  The migration promotes each distinct string as-is; consolidating them is an
  admin action, and there is no merge tool. Worth noting that `categories` has
  no unique constraint on `(name, domain, type)`, so duplicates can be
  recreated by hand.
- Facets for inventory categories. `type` is null for that domain; if inventory
  ever needs facets, the column is already there.
- Restoring the category term to the inventory `search_vector`. Dropped on the
  project owner's instruction; category filtering is a separate control.
