# UI Conventions

The design system rules for this app: which component to reach for, which token to
use, and how a page behaves between mobile and desktop. Read this before writing or
editing anything under `src/components/` or `src/routes/`.

Companion docs: [`QUIRKS.md`](./QUIRKS.md) for framework gotchas and code style,
[`../README.md`](../README.md) for running the app.

## Table of contents

1. [Brand and design tokens](#brand-and-design-tokens)
2. [Buttons and links](#buttons-and-links)
3. [Form inputs](#form-inputs)
4. [Color tokens](#color-tokens)
5. [Border radius](#border-radius)
6. [Mobile-first layout](#mobile-first-layout)
7. [Site header](#site-header)
8. [Mobile navigation](#mobile-navigation)
9. [Admin tables](#admin-tables)
10. [Component patterns](#component-patterns)
11. [Destructive actions](#destructive-actions)
12. [Mutations and feedback](#mutations-and-feedback)

---

## Brand and design tokens

The design system lives in two files: `src/lib/brand.ts` (a single file, so the app
stays portable to another institution) and `src/styles.css` (CSS custom properties,
light and dark). The primary brand color is Beaver Orange (`#D73F09`).

Reference CSS custom properties or Tailwind token aliases. A hardcoded hex in a
component is invisible to the dark-mode palette and to any future rebrand, so it
silently breaks both.

---

## Buttons and links

### Every interactive action uses `<Button>`

Import from `#/components/ui/button` (or `./ui/button` from inside `src/components/`).
A raw `<button className="bg-brand ...">` misses the focus ring, the disabled state,
and the dark-mode variants that `Button` carries. `src/test/button-conventions.test.ts`
refuses a raw `<button>` outside its allow list.

`type` is required: `type="submit"` on the one button that submits its form, and
`type="button"` on everything else, inside a form or not. The HTML default for a
typeless button is `submit`, so an Upload or Delete button inside a form silently
saves it. `button.tsx` makes `type` a required prop on a rendered `Button` and
forbids it on an `asChild` one (the child is a link), so `npm run typecheck` fails a
`Button` that does not say. It has no default, because a default of `"button"` would
turn an implicit form submit into a no-op just as silently.

| Variant | Use when |
| --- | --- |
| `default` | Primary CTA (Submit, Save, Create, Sign in) |
| `outline` | Secondary actions (Cancel, Edit, Sign out, Withdraw) |
| `ghost` | Tertiary / low-emphasis (Reply, Remove in lists) |
| `destructive` | Irreversible danger (Delete, Ban) |
| `secondary` | Muted fill, when `outline` reads too light against the surface |
| `link` | Inline text that behaves as a button |

### Sizes and icons

Sizes are `xs` (h-6, inline micro-actions like Post reply), `sm` (h-8, most
contextual buttons), `default` (h-9, standalone form submits), and `lg` (h-10,
hero / landing CTAs). Icon-only buttons use `icon-xs`, `icon-sm`, `icon`, or
`icon-lg` to stay square. `bare` has no height and no padding, for a Button that
reads as a line of text: a `link` one in a panel (`ClearFiltersButton`), or a
`ghost` one that is a row's own title.

The size variant also sets the icon size, so pass no size class on an icon inside a
`Button`; the scan refuses one. The base class carries
`[&_svg:not([class*='size-'])]:size-4` (`size-3` under `xs` and `icon-xs`), which
yields only to a class containing `size-`: `h-5 w-5` loses to it and renders 16px.
A call site that genuinely needs another size writes `size-5`.

### A link styled as a button uses `asChild`

`asChild` merges the Button styles onto the `<Link>` so one element renders. Without
it you nest an `<a>` inside a `<button>`, which is invalid HTML and breaks keyboard
activation.

```tsx
<Button asChild size="sm">
  <Link to="/projects/new">New project</Link>
</Button>
```

### One kind of action is one button everywhere

The eye reads a different button as a different action, so these four are fixed:

| Action | Button |
| --- | --- |
| Cancel | `outline` |
| Remove | `ghost` |
| Save | `default` |
| Clear all | `<ClearFiltersButton>` from `#/components/clear-filters-button` |

Size is the row's to decide, not the action's: Cancel takes the size of the button
beside it, Remove is `sm` in a table row and `default` beside an `Input`. Where the
two rules meet, the row wins. See "Size follows the row" below.

### A button shows the hand cursor, whichever element it renders

`button:not(:disabled) { cursor: pointer }` in the base layer of `styles.css` gives
every button the hand an anchor already gets, so an `asChild` Button and a rendered
one look the same under the pointer. A button that is not pressable says so with
`cursor-default`, which as a utility outranks the base rule.

### A variant owns its text colour at rest

`outline` and `ghost` carry `text-foreground` rather than inheriting a colour.
Inherited, a rendered `<button>` took the body colour and an `asChild` anchor took
the global `a` rule's brand orange, so one variant looked like two buttons.
`secondary`, `default` and `destructive` carry their foreground token; `link` is
meant to read as a link and keeps `text-brand-dark`.

### A filled variant hovers to a solid colour

`default` hovers to `bg-primary-hover`, a solid token, not upstream's
`bg-primary/90`. Beaver Orange carries white at 4.56:1, so the 90% blend with
the light page under it drops to 4.0:1 and fails AA while the pointer is on
the button. `destructive` keeps its `/90`, which measures 4.92 in light mode
and 6.33 in dark.

### Size follows the row, not the page

A button on a row with a form control is `default` (h-9), so it aligns with the
`Input` and `SelectTrigger` beside it: the search row's Export CSV, Columns and
view toggle are all `default` for this reason. A contextual button with no form
control on its row is `sm` (h-8): the title-row actions, the buttons inside a
table row or a panel.

### `className` on a Button never restyles it

A Button's `className` may position it (`w-full`, `mt-2`, `xl:hidden`,
`relative`), and may not set a colour, a height, a padding or a radius. Those four
are what the variant and size own, and a call site that sets them forks the
primitive in one file. If a call site needs a look the variants do not offer, the
variant changes, or a shared component wraps it.
`src/test/button-conventions.test.ts` scans for the four. Font weight is allowed: a
combobox trigger that displays a selected value carries `font-normal` so it reads
as an input.

Style a pressed toggle from `aria-pressed`, which the base class handles, not from
a conditional `bg-secondary` at the call site: the attribute is what a screen
reader reads, so styling from anything else lets the two disagree. `ViewToggle`
and the markdown Edit/Preview pair do this.

A segmented group (buttons that read as one control) gets its radius from the
wrapper, which carries `[&>*:not(:first-child)]:rounded-l-none`,
`[&>*:not(:last-child)]:rounded-r-none` and `[&>*+*]:-ml-px`, so no call site sets
a radius. The `:not()` form squares a middle button on both sides.

### Labels

Sentence case, always: "Propose project", not "Propose Project". A button that
creates a thing carries an icon rather than a literal plus sign, because the
icon is already the affordance and `+ New item` reads as two controls.

A busy label is the verb plus three ASCII dots, in the label's own place:
`{busy ? "Saving..." : "Save"}`. Not a real ellipsis (U+2026), which the scan
refuses, and not a spinner in place of the words: a control whose text vanishes
is a control a screen reader stops being able to name, and the accessible name
is what every role query in the test suite matches on.

### A link inside running text is underlined at rest

A link with words beside it on the line, in a paragraph, a list item, a callout or
a label-and-value row, carries `text-brand-dark underline`, not `hover:underline`.
WCAG 1.4.1 lets color alone mark a link only at 3:1 against the surrounding text,
and the brand color does not reach it: about 1.05:1 against muted text, and against
body text about 3.1:1 in light and 1.9:1 in dark. The global `a` rule in
`styles.css` already sets the underline's color, thickness and offset, so the class
only turns the line on, and `underline-offset-` at a call site restates it. These
links show no hover change, because `text-brand-dark` outranks the base `a:hover`
color; that is intended. A bare `underline` with no color class hovers to the vivid
orange this rule keeps off a link.

`hover:underline` stays for a link that is the whole content of its cell, title or
block: the title and action links in the tables, the card title, the "All
inventory" back link. A shared component that lands in running text anywhere
carries the underline everywhere, as `SupportEmailLink` does. `BreadcrumbLink`
underlines in no state and changes color on hover, because breadcrumbs are a
navigation landmark, not prose. Markdown body copy gets its underline from the
typography plugin. No regex can tell a `<td>` from a `<p>`, so where the rule
applies is not enforced; `src/test/brand-link-scan.test.ts` enforces the decidable
half, that a class string turning an underline on carries `text-brand-dark` and no
`underline-offset-`. Color against the background is the separate rule under
"Color tokens".

### Plain navigation links use `.nav-link`

Header nav items (Projects, My projects, Admin) use the `.nav-link` class from
`styles.css`, which supplies the brand-colored underline animation on hover and on
`.is-active`. It is styled for text links only; buttons keep their Button classes.

---

## Form inputs

Use `<Input>`, `<Textarea>`, and `<Label>` from `#/components/ui/`. They carry the
`h-9` sizing, the focus ring, and the `aria-invalid` styling that raw elements lack.

Wrap the label/input/error triple in a `space-y-1.5` div, written by hand. Give
every input an `id` that the `Label`'s `htmlFor` matches, and render errors with
`FieldError` from `#/components/ui/field`:

```tsx
<div className="space-y-1.5">
  <Label htmlFor="email">Email</Label>
  <Input id="email" name="email" type="email" required />
  <FieldError errors={field.state.meta.errors} />
</div>
```

`FieldError` takes `errors: readonly unknown[]` because a validation error can
arrive as either shape depending on which validator produced it: a Standard
Schema (what both forms in this app pass) produces `{ message }` issues, while a
hand-written validator or a server error can produce a bare string. `FieldError`
renders both so no call site has to know which it has.

### One-time codes

**A one-time code is `InputOTP`, not `Input`** (`#/components/ui/input-otp`). Put
the `id`, `name`, `autoComplete="one-time-code"` and `aria-*` on `InputOTP`, which
hands them to the one real input under the slots, and pass `aria-invalid` to each
`InputOTPSlot` as well, since the slots show the red border. Keep a submit button:
no `onComplete` auto-submit, which spends a guess on a typo nobody saw and changes
context on input (WCAG 3.2.2). Center it, with what the code was sent to above the
slots and the error under them.

### Title Case on the two long forms

**On the project and inventory forms, field labels are Title Case; nothing else
is.** "Problem Statement", "Contact Email", "Private Notes". A checkbox label is a
sentence and stays one. Headings, table headers, legends, badges, buttons and the
labels in dialogs, panels and the profile page stay sentence case, so a label reads
as the name of a box and a heading as a line of prose. Where a form label and a
page heading name the same field, the two are sibling constants pinned to the same
words by a unit test, since a case transform would lowercase "IP" and "NDA":
`FIELD_LABELS` and `FIELD_HEADINGS` in `src/lib/project-review-fields.ts`, and
`PRIVATE_NOTES_FIELD_LABEL` beside `PRIVATE_NOTES_LABEL` in
`src/lib/private-notes.ts`.

**The project and inventory forms set their labels at `text-base`** through their
local `Field` helpers and the raw `Label` uses beside them, and space their fields
at `space-y-6`, because a long form needs scanning. The shared `Label` stays at
`text-sm`. The project form is split into three groups by a hairline `hr` (the
project, how to reach the proposer, the terms), with no group headings.

`inventory-form.tsx` and `project-form.tsx` each have their own local `Field`, a
TanStack Form binding wrapper (it renders `<form.Field>` and wires
`handleChange`/`handleBlur`), not a layout primitive. They stay separate: every
consolidation considered either left the `aria-describedby` wiring duplicated or
put the AI review suggestion UI inside a component `inventory-form` also renders.
If you change the label, description or error handling in one, change it in the
other.

### Placeholders

**A placeholder is not a label.** Every `Input` and `Textarea` needs an `id`
matched by a `Label`'s `htmlFor`, or an `aria-label` when there is no visible
label. A placeholder disappears the moment the user types, and axe will not
report its absence, because `placeholder` is a fallback in the accessible-name
computation, so the name reads as non-empty. `src/test/field.test.tsx` enforces
it.

**A placeholder is not documentation either.** It has no tooltip, it clips without
saying so, and it is gone once the reader types. A listing search placeholder is a
name for the box, "Search projects" or "Search inventory", at most about 25
characters, which is what the `/projects` search row fits at 768 in table view.
What the box searches and the syntax it takes go on a `SearchHint` line
(`#/components/search-hint`) rendered right after the input in the same row, which
the input names through `aria-describedby`. The component carries the syntax
sentence, because every listing search runs through `websearch_to_tsquery`; the
caller passes the fields sentence, which must be true of that page's query. The
line is text only, so the tab order goes from the search to the Filters button.

### Error text goes through one component

A message about something that failed renders through `FieldError` from
`#/components/ui/field`, never as a hand-written
`<p className="text-destructive text-sm">`, so every error has one margin, one size
and one announcement. `src/test/error-text-scan.test.ts` refuses the paragraph.

`FieldError` takes either shape, and never both:

```tsx
<FieldError errors={field.state.meta.errors} />   {/* a TanStack Form field */}
<FieldError message={error} />                     {/* a string or null */}
```

It renders nothing when there is nothing to say, so a caller does not guard it
with `{error && ...}`, and it takes no `className`: one margin is the point.

It carries `role="alert"`, not `aria-live="polite"`. These messages answer
something the reader just did, and the assertive role interrupts to say so; a
polite region waits for a pause that a form with focus still in it may not reach.
`role="alert"` on an element already in the DOM announces on every content change,
which is why the component returns `null` rather than an empty paragraph.

An error about a whole form or panel rather than one field renders through
`ErrorBanner` from `#/components/error-banner`: the same message in a tinted box
with one opacity pair.

A status panel is not an error banner even when it is tinted with the destructive
color. The ban notice in `ban-form.tsx` describes a state the account is in, not an
action that failed, so it keeps its own markup.

### Why not shadcn `form`

The upstream `form` component declares `react-hook-form` and `@hookform/resolvers`
as dependencies. This project uses TanStack Form, so adopting `form` would put a
second form library in the tree. `field` is the form-library-agnostic half of that
family and declares no dependencies at all. Do not re-propose `form`.

---

## Color tokens

Semantic aliases adapt to dark mode; raw palette classes do not.

| Instead of | Use |
| --- | --- |
| `text-neutral-500` | `text-muted-foreground` |
| `border-neutral-200`, `border-neutral-300` | `border-border` |
| `bg-neutral-50`, `bg-neutral-100` | `bg-secondary` |
| `bg-white` | `bg-card` |
| `text-red-600`, `text-red-700` | `text-destructive` |
| `text-blue-700` on links | `text-brand-dark`; see the brand link rule below |
| `bg-blue-50` for highlights | `bg-[var(--brand-primary-tint)]` |
| `dark:bg-neutral-900` | `dark:bg-card` |
| `dark:border-neutral-800` | `dark:border-border` |

A brand-colored link uses `text-brand-dark`, not `text-brand`. Beaver Orange on
white is 4.56:1, a margin of 0.06 over AA, so a row hover, a selected state or a
status background under it fails, and on the page surface it is already 4.27:1;
`text-brand-dark` is 6.0:1 on white and about 5.6:1 on a hovered table row. Keep the
class rather than trusting the global `a` rule, whose hover state switches back to
`--brand-primary`. `text-brand` stays for icons and decoration, where no contrast
ratio applies; each such file is named in `src/test/brand-link-scan.test.ts`, which
fails on any other.

Status colors have no Tailwind alias, so reference the variable directly:

```tsx
<span style={{ color: "var(--status-success)" }}>Approved</span>
<span style={{ color: "var(--status-warning)" }}>Pending</span>
```

`--status-success-bg` and its siblings supply the matching tinted backgrounds. All of
them are redefined under the dark selector in `styles.css`.

What the five mean, so two badges for the same kind of news cannot pick two
colors: `success` is done or approved; `warning` is pending or missing, something
the reader may still act on (a review waiting, "Requested"); `error` is a hard
stop for the reader (deleted, "Team is full"); `info` is news with no
verdict in it; `neutral` is inactive (draft, archived).

---

## Border radius

Interactive elements are `rounded-md` (8px), which is already the default inside
`Button`, `Input`, and `SelectTrigger`. Cards and panels use `rounded-lg` or
`rounded-xl`, chips and badges use `rounded`, avatars use `rounded-full`.

---

## Mobile-first layout

Write the small-screen styles first, then add `md:` (768px and up) overrides. This is
a deliberate two-tier system, mobile and desktop, so `sm:`, `lg:`, and `xl:` overrides
are reserved for the rare case that genuinely needs a third tier. Two cases do, and
any other `xl:` needs a reason neither gives:

- A listing's filters. `ListingLayout` (see [Listing layout](#listing-layout)) puts
  them in a left aside from `xl` and in a `Sheet` below it. 288 (aside) + 32 (gap) +
  896 (card column) + 64 (padding) is 1280, so `lg` cannot hold it
  ([ADR-0020](./adr/0020-listing-filters-in-a-left-aside-from-xl.md)). The `xl:`
  layout classes live in that one component; a route passes at most its width pair
  through `className` (`mx-auto max-w-4xl xl:max-w-7xl`).
- The project page's similar-projects aside: 768 + 32 + 288 + 64 is 1152, so it
  takes `xl` rather than adding a tier
  ([ADR-0054](./adr/0054-similar-projects-float-below-xl-and-sit-beside-from-it.md)).
  Its `xl:` classes live in `SimilarProjectsLayout`; below `xl` it floats (see
  [Floating panel](#floating-panel)).

The listing cards (`project-card.tsx`, `inventory-card.tsx`) are one component at
both widths, in a single column bounded to `max-w-4xl`: image on top at 16:9 below
`md`, image on the left at 3:2 and `w-40` from `md` up. The image is letterboxed,
`object-contain` on `bg-muted`, so the whole picture shows at every width;
`object-cover` would crop anything not at the box's ratio. The detail page hero and
the table thumbnails still crop.

### Page wrapper padding

Every route page root other than the auth cards (see [Auth pages](#auth-pages))
carries this padding signature, with `max-w-*` chosen per page:

```tsx
<div className="mx-auto max-w-4xl px-4 py-6 md:p-8">
```

`px-4 py-6` gives comfortable touch margins; `md:p-8` expands to the desktop-standard
32px. A bare `p-8` wrapper wastes a third of the width on a phone.

Page width is chosen by content. Pick the narrowest that fits; a form at
`max-w-4xl` has an uncomfortably long measure.

| Width | For | Example |
| --- | --- | --- |
| `max-w-md` | one narrow form or card | `profile.tsx` |
| `max-w-2xl` | forms, dashboards, prose | `projects/new.tsx`, `privacy.tsx` |
| `max-w-3xl` | the long-form project page | `SimilarProjectsLayout`, widening to `xl:max-w-6xl` for its aside |
| `max-w-4xl` | lists, two-column detail, grids of figures | `my/projects.tsx`, `inventory/$itemId.tsx`, `admin/analytics.tsx` |
| none | admin tables that run full width | `/admin/projects`, `my/bookmarks.tsx` below its bounded title |

### Interactive element height

Inline form controls all share `h-9` (36px) so adjacent elements align without magic
numbers. `Input`, `SelectTrigger` (at `data-size=default`), `Button size="default"`,
and `ViewToggle` are already `h-9`. Set `h-9` explicitly on any new control that
sits inline beside them.

---

## Site header

The header carries site-wide chrome: navigation, the source link, notifications,
and the account menu. Anything scoped to one page's contents, such as a collection
count, lives on that page: the borrow list count on the `/inventory` title row
(`BorrowListButton`) and the bookmark count on the `/projects` title row
(`BookmarksButton`), opposite the `h1`. Site-wide versus page-scoped is the
distinction, not global state versus static: a static link to the source repository
belongs in the header, and a live count of a page's own collection does not.

---

## Mobile navigation

`SiteHeader` renders two sibling layouts and shows exactly one at a time:

```tsx
{/* Desktop */}
<div className="hidden h-14 md:flex ...">...</div>

{/* Mobile */}
<div className="flex h-14 md:hidden ...">...</div>
```

The mobile drawer is a shadcn `Sheet` with `side="left"`, opened by a hamburger
`<Button variant="ghost">`. It is a Radix Dialog underneath, so it is focus-trapped
and escape-dismissible. Four rules keep it correct:

- Call `setOpen(false)` in every `<Link>` click handler, so the drawer closes once
  navigation completes.
- Keep the `SheetHeader` title (`Navigation`) present for screen readers.
- Render the notification bell in the mobile header bar, outside the Sheet, so it
  stays reachable without opening the drawer.
- The source link is the last row of the Sheet's navigation block, not a third
  icon in the top bar, which is already logo, bell and hamburger at `h-14`. It
  sits outside the signed-in block because the Sheet renders regardless of
  session. On desktop it is a ghost icon button left of the bell, ahead of both
  session branches. Its accessible name is "Source code on GitHub", never
  "GitHub": `/sign-in` renders a "Continue with GitHub" button.

```tsx
<Sheet open={open} onOpenChange={setOpen}>
  <SheetTrigger asChild>
    <Button aria-label="Open navigation" size="icon-sm" variant="ghost">
      <Menu />
    </Button>
  </SheetTrigger>
  <SheetContent className="w-72 p-0" side="left">
    ...
  </SheetContent>
</Sheet>
```

---

## Admin tables

Render admin tables with `<AdminDataTable>` from `#/components/admin-data-table`,
and drive it with the `useAdminTable` hook from `#/lib/use-admin-table`. The component
handles sorting, column hiding, and the responsive card layout; the hook owns the
URL-backed sort and visibility state. A hand-rolled `<table>` in an admin route
collapses to an unreadable horizontal scroll on a phone.

The one exception is a short summary inside a `Sheet` (`/admin/placement`'s
analytics): a few fixed rows with nothing to sort, hide or restack use the plain
`Table` from `#/components/ui/table`. It is `table-fixed` with set count-column
widths, and its title cell is `truncate whitespace-nowrap` with the full text in a
`title` attribute, so the counts stay in the Sheet at any width.

Give the hook `columns`, `defaultSort` and `storageKey`, then spread `tableProps`
into the table, so the hook and the table cannot disagree about them. Row data
(`data`, `getRowId`) are props of the table, not the hook.

```tsx
const { orderRows, tableProps } = useAdminTable({
  columns: COLUMNS,
  defaultSort: DEFAULT_SORT,
  navigate,
  search,
  storageKey: "programs",
});

<AdminDataTable
  caption="Programs"
  data={rows}
  emptyMessage="No programs yet."
  getRowId={(row) => row.id}
  {...tableProps}
/>;
```

`navigate` is the route's own `useNavigate({ from })`, passed in so it typechecks
against the real route path. `resetPageOnSort` is for a paginated listing and is a
compile error on a route whose search type has no `page`; `serverSorted` is for a
listing the server ordered and turns off local reordering. They are separate because
server-ordered does not imply paginated. `orderRows(rows, getId)` puts exported rows
in the order the table renders, so a CSV matches the screen. The hook's docblocks
say why each is typed the way it is.

`headerHint` is one sentence about what a column means, for a column whose name
alone would mislead (`/admin/projects`' "Updated" moves only for a change a visitor
can see). It renders as an info button with a `Tooltip` beside the header, so it is
desktop only: below `md` the header row is hidden. Anything a staff member must know to act correctly belongs on the page, not
in a hint.

### Where Export CSV and the Columns menu go

A listing whose Export CSV and Columns menu sit in the search row passes
`controls="listing"` to the table, which then draws no row above itself, and renders
`<AdminTableControls actions={<ExportCsvButton />} filtered={filtered} rowCount={rows.length} {...controlsProps} />`
where the controls go, from the hook's second bag, `controlsProps`. It hides itself
under the same rule as the table. Every other table keeps the default and gets the
table's own row: its `toolbar` on the left, its `actions` and the Columns menu on
the right.

### More than one table on a page

`useAdminTableState` in `#/lib/table-state` is the router-agnostic core underneath,
directly unit-testable; reach past `useAdminTable` to it only from somewhere with no
`navigate`. A page with more than one table cannot keep them all in the URL, because
they would share `sort` and `cols`: pass each one `useLocalTableSearch()` from
`#/lib/use-local-table-search` as its `search` and `navigate`, which holds the state
in the component with the same localStorage column seed. `/admin/placement` does this.

### The mobile card layout

Responsive behavior is automatic: the component applies `className="admin-table"`
and derives each body cell's `data-label` from its column header. Below 768px the
`.admin-table` rules in `styles.css` hide the `<thead>`, turn each `<tr>` into a
card, and inject the label via `content: attr(data-label)`. The `table` keeps
`display: table`, so assistive tech still gets a table with a caption, and carries
`table-layout: fixed` in that media query, without which it sizes to its content and
the cards run past a 375px viewport. Keep both; the signed-in scans in
`user.a11y.test.ts` measure the overflow.

`cardHeader` marks the one column that titles the record. On mobile its cell becomes
the card's header strip: full width, with no field name in front of it. Use it for a
column whose content already says what it is, usually a name or title beside a
thumbnail. At most one column per table sets it; a second is logged and renders as
an ordinary labelled field. A row action inside the header strip is icon-only below
`md`, with the label as its `aria-label` and `title` and the text `hidden md:inline`,
so the title keeps the row (`AddToCartButton`'s `compact` prop). It keeps its text
size rather than an `icon-*` size, and a pending or error label stays visible at
every width, because an icon alone says too little about a failure.

### A free-text column is bounded and clamped

From `md` up every `TableCell` is `md:whitespace-nowrap`, so one 200-character title
sets the width of the whole column. A column whose value is free text therefore
bounds itself and clamps, and every class it uses for that carries the `md:`
prefix, because below `md` the cell is the card header strip, which wraps in full.

The title or name cell puts `md:min-w-xs md:max-w-md` on its outer flex
container and `min-w-0 md:line-clamp-2 md:whitespace-normal` on the link, with
the full text in a native `title` attribute so a mouse user can hover for it.
Two of those classes are easy to drop. `md:whitespace-normal`: `line-clamp` does
not reset the inherited `nowrap`, and a clamp on one unbreakable line clips it with
no ellipsis. `md:min-w-xs`: an auto-layout table wider than its container shrinks
the column with the most slack, and a clamped cell with no minimum is that column,
so the title collapses to its longest word. Two lines because titles here often
differ only in their tail, and two lines match the 3:2 thumbnail at `w-16`. The
clamp is CSS, so the full value stays in the DOM for screen readers, Find-in-page
and the CSV export.

A description cell is `line-clamp-3 max-w-xs md:whitespace-normal`: narrower and
three lines, because it is hidden by default and read on purpose, and no minimum,
because it competes with nothing when shown. Apply the classes per cell rather than
through an `AdminColumn` option or a shared cell component.

### Grouping rows that arrived together

`group` renders one `tbody` per group with a `th scope="rowgroup"` header across
every visible column, so a screen reader announces the group before its rows.
Absent means the flat table every other admin route renders.

```tsx
<AdminDataTable
  group={{
    key: (row) => row.requestId,
    header: (rows) => <RequestHeader row={rows[0]} count={rows.length} />,
    actions: (rows) => <ApproveAll rows={rows} />,
  }}
  {...tableProps}
/>
```

Grouped-ness is derived from the sort, never stored: rows are grouped while the
table's sort equals its `defaultSort` and flat the moment the reader sorts by
anything else, because a group stops being contiguous once rows are ordered by
another column. A page that needs a fixed group order returns its rows in that
order and declares every column `enableSorting: false`; its `defaultSort` is inert.

`header(rows)` receives the group's rows and nothing else, so whatever identifies
the group is denormalized onto every row in it. `getRowId` and `highlightedRowId`
keep addressing data rows, so a deep link still lands inside a group. On mobile the
header renders as a strip above its cards. One level only: no nesting or sorting
within a group.

`collapse` folds a group to its header, from a chevron that carries
`aria-expanded`, and `aria-controls` naming the group's `tbody` while it is open.
The page holds which groups are open in component state: `isOpen(key)` reads it,
`onToggle(key)` changes it, and `label(rows)` names the chevron. `isOpen` gets the
key alone, so a rule over a group's rows reads the page's own rows, not the ones a
filter left the table. When a control inside a group closes it, focus moves to that
group's chevron. A closed group renders no rows and no detail. `collapse` is part
of `group` and does nothing without it.

### A row's detail under it

`detail(row)` renders a full-width row under a data row, or nothing when it
returns null. The page keeps which rows are open, in component state rather
than the URL, and puts the control that opens them in a cell: a `Button` with
`aria-expanded`, and `aria-controls` naming the detail while it is open. On
mobile the detail joins the card above it rather than drawing a card of its
own.

It is for detail read against the row and its neighbours, where a Sheet would
cover what the reader is comparing: the placement board's bids under a student,
read beside the team they are on. A record read or acted on alone still opens a
Sheet, as the next section says. `detail` is the table's second extension after
`group`; add a third only for a need neither covers.

### The line sheet

Reading or acting on one request line opens a `Sheet` beside the table, not a
row's `detail` under it: a line is read and acted on alone, not against its
neighbours. `LineSheet` in `#/components/line-sheet` is the shell: a title, a
description, a definition list of fields, the timeline, and an actions slot in the
footer. `LineTimeline` draws the `TimelineEvent[]` that `lineTimeline` in
`#/lib/inventory-timeline` builds from the line's own columns, so the staff queue
and `/my/items` cannot disagree about what happened to a line. A row opens it
through a `Details` button in its Actions cell; the sheet closes without
navigating. The sheet is where a fulfill flow's actions fit, rather than a seventh
column.

```tsx
<LineSheet
  actions={<AdminRequestActions lineId={row.line.id} onDone={onDone} status={row.line.status} />}
  description={`Requested by ${requester}`}
  events={lineTimeline({ ... })}
  fields={[{ label: "Item", value: row.item.name }]}
  onOpenChange={(open) => !open && setOpenLineId(null)}
  open={row !== null}
  title={row.item.name}
/>
```

### Two empty states

A table with no rows is one of two things, and the route says which with `filtered`.

Unfiltered and empty is a listing with nothing in it. The component renders
`emptyMessage` and nothing else: no headers, no Columns menu, and nothing from the
`actions` slot, because a column picker over absent headers and an Export CSV of no
rows are controls that exist to be ignored.

Filtered and empty is a search or filter that matched nothing. The headers, the
Columns menu and `actions` stay, because the reader is mid-search, and one row
across every visible column says `noMatchMessage` ("Nothing matches these filters."
unless the route has better words).

Derive `filtered` from the search params that narrow the result, and leave out a
switch that widens it (`includeSoftDeleted` on projects, `includeBanned` on users).
A default that narrows counts: the request queue opens on `pending`, and a staff
member with no pending requests still wants the status select and the headers. The
one exception is `/admin/projects`, which opens on every status but archived and
reports itself unfiltered, because that set is what the listing is, not a search
over it. A route with no filters never sets it.

```tsx
const filtered = q !== "" || status !== null || categories.length > 0;

<AdminDataTable
  emptyMessage="No items yet."
  filtered={filtered}
  noMatchMessage="No items in this view."
  {...rest}
/>;
```

### An admin route's column list goes through `defineAdminColumns<Row>()`

```tsx
const COLUMNS = defineAdminColumns<Row>()([
  { accessorFn: (row) => row.name, header: "Name", id: "name" },
  {
    accessorFn: (row) => row.createdAt,
    cell: ({ row }) => <LocalTime dateOnly value={row.original.createdAt} />,
    header: "Created",
    id: "createdAt",
    sortFn: "datetime",
  },
]);
```

The builder turns two rules about what an `accessorFn` returns into compile errors.
Both fail quietly otherwise: the table renders and sorts, in the wrong order.

**A column that is not text sets its own `sortFn`.** `AdminDataTable` defaults
every column without one to a locale-aware **string** comparator, so whatever the
accessor returns is sorted through `String(value)`:

| Column value | `sortFn` | What the default does instead |
| --- | --- | --- |
| `Date` | `"datetime"` | `String(date)` starts with the weekday name, so ascending reads Fri, Fri, Mon, Wed. |
| number | `"basic"` | `"10"` sorts before `"2"`. |
| boolean | `"basic"` | `"false" < "true"` happens to read right, until a nullable flag puts `"null"` between them. |

**An accessor returns `undefined` for a missing value, never `null`.**
`sortUndefined: "last"` is the only knob TanStack offers for grouping empties and
it does not special-case `null`, so a `null` sorts as the string "null" among the
real values. Map it at the accessor: `(row) => row.label ?? undefined`.

The error names the column: `COLUMN_NEEDS_ITS_OWN_SORT_FN: "createdAt"` or
`ACCESSOR_RETURNS_NULL_USE_UNDEFINED: "note"`. `npm run typecheck`, not
`npm test`, enforces it, and `src/test/admin-columns.test.ts` holds a
`@ts-expect-error` per rejection case so the check cannot degrade to a no-op
unnoticed.

`accessorKey` and grouped (`columns`) definitions are banned outright: the first
carries a value type the check cannot read, the second hides its real columns a
level down where nothing inspects them.

The component's own fixtures in `src/test/admin-data-table.test.tsx` stay plain
`AdminColumn<Row>[]` literals, because they exercise the table, not a route.

### A shared column const uses `satisfies`, not an annotation

A column const declared outside the array uses `satisfies AdminColumn<Row>` with
`id: "..." as const`, never an `AdminColumn<Row>` annotation. The annotation erases the accessor's return type to `unknown`, and
`[null] extends [unknown]` is true, so every annotated column reports
`ACCESSOR_RETURNS_NULL_USE_UNDEFINED`, which reads as a bug in the check. Without
`as const` the `id` widens to `string` and the error stops naming the column.
Annotating the array the builder returns is redundant but harmless. A factory that
builds columns for several row types (`projectSummaryColumns<Row>()`) follows the
same rule. The `defineAdminColumns` docblock in `admin-data-table.tsx` carries the
type-level detail.

```tsx
const NAME_COLUMN = {
  accessorFn: (row) => row.name,
  header: "Name",
  id: "name" as const,
} satisfies AdminColumn<Row>;
```

---

## Component patterns

### The email skip

Every staff action that emails someone names the recipient before the click and can
be told not to send ([ADR-0019](./adr/0019-every-email-is-mandatory-and-staff-share-one-inbox.md)). Render `SendEmailCheckbox` from
`#/components/send-email-checkbox` inside the dialog or popover the action already
has: "Email <address>", checked by default, over a line saying what unchecking
leaves in place. Pick the line from `EMAIL_SKIP_HINT`: `withBell` when the action
also writes an in-app notification, `emailOnly` when email is the only channel (a
mentor named, a hard delete, a role change, a ban), and `holder` for a hold, where
an account holder gets the row and a walk-in does not. With `address={null}` the box
is disabled and reads "No address on file, no email will be sent"; keep sending
`true` in that state and let the server decide who is reachable.

A Save that had no dialog opens `SendEmailDialog` from
`#/components/send-email-dialog`, and only when the pending change would actually
send mail; a save that mails nobody goes straight through. The one inline exception
is the comment form: a plain "Email the proposer" box beside "Internal (staff
only)", unchecked and disabled while Internal is on, since an internal comment mails
nobody; unchecking Internal checks it again.

The box is checked again every time its dialog opens: the skip is a decision about
one action, and a Cancel must not carry an unchecked box into the next.
`SendEmailDialog` gets this by holding the state inside the content Radix unmounts.
A `ConfirmDialog` body or a popover holds the state in the caller, so the caller
resets it where the dialog opens or closes: the trigger's `onClick`, the function
that opens it, or the `onOpenChange` that handles the close.

```tsx
<SendEmailDialog
  address={trimmed}
  busy={busy}
  confirmLabel="Save mentor"
  description={`This names ${trimmed} as the mentor.`}
  error={error}
  hint={EMAIL_SKIP_HINT.emailOnly}
  onConfirm={(sendEmail) => void save(sendEmail)}
  onOpenChange={setConfirmOpen}
  open={confirmOpen}
  title="Save the mentor?"
/>
```

### Detail page header

A detail page (`/projects/$projectId`; the inventory item page is meant to follow)
opens with one header block, top to bottom:

1. The title row, `flex items-start justify-between gap-3`, title left, actions
   right.
2. One `flex flex-wrap` badge row: status, program, team-full, then the public
   marks, which `ProjectBadges` renders. The program badge sits with the status
   because both name a value, and is absent rather than empty for a project filed
   under none.
3. The category chips, then the owner actions, then the image.

The actions are Bookmark and, for a viewer who can edit, Edit. Bookmark keeps its
icon at every width and hides its text below `md`, with `aria-label` and `title` as
the accessible name. Edit sits right of Bookmark from `md`; below `md` it renders
full width directly above the image. Render it twice, `hidden md:inline-flex` in the
row and `md:hidden w-full` above the image: a display-none link is out of the
accessibility tree, so a role query still finds exactly one.

### Status tabs

Use `Tabs`, `TabsList`, `TabsTrigger`, and `TabsContent` from
`#/components/ui/tabs`, not a row of `<button>` elements. Radix gives the tablist
`role="tablist"`, `aria-selected`, one tab stop for the strip, and arrow-key
movement; a hand-rolled button row has none of that.

The tab state usually lives in a URL search param, so `Tabs` is controlled. Pass
`activationMode="manual"` whenever activating a tab has a side effect beyond showing
its panel, such as a navigation. Under the default `automatic` mode, arrowing across
the strip fires that side effect on every keypress; under `manual`, arrows only move
focus, and Enter or Space activates.

```tsx
<Tabs
  activationMode="manual"
  className="mt-4"
  onValueChange={(next) => navigate({ search: { tab: next as MyTabUnion } })}
  value={tab}
>
  <TabsList>
    <TabsTrigger value="active">Active</TabsTrigger>
    <TabsTrigger value="history">History</TabsTrigger>
  </TabsList>
  <TabsContent value="active">{/* active panel */}</TabsContent>
  <TabsContent value="history">{/* history panel */}</TabsContent>
</Tabs>
```

`onValueChange` hands back a plain `string`; cast it at the `navigate` boundary
when the search schema wants a narrower union. `TabsList` carries no margin, so give
`Tabs` a `className="mt-4"`; `TabsContent` already ships `mt-4`, so do not add
another to the panel body. The active trigger's styling lives in `tabs.tsx`, keyed
off `data-[state=active]`, not at the call site.

A strip with more tabs than a 375px screen fits scrolls sideways inside itself,
with `className="overflow-x-auto [&>*]:shrink-0 [&>*]:whitespace-nowrap
[&>*]:focus-visible:ring-inset"` on `TabsList`, rather than wrapping labels or
widening the page. The inset ring is not optional: a scroll box clips on both axes,
so an outset focus ring would be cut off. The placement page's tabs do this.

### Pagination

Use `<Pagination>` from `#/components/ui/pagination`, with `PaginationLink` for
route links and `PaginationButton` for in-place navigation.

Never disable a pagination control with `pointer-events-none` alone. That
suppresses mouse events and nothing else: the anchor stays in the tab order, is
still announced as a link, and Enter still activates it, and no axe rule reports
it. `PaginationLink` drops `href` and sets `aria-disabled` and `tabIndex={-1}`
when disabled, which is what actually removes it from the tab order.

```tsx
<Pagination>
  {page <= 1 ? (
    <PaginationLink disabled>Previous</PaginationLink>
  ) : (
    <PaginationLink asChild>
      <Link search={(prev) => ({ ...prev, page: page - 1 })} to="/projects">
        Previous
      </Link>
    </PaginationLink>
  )}
  <PaginationStatus
    page={page}
    shown={rows.length}
    total={total}
    totalPages={totalPages}
  />
  ...
</Pagination>
```

`PaginationStatus` is the one live region that counts rows, on every list:
`47 results` when everything fits on one page, `Page 2 of 3 · 20 of 47
results` otherwise, nothing when the total is zero. The route renders it, never
the table, because on `/projects` the same footer serves the card view. A list
the server does not page renders `ListCount` under its table, the same component
with everything on one page. `AdminDataTable` announces only the sort order, so a
screen reader hears one number.

### Badges

Every badge renders through `<Badge>` from `#/components/ui/badge`. A badge that
carries a domain status uses `variant="status"` and supplies its own `--status-*`
foreground and background through `style`, because the upstream variants paint a
fixed color and cannot express a status mapping. `CountBadge` is the one non-status
use of `variant="status"`: it wants the blank canvas, and paints it with
`bg-primary text-primary-foreground`.

A badge that reports a number is silent at the value nearly every row holds.
`TeamFullBadge` renders nothing for a team with room, and the teams badge in
`ProjectBadges` renders nothing at one team; a badge that is always there is
filler. So a row of badges can be empty: the component returns null rather than an
empty flex row, and a caller passing `children` handles that case itself, because
an element is truthy even when it renders nothing.

A badge does not repeat a value the same surface already prints. Both project
tables carry a Teams supported column, so their Badges cell passes `ProjectBadges`
no count; the card and the detail page have no such column.
`src/test/project-table-columns.test.tsx` pins that.

### Listing layout

A page that lists and filters renders through `ListingLayout` from
`#/components/listing-layout` ([ADR-0020](./adr/0020-listing-filters-in-a-left-aside-from-xl.md)):
`/projects`, `/admin/projects`, `/inventory` and `/admin/inventory`. The filters
components are `projects-filters.tsx` and `inventory-filters.tsx`, with the admin
forms inline in their routes.

```tsx
<ListingLayout
  activeFilterCount={countActiveFilters(state)}
  className="mx-auto max-w-4xl xl:max-w-7xl"
  filters={<ProjectsFilters {...state} />}
  search={<ProjectsSearchBar {...top} />}
  tableControls={
    view === "table" ? (
      <AdminTableControls filtered={filtered} rowCount={rows.length} {...controlsProps} />
    ) : undefined
  }
  title={<h1 className="font-semibold text-2xl">Projects</h1>}
>
  {rows}
  <Pagination>...</Pagination>
</ListingLayout>
```

`search` holds what does not narrow the list: the search input, its `SearchHint`
right after it, the sort, the card/table `ViewToggle`. The row renders on top at
every width, beside a "Filters" button that is gone from `xl`. `tableControls` is
the table's `AdminTableControls` when a table is showing and nothing in card view;
it renders at the end of the same row. The row wraps and the hint is a `basis-full`
item, so below `md` the input, the hint and the buttons each take a line in DOM
order, which is also the tab order; from `md` the hint takes `order-last` and the
input and buttons share one line, which each input's `basis` is sized to allow at
768. On `/projects` the recommendation prompt renders under the row, outside it, so
its link does not land between the toggle and the Filters button in the tab order.

The public listings render the table controls only in table view, from a
`useAdminTable` call that lives in the route at every view with
`seedColumns: view === "table"`, so card view's URL never picks up a stored column
layout. Do not give `AdminDataTable` a filters slot: its extensions stay few
(grouping and a row's detail).

### A listing's filters

`filters` holds what narrows: program, the switches, the category or status lists,
Clear all. It renders in a sticky `aside` from `xl` and inside a left `Sheet` below
it; pass one element and the layout renders it in both places, only one ever
displayed. Because it can be mounted twice, every `id` inside it comes from
`useId`, never a literal, or the sheet copy's labels point at the hidden aside.
Stack the controls (`space-y-4`) and give each `w-full`; a fixed `w-56` overflows
an 18rem column.

A `FilterSwitch` label is one line under a `fieldset` legend carrying "Only show
projects that", and each label completes the legend as a lowercase predicate ("are
looking for team members"). Both project listings read legend and labels from
`PROJECT_SWITCH_LEGEND` and `PROJECT_SWITCH_LABEL` in `projects-filters.tsx`, so
they cannot drift. A switch whose label does not say what it hides takes a `hint`,
one muted line the switch names through `aria-describedby` (`PROJECT_SWITCH_HINT`).
A control that swaps the set rather than narrowing it is not a switch under that
legend: the public listing's archive is a two-option `RadioGroup` ("Show: Current
projects / Archived projects") above the switches, over the `archivedOnly` param.

`activeFilterCount` is what the button shows below `xl`. Count decisions, not
values: a category set counts once however many it holds. The public route derives
it from the same booleans as `filtered`; the admin route also counts the
soft-deleted switch, which widens and so stays out of `filtered`.

### Floating panel

One panel floats, the project page's similar projects (`SimilarProjectsLayout`,
[ADR-0054](./adr/0054-similar-projects-float-below-xl-and-sit-beside-from-it.md)),
and it has one form per tier:

| Width | Form | Starts |
| --- | --- | --- |
| below `md` | `icon-lg` outline Button, fixed bottom right, opening a bottom `Sheet` | collapsed |
| `md` to `xl` | `Card` fixed bottom right, collapsing to an outline Button with the heading as its label | open, or collapsed if the viewer collapsed it before |
| `xl` and up | sticky aside in a second grid column, no collapse | open |

The collapse is remembered in `localStorage` under
`cs-capstone:similar-projects-collapsed`, read and written in try/catch, and
read only after the list has arrived on the client, so it cannot disagree with
the server render. A link in the sheet closes it, because the route component
is reused across project ids. The page's main column takes `pb-16` below `xl`
while the panel is showing, so the fixed control never sits over the last line.
The floating controls position themselves and carry `shadow-md` for elevation;
their radius and size are the Button's own (see
[`className` on a Button never restyles it](#classname-on-a-button-never-restyles-it)).
The floating card and the `xl` aside are both labelled `aside` landmarks named
"Similar projects"; CSS shows one at a time, which is what keeps the name
unique for a screen reader.

### Charts

There is one chart in the app, on `/admin/traffic`, and
[ADR-0049](./adr/0049-one-chart-on-admin-traffic.md) says why the rest of the admin
pages use numbers and tables instead. A new chart needs the same argument: a shape
over time that a column of numbers cannot show at a glance.

Draw it with `ChartContainer` from `#/components/ui/chart`, the trimmed
shadcn component. Give each series a token in its `ChartConfig`, such as
`var(--chart-1)`, never a hex code; the container sets it as
`--color-<key>` and the marks read `var(--color-<key>)`. Hide the SVG with
`aria-hidden` and render the same numbers as a `sr-only` table with a
caption beside it, as `TrafficChart` does, so nothing the chart says is
visual only and axe scans the table rather than the SVG.

### Surfaces are not all cards

`<Card>` is the repeated `rounded-lg border border-border bg-card` surface used
by list items, the filters aside, and admin tiles. Three other surfaces are
deliberately separate and must not be folded into it:

- `panel.tsx` for the audience-gated panels, which carry their own tone variants
- `.island-shell` for the auth cards
- `.feature-card` for the landing page panels, with no hover state, because the
  panel is not a link and a lift on hover makes it look like one.

`Card` takes `asChild` for a card whose root is the navigable element and nothing
else, such as Admin's `NavCard`; a plain `<Card>` would nest a `<div>` around the
`<a>` instead of merging onto it:

```tsx
<Card asChild className="flex flex-col overflow-hidden" interactive>
  <Link to="/admin/projects">...</Link>
</Card>
```

A card that carries a control beside its link (`project-card.tsx` with its bookmark
toggle, `inventory-card.tsx` with its add-to-cart button) is not `asChild`: a button
inside an anchor is invalid HTML that axe reports as a nested interactive. There the
`Card` is a `div`, the `Link` is its first child and takes the whole image-and-text
area, and the control is a sibling.

### Select with an "All" option

Radix `SelectItem` rejects `value=""`, so an unset option needs a sentinel. Use
`"_all_"` and convert at the call site:

```tsx
<Select
  onValueChange={(v) => setFilter(v === "_all_" ? null : v)}
  value={filter ?? "_all_"}
>
  <SelectTrigger className="h-9 w-full">
    <SelectValue placeholder="All" />
  </SelectTrigger>
  <SelectContent>
    <SelectItem value="_all_">All</SelectItem>
    {items.map((item) => (
      <SelectItem key={item.id} value={item.id}>
        {item.name}
      </SelectItem>
    ))}
  </SelectContent>
</Select>
```

### Auth pages

`/sign-in`, the one auth page, uses an `island-shell` card:

```tsx
<div className="flex min-h-[calc(100vh-3.5rem)] items-start justify-center px-4 pt-12 pb-20">
  <div className="island-shell w-full max-w-sm rounded-xl p-8">...</div>
</div>
```

`3.5rem` is the `h-14` header, so the card centers in the space below it.

---

## Destructive actions

Most destructive actions confirm through `<ConfirmDialog>` from
`#/components/confirm-dialog`. Pass the question as `title` and the consequence
as `description`; the title is what gives the dialog its accessible name. An
optional `body` renders between the description and the buttons: the project
hard delete puts the email skip there, since that delete emails the proposer
(see "The email skip" above).

```tsx
<ConfirmDialog
  description="This cannot be undone."
  onConfirm={runDelete}
  title="Permanently delete this draft?"
>
  <Button variant="destructive">Delete draft</Button>
</ConfirmDialog>
```

`ConfirmDialog` and both dialogs under "Typing the value to confirm" are built on
`AlertDialog` from `#/components/ui/alert-dialog`, never `Dialog`. An irreversible
action wants `role="alertdialog"`, which screen readers announce more assertively
and which does not dismiss on an outside click; Escape still closes it. axe does not
report a plain `dialog` on a destructive prompt, so the role is asserted by the
component tests and the accessibility suite rather than a scan. The destructive
button is a plain `Button`, not `AlertDialogAction`: the action closes the dialog on
click unless the handler calls `preventDefault`, and these dialogs stay open to show
a failure, so an explicit `open` state is clearer than an opt-out.

What a confirmed action reports when it succeeds, fails or is still running is
"Mutations and feedback" below; `ConfirmDialog` implements that part, so a caller
passes a handler and nothing else.

**Native `confirm()` and `alert()` are banned.** They are unstyled, ignore the
brand and the dark palette, block the main thread, and cannot be scanned by the
accessibility suite, because axe cannot reach a page whose script is parked on a
modal browser prompt. `src/test/no-native-modals.test.ts` enforces this.

### Typing the value to confirm

Two dialogs make the user type something exact into an `Input` before the
destructive `Button` un-disables: the inventory hard delete in
`inventory-lifecycle-panel.tsx` asks for the item's name
(`disabled={busy || delConfirm !== item.name}`), and the account deletion in
`delete-account-dialog.tsx` asks for the person's own email, compared
case-insensitively. A confirm click is an easy reflex; typing the exact value is a
deliberate brake. Both reset the typed value before the dialog shows again, so a
Cancel never leaves the next opening pre-armed. Reach for this shape only when one
confirmation is not enough friction, not as the default: the project hard delete in
`staff-project-panel.tsx` is equally permanent and confirms through plain
`ConfirmDialog`.

Radix moves initial focus to the cancel action. That is right for a one-click
prompt and for the account dialog, whose input sits under a list of consequences
the reader should get through first. The inventory panel has only a one-line
reminder above its input, so it points `AlertDialogContent`'s `onOpenAutoFocus` at
the input. Decide per dialog by what stands between the top of the body and the
input.

---

## Mutations and feedback

Everything a trigger does between the click and the result. The rules below are the
contract, and `src/lib/use-action.ts` is the shared piece that keeps a handler to
them.

**New code uses the hook.** A handler that writes the same shape by hand
(`setBusy(true)`, `try` / `catch` / `finally`, an inline error) is not wrong, and
some older ones do; what is wrong is any rule below going unmet. The hook makes
meeting them the short path, and makes the guard below a ref.

### The flight

**A trigger is disabled from the click until the promise settles, and the
handler returns early if one is already in flight.** Both, not either. The
`disabled` prop is what the reader sees; it is not a guard, because a keyboard
activation or a dropdown item can arrive before React has re-rendered, and a
`disabled` button that was enabled when the key went down still fires. The
guard has to be read and written synchronously, which is why `useAction` holds
a ref beside the state.

```tsx
const { busy, error, run } = useAction();

<Button disabled={busy} onClick={() => void run(() => save(values))}>
  {busy ? "Saving..." : "Save"}
</Button>
<FieldError message={error} />
```

The label swaps to the verb in progress while busy: "Saving...", "Deleting...",
"Banning...". Three ASCII dots, never the ellipsis character (see "Labels"
above).

`run` answers whether the action succeeded, so a caller can navigate or close a
dialog on the true branch without a second `try` of its own:

```tsx
if (await run(() => createProgram(name))) {
  setOpen(false);
}
```

### Where the failure goes

**Every failure reaches the reader.** Never `console.error` alone, never an
unhandled rejection from a bare `void handler()`.

Which shape it takes follows where the control sits, not what the mutation
does:

- **Inside a form, a panel or a dialog**: inline, through `<FieldError>` for one
  message or `<ErrorBanner>` for a whole form's failure. That is the default,
  and it is what `useAction` gives you in `error` when you pass no `onError`.
- **On a table row, in a header, or anywhere with no panel to write into**:
  `toast.error`, passed as `onError`. A row has nowhere to put a paragraph that
  would not shift every row below it.

```tsx
const { busy, run } = useAction({ onError: toast.error });
```

**Error text always comes through `errorMessage`** from
`src/lib/error-message.ts`. A `catch` binding is `unknown`, so
`(err as Error).message` is a lie the compiler cannot check, and an `Error`
whose message is empty renders an empty paragraph. `useAction` and
`ConfirmDialog` both call the helper for you; a hand-written `catch` calls it
itself. `src/test/error-extraction-scan.test.ts` refuses the cast.

### Where the success goes

- **A form that navigates away on success confirms with `toast.success`**,
  because the page that would have carried an inline confirmation is gone by
  the time it renders.
- **A save that stays on the page confirms inline**, next to what it saved,
  through `<SavedNote>` from `#/components/ui/field`. It is an `output`, not
  the `role="alert"` paragraph `FieldError` is: a result the reader asked for
  is announced politely, an error interrupts.

Neither is optional, unless the result is itself visible where the reader is
already looking: a row that leaves the table, a status badge that changes, a
field that now holds what was typed. A cancelled request does not need a toast
saying it was cancelled when the row it was on has gone. Everything else
confirms, because a mutation that reports nothing is indistinguishable from
one that silently failed.

### Dialogs

**A dialog that runs a mutation stays open on failure and shows the error
inside itself. It closes only on success.** A dialog that closes on click puts
the refusal on the page behind it, where the reader is not looking and often
cannot see it at all.

`ConfirmDialog` owns this: pass it an `onConfirm` that does the work and lets a
rejection propagate, and it disables both buttons, swaps the label to
`busyLabel`, keeps itself open, and renders the message in a `FieldError`
inside. Callers do not pass `busy` or `error` and do not catch.

A dialog built on `AlertDialog` or `Dialog` directly holds the same three
things itself, through `useAction`: `delete-account-dialog.tsx`,
`inventory-lifecycle-panel.tsx` and `submit-borrow-list-dialog.tsx` do. The
one exception is `send-email-dialog.tsx`, which takes `busy` and `error` as
props because the save it confirms runs in the section behind it, and that
section shows the same failure in its own panel. Owning the flight is the
default; taking it as props is for a dialog that is one step of an action
belonging to something else.

### Cache

**Query invalidation names its keys.** A bare `queryClient.invalidateQueries()`
refetches every query on the page, including the ones the mutation cannot have
touched, which is slow and hides which key actually mattered.

**`router.invalidate()` is awaited inside the busy window**, not fired and
forgotten. Loader data is what the control is about to be re-enabled over; a
fire-and-forget invalidate re-enables it over the stale copy, and the reader
sees the old value with a live button beside it.

**A refresh a component takes as a prop returns a promise, and the child awaits
it.** `onChanged`, `onDone` and their kin are typed `() => Promise<void>`, never
`() => void`: a `void` return type discards the parent's `router.invalidate()` at
the prop boundary, the same stale-data bug one hop further out. The parent returns
the promise (`onChanged={() => router.invalidate()}`) rather than voiding it.

**A handler that closes a surface awaits the refresh first, then closes**, where
the control behind that surface is not itself disabled while the handler runs.
`close(); await onDone();` hands the reader back a live popover trigger, status
pill or row action over a row the refetch has not reached yet. Where the trigger
does carry `disabled={busy}` (`role-select.tsx`, `staff-mentorship-section.tsx`)
the order does not matter and closing first is kinder, because a modal whose
buttons are all disabled has no visible way out. `router.invalidate()` does not
reject (a loader that throws renders through `errorComponent`), so the ordering
buys a correct busy window, not a place for a refusal to land.

Go through the hook that owns a key rather than calling the server function
underneath it: `useWriteBookmark` exists so that a bookmark write invalidates
`["bookmarks"]` wherever it happens.
