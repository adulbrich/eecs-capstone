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
and the dark-mode variants that `Button` carries.

| Variant | Use when |
| --- | --- |
| `default` | Primary CTA (Submit, Save, Create, Sign in, Sign up) |
| `outline` | Secondary actions (Cancel, Edit, Sign out, Withdraw) |
| `ghost` | Tertiary / low-emphasis (Reply, Remove in lists) |
| `destructive` | Irreversible danger (Delete, Ban) |
| `secondary` | Muted fill, when `outline` reads too light against the surface |
| `link` | Inline text that behaves as a button |

Sizes are `xs` (h-6, inline micro-actions like Post reply), `sm` (h-8, most
contextual buttons), `default` (h-9, standalone form submits), and `lg` (h-10,
hero / landing CTAs). Icon-only buttons use `icon-xs`, `icon-sm`, `icon`, or
`icon-lg` to stay square.

The size variant also sets the icon size, so pass no size class on an icon
inside a `Button`. The base class carries
`[&_svg:not([class*='size-'])]:size-4`, which `xs` and `icon-xs` override to
`size-3`. That selector stands down only for a class containing `size-`:
`h-5 w-5` does not match it and loses to it on specificity, so it renders 16px
while reading as 20. If a call site genuinely needs a different size, write
`size-5`, which the rule is built to yield to.

### A link styled as a button uses `asChild`

`asChild` merges the Button styles onto the `<Link>` so one element renders. Without
it you nest an `<a>` inside a `<button>`, which is invalid HTML and breaks keyboard
activation.

```tsx
<Button asChild size="sm">
  <Link to="/projects/new">New project</Link>
</Button>
```

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

`inventory-form.tsx` and `project-form.tsx` each have their own local `Field`, a
TanStack Form binding wrapper (it renders `<form.Field>` and wires
`handleChange`/`handleBlur`), not a layout primitive. They share about 31
identical lines. Consolidating them was considered in 2026-08 and declined: the
options were a layout-only shell (which leaves the `aria-describedby` wiring
duplicated, so it removes the lines without removing the risk), a shared binding
with a control slot (a render prop inside TanStack's own render prop, across 17
call sites), or one component carrying every prop both forms need (which puts
the AI review suggestion UI inside a component `inventory-form` also renders).
None was worth the churn against two wrappers that are currently in sync. Keep
them separate, and if you change the label, description or error handling in one,
change it in the other.

**A placeholder is not a label.** Every `Input` and `Textarea` needs an `id`
matched by a `Label`'s `htmlFor`, or an `aria-label` when there is no visible
label. A placeholder disappears the moment the user types, and axe will not
report its absence, because `placeholder` is a fallback in the accessible-name
computation, so the name reads as non-empty. Six controls shipped this way.
`src/test/field.test.tsx` enforces it.

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
| `text-blue-700` on links | Drop it; the global `a` style handles link color |
| `bg-blue-50` for highlights | `bg-[var(--brand-primary-tint)]` |
| `dark:bg-neutral-900` | `dark:bg-card` |
| `dark:border-neutral-800` | `dark:border-border` |

Status colors have no Tailwind alias, so reference the variable directly:

```tsx
<span style={{ color: "var(--status-success)" }}>Approved</span>
<span style={{ color: "var(--status-warning)" }}>Pending</span>
```

`--status-success-bg` and its siblings supply the matching tinted backgrounds. All of
them are redefined under the dark selector in `styles.css`.

What the five mean, so two badges for the same kind of news cannot pick two
colors: `success` is done or approved; `warning` is pending or missing, something
the reader may still act on (a review waiting, "Seeking mentor"); `error` is a hard
stop for the reader (deleted, "Not accepting applicants"); `info` is news with no
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
are reserved for the rare case that genuinely needs a third tier.

There is no card grid any more. The listing cards (`project-card.tsx`,
`inventory-card.tsx`) are one component at both widths: image on top at 16:9
below `md`, image on the left at 3:2 and `w-40` from `md` up, in a single column
bounded to `max-w-4xl`. A five-tier grid ladder used to hold the mobile-shaped
card at every width; it left with the two display modes on 2026-09-02, because a
card that turns into a row at `md` cannot sit in a three-column grid.

### Page wrapper padding

Every route page root other than the auth cards (see [Auth pages](#auth-pages))
carries this padding signature, with `max-w-*` chosen per page (see below):

```tsx
<div className="mx-auto max-w-4xl px-4 py-6 md:p-8">
```

`px-4 py-6` gives comfortable touch margins; `md:p-8` expands to the desktop-standard
32px. A bare `p-8` wrapper wastes a third of the width on a phone.

Page width is chosen by content, not fixed. Counting the 19 route roots that carry
this `px-4 py-6 md:p-8` signature: `max-w-2xl` on the 8 form, dashboard and prose pages
(`projects/new`, `projects/$projectId/edit`, `admin/index`, `admin/programs/$programId`,
`admin/users/$userId`, `inventory/new`, `inventory/$itemId/edit`, `privacy`), `max-w-4xl` on 7
pages that hold a list, a two-column detail layout or a grid of figures, `max-w-3xl` on the one
long-form page (`projects/$projectId.tsx`), and `max-w-md` on two narrow-content
pages (`profile.tsx`, `admin/categories/$categoryId.tsx`) plus `max-w-sm` on
`verify-email.tsx`. Of the seven `max-w-4xl` pages, three hold a single-column
card list (`projects/index.tsx`, `inventory/index.tsx`, `my/projects.tsx`),
`my/items.tsx` holds an attention region, a borrow-list card and two tab
panels of tables, all bounded to the title width since a borrower's list is
short, `my/bookmarks.tsx`
bounds only its title, `inventory/$itemId.tsx` holds a two-column detail
layout, and `admin/analytics.tsx` holds a two-column grid of figure cards.
`projects/index.tsx` in
table mode and `my/bookmarks.tsx` let the table run full width below the bounded
title (and filter bar), the way the admin tables do. The sign-in/sign-up/forgot/reset-password cards
are narrower still but live inside the separate `island-shell` container below, not
this padding pattern.

Pick the narrowest that fits the content; a form at `max-w-4xl` has an
uncomfortably long measure.

### Interactive element height

Inline form controls all share `h-9` (36px) so adjacent elements align without magic
numbers. `Input`, `SelectTrigger` (at `data-size=default`), `Button size="default"`,
and `ViewToggle` are already `h-9`. Set `h-9` explicitly on any new control that
sits inline beside them.

---

## Site header

The header carries site-wide chrome: navigation, the source link, notifications,
and the account menu. Anything scoped to one page's contents, such as a
collection count, lives on that page. The borrow list count sits on the
`/inventory` title row (`BorrowListButton`) and the bookmark count on the
`/projects` title row (`BookmarksButton`), opposite the `h1` and above the
filter bar. The header used to carry the borrow list as a shopping cart icon,
which both claimed something was being bought and reminded you of a list scoped
to one page from every other one.

Site-wide versus page-scoped is the distinction, not global state versus
static: a static link to the source repository belongs in the header, and a
live count of a page's own collection does not.

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
and escape-dismissible for free. Four rules keep it correct:

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
  "GitHub": `/sign-in` and `/sign-up` render a "Continue with GitHub" button.

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
URL-backed sort and visibility state.

Give the hook `columns`, `defaultSort` and `storageKey`, then spread what it hands back.
Those three used to be passed twice, once to the hook and once to the table, with nothing
checking that the two agreed: a mismatched `storageKey` writes column preferences under
one key and clears them under another, and a mismatched `defaultSort` leaves the URL and
the rendered order disagreeing. Spreading makes disagreeing impossible.

Row data does not go through the hook. `data` and `getRowId` are props of the table,
because the hook never read them and routing them through it bought nothing but a generic
parameter (#97). The hook does take one option it only forwards, `serverSorted`; it is described
below.

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

`navigate` is the route's own `useNavigate({ from })`, passed in rather than called
inside the hook so it typechecks against the real route path. Two options carry the
variations: `resetPageOnSort` for a paginated listing, whose page number stops meaning
anything once the server reorders, and `serverSorted` for a listing the server ordered,
which turns off local reordering. They are separate because server-ordered does not
imply paginated. `orderRows(rows, getId)` puts exported rows in the order the table is
rendering, so a CSV matches the screen; it is a no-op under `serverSorted`.

`resetPageOnSort` is unsatisfiable unless the route's own search type declares a `page`,
so setting it on a route that paginates nothing is a compile error rather than a stray
`page: 1` pushed into a schema with no `page` in it. The compiler prints the reason,
because the false branch of that conditional is a sentence rather than `never`.

That is all the route's search type is used for. Typing `navigate`'s reducer against it
as well was built and thrown away: the reducer spreads over a generic, so its return needs
a cast, and the cast silences the check the typing was for. It caught nothing the
conditional does not. That is what the hook's `TSearch`
parameter is for. It does not restore full search-schema checking on the patch: the
reducer spreads over a generic, TypeScript cannot prove that preserves it, and the cast
that makes it compile is what stops the compiler seeing the rest. One named failure
caught beats a boundary that looks typed and checks nothing.

`cardHeader` marks the one column that titles the record. On mobile its cell becomes the
card's header strip: full width, with no field name in front of it. Use it for a column
whose content already says what it is, usually a name or title beside a thumbnail, where a
"Name" label would only squeeze the title into what is left of the row. At most one column
per table may set it. A second one is logged and does not become a header strip; its cell
still renders as an ordinary labelled field. Two title rows on one card read as a styling
oddity and get lived with instead of reported, which is why this is checked at all.

`useAdminTableState` in `#/lib/table-state` is the router-agnostic core underneath, and
stays directly unit-testable. Every admin route goes through `useAdminTable`; reach past
it to the core only if you are driving a table from somewhere that has no `navigate`.

Responsive behavior is automatic: the component applies `className="admin-table"` and
derives each body cell's `data-label` from its column header. Below 768px the
`.admin-table` rules in `styles.css` hide the `<thead>`, turn each `<tr>` into a card,
and inject the label via `content: attr(data-label)`. No JavaScript, no duplicated
markup, and nothing to add by hand.

A hand-rolled `<table>` in an admin route collapses to an unreadable horizontal
scroll on a phone, which is the whole reason this component exists.

### An admin route's column list goes through `defineAdminColumns<Row>()`

```tsx
const COLUMNS = defineAdminColumns<Row>()([
  { accessorFn: (row) => row.name, header: "Name", id: "name" },
  {
    accessorFn: (row) => row.createdAt,
    cell: ({ row }) => <LocalTime dateOnly value={row.original.createdAt} />,
    header: "Created",
    id: "createdAt",
    sortingFn: "datetime",
  },
]);
```

The builder turns two rules about what an `accessorFn` returns into compile
errors. Both used to be prose, and both fail the same way: the table renders,
sorts, and looks fine, in the wrong order.

**A column that is not text sets its own `sortingFn`.** `AdminDataTable` defaults
every column without one to a locale-aware **string** comparator, so whatever the
accessor returns is sorted through `String(value)`. That is correct for text and
wrong for everything else:

| Column value | `sortingFn` | What the default does instead |
| --- | --- | --- |
| `Date` | `"datetime"` | `String(date)` starts with the weekday name, so ascending reads Fri, Fri, Mon, Wed. |
| number | `"basic"` | `"10"` sorts before `"2"`. |
| boolean | `"basic"` | `"false" < "true"` happens to read right, until a nullable flag puts `"null"` between them. |

**An accessor returns `undefined` for a missing value, never `null`.**
`sortUndefined: "last"` is the only knob TanStack offers for grouping empties and
it does not special-case `null`, so a `null` sorts as the string "null" among the
real values. Map it at the accessor: `(row) => row.label ?? undefined`.

Both are easy to ship and hard to notice. Seeded rows written in one run share a
timestamp, and the numeric cases are ordinals that stay single-digit for a long
time, so the column looks sorted until real data arrives. Two columns were
already breaking a rule when the check landed, one of them the users table's
Banned flag, which is nullable in the auth schema.

The error names the column: `COLUMN_NEEDS_ITS_OWN_SORTING_FN: "createdAt"` or
`ACCESSOR_RETURNS_NULL_USE_UNDEFINED: "note"`. `npm run typecheck`, not
`npm test`, is what enforces it, and `src/test/admin-columns.test.ts` holds a
`@ts-expect-error` per rejection case so the check cannot degrade to a no-op
unnoticed. Vitest reports those blocks green whatever the types do; tsc reads
the file because `tsconfig.json` includes `**/*.ts`.

A shared column const declared outside the array uses `satisfies
AdminColumn<Row>` with `id: "..." as const`, never an `AdminColumn<Row>`
annotation, which breaks the check in a way that reads as a bug in the check.
[`QUIRKS.md`](./QUIRKS.md#a-shared-admin-column-const-uses-satisfies-not-an-annotation)
says why; this section says only that the rule exists, so there is one copy to
keep true.

`accessorKey` and grouped (`columns`) definitions are banned outright. Both used
to compile with no rule applied at all, which is the one failure this check
cannot afford: the first carries a value type the check cannot read, the second
hides its real columns a level down where nothing inspects them.

The component's own test fixtures in `src/test/admin-data-table.test.tsx` stay
plain `AdminColumn<Row>[]` literals. They exercise the table, not a route, and
some of them are deliberately shaped in ways a route's columns never are.

---

## Component patterns

### Status tabs

Use `Tabs`, `TabsList`, `TabsTrigger`, and `TabsContent` from
`#/components/ui/tabs`, not a row of `<button>` elements. The primitive wraps
Radix's `Tabs`, so it gives the tablist real semantics for free: `role="tablist"`,
`aria-selected`, one tab stop for the whole strip, and arrow-key movement between
triggers. A hand-rolled button row has none of that: a screen reader announces
unrelated buttons, and a keyboard user has to tab through every tab individually.

The tab state usually lives in a URL search param, so `Tabs` is controlled. Pass
`activationMode="manual"` whenever activating a tab has a side effect beyond
showing its panel, such as a navigation: activating pushes a URL change, and the
ARIA authoring practices recommend manual activation whenever activation carries
a side effect. Under the default `automatic` mode, arrowing across a three-tab
strip fires that side effect on every keypress; under `manual`, arrows only move
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
when the search schema wants a narrower union. `TabsList` carries no margin of
its own, so give `Tabs` a `className="mt-4"` for the gap above the strip;
`TabsContent` already ships `mt-4` for the gap below it, so do not add another
`mt-4` to the panel body or the two will stack. The active trigger still gets the
brand-colored bottom border and the rest go muted, but that styling lives inside
`tabs.tsx` now, keyed off Radix's `data-[state=active]`, rather than being
hand-written at every call site.

### Pagination

Use `<Pagination>` from `#/components/ui/pagination`, with `PaginationLink` for
route links and `PaginationButton` for in-place navigation.

Never disable a pagination control with `pointer-events-none` alone. That
suppresses mouse events and nothing else: the anchor stays in the tab order, is
still announced as a link, and Enter still activates it, so a keyboard user on
page 1 could focus a control that looks disabled and activate it to no effect.
Two of the three pagers in this app shipped that way, and no axe rule reports
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
the server does not page renders `ListCount` under its table, which is the
same component with everything shown on one page, so the count sits in the
same place with the same format everywhere. `AdminDataTable` announces only
the sort order, so a screen reader hears one number (#209).

### Badges

Every badge renders through `<Badge>` from `#/components/ui/badge`. A badge that
carries a domain status uses `variant="status"` and supplies its own
`--status-*` foreground and background through `style`, because the upstream
variants (`default`, `secondary`, `outline`) paint a fixed color and cannot
express a status mapping. Four components wrote this box independently before
this rule existed, and two had already drifted apart on details like
`inline-flex` versus `inline-block`. `CountBadge` is the one non-status use of
`variant="status"`: it wants the blank canvas, and paints it with the
`bg-primary text-primary-foreground` tokens rather than a status pair.

### Surfaces are not all cards

`<Card>` is the repeated `rounded-lg border border-border bg-card` surface used
by list items, filter bars, and admin tiles. Three other surfaces are
deliberately separate and must not be folded into it:

- `panel.tsx` for the audience-gated panels, which carry their own tone variants
- `.island-shell` for the auth cards
- `.feature-card` for the landing page tiles

`Card` also takes an `asChild` prop. Admin's `NavCard` (in `admin/index.tsx`)
has a `<Link>` as its root element; wrapping it in a plain `<Card>` would nest a
`<div>` around the `<a>` instead of merging onto it, which silently breaks the
click target. Reach for `asChild` any time the thing a card wraps is itself the
navigable element and nothing else:

```tsx
<Card asChild className="flex flex-col overflow-hidden" interactive>
  <Link to="/admin/projects">...</Link>
</Card>
```

`project-card.tsx` and `inventory-card.tsx` used to be `asChild` too and no
longer are: each carries a control beside its link (the bookmark toggle, the
add-to-cart button), and a button inside an anchor is invalid HTML that axe
reports as a nested interactive. There the `Card` is a `div`, the `Link` is its
first child and takes the whole image-and-text area, and the control is a
sibling.

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

Sign-in, sign-up, forgot-password, and reset-password share an `island-shell` card:

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
as `description`; the title is what gives the dialog its accessible name.

```tsx
<ConfirmDialog
  description="This cannot be undone."
  onConfirm={runDelete}
  title="Permanently delete this draft?"
>
  <Button variant="destructive">Delete draft</Button>
</ConfirmDialog>
```

Two exceptions add a step `ConfirmDialog` does not have: the user must type
something exact into an `Input` before the destructive `Button` un-disables.
The inventory hard delete in `inventory-lifecycle-panel.tsx` asks for the
item's name (`disabled={busy || delConfirm !== item.name}`); the account
deletion in `delete-account-dialog.tsx` asks for the person's own email,
compared case-insensitively. A single confirm click is an easy reflex to fire
without reading; typing the exact value is a deliberate extra brake. Both
reset the typed value before the dialog shows again (the inventory panel when
its trigger opens it, the account dialog on every open and close), so a Cancel
never leaves the next opening pre-armed. Reach for this shape only when a
single confirmation is not enough friction for the action at hand, not as the
default: the project hard delete in `staff-project-panel.tsx` is equally
permanent and still confirms through plain `ConfirmDialog`.

Both are built on `AlertDialog` from `#/components/ui/alert-dialog`, never
`Dialog`. `Dialog` renders `role="dialog"`; an irreversible action wants
`role="alertdialog"`, which screen readers announce more assertively and which
does not dismiss on an outside click. Escape still closes it; Radix blocks
only outside interaction. axe does not report a plain `dialog` on a
destructive prompt, so the role is a rule here, asserted by the component
tests and the accessibility suite rather than found by a scan. The
destructive button is a plain `Button`, not `AlertDialogAction`: the action
closes the dialog on click unless the handler calls `preventDefault`, and both
dialogs keep theirs open to show a failure, so an explicit `open` state is
clearer than an opt-out.

Radix moves initial focus to the cancel action. That is right for a one-click
prompt and for the account dialog, whose input sits under a list of
consequences the reader should get through first. It is wrong for the
inventory panel, where only a one-line reminder of the item's name stands
before the input, so that one points `AlertDialogContent`'s `onOpenAutoFocus`
at the input (#66). Decide per dialog by what stands between the top of the
body and the input.

Results that need no acknowledgement use a toast: `import { toast } from "sonner"`.

**Native `confirm()` and `alert()` are banned.** They are unstyled, ignore the
brand and the dark palette, block the main thread, and cannot be scanned by the
accessibility suite, because axe cannot reach a page whose script is parked on a
modal browser prompt. `src/test/no-native-modals.test.ts` enforces this.
