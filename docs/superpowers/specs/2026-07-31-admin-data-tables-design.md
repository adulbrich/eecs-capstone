# Admin data tables (inventory, projects, mentors): design

Date: 2026-07-31

Rebuilds the three staff list pages (`/admin/inventory`, `/admin/projects`,
`/admin/mentors`) on TanStack Table so staff can sort by any column, choose
which columns are visible, and see substantially more of each record at once.
All three get the same interaction model; each keeps the filters and row
actions its own workflow needs.

The governing principle, which every decision below follows from:

> **The server decides which rows exist. The client decides their order and
> which columns show.**

Filtering (search text, status, program, proposer, soft-deleted, category)
stays server-side, in the URL, and in `loaderDeps`. Sorting and column
visibility are client-side, in the URL, and deliberately *not* in `loaderDeps`.

---

## Current behavior

| | `/admin/inventory` | `/admin/projects` | `/admin/mentors` |
| --- | --- | --- | --- |
| Rows fetched | server-paginated, 20/page | all matching | all |
| Presentation | `AdminTable` | `ProjectRow` cards | `AdminTable` |
| Order | fixed `updatedAt desc` | fixed `updatedAt desc` | fixed `name asc` |
| Search | server, name + tsvector | server, title + tsvector | none |
| Other filters | status | status, program, proposer, soft-deleted | none |
| Column choice | none | none | none |
| Container | `max-w-4xl` | `max-w-4xl` | `max-w-4xl` |

Three facts about the existing code shape the design:

1. **`@tanstack/react-table` and `@tanstack/match-sorter-utils` are already
   dependencies and are imported by nothing.** This is a greenfield
   integration, not an extension of existing usage.
2. **The mobile card layout already exists and is free.** `src/styles.css:436`
   restacks any `.admin-table` into cards below 768px, drawing each field's
   name from its cell's `data-label` attribute. Any table that emits
   `data-label` gets mobile cards with no extra code. By contrast the
   `data-columns` attribute set at `admin-table.tsx:12` is read by nothing and
   is dead.
3. **`ProjectRow` is shared with the public listing** through
   `project-list-item.tsx`. It stays; `/admin/projects` simply stops being one
   of its consumers.

### Scale

Steady-state expectation is under roughly 500 rows per table. That is what
makes "server sends the whole filtered set, client orders it" viable, and it is
the assumption the whole design rests on. If any table later approaches
thousands of rows, sorting has to move into `ORDER BY` with a column whitelist,
and this document's core rule is what would have to change.

The exposure is narrower than it looks: `/admin/projects` and `/admin/mentors`
already load every matching row today. Only inventory changes behavior here,
from 20 rows per request to the whole filtered set.

---

## Feature A: the shared table component

### `src/components/ui/table.tsx` (new, via `shadcn add table`)

shadcn ships no data-table component; its Data Table page is a guide to
composing `<Table />` with TanStack yourself, which is what this design does.
The only installable piece is `table.tsx`, eight thin wrappers over plain HTML
table elements. It is adopted for consistency with the other components in
`src/components/ui/`, and it needs four edits on arrival:

1. `Table` hardcodes a wrapper `<div className="relative w-full
   overflow-x-auto">`, and the `className` prop lands on the inner `<table>`,
   not the div. The wrapper becomes `md:max-h-[calc(100vh-14rem)]
   md:overflow-auto`, so it is a genuine scroll container above the card
   breakpoint and no container at all below it. The height constraint is what
   makes the sticky header work; see below.
2. `TableCell` and `TableHead` carry `whitespace-nowrap`, which is right for a
   table row and wrong for a stacked card. Both become `whitespace-normal
   md:whitespace-nowrap`.
3. The `<table>` gets `border-separate border-spacing-0`. A sticky header
   requires this: `position: sticky` on a `th` does not hold under
   `border-collapse: collapse` in most engines, which is what both the browser
   default and the current `admin-table.tsx:11` markup use.
4. The row rule moves off `TableRow` and onto the cells. In the separated
   border model a `<tr>` cannot paint a border at all, so shadcn's
   `TableRow` `border-b` would silently render nothing once edit 3 lands.
   `TableHead` and `TableCell` each take the `border-b` instead. This also
   preserves what the mobile CSS depends on, since it uses each cell's
   `border-bottom` as the card's internal divider.

Above the card breakpoint the admin tables therefore lose today's full grid
lines and become row-ruled. That is an intended visual change.

Recording these edits matters because the component is copy-owned: there is no
upstream to sync with, and a future reader needs to know which divergences are
deliberate, particularly edits 3 and 4, which look like arbitrary style churn
until you know the sticky header is what forced them.

### `src/components/admin-data-table.tsx` (new)

One component owns the toolbar, the sortable header, the `data-label` body, and
the URL/localStorage sync. Props:

```ts
interface AdminDataTableProps<T> {
  caption: string;          // rendered in <TableCaption>, for screen readers
  columns: ColumnDef<T>[];
  data: T[];
  defaultSort: { id: string; desc: boolean };
  emptyMessage: string;
  getRowId: (row: T) => string;
  storageKey: string;       // localStorage suffix, e.g. "inventory"
  toolbar?: ReactNode;      // the page's own filter controls
}
```

Pages supply column definitions and their filter controls; everything else is
shared. `getRowId` is required rather than optional, for the reason given under
Feature D.

There is deliberately no `defaultHidden` prop. Whether a column starts hidden
lives on the column definition itself, as `meta: { defaultHidden: true }`, and
`AdminDataTable` derives the initial visibility state by reading it. One source
of truth means the per-page column tables below map one to one onto code, and
it removes the possibility of a column being listed as hidden by default while
also setting `enableHiding: false`, a combination that would be unreachable
from the UI.

The rendered table keeps `className="admin-table"` so the existing mobile CSS
applies unchanged, and every body cell emits `data-label` derived from its
column's header text.

### Sorting

Each sortable header renders a `<button>` inside `<TableHead scope="col">`,
with `aria-sort` (`"ascending"` / `"descending"` / `"none"`) on the `th` itself.
Indicators use the lucide chevrons already in the project.

Three sorting rules are set once, in the shared component, rather than
rediscovered per page:

- **Nulls sort last in both directions.** Most columns here are nullable, and a
  staff member sorting by Location wants locations, not forty blank rows first.
  TanStack's `sortUndefined: "last"` does this, and is applied before the
  direction is negated, so it holds ascending and descending alike. It only
  recognizes `undefined` though, while Drizzle returns SQL nulls, so each
  nullable column's `accessorFn` maps `null` to `undefined` before the option
  can take effect.
- **Text sorts case-insensitively**, via `localeCompare` with
  `sensitivity: "base"`, so `arduino` and `Arduino` interleave.
- **Status sorts by workflow order, not alphabetically.** Inventory sorts
  `available < requested < reserved < checked_out < maintenance`; projects sort
  `draft < submitted < changes_requested < approved < published < archived`.
  Alphabetical status order carries no meaning for a reader.

State syncs to `?sort=<columnId>&dir=asc|desc`. Each route's `validateSearch`
schema gains `sort` (optional string), `dir` (optional `"asc" | "desc"`), and
`cols` (optional string), all optional so their absence means "page default"
rather than a value that has to be serialized.

### Column visibility

The picker is a `DropdownMenu` of `DropdownMenuCheckboxItem`s behind a
"Columns" button, so Radix supplies keyboard operation and focus management.
The identity column (Name or Title) and the actions column set
`enableHiding: false`. A "Reset columns" item restores the page default.

`?cols=` carries **only the hidden column ids**, comma-joined, and is absent
entirely when the default set is showing. A default view therefore has a clean
URL, and a shared link reproduces exactly what the sender saw.

Because desktop and mobile render the same DOM, hiding a column hides it in the
mobile cards too. That is intended.

### `src/lib/table-state.ts` (new)

The URL and storage codec, modeled directly on `src/lib/view-preference.ts`:

- `parseSort` / `serializeSort` for `?sort=` and `?dir=`, falling back to the
  page default on an unknown column id or direction.
- `parseHidden` / `serializeHidden` for `?cols=`, returning `undefined` (so the
  param is omitted) when the hidden set equals the page default.
- `readStoredColumns` / `writeStoredColumns`, one `localStorage` key per page
  (`admin-table-cols:<storageKey>`), SSR-safe and tolerant of stored garbage.
- A mount hook that seeds the URL from storage when `?cols=` is absent, using
  `navigate({ replace: true })`, exactly as `use-seed-view` already does. The
  URL wins whenever the param is present; storage only supplies a default.

### The `loaderDeps` hazard

`src/routes/_authed/admin/inventory/index.tsx:62` is currently
`loaderDeps: ({ search }) => search`. Adding `sort`, `dir`, and `cols` to that
route's search schema without changing this would make every sort click and
every column toggle re-run the loader and refetch rows the browser already has.
`loaderDeps` on all three routes must therefore list the filter fields
explicitly, the way `projects/index.tsx:65` already does. This is called out
here so it is not later "fixed" back to the terser form.

---

## Feature B: server-side changes

Search stays in Postgres. The projects `search_vector` indexes
`problem_statement`, `objectives`, and both qualification fields, long-form text
that will never be a table column, and it stems, so `mentoring` finds `mentor`.
Moving search into the browser would silently shrink what is findable. Instead
each page's existing predicate widens to cover the fields staff actually
hunt by.

### Inventory (`src/server/inventory.ts`, `src/server/_internal/inventory.ts`)

`listInventory` is shared with the public `/inventory` page, which keeps its
pagination, so admin gets its own entry point rather than a new mode on the
shared one.

- Extract the WHERE-clause construction in `listInventoryAs` into
  `buildInventoryConditions(data)`, used by both listings so the two cannot
  drift on what "retired is excluded" means.
- New `listAdminInventoryAs(viewer, data)` and its `listAdminInventory` server
  function. It asserts staff, returns every matching row with no `limit` or
  `offset`, and keeps the existing holder join.
- Staff rows gain `createdAt` and `updatedAt`, which `fullForStaff` does not
  currently carry, so those columns can exist.
- The search predicate widens from name plus tsvector to also match `serial`,
  `label`, `location`, and the joined holder's name and email by `ilike`.
- The category filter is finally wired up on this page. `listInventoryCategories`
  already exists and is imported by nothing, while the route passes
  `category: null` into a parameter the query already honors.

### Projects (`src/server/_internal/project-summary.ts`, `projects-queries.ts`)

`projectSummarySelect` feeds the public listing and "my projects", so it is not
touched.

- New `adminProjectSummarySelect` in the same file, spreading
  `projectSummarySelect` and adding `contactEmail`, `teamsSupported`,
  `createdAt`, `publishedAt`, `deletedAt`, `proposerId`, and the joined
  proposer's `name` and `email`.
- `listAdminProjectsAs` selects it and adds a `leftJoin` on `user` for the
  proposer. The join must be a `leftJoin`, not `innerJoin`: `proposerId` is
  `onDelete: "set null"`, so a project whose proposer was deleted would
  otherwise vanish from the staff list.
- The search predicate widens across that join to match proposer name and
  email, plus `contactName` and `contactEmail`, by `ilike`.
- The existing proposer-dropdown scoping (built from status, program, and the
  soft-delete switch, but not from `q` or the proposer choice) is unchanged.
  The comment at `projects-queries.ts:117` explaining why still holds.

### Mentors (`src/server/_internal/users.ts`)

- `listMentorsAs` takes an optional `q`, matching `name`, `email`, and
  `affiliation` by `ilike`. The `user` table has no tsvector, so this is
  substring matching, which is adequate for a list of a few dozen people.

---

## Feature C: the three pages

Each page keeps its current filter controls, passed through the `toolbar` slot,
and adds the Columns button. All three drop `max-w-4xl` for a full-width
container at `md` and up; the mobile card view is unaffected. The other admin
list pages (`users`, `categories`, `programs`) keep their current narrow layout
and are out of scope.

The header pins at `md` and up only, since `thead` is `display: none` below that
breakpoint. Three things have to hold together for it to actually stick, and
all three are already accounted for in the `table.tsx` edits:

- the wrapper is a height-constrained scroll container, so `top: 0` has
  something to stick against rather than being pinned to the top of a table
  that scrolls away with the page;
- the table is `border-separate` with zero spacing, since sticky positioning on
  a `th` does not hold under `border-collapse: collapse`;
- each `th` carries an opaque background (`bg-secondary`, matching today's
  header) and a `z-index`, or the body rows show through as they scroll under
  it.

### `/admin/inventory`

| Column | Default | Notes |
| --- | --- | --- |
| Name | visible, not hideable | thumbnail + link to `/inventory/$itemId` |
| Status | visible | `InventoryStatusBadge`, workflow sort order |
| Holder | visible | name, falling back to label, then "(user)" |
| Location | visible | |
| Category | visible | |
| Label | hidden | |
| Serial | hidden | |
| Due | hidden | `dueAt`, date sort |
| Updated | hidden | |
| Created | hidden | |
| Actions | visible, not hideable | Edit link |

Filters: search, status, and the newly wired category select. Server pagination
and the Previous/Next control are removed; the full filtered set renders in one
scrollable table.

### `/admin/projects`

| Column | Default | Notes |
| --- | --- | --- |
| Title | visible, not hideable | thumbnail + link; carries a "Deleted" badge when `deletedAt` is set |
| Status | visible | badge, workflow sort order |
| Proposer | visible | name over email; sorts by name, nulls last |
| Program | visible | `courseId courseName` |
| Updated | visible | |
| Contact | hidden | `contactName` over `contactEmail` |
| Teams | hidden | `teamsSupported`, numeric sort |
| Created | hidden | |
| Published | hidden | |
| Actions | visible, not hideable | Edit link |

Filters unchanged: search, status, program, proposer, show soft-deleted. The
page stops importing `ProjectRow`.

This is the page where "more information visible at once" does the most work:
today a staff member sees a title, a status, and a description excerpt, and must
open a project to learn who proposed it.

### `/admin/mentors`

| Column | Default | Notes |
| --- | --- | --- |
| Name | visible, not hideable | |
| Affiliation | visible | |
| Email | visible | |
| Teams | visible | the existing number input, live state |
| Actions | visible, not hideable | Save / Remove |

Gains a search box, backed by the new server-side `q`. Nothing is hidden by
default; with five columns a picker that starts by hiding things would only
confuse.

---

## Feature D: the mentors inline-edit hazard

Mentors is the one page whose cells hold unsaved state. `MentorRow` keeps
`count`, `error`, and `saving` in React state, and the Teams cell is a live
`<input>`.

Sorting reorders rows. If React re-keys them (which it does when keys are
positional), the row unmounts and remounts, and a half-typed team count is
silently lost. `getRowId: (row) => row.id` makes TanStack's row ids stable
across every reorder, so React reconciles rather than remounts.

This is why `getRowId` is a required prop on `AdminDataTable` rather than an
optional one with an index fallback: the failure is invisible in review and
only shows up as a user losing work.

---

## Accessibility

The project has a dedicated a11y suite (`src/test/a11y/admin.a11y.test.ts`),
and sortable headers plus a column menu are both new interactive surfaces.

- `<th scope="col">` with a real `<button>` inside, and `aria-sort` on the `th`.
- The column menu is Radix `DropdownMenu`, so keyboard operation, focus
  trapping, and `aria-checked` come from the primitive.
- `<TableCaption>` names each table, rendered as the **first** child of
  `<Table>`, before `<TableHeader>`. shadcn styles it `caption-bottom` so it
  appears below visually, but the HTML spec requires `<caption>` to be the
  table's first child and axe flags it otherwise.
- A visually hidden `aria-live="polite"` region announces the row count after
  filtering ("24 items"), since the table can change size with no visible
  focus change.
- Sticky headers must not apply below 768px, where `thead` is `display: none`.

---

## Testing

**Unit (`vitest` + testing-library):**

- `table-state.ts`: sort round-trips through the URL; an unknown column id or
  direction falls back to the page default; the hidden-columns param is omitted
  when the set matches the default and parses back identically when it does
  not; stored garbage in `localStorage` is ignored rather than thrown on.
- `admin-data-table.tsx`: activating a header button sets `aria-sort` on its
  `th` and reorders rows; hiding a column removes both its `th` and all its
  `td`s; every body cell's `data-label` equals its column's header text (this
  is what mobile cards depend on).
- Mentors regression: type into a Teams input, sort by Name, assert the typed
  value survived. This is the `getRowId` guarantee from Feature D.

**Integration (`vitest.integration.config.ts`):**

- Extend `src/server/__tests__/admin-projects-filter.integration.test.ts`:
  searching by proposer email and by contact name finds the project; a project
  whose proposer was deleted still appears (the `leftJoin` guarantee).
- New test for `listAdminInventoryAs`: returns the complete filtered set rather
  than a page; searching by serial, by label, and by holder email each match.

**Accessibility (`playwright`):**

- `admin.a11y.test.ts` gains an interaction pass on `/admin/inventory`: open
  the column menu, activate a sort header, then `checkA11y`.
- The existing static route checks for all three pages stay, but they are not
  assumed to keep passing. Each page is now a new markup surface for axe
  (`scope`, `aria-sort` values, caption position, the dropdown trigger's
  accessible name), so the suite runs at the end of every phase and any new
  violation blocks that phase rather than being carried forward.

---

## Sequencing

1. **Foundation plus inventory.** `shadcn add table` with its three edits,
   `table-state.ts`, `admin-data-table.tsx`, the inventory server changes, and
   the inventory route. Proves the pattern end to end on the page with the most
   filters.
2. **Projects.** `adminProjectSummarySelect`, the widened search, the route.
   The richest of the three.
3. **Mentors.** The `q` parameter, the route, the inline-edit test. Then delete
   `src/components/admin-table.tsx`.

**Correction, made during implementation.** That last step was wrong and was
not carried out. `AdminTable` still has three consumers after mentors:
`/admin/programs`, `/admin/users`, and `/admin/categories`. Deleting it would
break the build. It stays until those three pages migrate, which the project
backlog already records as separate future work.

The old component is deleted outright rather than kept as a wrapper: the app is
pre-production and carries no back-compatibility shims.

---

## Out of scope

- Row selection and bulk actions.
- CSV or spreadsheet export.
- Row virtualization. At this scale it would cost a dependency, fixed row
  heights, and complications for the card CSS, for no gain.
- Per-column filter inputs. The existing selects plus one search box cover the
  known workflows.
- `/admin/users`, `/admin/categories`, `/admin/programs`.
- The public `/inventory` and `/projects` listings, including their pagination,
  their view toggle, and `ProjectRow`.
