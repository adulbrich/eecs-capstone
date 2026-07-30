# Unified item detail page + project private panel: design

Date: 2026-07-30

Covers two independent changes requested together, both about making the
visibility boundary on a detail page structural rather than incidental:

- **A.** Merge the two inventory item detail pages into one, matching how
  projects already work.
- **B.** Group the proposer-and-staff sections of the project page (private
  notes, status history, comments) into one bordered panel, distinct from the
  publicly displayed fields.

Both follow the same principle: **a detail page is one page, and audience is
expressed by which panels render, not by which URL you are on.**

---

## Feature A: One inventory item detail page

### Current behavior

Two routes render the same item with no link between them:

| | `/inventory/$itemId` | `/admin/inventory/$itemId` |
| --- | --- | --- |
| Reached from | `inventory-card`, `inventory-row` | `/admin/inventory` table |
| Image, name, status, category, description | yes | yes, re-implemented |
| Add to cart | yes | no |
| Serial, label, location, private notes | no | yes |
| Lifecycle panel | no | yes |
| Link to the other page | no | no |

Three problems follow:

1. **No path between them.** Staff browsing the public catalog who spot a
   problem must navigate to `/admin/inventory` and find the item again by hand.
2. **The duplication has already drifted.** With no image the public page
   renders nothing, while the admin page renders an empty `aspect-square`. Two
   renderers for one payload guarantee more of this.
3. **Staff lose "Add to cart"** on the admin page, for no recorded reason.

Projects solved this already: one route, `viewerIsStaff` / `viewerIsOwner`
conditionals, and a `StaffProjectPanel` for the staff surface.

### Approach: merge onto the public route

`/inventory/$itemId` becomes the single detail page. Everyone sees the public
block; staff additionally render a staff panel below it.

### Server (`src/server/inventory.ts`, `src/server/_internal/inventory.ts`)

The public route cannot call `getItemHistory`: `getItemHistoryAs` opens with
`assertStaff(viewer)` and `getItemHistoryForCurrentUser` wraps `requireUser()`,
so an anonymous loader would throw rather than degrade. The loader therefore
needs one call that decides for itself.

- New `getInventoryItemDetailAs(viewer, { id })` returning
  `{ item, history, viewerIsStaff }`, mirroring `getProjectAs`'s shape:
  - `item` is whatever `getInventoryItemAs` already returns, so
    `stripForPublic` / `fullForStaff` remain the single gate. No new field
    filtering is introduced by this change.
  - `history` is `getItemHistoryAs(viewer, …)` for staff and `[]` otherwise.
    Non-staff never reach the `assertStaff` call.
  - `viewerIsStaff` is returned explicitly rather than inferred client-side
    from the presence of `notes` / `serial`, which would be a
    payload-shape-sniffing gate and would silently invert if a field were ever
    added to the public shape.
  - Returns `null` when the item is missing or retired-and-not-staff, matching
    `getInventoryItemAs` today.
- New `getInventoryItemDetail` server fn wrapping it, per the repo convention
  that every `createServerFn` has an `*As(viewer, …)` companion for tests.

Fate of the two server fns this replaces, verified by grep rather than assumed:

- `getInventoryItem` (server fn) keeps one caller after the merge, the edit
  route `$itemId_.edit.tsx`. It stays.
- `getItemHistory` (server fn) has exactly one caller, the admin detail route
  that becomes a redirect. It therefore becomes dead and is **removed**.
  `getItemHistoryAs` stays: the new detail function calls it directly, and the
  integration tests use it.
- `getItemHistoryForCurrentUser` exists only to back the removed server fn and
  is removed with it.

### Routes

`src/routes/inventory/$itemId.tsx`
- Loader calls `getInventoryItemDetail`, `throw notFound()` on null.
- Public block unchanged in content: image, name, status badge, category,
  description, Add to cart. Add-to-cart gating (`status === "available"` and
  signed in) is unchanged, so staff now get the button they previously lost.
- Renders `<StaffInventoryPanel>` when `viewerIsStaff`.

`src/routes/_authed/admin/inventory/$itemId.tsx`
- Becomes a `beforeLoad` redirect to `/inventory/$itemId`. Kept rather than
  deleted so existing bookmarks and any external links still resolve.
- Its `StaffItem` interface, `<dl>`, notes block and breadcrumb move into the
  new panel or are dropped (see below).

`src/routes/_authed/admin/inventory/index.tsx`
- Row link target becomes `/inventory/$itemId`.

`src/routes/_authed/admin/inventory/$itemId_.edit.tsx`
- Back-link target becomes `/inventory/$itemId`. The edit route itself is
  unchanged and stays under `/admin`, since it is a staff-only form rather than
  a view.

### New component (`src/components/staff-inventory-panel.tsx`)

Bordered panel matching `StaffProjectPanel`'s visual language, whose container
is `mt-8 rounded-lg border-(--brand-primary-tint) border-2 bg-card p-4` with an
`island-kicker` header. Contains, in order:

- Staff fields `<dl>`: location, serial, label.
- Private notes, using `PRIVATE_NOTES_LABEL` / `PRIVATE_NOTES_INVENTORY_HINT`.
- Edit link to `/admin/inventory/$itemId/edit`.
- `<InventoryLifecyclePanel>` relocated **unchanged**. It is 558 lines with its
  own status-transition dialogs and danger zone; moving it as-is keeps this
  change reviewable, and its behavior is already covered by existing tests.

The breadcrumb (`Admin > Inventory > item`) is dropped. It described a path
that no longer exists now that the canonical URL is public, and the panel's
"Edit" link plus the site header cover navigation.

### Presentation cleanup

The merged public block gets one image renderer. Inventory images are square
(`InventoryImageUploader` crops 1:1), so the fallback is the existing
`ImageOrFallback` treatment rather than the project placeholder, which is 16:9
and branded for projects. Explicitly **not** reusing
`PROJECT_PLACEHOLDER_IMAGE` here: it says "OSU Capstone" and would be wrong on
a Raspberry Pi.

---

## Feature B: Project private panel

### Current behavior

`/projects/$projectId` renders, in page order: public fields, then Private
notes, Status history and Comments as three sibling `h2` sections gated on
`viewerIsStaff || viewerIsOwner`, then `StaffProjectPanel`. Nothing visually
separates the private three from the public ones, and Private notes carries its
own audience line that the other two lack.

### Approach

One bordered panel wrapping all three, with a single audience statement.

`src/components/project-private-panel.tsx`:

- Bordered container, `island-kicker` reading "Private", and one line:
  "Only visible to you and program staff. Never shown publicly."
- **Visually distinct from the staff panel.** A staff viewer renders both
  panels stacked; if they shared the brand-tinted border they would read as one
  region, which defeats the point of separating two different audiences. The
  private panel uses a neutral `border-border` container on `--surface-sunken`;
  the brand tint stays reserved for staff-only. The kicker text ("Private" vs
  "Staff panel") is the label, the border is the signal.
- The kicker is an `<h2 className="island-kicker">`, not the `<p>` that
  `StaffProjectPanel` uses. The panel needs a real heading so its `h3`s have a
  parent and so the panel is reachable by heading navigation, which matters more
  here than anywhere else on the page: this is the section that tells a proposer
  what is and is not public. Aligning `StaffProjectPanel` to the same treatment
  is a follow-up, not part of this change.
- Contains Private notes, Status history (`<StatusTimeline>`) and Comments
  (`<CommentThread>`), in that order.
- Rendered from the route when `viewerIsStaff || viewerIsOwner`, replacing the
  three inline sections.
- `PRIVATE_NOTES_PROJECT_HINT` is no longer rendered per-field on this page;
  the panel's line supersedes it. The constant stays in use on the project
  form, where the field appears without the panel around it.

The page's visibility tiers become explicit and top-to-bottom:

1. Public: title, status, image, markdown fields, contact, URL.
2. Private panel: proposer + staff.
3. Staff panel: staff only.

### Heading levels

Status history and Comments are currently page-level `h2`s. Inside the panel
they become `h3`s under the panel's own `h2`, which is the correct document
structure and keeps the axe `heading-order` rule satisfied. This is a visible
restyle of those two headings, and is intended.

`SectionHeading` (added earlier for the h2 pass) continues to serve the public
sections and the panel's own `h2`.

---

## Tests

### Integration (`src/server/__tests__/inventory.integration.test.ts`)

Extending the privacy block added earlier:

- `getInventoryItemDetailAs` returns `viewerIsStaff: false` and `history: []`
  for an anonymous viewer and for a signed-in non-staff user, and does not
  throw. This is the regression guard for the `assertStaff` trap: the whole
  reason the wrapper exists.
- The same call returns `viewerIsStaff: true` and a populated `history` for
  staff after a transition.
- The non-staff `item` payload still omits `notes`, `serial`, `location`, so
  merging the pages did not widen the public shape.
- Returns `null` for a retired item viewed by a non-staff user.

### Accessibility (`src/test/a11y/admin.a11y.test.ts`)

- The `admin inventory item detail` test currently visits
  `/admin/inventory/${itemId}`, which will become a redirect. Repoint it at
  `/inventory/${itemId}` while still authenticated as admin, so the staff panel
  keeps axe coverage instead of the suite scanning a redirect target that the
  public test already covers as an anonymous viewer.
- The public `inventory item detail` test is unchanged and now also asserts
  that the anonymous render has no staff panel.

### Existing tests expected to stay green

`inventory-card`, `inventory-row`, `comment-thread`, `project-card`,
`project-row`, and the project visibility unit tests. None reference the routes
being changed.

---

## Out of scope / non-goals

- **No change to who can see what.** Both features are presentational
  regrouping. `stripForPublic`, `fullForStaff`, `stripPrivateFields` and
  `filterCommentsForViewer` are untouched, and the integration assertions above
  exist to prove it.
- `InventoryLifecyclePanel` is relocated, not refactored. Its size and its
  `text-sm` `h2`s are a known follow-up, deliberately not bundled here.
- `/admin/inventory` (the management table) stays. Only the item *detail* page
  merges; a bulk management table is a different surface from a detail view.
- The inventory edit form stays under `/admin`. Merging view pages does not
  imply merging forms.
- No default placeholder image for inventory items. Projects got a branded 16:9
  placeholder; inventory items are square and unbranded, and would need their
  own asset.

---

## Risks

- **Redirect loop.** `/admin/inventory/$itemId` redirecting to
  `/inventory/$itemId` is safe only because the target is not itself gated to
  `_authed`. Verified: the target route is public and does its own null check.
- **SSR shape.** The merged route is server-rendered for anonymous viewers with
  a staff-only branch in the tree. The branch is driven by the server-computed
  `viewerIsStaff` and the payload is already stripped server-side, so an
  anonymous render has no staff data to leak into the HTML. The integration
  assertions on the non-staff `item` payload are what hold this.
