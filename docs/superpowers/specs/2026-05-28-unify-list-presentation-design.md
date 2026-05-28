# Unify Projects & Inventory list presentation

Date: 2026-05-28
Status: Approved

## Goal

Make the Projects and Inventory browse pages visually cohesive and give
their card/row presentations a single consistent layout, spacing, and
type/color system. Bring the project management views (admin/projects,
my/projects, my/bookmarks) onto the same card/row components so the whole
app presents projects identically. Add a placeholder icon to inventory
items with no image, and give the public Inventory page pagination that
matches Projects.

## Decisions (locked)

- **Card-view width:** outer container `max-w-7xl`; card grid spans it at
  `sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4`.
- **Bounded width:** filter bar, row-view list, and pagination are bounded
  to `max-w-4xl` (left-aligned within the `max-w-7xl` container).
- **Inventory card/row content:** name, 3-line description, status badge,
  embedded Add-to-cart. No category/location/overdue on the list face.
- **Project card/row content:** image, title, 3-line description, program
  label (`courseId courseName`), contact name (no email), `Updated
  M/D/YYYY`, and a status badge shown **for every status except
  `published`** (so the public browse shows an Archived tag only, while
  management views show draft/submitted/changes_requested/archived).
- Project components drop the published-date line and the always-on status
  badge in favor of the rule above.
- Styling standardizes on semantic tokens (`bg-card`, `border-border`,
  `text-muted-foreground`, `hover:border-primary`), replacing the project
  components' inline `var(--surface-*)` styles.
- Implementation uses identical inlined Tailwind classes in each route
  (no shared layout wrapper component yet — extract only if a third list
  page appears).

## Components

### `src/components/image-or-fallback.tsx` (new, moved)
Move `ImageOrFallback` out of `project-card.tsx` into its own module so
both project and inventory components share it. Renders the `<img>` when a
src exists, otherwise a gradient with a centered, muted `ImageIcon`
placeholder. `project-card.tsx` re-exports it for back-compat, or callers
import from the new path (prefer updating imports).

### `ProjectCard` / `ProjectRow`
Shared visual spec:
- **Card:** `ImageOrFallback` (aspect 16/9) → title row (title +
  `StatusBadge` when `status !== "published"`) → 3-line description
  (`line-clamp-3`) → meta line `CS-462 Capstone · Jane Doe` → `Updated
  M/D/YYYY`. Container `rounded-lg border border-border bg-card`,
  `hover:border-primary`.
- **Row:** thumbnail left (`h-24 w-32`, `shrink-0`, object-cover) + the
  same fields stacked on the right (`min-w-0`, truncation where needed).
- Type/color: title `font-semibold` (card text-base, row text-sm),
  description `text-sm text-muted-foreground`, meta `text-xs
  text-muted-foreground`.

`ProjectSummary` type gains **optional** fields: `contactName`,
`updatedAt`, `programCourseId`, `programCourseName`. Meta segments render
only when their value is present, so callers that don't supply them degrade
gracefully (none will after this change, but it keeps the type safe).

### `InventoryCard` / `InventoryRow`
- **Card:** `ImageOrFallback` (aspect 16/9) → name → 3-line description →
  `InventoryStatusBadge` → embedded `Add to cart` (rendered when
  `signedIn && status === "available" && onAddToCart`). The whole card is
  navigable to the item except the button.
- **Row:** thumbnail left + name + 3-line description + status on the
  right, with Add-to-cart embedded.
- `InventoryRow` props expand to include `description`, `imageUrl`, and the
  `signedIn` / `onAddToCart` handling already used by `InventoryCard`.
- Same token/type system as the project components for cohesion.

## Page layout (identical structure)

Applies to `/projects` and `/inventory`, and structurally to
`my/projects`, `my/bookmarks`, `admin/projects`:

```
<div class="mx-auto max-w-7xl px-4 py-6 md:p-8">
  <h1 />                              // + management-page header controls
  <div class="max-w-4xl"> filter / controls </div>
  {view === "card"
    ? <div class="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"> cards </div>
    : <div class="mt-6 max-w-4xl flex flex-col gap-3"> rows </div>}
  <div class="mt-6 max-w-4xl ..."> pagination </div>
</div>
```

- `/projects`: `max-w-3xl` → `max-w-7xl`; grid gains `xl:grid-cols-4`.
- `/inventory`: `max-w-4xl` → `max-w-7xl`; add pagination UI; `pageSize`
  24 → 20.
- `my/bookmarks`: card-only grid using the card-view block.
- `my/projects`, `admin/projects`: keep their status-tab controls (bounded
  to `max-w-4xl`), render rows in the bounded row block. (These are
  row-only views today; keep them row-only.)

## Data wiring

To populate program/contact/updated meta consistently, four queries get a
`leftJoin(programs)` and select `programs.courseId` / `programs.courseName`
plus `contactName` and `updatedAt`:

- `searchProjectsImpl` (public browse)
- `listMyProjectsImpl`
- `listAdminProjectsImpl`
- `listMyBookmarksForCurrentUser` (extend its narrow projection)

Introduce a shared select fragment + mapper in
`src/server/_internal/project-summary.ts`:
- `projectSummarySelect` — the column projection (project fields + program
  course id/name) used by the queries.
- `mapProjectSummary(row)` — maps a joined row to the `ProjectSummary`
  shape consumed by the components.

This keeps the four queries DRY and guarantees identical shapes. Existing
extra fields each query returns (e.g. `bookmarkedAt`, ordering) are
preserved.

## Inventory pagination & data

- `/inventory` route: add the Previous / "Page X of Y" / Next block
  identical to `/projects`, driven by the `page` search param; bound to
  `max-w-4xl`.
- Pass `description` and `imageUrl` (already loaded) plus
  `signedIn`/`onAddToCart` into `InventoryRow`.
- `pageSize` aligned to 20.

## Testing

- Run the full unit suite (`npm test`). Update any test touching changed
  component markup or query shapes (`inventory-filter-bar`,
  `inventory-status-badge`, `inventory-schemas` do not assert card/row
  internals, but verify).
- Integration tests (`search`, `bookmarks`, `projects`) assert query
  results — update expected shapes for the added program/contact/updated
  fields if they pin exact objects.
- Visual verification in the running app on `:3000`, signed in as the seed
  admin: projects + inventory, card and row, signed-in/out, archived vs
  published, items/projects with and without images, and inventory
  pagination.

## Out of scope

- No changes to the project/inventory detail pages.
- No new filters or data beyond the meta fields listed.
- No shared layout-wrapper abstraction (inlined classes per route).
