# Category usage counts and holder assignment: design

Date: 2026-08-06

Clears two roadmap items from the README:

1. **Usage counts in `/admin/categories`.** Each category row shows how many
   projects (or inventory items) are filed under it, computed efficiently and
   without slowing down every category dropdown in the app.
2. **A simpler inventory holder assignment.** Staff assign an item to a person
   by email address, with an optional name and program, or to a thing by label.
   One student can request an item and a teammate can pick it up, and both the
   request and the picker are visible.

The two are independent. They share this document because they land together;
neither blocks the other, and they can be implemented and reviewed in any
order.

---

## Part A: usage counts in `/admin/categories`

### Governing rule

> **The count is computed by the database, in the same round trip that fetches
> the rows, and only for the screen that asks for it.**

### Current behavior

`listCategoriesImpl` (`src/server/_internal/categories.ts:36`) is a plain
`select()` over `categories` filtered by domain and type. It has three
consumers:

| Caller | Purpose | Gate |
| --- | --- | --- |
| `src/routes/_authed/admin/categories/index.tsx:77` | the admin table | staff, in `beforeLoad` |
| `src/components/category-multi-select.tsx:41` | the category picker on project and item forms | none |
| `src/components/projects-filter-bar.tsx:61` | the public project filter | none |

Two of the three are dropdowns on hot paths, and neither is staff-gated.

### Why a new function rather than a flag

Adding a `withUsage?: boolean` to `listSchema` would keep one code path, but it
has two costs the flag cannot avoid:

- **Type honesty.** The admin route derives its row type with
  `type Row = Awaited<ReturnType<typeof listCategories>>["rows"][number]`
  (`index.tsx:85`). A conditional field would have to be typed
  `usageCount?: number`, so the table column and the CSV column would both
  handle an `undefined` that never actually occurs on that screen.
- **Gating.** `listCategories` is reachable without a session, because the
  public filter bar calls it. Counts are staff information. A flag on a
  publicly-reachable function is one forgotten argument away from leaking.

So: a second server function, `listCategoriesWithUsage`, gated by the same
`assertStaff` the other admin category mutations use. `listCategories` is left
untouched, and the dropdowns keep both their current query plan and their
current row type.

### The query

```sql
select c.*,
  (case c.domain
     when 'project' then (
       select count(*)::int
       from project_categories pc
       join projects p
         on p.id = pc.project_id
        and p.deleted_at is null
        and p.status <> 'draft'
       where pc.category_id = c.id)
     else (
       select count(*)::int
       from inventory_item_categories iic
       where iic.category_id = c.id)
   end) as usage_count
from categories c
where c.domain = $1
order by c.type, c.name
```

Three properties make this the efficient shape:

- **`CASE` short-circuits per row.** A project category never scans
  `inventory_item_categories`, and the reverse. Two `LEFT JOIN`s onto grouped
  subqueries would build both aggregates for every row regardless of domain.
- **`categories.domain` is immutable** (`updateCategoryAs` rejects a domain
  change, `src/server/_internal/categories.ts:130`), so the cross-domain count
  is always zero and there is never a reason to render both.
- **`::int`** because `count()` returns `bigint`, which the `pg` driver hands
  back as a string. Without the cast the column arrives as `"12"` and sorts
  lexicographically, putting 9 after 12.

In Drizzle this is one `sql<number>` fragment in the select list of the
existing query, not a separate round trip.

### What counts

**Projects:** every project filed under the category except soft-deleted ones
(`deleted_at is not null`) and drafts (`status = 'draft'`). A draft is a work
in progress visible only to its owner, so counting it would inflate the answer
to "how much is actually filed under this category". Submitted, approved,
changes-requested, published and archived projects all count.

**Inventory items:** every item filed under the category, with no status
filter. Items are retired or hard-deleted, never soft-deleted, so there is no
equivalent exclusion to make.

### Index

`inventory_item_categories` already carries
`inventory_item_categories_category_idx` on `category_id`
(`drizzle/0010_category_domains.sql:47`). `project_categories` has only its
composite primary key, which leads with `project_id`, so counting by
`category_id` has no supporting index today.

Add to the `projectCategories` table definition in `src/db/schema.ts`:

```ts
index("project_categories_category_idx").on(t.categoryId)
```

`npm run db:generate` picks this up; no hand-written SQL.

### Table and export

One count column per tab, since the domain decides which junction table was
counted:

| Tab | Header | Position |
| --- | --- | --- |
| Project categories | `Projects` | after `Name`, before `Type` |
| Inventory categories | `Items` | after `Name` |

Numeric sort, visible by default, hideable through the Columns menu.

`EXPORT_COLUMNS` gains a matching `Usage` entry. This is not optional:
`defineCsvColumns<Row>()` fails `npm run typecheck` when a field of `Row` has
no column (`index.tsx:148-151`), which is the forcing function working as
designed.

### Tests

Unit: the usage-count projection against a category carrying a soft-deleted
project, a draft project and a published project. The count is 1.

Integration: a category with items in both junction tables returns only the
count for its own domain.

### Non-goals

- **No delete guard.** Seeing "12 projects" beside a category does not block
  deleting it, and `deleteCategoryAs` keeps its current cascade behavior. That
  is a separate behavior change, not part of showing a number.
- **The count is not a link.** Clicking it does not navigate to a filtered
  project or inventory list.

---

## Part B: inventory holder assignment

### Governing invariant

> **`current_holder_label` is non-null if and only if `current_holder_email`
> is null.** A hold is on a person, identified by an address, or on a thing,
> identified by a label. `current_holder_id` is never an input; it is always
> derived from the address.

### Current behavior

`inventory_items` already carries `current_holder_id`,
`current_holder_email` and `current_holder_label`, and `transitionItem`
already resolves an address to an existing account through `resolveHolderId`
(`src/server/_internal/inventory-transitions.ts:104`), the same way
`projects.proposer_email` resolves to `proposer_id`. The assign dialog in
`src/components/inventory-lifecycle-panel.tsx` offers three radio modes and
`validateInvariants` requires exactly one of the three columns.

That "exactly one of three" is the defect. Assigning to an account through the
user picker writes `current_holder_id` and leaves `current_holder_email` null;
assigning the same person by typing their address writes both. One person
therefore produces two different row shapes, and every read path compensates:

- `holderEmailOf` (`src/server/_internal/inventory.ts:123`) prefers the joined
  account address over the stored one, because the stored one may be absent.
- `formatHolderDisplay` (`inventory-lifecycle-panel.tsx:152`) has a four-branch
  fallback chain ending in the string `"(user)"`.
- `initialAssignMode` (`inventory-lifecycle-panel.tsx:83`) reverse-engineers
  which radio to reopen from which columns happen to be populated.

None of that code has a reason to exist once the address is always stored.

### What the dialog stores

```
Staff open "Check out" or "Reserve" on an item
│
├─ item.current_request_item_id is not null ?
│    ├─ yes -> Email prefilled with the REQUESTER's address
│    └─ no  -> Email prefilled with the current holder's address, or blank
│
▼
Email field non-empty?
│
├─ YES: the hold is on a person. Name and Program inputs are offered.
│       The Label field is not rendered.
│  │
│  └─ look up an account WHERE user.email = the typed address
│     │
│     ├─ account exists
│     │    current_holder_id      = that account's id
│     │    current_holder_email   = the typed address
│     │    current_holder_label   = null
│     │    current_holder_name    = null   (the account is authoritative)
│     │    current_holder_program = null   (same)
│     │    -> the holder is notified and the item appears in their /my/items
│     │
│     └─ no account
│          current_holder_id      = null
│          current_holder_email   = the typed address
│          current_holder_label   = null
│          current_holder_name    = the typed name, or null
│          current_holder_program = the typed program, or null
│          -> no notification is possible (notifications.user_id is a foreign
│             key and there is no account to point it at), but the hold links
│             itself on the next transition after that address signs up
│
└─ NO: the hold is on a thing. Label becomes required.
        current_holder_id      = null
        current_holder_email   = null
        current_holder_label   = the typed label
        current_holder_name    = null
        current_holder_program = null
```

### Two people on one item

```
Student A carts the item, submits
   request line (requester = A, status pending)
   item.current_request_item_id = line.id
   item.current_holder_id = A, current_holder_email = A's address
│
▼
Staff approve
   item -> reserved, holder still A, pickup_by set, line -> approved
│
▼
Student B walks in to collect it. Staff hit "Check out"; the Email field is
prefilled with A's address and staff replace it with B's.
   item.current_request_item_id  stays = line.id   (request still belongs to A)
   item.current_holder_*         now describe B
   history row: new_status = checked_out, request_item_id = line.id,
                holder_id / holder_email describe B
│
▼
Reads
   admin request queue -> "Requested by A - Collected by B"
   A's /my/items       -> the request line, shown as checked out, "collected by B"
   B's /my/items       -> the hold
   after return        -> the checked_out history row still names B, so the
                          closed line still reports its collector
```

### Migration

| Table | Change |
| --- | --- |
| `inventory_items` | add `current_holder_name` text, `current_holder_program` text |
| `inventory_item_status_history` | add `holder_email` text, `holder_name` text, `holder_program` text |

`program` is free text, not a foreign key to `programs`. A walk-in with no
account may name a course the table does not have, and staff should not be
blocked by that at the counter.

`holder_email` on the history table ends a conflation the current code admits
to in a comment (`inventory-transitions.ts:206-211`): today an address that
matched no account is written into `holder_label`, so history cannot
distinguish "assigned to an address with no account" from "assigned to the
ad-hoc label `bob@example.com`". After this change `holder_label` means a
label and nothing else.

No backfill. The app is pre-production and dev seeds reset.

### Server changes

**`inventory-transitions.ts`**

- `TransitionInput` drops `holderId` and gains `holderName` and
  `holderProgram`.
- `validateInvariants`, the `reserved | checked_out` arm: require exactly one
  of `holderEmail` and `holderLabel`. Name and program are attributes, not
  identity, and are excluded from that count. `checked_out` still requires
  `dueAt`.
- `validateInvariants`, the `available | maintenance | retired` arm: reject
  name and program alongside the holder fields it already rejects.
- `validateInvariants`, the `requested` arm: require `requestItemId` and
  `holderEmail`, and reject `holderLabel`. A request always comes from an
  account, so it always has an address.
- `resolveHolderId` is unchanged and becomes the sole writer of
  `current_holder_id`.
- When `resolveHolderId` returns an id, `holderName` and `holderProgram` are
  discarded before the write. The account is authoritative for both.
- The history insert writes `holder_email`, `holder_name` and `holder_program`
  straight through; the `holderLabel ?? (holderId ? null : holderEmail)`
  expression is deleted.

**`inventory.ts`**

- `approveRequestItemAs` passes the requester's `email` rather than
  `requesterId`. Its locked select gains `innerJoin(user, eq(inventoryRequests.userId, user.id))`.
- `submitCartAs` writes `current_holder_email` alongside `current_holder_id`
  using a scalar subselect on `user`, so a self-submitted request hold obeys
  the same invariant as every other person hold. Its inline history insert
  writes `holder_email` too.
- `holderEmailOf` keeps preferring the joined account address over the stored
  one. That is still correct and is now a genuine "someone changed their email"
  case rather than a compensation for a missing column.
- `fullForStaff` gains `currentHolderName` and `currentHolderProgram`.
- **`listMyItemsAs`**: the hold query's `isNull(inventoryItems.currentRequestItemId)`
  condition becomes a `NOT EXISTS` over the viewer's own live request lines for
  that item. The point of the original condition was that an item must not
  appear twice on one person's page; that still holds, while a picker who is
  not the requester now sees the item they are actually holding.

```ts
// replaces isNull(inventoryItems.currentRequestItemId)
notExists(
  db.select({ one: sql`1` })
    .from(inventoryRequestItems)
    .innerJoin(inventoryRequests, eq(inventoryRequestItems.requestId, inventoryRequests.id))
    .where(and(
      eq(inventoryRequestItems.id, inventoryItems.currentRequestItemId),
      eq(inventoryRequests.userId, viewer.id)
    ))
)
```

- **`recordOverdueNotificationsAs`**: the hold scan drops the same `isNull`
  condition, so the picker is notified about an item they hold even when the
  request behind it belongs to someone else. The requester scan is unchanged,
  so the requester is notified too. Before the insert, candidates are deduped
  in JS on `(userId, type, link)`, so requester and picker being the same
  person still produces one row per deadline type.

**New helper, `collectedByForRequestItems(lineIds: string[])`** in
`src/server/_internal/inventory.ts`:

```sql
select distinct on (h.request_item_id)
  h.request_item_id, h.holder_id, h.holder_email, h.holder_name,
  u.email as account_email, u.name as account_name
from inventory_item_status_history h
left join "user" u on u.id = h.holder_id
where h.new_status = 'checked_out' and h.request_item_id = any($1)
order by h.request_item_id, h.created_at desc
```

One query for a whole page of lines, no N+1. This is what makes "collected by"
survive the return without denormalizing the fact onto
`inventory_request_items`: the history row is the record, and it is already
written by the single transition chokepoint.

`listInventoryRequestsAs` and `listMyItemsAs` both call it for the lines they
are about to return, and merge the result in memory.

**`src/server/inventory.ts`**: `transitionSchema` drops `holderId`, gains
`holderName` and `holderProgram` (`z.string().max(200).nullable().default(null)`
each), and keeps the existing email validation.

### UI changes

`UserPicker` (`src/components/user-picker.tsx`) has exactly one consumer, this
dialog. It is deleted, along with `AssignFields`, `initialAssignMode`,
`selectedHolder`, the `AssignMode` type and the three-radio fieldset. Its unit
test is rewritten against the replacement.

New `HolderField` component: an email `Input` with a "Search accounts" popover
beside it. The popover is the existing `searchUsers`-backed `Command` list from
`UserPicker`, changed only in what selecting a row does, which is now to write
the address into the field instead of holding a separate `SelectedUser` object.

```
+-- Check out item -------------------------------+
| Email        [alice@oregonstate.edu ] [Search]  |
|              Matches account: Alice Chen        |
|                                                 |
| Name         [                      ] optional  |
| Program      [                      ] optional  |
|                                                 |
| Due date     [2026-08-20]                       |
| Comment      [                      ]           |
+-------------------------------------------------+

With the email left blank:

| Email        [                      ]           |
| Label        [Lab 204               ] required  |
```

Name and Program are rendered only while the typed address matches no account,
so the form never offers to collect information the account already holds.
Matching is checked on a debounced lookup against the same `searchUsers`
endpoint the popover uses.

`formatHolderDisplay` collapses to two branches: the account's name and
address when there is an account, otherwise the stored address (with name and
program, when present) or the label.

The status history list in the same panel currently renders
`Holder: {h.holderLabel ?? h.holderId}` (`inventory-lifecycle-panel.tsx:208`),
which prints a raw user id whenever the hold was assigned through the user
picker. With `holder_email` on the history table it prints an address instead,
falling back to the label. `HistoryRow` gains `holderEmail`, `holderName` and
`holderProgram`, and `getItemHistoryAs` projects them.

`AdminRequestQueueRow` gains a `Requested by A - Collected by B` line, rendered
only when the collector differs from the requester.

The `/my/items` active and history entries gain the same line for the same
reason.

### Documentation to update

`docs/QUIRKS.md:537-539` currently states that the request-line scan and the
hold scan in `recordOverdueNotificationsAs` are "disjoint by construction",
resting on `current_request_item_id IS NULL`. That is no longer true and the
overlap is deliberate: when a request and a hold describe two different people,
both are notified. The entry is rewritten to say so, to describe the JS dedupe
that handles the same-person case, and to note that
`notifications_overdue_unique_idx` on `(user_id, type, link)` does not collapse
the two-person case because the user ids differ.

The same section's note about `listMyItemsAs` matching an unlinked hold by
verified email is unchanged and still accurate.

### Tests

Integration (`src/server/__tests__/`):

- Checking out a request-linked item to a different address keeps
  `current_request_item_id` attached, and the item appears in the requester's
  `/my/items` as a request line and in the picker's as a hold, exactly once
  each.
- An overdue item held by B against A's request produces two notifications with
  two different `user_id`s; the same item held by its own requester produces
  one.
- A returned line still reports its collector, read from the `checked_out`
  history row.
- A transition to `checked_out` with neither an email nor a label is rejected;
  so is one with both.
- An address matching an account discards a supplied name and program.

Unit:

- `validateInvariants` against the new exclusivity rule, including the name and
  program fields being ignored by it.

**Known migration cost.** `src/server/__tests__/inventory.integration.test.ts`
has 25 `holderId:` arguments across roughly 50 `transitionItem` calls. Dropping
`holderId` from `TransitionInput` turns every one of them into a `holderEmail:`
with a seeded address. This is mechanical but it is the single largest block of
edits in Part B, and the plan should budget a step for it rather than treating
it as incidental cleanup.

### Non-goals

- **No `picked_up_by_*` columns on `inventory_request_items`.** The history
  table already records the fact and is already written by the single
  transition chokepoint; a second copy would need to be kept in sync for no
  read that cannot be served by one `DISTINCT ON` query.
- **No third holder party.** An item has one requester and one current holder.
  A chain of three people passing an item along is recorded in status history
  as successive checkouts, not modeled as a first-class relation.
- **Program stays free text.** No dropdown, no foreign key, no validation
  against `programs`.
