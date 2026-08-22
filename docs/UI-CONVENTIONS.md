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
7. [Mobile navigation](#mobile-navigation)
8. [Admin tables](#admin-tables)
9. [Component patterns](#component-patterns)

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

Wrap each label/input pair in `space-y-1.5` for consistent vertical rhythm, and give
every input an `id` that its `<Label htmlFor>` matches:

```tsx
<div className="space-y-1.5">
  <Label htmlFor="email">Email</Label>
  <Input id="email" name="email" type="email" required />
</div>
```

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

### Page wrapper padding

Every route page root:

```tsx
<div className="mx-auto max-w-4xl px-4 py-6 md:p-8">
```

`px-4 py-6` gives comfortable touch margins; `md:p-8` expands to the desktop-standard
32px. A bare `p-8` wrapper wastes a third of the width on a phone.

`max-w-4xl` is the standard page width. The 2026-06 list-presentation work
deliberately kept it rather than widening to `max-w-7xl`.

### Interactive element height

Inline form controls all share `h-9` (36px) so adjacent elements align without magic
numbers. `Input`, `SelectTrigger` (at `data-size=default`), `Button size="default"`,
and `ViewToggle` are already `h-9`. Set `h-9` explicitly on any new control that
sits inline beside them.

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
and escape-dismissible for free. Three rules keep it correct:

- Call `setOpen(false)` in every `<Link>` click handler, so the drawer closes once
  navigation completes.
- Keep the `SheetHeader` title (`Navigation`) present for screen readers.
- Render the notification bell in the mobile header bar, outside the Sheet, so it
  stays reachable without opening the drawer.

```tsx
<Sheet open={open} onOpenChange={setOpen}>
  <SheetTrigger asChild>
    <Button aria-label="Open navigation" size="sm" variant="ghost">
      <Menu className="h-5 w-5" />
    </Button>
  </SheetTrigger>
  <SheetContent className="w-72 p-0" side="left">
    ...
  </SheetContent>
</Sheet>
```

---

## Admin tables

Render admin tables with `<AdminDataTable>` from `#/components/admin-data-table`.
It handles sorting, column hiding, and the responsive card layout, and it pairs with
the `useAdminTableState` hook for URL-backed sort and visibility state.

Responsive behavior is automatic: the component applies `className="admin-table"` and
derives each body cell's `data-label` from its column header. Below 768px the
`.admin-table` rules in `styles.css` hide the `<thead>`, turn each `<tr>` into a card,
and inject the label via `content: attr(data-label)`. No JavaScript, no duplicated
markup, and nothing to add by hand.

A hand-rolled `<table>` in an admin route collapses to an unreadable horizontal
scroll on a phone, which is the whole reason this component exists.

### A column that is not text sets its own `sortingFn`

`AdminDataTable` defaults every column without one to a locale-aware **string**
comparator, so whatever the `accessorFn` returns is sorted through `String(value)`.
That is correct for text and wrong for everything else:

| Column value | `sortingFn` | What the default does instead |
| --- | --- | --- |
| `Date` | `"datetime"` | `String(date)` starts with the weekday name, so ascending reads Fri, Fri, Mon, Wed. |
| number | `"basic"` | `"10"` sorts before `"2"`. |

```tsx
{
  accessorFn: (row) => row.createdAt,
  cell: ({ row }) => <LocalTime dateOnly value={row.original.createdAt} />,
  header: "Created",
  id: "createdAt",
  sortingFn: "datetime",
}
```

Both are easy to ship and hard to notice. Seeded rows written in one run share a
timestamp, and the numeric cases are ordinals that stay single-digit for a long
time, so the column looks sorted until real data arrives. Every non-text column
under `src/routes/_authed/admin/` sets this, so a new one that forgets is the
outlier rather than the pattern.

---

## Component patterns

### Status tabs

Use `Tabs`, `TabsList`, `TabsTrigger`, and `TabsContent` from
`#/components/ui/tabs`, not a row of `<button>` elements. The primitive wraps
Radix's `Tabs`, so it gives the tablist real semantics for free: `role="tablist"`,
`aria-selected`, one tab stop for the whole strip, and arrow-key movement between
triggers. A hand-rolled button row has none of that: a screen reader announces
unrelated buttons, and a keyboard user has to tab through every tab individually.

The tab state usually lives in a URL search param, so `Tabs` is controlled:

```tsx
<Tabs
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
when the search schema wants a narrower union. The active trigger still gets the
brand-colored bottom border and the rest go muted, but that styling lives inside
`tabs.tsx` now, keyed off Radix's `data-[state=active]`, rather than being
hand-written at every call site.

### Disabled pagination

Use `pointer-events-none text-muted-foreground/40`, which stays legible in dark mode
where `text-neutral-300` does not.

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
