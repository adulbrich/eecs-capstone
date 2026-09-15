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

`type` is required: `type="submit"` on the one button that submits its form, and
`type="button"` on everything else, inside a form or not. The HTML default for a
typeless button is `submit`, which is how the image uploader's "Upload image" saved
the project edit form on its way to the file picker (#305), and how the admin
category and program pages' Delete buttons saved the form while opening their
confirm dialog. `Button` does not default the prop, because a default of `"button"`
would turn an implicit form submit into a no-op just as silently. An `asChild`
`Button` takes no `type`; the child it renders is a link.

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
`icon-lg` to stay square. `bare` is the odd one out of the height scale: no
height and no padding at all, for a `link` Button that sits in a panel as a
line of text, which is what `ClearFiltersButton` uses.

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

### One kind of action is one button everywhere

The variant table above says which variant an action takes. These four drifted
across pages often enough to be worth naming, because the eye reads a different
button as a different action:

| Action | Button |
| --- | --- |
| Cancel | `outline` |
| Remove | `ghost` |
| Save | `default` |
| Clear all | `<ClearFiltersButton>` from `#/components/clear-filters-button` |

Size is the row's to decide, not the action's. Cancel takes the size of the
button it sits beside; Remove is `sm` in a list or a table row and `default`
beside the mentor capacity `Input`; Save is `default` under a form and `sm`
beside the `sm` `SelectTrigger` on the admin user page. Where the two rules
meet, the row wins, because a button half a step off the control next to it is
the misalignment this section exists to stop. See "Size follows the row" below.

Cancel was `ghost` in four dialogs and `outline` in ten, Remove was six
different buttons including two hand-rolled red palettes, and Clear all was a
`link` Button with `h-auto p-0` copied five times. `ClearFiltersButton` exists
so the sixth copy is an import rather than a paste.

### A button shows the hand cursor, whichever element it renders

Tailwind's preflight leaves `button` at the browser's default arrow, while an
anchor gets the hand. An `asChild` Button renders a `<Link>`, so before the
base rule in `styles.css` the cursor told the user which element the code
happened to choose. `button:not(:disabled) { cursor: pointer }` in the base
layer covers every button on the page, the deliberate raw ones included; a
button that is genuinely not pressable says so with `cursor-default`, which is
a utility and so outranks the base rule (the current status pill in
`staff-project-panel.tsx` does this).

### A variant owns its text colour at rest

`outline` and `ghost` carry `text-foreground` rather than leaving the colour to
be inherited. Without it a rendered `<button>` inherited the body colour and an
`asChild` anchor inherited the global `a` rule, brand orange, so the same
variant was two different buttons depending on the element underneath it.
`secondary`, `default` and `destructive` already carried their foreground
token; `link` is the one variant that is meant to read as a link and keeps
`text-brand-dark`.

### Size follows the row, not the page

A button on a row with a form control is `default` (h-9), so it aligns with the
`Input` and `SelectTrigger` beside it: the search row's Export CSV, Columns and
view toggle are all `default` for this reason. A contextual button with no form
control on its row is `sm` (h-8): the title-row actions, the buttons inside a
table row or a panel. The rule was previously a comment in
`export-csv-button.tsx`, which meant the next page picked either.

### `className` on a Button never restyles it

A Button's `className` may position it (`w-full`, `mt-2`, `xl:hidden`,
`relative`), and may not set a colour, a height, a padding or a radius. Font
weight is not on that list, and one call site uses it: the combobox trigger in
`category-type-combobox.tsx` carries `font-normal`, because a trigger that
displays a selected value reads as an input rather than as a button. Those
four are what the variant and size own, so a call site that sets them has
forked the primitive in one file: a Remove in a destructive palette here, an
`h-auto p-0` there, until no two pages agree. If a call site needs a look the
variants do not offer, the variant is what changes, or a shared component wraps
it. `src/test/button-conventions.test.ts` scans for the four.

A pressed toggle is the case this most often tempts. Style it from
`aria-pressed` in the primitive, which the base class handles, not from a
conditional `bg-secondary` at the call site: the attribute is what a screen
reader reads, so styling from anything else lets the two disagree. `ViewToggle`
and the markdown Edit/Preview pair are the two.

A segmented group (buttons that read as one control) gets its radius from the
wrapper, which carries `[&>*:not(:first-child)]:rounded-l-none`,
`[&>*:not(:last-child)]:rounded-r-none` and `[&>*+*]:-ml-px`, so no call site
sets a radius. Written against `:not()` rather than `:first-child` and
`:last-child` so a third button squares on both sides instead of keeping the
base radius in the middle of the group.

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

A link with words beside it on the line, in a paragraph, a list item, a
callout or a label-and-value row, carries `text-brand-dark underline`, not
`hover:underline`. WCAG 1.4.1 lets color alone mark a link only at 3:1
against the surrounding text, and the brand color does not reach it anywhere
that matters: about 1.05:1 against muted text and 1.07:1 against destructive
text in light mode, and against ordinary body text about 3.1:1 in light and
1.9:1 in dark (`#FF8C5A` on `#EDE9E5`). The global `a` rule in `styles.css`
already sets the underline's color, thickness and offset, so the class only
turns the line on, and `underline-offset-` at a call site is the global rule
restated. These links show no hover change, because `text-brand-dark` outranks
the base `a:hover` color and the line is already there; that is the intended
state. Colored prose came first (#361) and body copy followed (#364), each PR
listing the links it found. Thirteen were missed by both, on the auth pages,
`/profile`, the account deletion dialog and two admin inventory routes: they
carried a bare `underline` with no color class at all, which the scan looked
for `text-brand` to find and so could not see, and hovered to the vivid orange
this rule exists to keep off a link. This doc claimed those pages had no hover
change while they did, from #361 until #411 made it true.

`hover:underline` stays for a link that is the whole content of its cell,
title or block, where nothing sits beside it to be confused with: the title
and action links in the tables, the card title that wraps the whole card,
the "All inventory" back link. A shared component that lands in running text
anywhere carries the underline everywhere, as `SupportEmailLink` does: one
look per component, no prop to get wrong. Breadcrumbs are a navigation
landmark rather than prose; `BreadcrumbLink` underlines in no state and
changes color on hover instead, and stays that way. Markdown body copy is
covered by the typography plugin, which underlines its links. Whether a class
sits in a `<td>` or a `<p>` is not something a regex over a file can tell, so
no scan can enforce where this rule applies; what
`src/test/brand-link-scan.test.ts` does enforce is the half that is decidable,
that a class string turning an underline on carries `text-brand-dark` with it
and does not restate `underline-offset-`. Color against the background is the
separate rule under "Color tokens".

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

**On the project and inventory forms, field labels are Title Case; nothing
else is.** "Problem Statement", "Contact Email", "Private Notes". A checkbox
label is a sentence and stays one. Page headings, section headings, table
headers, legends, badges and buttons stay sentence case, so a label reads as
the name of a box and a heading as a line of prose. The rule is scoped to the
two long forms on purpose (#375): the labels in dialogs, panels and the
profile page are still sentence case, and moving them is a separate change.
Where a form label and a page heading name the same field, the two are
sibling constants pinned to the same words by a unit test, since a case
transform would lowercase "IP" and "NDA": `FIELD_LABELS` and `FIELD_HEADINGS`
in `src/lib/project-review-fields.ts`, and `PRIVATE_NOTES_FIELD_LABEL` beside
`PRIVATE_NOTES_LABEL` in `src/lib/private-notes.ts`.

**The project and inventory forms set their labels at `text-base`** through
their local `Field` helpers and the raw `Label` uses beside them, and space
their fields at `space-y-6`. The shared `Label` stays at `text-sm`: a dialog
or a filter has one or two labels and no scanning problem, and the two long
forms had one (#375). The project form is also split into three groups by a
hairline `hr`: the story of the project, how to reach the proposer, and the
terms; no group headings, which were considered and declined.

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

**A placeholder is not documentation either.** It has no tooltip, it clips
without saying so, and it is gone once the reader types. A listing search
placeholder is a name for the box, "Search projects" or "Search inventory",
at most about 25 characters: the search row gives `/projects` about 28 at
768 in table view, and the two long placeholders it replaced clipped there and
at 375 (#369). What the box searches and the syntax it takes go on a
`SearchHint` line (`#/components/search-hint`) rendered right after the input
in the same row, which the input names through `aria-describedby`. The
component carries the syntax sentence, because every listing search runs
through `websearch_to_tsquery`; the caller passes the fields sentence, which
must be true of that page's query. The line is text only, so the tab order
from the search to the Filters button is what the a11y suite asserts.

### Error text goes through one component

A message about something that failed renders through `FieldError` from
`#/components/ui/field`, never as a hand-written
`<p className="text-destructive text-sm">`. About forty call sites wrote that
paragraph themselves and drifted: `mt-2` in five, `mt-3` in two, no margin in
the rest, `text-xs` in two, no size class at all in one, and only two of them
announced anything to a screen reader (#411).

`FieldError` takes either shape, and never both:

```tsx
<FieldError errors={field.state.meta.errors} />   {/* a TanStack Form field */}
<FieldError message={error} />                     {/* a string or null */}
```

It renders nothing when there is nothing to say, so a caller does not guard it
with `{error && ...}`, and it takes no `className`: one margin is the point,
and none of the fifty-nine call sites needed a different one.

It carries `role="alert"`, not `aria-live="polite"`. Both announce, but these
messages are inserted in response to something the reader just did, a save they
pressed and a server that refused it, and the assertive role is what interrupts
to say so; a polite region waits for a pause that a form with focus still in it
may not reach. The trade is that `role="alert"` on an element already in the
DOM announces on every content change, which is why the component returns
`null` rather than rendering an empty paragraph.

An error about a whole form or panel rather than one field renders through
`ErrorBanner` from `#/components/error-banner`, which is the same message in a
tinted box with one opacity pair. Three copies of that box had drifted to two
different opacity pairs before it existed.

A status panel is not an error banner even when it is tinted with the
destructive color. The ban notice in `ban-form.tsx` is a `<section>` with a
heading, a reason and an expiry, describing a state the account is in rather
than an action that failed, so it keeps its own markup.

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
white is 4.56:1, a margin of 0.06 over AA, so the moment a row hover, a selected
state or a status background sits under it the link fails, and on the page
surface itself it is already 4.27:1; `text-brand-dark` is 6.0:1 on white and
about 5.6:1 on a hovered table row, and the `link` Button variant already uses it
in both modes. Keep the class rather than dropping it and trusting the global `a`
rule: that rule's hover state switches back to `--brand-primary`, and a utility
outranks it. Table cells were the first case (#357) and the rest followed in
#358, so `text-brand` on a link is a regression. `text-brand` stays for icons
and decoration, where no contrast ratio applies; each such file is named in
`src/test/brand-link-scan.test.ts`, which fails on any other.

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

One case does: a listing's filters. `ListingLayout` (see
[Listing layout](#listing-layout)) puts them in a left aside from `xl` (1280px)
and in a `Sheet` below it. The tier is `xl` and not `lg` by arithmetic, not
taste: the card column is `max-w-4xl` (896px), the aside is 18rem (288px), the
gap 2rem and the page padding 4rem, and 288 + 32 + 896 + 64 is 1280. At `lg`
the cards would have to shrink to make room. The `xl:` layout classes live in
that one component; a route passes at most its width pair through `className`
(`mx-auto max-w-4xl xl:max-w-7xl` on `/projects` and `/inventory`). Any other `xl:` still needs
a reason this paragraph does not already give (#350).

There is no card grid any more. The listing cards (`project-card.tsx`,
`inventory-card.tsx`) are one component at both widths: image on top at 16:9
below `md`, image on the left at 3:2 and `w-40` from `md` up, in a single column
bounded to `max-w-4xl`. The image is letterboxed inside that box, `object-contain`
on `bg-muted`, so the whole picture shows at every width and the bars read as
part of the card; `object-cover` cropped anything that was not the box's ratio
(#314). The detail page hero and the table thumbnails still crop. A five-tier grid ladder used to hold the mobile-shaped
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
`my/items.tsx` holds an attention region and one grouped table with a filter
above it, all bounded to the title width since a borrower's list is
short, `my/bookmarks.tsx`
bounds only its title, `inventory/$itemId.tsx` holds a two-column detail
layout, and `admin/analytics.tsx` holds a two-column grid of figure cards.
`my/bookmarks.tsx` lets the table run full width below the bounded
title, the way the admin tables do. `projects/index.tsx` and
`inventory/index.tsx` used to as well; since #350 and #352 they pass
`mx-auto max-w-4xl xl:max-w-7xl` to `ListingLayout`, so the table is bounded
with the cards below `xl` and shares the wider grid with the aside from `xl`.
`/admin/projects` and `/admin/inventory` pass no width and run full, as before. The sign-in/sign-up/forgot/reset-password cards
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
`<Button variant="ghost">`. It shares the component with the line sheet under
Admin tables below and the filters sheet in `ListingLayout`, and nothing else. It is a Radix Dialog underneath, so it is focus-trapped
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

The hook hands back a second bag, `controlsProps`, for the listings whose Export CSV
and Columns menu sit in the search row rather than on the table's own row. Pass
`controls="listing"` to the table, which then draws no row above itself, and render
`<AdminTableControls actions={<ExportCsvButton />} filtered={filtered} rowCount={rows.length} {...controlsProps} />`
where the controls should go. The component is built from the column list and the hidden
set rather than from the table instance, which is what lets it render in another subtree;
it hides itself under the same rule as the table (no rows and no filter, #260), and
the `rowCount` and `filtered` it takes are the table's own. Every other table leaves
`controls` at its default and gets the table's own row: whatever it passes as `toolbar`
on the left, its `actions` and the Columns menu on the right, and nothing visible when
it passes neither and no column can hide (the bookmarks shortlist).

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
A row action inside that header strip is icon-only below `md`, with the label as
its `aria-label` and `title` and the text `hidden md:inline`, so the title keeps the
row: the public inventory table's Borrow button does this through
`AddToCartButton`'s `compact` prop (#401). It keeps its text size rather than
taking an `icon-*` size: the same element shows its text from `md`, and swapping
the size at the breakpoint would cost a second class set for a button that is
square enough at `sm` with the text hidden. A pending or error label stays visible
at every width, because an icon alone says too little about a failure.

### A free-text column is bounded and clamped

From `md` up every `TableCell` is `md:whitespace-nowrap`, so a cell cannot wrap
on its own: one 200-character title sets the width of the whole column and
pushes every other column right. A column whose value is free text therefore
bounds itself and clamps, and every class it uses for that carries the `md:`
prefix, because below `md` the cell is the card header strip, which wraps in
full and must stay exactly as wide as the card.

The title or name cell puts `md:min-w-xs md:max-w-md` on its outer flex
container and `min-w-0 md:line-clamp-2 md:whitespace-normal` on the link, with
the full text in a native `title` attribute so a mouse user can hover for it.
Two of those classes are load-bearing in ways that are easy to drop.
`md:whitespace-normal`: `line-clamp` does not reset the inherited `nowrap`, and
a clamp on one unbreakable line clips it with no ellipsis. `md:min-w-xs`: an
auto-layout table that is wider than its container shrinks the column with the
most slack, and a clamped cell with no minimum is that column, so with the
maximum alone the title column collapses to its longest word while every
nowrap column keeps its full width. Two lines rather than one because titles
here often differ only in their tail, and two lines match the height of the
3:2 thumbnail at `w-16`. The clamp is CSS, so the full value stays in the DOM
for screen readers, Find-in-page and the CSV export.

A description cell is `line-clamp-3 max-w-xs md:whitespace-normal`: narrower
and three lines, because it is hidden by default and read on purpose rather
than scanned, and no minimum, because it competes with nothing when shown. The
`md:whitespace-normal` is the same fix as above; the `Prose` cell behind the
six hidden prose columns of `/projects` and the inventory description cell
shipped without it and clipped to one line.

The cells that do this: the title cells of the two projects listings, the
bookmarks table and the two inventory listings, and the programs description,
which follows the title recipe with no thumbnail (#371). A short-capped name
column (categories, users, mentors) has not needed it. Classes on each cell
rather than an `AdminColumn` option or a shared cell component: six cells, one
pattern, and the triage on #371 chose the pattern over the abstraction.

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
anything else. Nothing enters the URL. Grouping and sorting genuinely conflict,
because a group stops being contiguous once rows are ordered by another column,
so sorting is the escape hatch rather than a mode a reader can get stuck in. A
page that needs a fixed group order returns its rows in that order and declares
every column `enableSorting: false`; it still passes a `defaultSort`, which is
inert there.

Groups are formed from the sorted row model, so a page that sorts client-side
groups what the reader sees. `header(rows)` receives the group's rows and nothing
else, which means whatever identifies the group is denormalized onto every row in
it. `getRowId` and `highlightedRowId` keep addressing data rows, so a deep link
still lands inside a group. On mobile the header renders as a strip above its
cards rather than a card of its own. One level only: no nesting, collapsing or
sorting within a group. CSV export is per-route and unaffected.

### The line sheet

Reading or acting on one request line opens a `Sheet` beside the table, never a
row that expands inside it. `LineSheet` in `#/components/line-sheet` is the shell:
a title, a description, a definition list of fields, the timeline, and an
actions slot in the footer. `LineTimeline` draws the `TimelineEvent[]` that
`lineTimeline` in `#/lib/inventory-timeline` builds from the line's own columns,
so the staff queue and `/my/items` cannot disagree about what happened to a line.
A row opens it through a `Details` button in its Actions cell; the sheet closes
without navigating.

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

Two things follow from choosing a sheet. `AdminDataTable` grows no expansion
mode, which matters because the grouping mode above is already the shared
component's one extension. And the actions get room: a fulfill flow wants more
than a table cell, and the sheet is where it lives rather than a seventh column.
This is the first use of `Sheet` outside the mobile navigation drawer.

### Two empty states

A table with no rows is one of two things, and the route says which with `filtered`.

Unfiltered and empty is a listing with nothing in it. The component renders
`emptyMessage` and nothing else: no headers, no Columns menu, and nothing from the
`actions` slot, because a column picker over headers that are not on the page and an
Export CSV of no rows are controls that exist to be ignored (#260). The two are gated
together inside the component so they cannot drift apart.

Filtered and empty is a search or filter that matched nothing. The headers, the Columns
menu and `actions` stay, because the reader is mid-search and they are what is being
searched over, and one row across every visible column says `noMatchMessage`
("Nothing matches these filters." unless the route has better words). On the mobile
card layout that row is a single card with no field label.

Only the route can tell the two apart, because the loader did the filtering. Derive
`filtered` from the search params that narrow the result, and leave out a switch that
widens it (`includeSoftDeleted` on projects, `includeBanned` on users): an empty result
with a widening switch on is still nothing at all. A default that narrows counts as a
filter: the request queue opens on `pending`, and a staff member with no pending
requests still wants the status select and the headers rather than a bare message.
The one exception is the status set on `/admin/projects`, which opens on every status
but archived and reports itself unfiltered (#335): that set is what the listing is,
not a search over it, and archived rows are the bulk the legacy import adds. The cost
is that a program with nothing but archived projects sees the bare message; a
reader who wants the archive follows the link from `/admin/analytics` or edits the
URL. A route with no filters (programs, categories, bookmarks, My Items) never sets
it.

```tsx
const filtered = q !== "" || status !== null || categories.length > 0;

<AdminDataTable
  emptyMessage="No items yet."
  filtered={filtered}
  noMatchMessage="No items in this view."
  {...rest}
/>;
```

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
    sortFn: "datetime",
  },
]);
```

The builder turns two rules about what an `accessorFn` returns into compile
errors. Both used to be prose, and both fail the same way: the table renders,
sorts, and looks fine, in the wrong order.

**A column that is not text sets its own `sortFn`.** `AdminDataTable` defaults
every column without one to a locale-aware **string** comparator, so whatever the
accessor returns is sorted through `String(value)`. That is correct for text and
wrong for everything else:

| Column value | `sortFn` | What the default does instead |
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

The error names the column: `COLUMN_NEEDS_ITS_OWN_SORT_FN: "createdAt"` or
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

### The email skip

Every staff action that emails someone names the recipient before the click
and can be told not to send (#379, ADR-0019). Render `SendEmailCheckbox` from
`#/components/send-email-checkbox` inside the dialog or popover the action
already has: "Email <address>", checked by default, over a line saying what
unchecking leaves in place. Pick the line from `EMAIL_SKIP_HINT`: `withBell`
when the action also writes an in-app notification, `emailOnly` when email is
the only channel (a mentor named, a hard delete, a role change, a ban), and
`holder` for a hold, where an account holder gets the row and a walk-in does
not. With `address={null}` the box is disabled and reads "No address on file,
no email will be sent"; keep sending `true` in that state and let the server
decide who is reachable. A popover carries it the same way a dialog does: the
inventory queue's approve and reject popovers do.

A Save that had no dialog opens `SendEmailDialog` from
`#/components/send-email-dialog`, and only when the pending change would
actually send mail; a save that mails nobody goes straight through, or the
dialog announces an email that never goes out. The one inline exception is
the comment form, where staff post many: a plain "Email the proposer" box
beside "Internal (staff only)", unchecked and disabled while Internal is on,
since an internal comment mails nobody; unchecking Internal checks it again.

The box is checked again every time its dialog opens: the skip is a decision
about one action, and a Cancel must not carry an unchecked box into the next.
`SendEmailDialog` gets this for free by holding the state inside the content
Radix unmounts. A `ConfirmDialog` body or a popover holds the state in the
caller, so the caller resets it where the dialog opens or closes: the
trigger's `onClick` (the ban form, the project hard delete), the function that
opens it (the checkout dialog), or the `onOpenChange` that handles the close
(the inventory popovers and dialogs).

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

A detail page (`/projects/$projectId` since #400; the inventory item page is
meant to follow) opens with one header block, top to bottom: the title row,
`flex items-start justify-between gap-3`, with the title left and the actions
right; one `flex flex-wrap` badge row under it holding the status badge, the
applicants badge and the public marks in that order with one gap, which
`ProjectBadges` renders from its `children` slot plus the marks; the category
chips; the owner actions; then the image. The actions are Bookmark and, for a
viewer who can edit, Edit. Bookmark keeps its icon at every width and hides its
text below `md`, with `aria-label` and `title` as the accessible name, so it is
the small icon button right of the title on a phone. Edit sits right of
Bookmark from `md`; below `md` it leaves the title row and renders full width
directly above the image. Render it twice, `hidden md:inline-flex` in the row
and `md:hidden w-full` above the image: a display-none link is out of the
accessibility tree, so a role query still finds exactly one.

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

### Listing layout

A page that lists and filters renders through `ListingLayout` from
`#/components/listing-layout`, with four slots and an optional fifth. The four listings on it are
`/projects`, `/admin/projects`, `/inventory` and `/admin/inventory`; the
filters components are `projects-filters.tsx` and `inventory-filters.tsx`,
with the admin forms inline in their routes.

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

`search` holds what does not narrow the list: the search input, its
`SearchHint` right after it, the sort, the card/table `ViewToggle`. The row
renders on top at every width, beside a "Filters" button that is gone from
`xl`. `tableControls` is that table's `AdminTableControls` (Export CSV, the
Columns menu) when a table is showing, and nothing in card view; the layout
renders it after the Filters button, at the end of the same row. The row wraps
at every width and the hint is a `basis-full` item, so below `md` the input has
a line, the hint the next, and the buttons follow it left-aligned in DOM order,
which is also the tab order; from `md` the hint takes `order-last` and the
input and the buttons share one line, which each input's `basis` is sized to
allow at 768 (`/projects` carries `basis-40` because its row is the fullest).
On `/projects` the recommendation prompt renders from the route as the first
child under the row, outside it, so its link does not land between the toggle
and the Filters button in the tab order. `filters` holds what narrows: program, the
switches, the category or status lists, Clear all. It renders in a sticky
`aside` from `xl` and inside a left `Sheet` below it; pass one element and the
layout renders it in both places, only one of which is ever displayed. Stack the
controls (`space-y-4`) and give each `w-full`; a fixed `w-56` that fit a toolbar
overflows an 18rem column. A `FilterSwitch` label is one line under a
`fieldset` legend that carries the "Only show projects that", because the full
sentence wrapped to two lines beside its switch at that width; each label
completes the legend as a lowercase predicate ("are accepting applicants"), and
both project listings read legend and labels from `PROJECT_SWITCH_LEGEND` and
`PROJECT_SWITCH_LABEL` in `projects-filters.tsx`, so they cannot drift (#383).
A switch whose label does not say what it hides takes a `hint`, one muted line
under the label that the switch names through `aria-describedby`, the way
`SearchHint` is wired to its input; `PROJECT_SWITCH_HINT` carries the one in
use. A control that swaps the set rather than narrowing it is not a switch
under that legend: the public listing's archive is a two-option `RadioGroup`
("Show: Current projects / Archived projects") above the switches, with its own
hint line, over the same `archivedOnly` param.

`activeFilterCount` is what the button shows below `xl`, so a reader knows the
list is narrowed without opening the sheet. Count decisions, not values: a
category set counts once however many it holds. The public route derives it
from the same booleans as `filtered`; the admin route also counts the
soft-deleted switch, which widens rather than narrows and so stays out of
`filtered`.

The admin route stopped passing `toolbar` to `AdminDataTable` when its filters
moved into the aside, which left Export and Columns alone on a row of their own
under the search; #366 and #367 moved them into the search row through
`controls="listing"` and `AdminTableControls` ("Admin tables" above). The public
listings render the controls only in table view, from a `useAdminTable` call that
lives in the route at every view with `seedColumns: view === "table"`, so card
view's URL never picks up a stored column layout. Growing the table with a filters
slot was the alternative and was declined, because the grouping mode is meant to
be that component's one extension.

### Surfaces are not all cards

`<Card>` is the repeated `rounded-lg border border-border bg-card` surface used
by list items, the filters aside, and admin tiles. Three other surfaces are
deliberately separate and must not be folded into it:

- `panel.tsx` for the audience-gated panels, which carry their own tone variants
- `.island-shell` for the auth cards
- `.feature-card` for the landing page panels. It has no hover state on purpose:
  the panel is not a link, and a lift on hover is what made the old tiles look
  like one (#393).

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

What a confirmed action reports when it succeeds, fails or is still running
is "Mutations and feedback" below; `ConfirmDialog` implements that part, so
a caller passes a handler and nothing else.

**Native `confirm()` and `alert()` are banned.** They are unstyled, ignore the
brand and the dark palette, block the main thread, and cannot be scanned by the
accessibility suite, because axe cannot reach a page whose script is parked on a
modal browser prompt. `src/test/no-native-modals.test.ts` enforces this.

## Mutations and feedback

Everything a trigger does between the click and the result. An audit found five
ways of wiring one mutation and the same kind of action wired differently in
neighbouring files (#410), so the rules below are the contract and
`src/lib/use-action.ts` is the shared piece that keeps a handler to them.

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
- **A save that stays on the page confirms inline**, next to what it saved.
  `profile.tsx` is the page this describes.

Neither is optional. A mutation that reports nothing on success is
indistinguishable from one that silently failed.

### Dialogs

**A dialog that runs a mutation stays open on failure and shows the error
inside itself. It closes only on success.** A dialog that closes on click puts
the refusal on the page behind it, where the reader is not looking and often
cannot see it at all.

`ConfirmDialog` owns this: pass it an `onConfirm` that does the work and lets a
rejection propagate, and it disables both buttons, swaps the label to
`busyLabel`, keeps itself open, and renders the message in a `FieldError`
inside. Callers do not pass `busy` or `error` and do not catch. A dialog built
on `AlertDialog` directly (`delete-account-dialog.tsx`,
`inventory-lifecycle-panel.tsx`, `send-email-dialog.tsx`) does the same thing
with its own state.

### Cache

**Query invalidation names its keys.** A bare `queryClient.invalidateQueries()`
refetches every query on the page, including the ones the mutation cannot have
touched, which is slow and hides which key actually mattered.

**`router.invalidate()` is awaited inside the busy window**, not fired and
forgotten. Loader data is what the control is about to be re-enabled over; a
fire-and-forget invalidate re-enables it over the stale copy, and the reader
sees the old value with a live button beside it.

Go through the hook that owns a key rather than calling the server function
underneath it: `useWriteBookmark` exists so that a bookmark write invalidates
`["bookmarks"]` wherever it happens.
