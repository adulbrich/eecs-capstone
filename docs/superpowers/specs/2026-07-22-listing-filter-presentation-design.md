# Listing and Filter Presentation

Date: 2026-07-22
Status: Approved design, ready for implementation planning

## Summary

Four README roadmap items are one body of work: they are all presentation
problems in the project listings and their filter bars, and three of them touch
the same components.

1. The list-view thumbnail has no fixed aspect ratio, so its crop varies from
   row to row.
2. The "Show only archived projects" and "Include banned" checkboxes are
   smaller than and bottom-aligned against the inputs beside them.
3. The admin projects soft-delete toggle is a bare text link, which does not
   read as a control at all.
4. Admin projects cannot be filtered by program, which instructors will need
   once different instructors run different programs.

Items 2 and 3 resolve into a single shared component. Item 4 is a
straightforward port of a filter that already exists on the public listing.

## Goals

- Give the list-view thumbnail a deterministic crop that does not depend on how
  much text sits beside it.
- Present every boolean filter identically, aligned with the inputs and selects
  it sits next to.
- Let staff filter admin projects by program, as a URL search param, alongside
  the existing status and soft-delete filters.

## Non-goals (out of scope for this release)

- Changing the upload crop ratio. Project images stay 16:9 at upload
  (`project-image-uploader.tsx:11`).
- Changing the card view. `aspect-[16/9]` there is correct and stays.
- Restricting instructors to their own programs. The program filter is a
  convenience, not an authorization boundary. See Decisions.
- Per-type faceted category filtering, which is its own README roadmap item.
- ~~Reworking the admin status tab strip.~~ Superseded during implementation:
  the tab strip became a dropdown. See Decisions.

## Decisions

- **The list thumbnail becomes a fixed 3:2 box, vertically centered (user
  decision).** The root cause today is that `ProjectRow` stretches the image to
  the row's height (`w-32 shrink-0 self-stretch` with an absolutely positioned
  `object-cover` image, `project-row.tsx:18-23`). Row height is driven by
  description length and by whether the meta and updated lines render, so the
  same image is cropped differently in every row, and roughly square in most.
  Fixing the ratio makes the crop deterministic.
- **3:2 rather than 4:3 or 16:9 (user decision).** Uploads are cropped to 16:9,
  so any taller display box crops the sides. 3:2 preserves about 89% of the
  upload width against 75% for 4:3, while still reading as a compact list
  thumbnail rather than a wide banner. The crop still differs from the card
  view; that is the accepted cost of a compact row.
- **Boolean filters become switches with an inline label, vertically centered
  (user decision).** A switch communicates a binary on/off state more directly
  than a checkbox in a filter context, and centering the switch-plus-label pair
  against the control row height fixes the alignment without aligning it to the
  labels above.
- **One `FilterSwitch` component for all three call sites.** The public filter
  bar, admin users, and admin projects currently express the same idea three
  different ways, including one that is not a control. Consolidating is the
  point of grouping these items.
- **The program filter defaults to all programs (user decision).** It behaves
  identically for every staff member and mirrors the public filter bar. No
  authorization change, no per-role default, nothing to reason about when
  reading a shared URL.
- **Projects with no program remain visible under "All programs".** The filter
  applies a `programId` equality condition only when a program is selected, so
  a null program is never silently excluded from the default view.

## Item 1: list-view thumbnail

`src/components/project-row.tsx`, used by the public listing
(`routes/projects/index.tsx` via `ProjectListItem`), the admin projects list,
and `my/projects`. All three inherit the fix.

Current structure is a stretched wrapper with an absolutely positioned image.
The replacement drops the wrapper entirely and lets the aspect ratio drive the
box:

- The image becomes `aspect-[3/2] w-28 shrink-0 rounded-md object-cover sm:w-40`.
- The `Link` changes from `items-stretch` to `items-center` and gains `p-3`,
  while the text column drops its own `py-3 pr-3`. Padding is needed because a
  centered image no longer meets the card's edges, so without it the thumbnail
  would float against a bare border.
- `ImageOrFallback` already merges an incoming `className` through `cn` for the
  fallback branch and applies it directly to the `img`, so both branches accept
  the aspect classes with no change to that component.

Row height becomes the greater of the text block and the thumbnail, so short
rows are governed by the image and long rows by the text, and the crop is
identical either way.

## Items 2 and 3: `FilterSwitch`

New `src/components/filter-switch.tsx`, built on the existing
`src/components/ui/switch.tsx`:

```tsx
<div className="flex h-9 items-center gap-2">
  <Switch checked={checked} id={id} onCheckedChange={onCheckedChange} />
  <Label className="font-normal" htmlFor={id}>{children}</Label>
</div>
```

The `h-9` box is what does the alignment work. Where a switch sits beside a
labelled field in a grid, the parent cell keeps `items-end`, so the 36px switch
box lines up exactly with the 36px `SelectTrigger` or `Input` beside it, and
not with the label above it. Where it sits in a toolbar, the box centers
naturally in the row.

**An accessibility detail that must not be missed.** The current call sites nest
`<Checkbox>` inside `<Label>` and rely on implicit labelling. Radix's `Switch`
renders a `button`, and a `button` inside a `label` is not implicitly labelled.
`FilterSwitch` therefore requires an explicit `id` and `htmlFor`, and every call
site must pass a unique id. Without it the control is announced unlabelled, and
the axe run in `src/test/a11y` should catch a regression here.

Call sites:

- `src/components/projects-filter-bar.tsx:152-160`: "Show only archived
  projects". The cell keeps `flex items-end`; the checkbox-in-label is replaced.
- `src/routes/_authed/admin/users/index.tsx:145-159`: "Include banned". Sits in
  a `flex flex-wrap items-end gap-3` toolbar and aligns with the search input
  and the role select.
- `src/routes/_authed/admin/projects/index.tsx:76-87`: the `Show/Hide
  soft-deleted` link becomes a labelled switch reading "Show soft-deleted",
  driven by `navigate` rather than a `Link`. State remains a URL search param,
  so links stay shareable; the loss is that the toggle can no longer be
  middle-clicked into a new tab, which is not a meaningful use of a filter.

## Item 4: admin program filter

The public listing already does exactly this. `searchProjectsImpl:18-20` applies
`eq(projects.programId, data.programId)` when a program is selected, and joins
`programs` for the label. The admin query mirrors it.

The chain, end to end:

1. `src/routes/_authed/admin/projects/index.tsx`: `searchSchema` gains
   `program: z.string().uuid().nullable().default(null)`, and `loaderDeps`
   passes it through.
2. `src/server/projects-queries.ts:18-21`: `adminListSchema` gains the same
   field.
3. `src/server/_internal/projects-queries.ts:68-90`: `listAdminProjectsImpl`
   pushes `eq(projects.programId, data.program)` into its `conditions` array
   when the value is non-null. The existing `leftJoin(programs, ...)` already
   supplies the label, so nothing else in the query changes.
4. UI: a `Select` populated from `listPrograms()`, with an "All programs"
   option mapping to `null`, following the pattern in
   `projects-filter-bar.tsx:134-151` including its `_all_` sentinel value,
   since an empty string is not a valid `SelectItem` value.

Placement, matching the route's existing responsive split:

- Mobile: the program select stacks under the status select in the existing
  `space-y-2` block, with the soft-delete switch below.
**Amended during implementation: the status tab strip is now a dropdown.**
Adding the program select pushed the desktop toolbar past its container. The
row held a seven-item tab strip plus, newly, a 224px select and the
soft-delete switch: roughly 960px of content in an 832px `max-w-4xl` column.
It could not fit at any viewport, and `body { overflow-x: hidden }` meant the
overflow was silently clipped rather than scrollable.

Converting status to a dropdown fixes the cause rather than the symptom, and
collapses a structural problem with it. The mobile and desktop blocks had
been separate because status was a select on one and tabs on the other; both
were always in the DOM, since `md:hidden` and `hidden md:flex` are visibility
toggles, not conditional rendering. That forced per-breakpoint id suffixes to
avoid duplicate ids, after a real duplicate-id defect was found in review.
With status a dropdown everywhere, the two blocks render identical content
and collapse into one, so each control has a single instance, the suffix
machinery is gone, and the program label could become visible like every
other filter label.

The cost is real and accepted: the available statuses are no longer visible
at a glance, and switching status is now two clicks rather than one.

The layout below describes the original design and is retained for context.

- Desktop: the status tab strip is unchanged. The program select and the
  soft-delete switch sit together in the right-hand group of the existing
  `flex items-end justify-between` row.

Clearing behaviour follows the rest of the app: changing a filter does not
reset the others, and every filter is readable from the URL.

## Testing

- Unit: `ProjectRow` renders the thumbnail with the fixed aspect class, in both
  the image and the fallback branches.
- Unit: `FilterSwitch` renders a control with an accessible name, and calls
  `onCheckedChange` when toggled.
- Integration: `listAdminProjectsImpl` filters by program; returns projects with
  a null program when no program is selected; and composes the program filter
  with the status and soft-delete conditions rather than replacing them.
- Integration: the program filter remains subject to the existing staff-only
  gate in `listAdminProjectsImpl`.
- Accessibility (Playwright): the projects listing, admin projects, and admin
  users pages keep a clean axe run, specifically covering the switch labelling
  change.

## Manual smoke checklist

- List view: a project with a one-line description and a project with a long
  description show the same crop of the same image.
- Card and list views side by side: the list crop is visibly the centre of the
  card crop, not a different framing.
- The archived, banned, and soft-deleted switches each sit on the same
  horizontal centre line as the input or select beside them, at both
  breakpoints.
- Each switch is reachable by keyboard, toggles with Space, and announces its
  label and state.
- Selecting a program on admin projects updates the URL, survives a reload, and
  composes with a status tab and the soft-delete switch.
