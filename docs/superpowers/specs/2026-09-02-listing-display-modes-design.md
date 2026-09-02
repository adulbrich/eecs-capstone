# Listing display modes: design

Date: 2026-09-02
Issue: #78

Two display modes on the public project listing, each responsive, replacing the
two non-responsive ones there today. The inventory listing gets the card half of
the same change: the card half first, and the table half once its column
list was settled on the issue.

---

## What exists today

`ViewToggle` (`src/components/view-toggle.tsx`) offers `card` and `row`, one
preference for both `/projects` and `/inventory`, persisted through
`src/lib/view-preference.ts` and seeded from storage by
`src/lib/use-seed-view.ts`. `project-card.tsx` renders the mobile shape and
`project-row.tsx` the desktop one, as two components rendering the same nine
fields. `project-list-item.tsx` is a third file that picks between them. The
inventory listing has the same pair, `inventory-card.tsx` and
`inventory-row.tsx`.

Neither shape is responsive. A phone in row mode gets a 7rem thumbnail beside a
truncated title; a wide screen in card mode gets a five-column grid of
16:9 tiles. The mode chooses a layout, and the layout does not read the
viewport.

There is no bookmark control on the listing. `bookmark-button.tsx` is used only
by the detail page, so shortlisting a project means opening it and navigating
back.

## The two modes

The stored preference values become `card` and `table`. `row` is removed, not
aliased: `readStoredView` returns `null` for it, so anyone holding a stored
`row` falls back to the default once and their next click writes a valid value.
A `?view=row` link is treated the same way: the search schema's `view` takes
`.catch(undefined)`, so a stale link renders the default rather than a router
error, exactly as the inventory route already does for a stale `?category=`.

### Mode 1, `card`

One component, `ProjectCard`, responsive at the app's single `md` breakpoint
(`docs/UI-CONVENTIONS.md`, "Mobile-first layout"). Below `md` it is today's
card: image on top at 16:9, title, three clamped lines of description, program
and contact, updated date. At `md` and up it is today's row: image on the left
at 3:2 and `w-40`, the same content beside it.

`project-row.tsx` and `project-list-item.tsx` are deleted. Every consumer of
either renders `ProjectCard` in a single-column list bounded to `max-w-4xl`:
the public listing, `/my/projects`, and `/my/bookmarks`. The five-tier card
grid ladder leaves the project pages with this change, because a row-shaped
card at `md` cannot sit in a three-column grid.

The `Card` is no longer `asChild` around the `Link`. The bookmark control below
is a `<button>`, and a button inside an anchor is invalid HTML that axe reports
as a nested interactive. The structure `inventory-card.tsx` already uses is the
model: the `Card` is a `div`, the `Link` is its first child and takes the whole
image-and-text area, and the control sits beside it as a sibling.

### Mode 2, `table`

An `AdminDataTable` driven by `useAdminTable`, on both mobile and desktop,
matching the admin tables. Column visibility stays on with
`storageKey: "public-projects"`, a key of its own because its column list is not
the admin table's. Sorting is client side over the current page, because the
issue's sorting requirements (`sortingFn: "basic"` for teams, `"datetime"` for
updated) describe TanStack's local sort and because the server's ordering
vocabulary (relevance, newest, recommended) is not a column.

That decision has one consequence to state rather than discover: the table
always applies one column sort, and its default is `updatedAt` descending, the
same as `/admin/projects`. In table mode the Sort select still decides which
twenty rows make up the page; the column sort decides their order on it. A
keyword search in table mode therefore shows the twenty most relevant rows,
ordered by date. Teaching `AdminDataTable` a "no sort, keep server order" state
would fix that and was considered; it is a change to the shared table with its
own tests and belongs to its own issue if the trade-off turns out to matter.

The `sort` search param on `/projects` (relevance, newest, recommended) is
renamed to `order`, because `useAdminTable` owns `sort` and `dir` and there is
no way to tell it otherwise. The server function input keeps its `sort` field:
that is the API, and the route maps one name to the other. This changes shared
URLs. The app is pre-production and takes no back-compat shims, so a
`?sort=newest` link simply renders the default order.

`loaderDeps` narrows from the whole search object to the six filter fields
(`q`, `categories`, `program`, `archivedOnly`, `page`, `order`). Today every
search change re-runs the loader; with `sort`, `dir`, `cols` and `view` in the
URL that would mean a server round trip per column toggle, which the admin
routes already avoid the same way.

### Columns

`projectDetailView` (`src/lib/project-visibility.ts`) is the authority: what it
returns to an anonymous viewer is what is public. Nothing here makes a new field
public.

| Column | id | Default | Sort | Notes |
| --- | --- | --- | --- | --- |
| Title | `title` | visible, not hideable | text | `cardHeader`. Thumbnail and bookmark control render inside this cell beside the link, as `/admin/projects` does for the thumbnail. Neither is its own column. |
| Program | `program` | visible | text, empties last | `programLabel`, course id and name |
| Categories | `categories` | visible | none | name-only chips from a correlated `json_agg` of `{ id, name, type }`, ordered by type then name; the type is the chip's `title`, because as chip text it made a five-category project a five-line row |
| Teams supported | `teams` | visible | `basic` | |
| NDA/IP required | `nda` | visible | `basic` | `Badge` reading "Required", or a dash |
| Mentorship | `mentorship` | visible | seeking first, then student proposed, `basic` | added when #75 landed during this branch: the two public flags as `MentorshipBadges` plus the resolved mentor name; never the address |
| Contact name | `contactName` | visible | text, empties last | |
| Contact email | `contactEmail` | hidden | text, empties last | `mailto:` link, as the detail page renders it |
| Updated | `updatedAt` | visible | `datetime` | `LocalTime dateOnly` |
| Description | `description` | hidden | none | prose |
| Problem statement | `problemStatement` | hidden | none | prose |
| Objectives | `objectives` | hidden | none | prose |
| Min qualifications | `minQualifications` | hidden | none | prose |
| Pref qualifications | `prefQualifications` | hidden | none | prose |
| License restrictions | `licenseRestrictions` | hidden | none | prose |
| URL | `url` | hidden | text, empties last | external link, `rel="noreferrer"` |

Prose cells render `stripMarkdown(text)` inside `max-w-xs line-clamp-3`. Without
the fixed width one long description sets the row height and the table stops
being scannable. Prose columns set `enableSorting: false` and carry no
`accessorFn`: sorting a clamped paragraph means nothing, and the explicit flag
is what keeps `?sort=description` out of `useAdminTableState`'s sortable set.

Not columns: `status`, because the public listing shows one status at a time
and a constant column is noise even when hideable. `notes` and `isSponsored`,
proposer-and-staff only. `proposerId` and `proposerEmail`, staff only.
`publishedAt`, not on the public page at all.

The column list lives in `src/components/project-table-columns.tsx`, not in
the route, so a jsdom test can render it through `AdminDataTable` the way
`admin-data-table.test.tsx` renders its fixtures. The admin routes keep their
columns inline; this one is exported because the bookmark control and the prose
clamp are behavior worth pinning.

### Bookmarks on the listing

Both modes get a bookmark control, per the comment on #78. It is a compact,
icon-only toggle: on a card it sits beside the link (below the text under `md`,
to the right at `md` and up); in the table it sits at the end of the Title cell.
The table gets no bookmark column, so an anonymous viewer, for whom the control
renders nothing, does not see an empty column.

`BookmarkButton` today fetches its own state on mount. Twenty of them on one
page would be twenty requests, so the listing fetches the viewer's bookmarked
ids once:

- `listMyBookmarkIdsAs(viewer)` in `src/server/_internal/bookmarks.ts` returns
  `{ ids: string[] }`, the project ids of the viewer's own bookmark rows. No
  `canSeeProject` filter: the ids are only ever matched against rows the
  listing already showed, and a hidden project's id matching nothing is not a
  leak. `listMyBookmarkIds` is the `createServerFn` wrapper, declared
  `authenticated` in `access-contract.ts`.
- `BookmarkSetProvider` (`src/components/bookmark-set.tsx`) wraps the listing.
  After mount, for a signed-in viewer, it calls `listMyBookmarkIds` once and
  holds the set. `useBookmarkSet()` returns `null` outside a provider, before
  mount, when signed out, or before the fetch resolves.
- `BookmarkToggle({ projectId })` reads the set and renders nothing while it is
  `null`. That is the hydration rule `bookmark-button.tsx` already documents:
  the server renders no control, so the client's first render must not either.
  On click it flips the set optimistically, calls `addBookmark` or
  `removeBookmark`, and reverts on failure. Labels are the detail page's
  ("Bookmark" and "Remove bookmark") so the e2e suite's role queries carry.

`/my/projects` and `/my/bookmarks` render no provider, so their cards carry no
control. On the bookmarks page a working toggle would have to remove the row
as well, which is its own small feature and not this one.

## Server change

`projectSummarySelect` (`src/server/_internal/project-summary.ts`) widens from
nine fields to every public column above: it gains `problemStatement`,
`objectives`, `minQualifications`, `prefQualifications`, `url`,
`licenseRestrictions`, `contactEmail`, `requiresNdaIp`, `teamsSupported` and
`categories`. That is `projectDetailView` minus `notes`, `isSponsored`,
`programId` and `deletedAt`, which the listing has no use for.

Consequences:

- `listMyBookmarksAs` and `listMyProjectsImpl` share the projection and get
  wider too. Deliberate. The bookmarks integration test pins the key set and is
  updated to the new one.
- The correlated `categories` subquery moves out of `exportAdminProjectsAs`
  into `project-summary.ts` as one shared expression.
- `adminProjectSummarySelect` loses `contactEmail` and `teamsSupported`, now
  duplicates. `exportAdminProjectsAs` loses the six prose columns and
  `categories` from its own select for the same reason and keeps `notes` and
  `archivedAt`. Its CSV gains an "NDA/IP required" column, because
  `defineCsvColumns<ExportRow>` refuses to compile with a field left out.
- The public listing's SSR payload gets larger, on the page anonymous users hit
  first, times `pageSize`. The issue says not to build a lazy prose fetch until
  that is measured. Nothing here measures it; the PR body carries the payload
  size of the seeded page for whoever does.
- `searchProjectsImpl`'s key set is pinned by a new integration test, in the
  same shape as the bookmarks one, so a private column cannot ride into the
  public listing with nothing failing.

## Inventory

`/inventory` gets both modes. `InventoryCard` becomes responsive the same
way, `inventory-row.tsx` is deleted, and the grid becomes the same bounded
single-column list. The table is an `AdminDataTable` under
`storageKey: "public-inventory"`, its column list in
`src/components/inventory-table-columns.tsx` for the same testability reason
as the projects one.

`publicItemView` (`src/lib/inventory-visibility.ts`) is the authority. Its
column list was settled on #78 on 2026-09-02:

| Column | id | Default | Sort | Notes |
| --- | --- | --- | --- | --- |
| Name | `name` | visible, not hideable | text | `cardHeader`. Thumbnail, link, and the add-to-cart control for a signed-in viewer when the item is available, all inside this cell. No Actions column |
| Status | `status` | visible | lifecycle order, `basic` | badge; available first, as `/admin/inventory` sorts it |
| Categories | `categories` | visible | none | chips, as the cards render them |
| Description | `description` | hidden | none | plain text, `max-w-xs line-clamp-3` |

Not columns: `pickupBy` and `dueAt`. They are in `publicItemView` but nowhere
on the public UI, and #193 removes them from it: a hold's dates belong to
staff, the requester and the holder.

Default sort is Name ascending. The server orders the listing by `updatedAt`,
which is a staff column, and the table must sort by one it shows; widening
the projection to match the card order would make a new field public.

The add-to-cart control in the table is `ListingAddToCart`
(`add-to-cart-button.tsx`): the column list is a module constant with no
route to hand it the session, so it reads the session itself and renders
nothing until mounted, signed in, and the item is available, the same
hydration rule as `BookmarkToggle`.

`ViewToggle` takes `onChange` rather than navigating itself: the two routes
navigate from different paths and `useNavigate({ from })` typechecks only
against a literal one. One stored preference covers both listings, so table
on projects means table on inventory.

### Two changes to the projects table from seeing it rendered

Categories are chips there too. The projection carries `{ id, name, type }`
objects (a `json_agg`, coalesced to `[]`) instead of a `string_agg`, and the
admin CSV joins the names back. Contact email is hidden by default: eight
visible columns overflowed 1280px, and the address is the field a reader
wants least while scanning. The container scrolls sideways for the rest, as
the admin tables do.

## Test coverage

Unit (jsdom, `npm test`):

- `view-preference`: a stored `row` reads as `null`; `table` round-trips.
- `ViewToggle`: writes the choice to storage and navigates with it.
- `ProjectCard`: the image is on top below `md` and on the left at `md`; the
  link and the toggle are siblings, not nested; no control renders outside a
  provider.
- `BookmarkToggle` inside a provider with a mocked signed-in session: renders
  the right label from the set, flips on click, reverts on a failed call.
- The public column list rendered through `AdminDataTable`: default-hidden
  set, prose clamp, NDA badge, URL link, bookmark control in the Title cell.

Integration (`npm run test:integration`):

- `searchProjectsImpl` returns exactly the public key set.
- `listMyBookmarkIdsAs` returns the viewer's own ids and nobody else's.
- The bookmarks key-set test updated.

Accessibility (`npm run test:accessibility`, public suite):

- `@smoke` scan of `/projects?view=table`.
- Mode toggle: clicking "Table view" writes `view=table` and renders the table;
  clicking "Card view" writes `view=card`; a bare revisit is seeded from
  storage.
- Table interactions, the way `admin.a11y.test.ts` does them: Columns menu open
  and scanned, a sort header click writes `sort` and `dir` and flips
  `aria-sort`, a default-hidden column toggled on renders a non-empty cell.

Accessibility, user suite: two signed-in scans of `/projects`, card and table
mode, because the bookmark toggle renders for nobody the public suite signs in
as, and those are the only scans that ever see it; and one of `/inventory` in
table mode, for the add-to-cart control on the same grounds.

Accessibility, inventory: the same four shapes as projects, a `@smoke` scan of
`/inventory?view=table`, the toggle writing the URL, the Columns menu and a
Status sort writing `sort` and `dir`, and the Description column toggled on.

Smoke (`npm run test:smoke`): the public flow already asserts a detail link on
`/projects`; it is run, not extended.

## Documentation

- `docs/UI-CONVENTIONS.md`: the card grid ladder paragraph, the `max-w-4xl`
  page census, and the `asChild` example that names `project-row.tsx`.
- `docs/QUIRKS.md`: a project-domain entry on the listing projection being
  bounded by `projectDetailView` and pinned by the search key-set test.
- `PRD.md`: the listing toggle line (`?view=card|table`) and the bookmark line.

## Out of scope

- "Accepting applicants" and the mentor state as columns (#72, #75).
- The bookmarks count on the title row (#82).
- A "keep server order" state for `AdminDataTable`.
- Lazy fetching of prose columns.
