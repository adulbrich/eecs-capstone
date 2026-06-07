# AI Agent Instructions

This project is a TanStack Start application with React SSR, TanStack Query, TanStack Router, Drizzle ORM, and Better Auth. Object storage is handled with S3-compatible RustFS locally. The UI is built with shadcn/ui components and Radix primitives.

## Quick Start

```bash
# Install dependencies
npm install

# Start local PostgreSQL database and S3 storage
docker compose up -d

# Start development server
npm run dev
```

To stop the database:

```bash
docker compose down
```

## Key Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server on port 3000 |
| `npm run build` | Build for production |
| `npm run db:generate` | Generate Drizzle migrations |
| `npm run db:migrate` | Run Drizzle migrations |
| `npm run db:push` | Push schema to database |
| `npm run db:studio` | Open Drizzle Studio |
| `npm run format` | Format with Ultracite (`ultracite fix`) |
| `npm run lint` | Lint with Ultracite (`ultracite check`) |
| `npm run check` | Run Ultracite checks |
| `npm run typecheck` | Type-check with `tsc --noEmit` |
| `npm test` | Run Vitest tests |

## Architecture

- **Routing**: TanStack Router with SSR (`src/router.tsx`, `src/routes/`)
- **Data fetching**: TanStack Query with SSR integration (`src/integrations/tanstack-query/`)
- **Auth**: Better Auth (`src/lib/auth.ts`, `src/integrations/better-auth/`)
- **Database**: Drizzle ORM with PostgreSQL (`src/db/schema.ts`)
- **UI**: shadcn/ui components with Radix primitives (`src/components/ui/`)

## Database

Database schema is defined in `src/db/schema.ts`. Use Drizzle commands to manage migrations:

```bash
npm run db:generate
npm run db:migrate
```

## UI Components

Use shadcn/ui with the `npx shadcn@latest add <component>` command. Existing components are in `src/components/ui/`.

## Server functions

Always import `createServerFn` from `@tanstack/react-start`, not `@tanstack/start`:

```ts
import { createServerFn } from "@tanstack/react-start";
```

## Code Quality

This project uses **Ultracite** (a strict Biome preset) for formatting and linting.

- `npm run check` runs `ultracite check` (read-only); `npm run format` runs `ultracite fix`.
- `npm run typecheck` runs `tsc --noEmit`. Config lives in `biome.json`, extending `ultracite/biome/core` and `ultracite/biome/react`.
- Always run `npm run check` and `npm run typecheck` after finishing work, and fix issues before committing. CI (`.github/workflows/ci.yml`) enforces check, typecheck, test, and build.
- See `docs/QUIRKS.md` for the rules that are deliberately disabled, relaxed in tests, or deferred, and why.

## Library documentation

The stack moves fast (TanStack Start is pre-v1, Better Auth 1.5.x, Drizzle 0.45). Prefer the **context7** MCP server for current, version-accurate docs on these libraries rather than relying on training data. `docs/QUIRKS.md` is the ground truth for this codebase's specific gotchas.

## Configuration

- `biome.json` - Biome configuration
- `drizzle.config.ts` - Drizzle configuration
- `vite.config.ts` - Vite configuration
- `tsconfig.json` - TypeScript configuration

## UI Component Guidelines

### Brand and design system

The design system is defined in `src/lib/brand.ts` (single file for multi-institution portability) and `src/styles.css` (CSS custom properties). The primary brand color is Beaver Orange (`#D73F09`). Never hardcode hex colors in components; always reference CSS custom properties or Tailwind token aliases.

### Button usage: always use `<Button>`

Use the shadcn `Button` component from `#/components/ui/button` (or `./ui/button` within components) for **all interactive actions**. Never write raw `<button className="bg-brand ...">` or `<button className="border ...">`.

| Variant | Use when |
|---|---|
| `default` | Primary CTA (Submit, Save, Create, Sign in, Sign up) |
| `outline` | Secondary actions (Cancel, Edit, Sign out, Withdraw) |
| `ghost` | Tertiary / low-emphasis (Reply, Remove in lists) |
| `destructive` | Irreversible danger (Delete, Ban) |
| `link` | Inline text links that look like buttons |

Size guidance: `size="sm"` for most contextual buttons; `size="default"` for standalone form submits; `size="lg"` for hero/landing CTAs; `size="xs"` for inline micro-actions (Post reply, Cancel reply).

### Links that look like buttons: use `asChild`

When a navigation link needs button styling, use `asChild` to merge the Button styles onto the `<Link>` without nesting DOM elements:

```tsx
// Correct
<Button asChild size="sm">
  <Link to="/projects/new">New project</Link>
</Button>

// Wrong — do not do this
<Link to="/projects/new" className="bg-brand px-3 py-1.5 text-white rounded">
  New project
</Link>
```

### Links that are plain navigation

Nav links (Projects, My projects, Admin) use the `.nav-link` CSS class defined in `styles.css`. They get the brand-colored underline animation on hover/active. Do not use `.nav-link` on buttons.

### Form inputs: always use shadcn components

Use `<Input>`, `<Textarea>`, and `<Label>` from `#/components/ui/` for all form fields. Wrap label+input pairs with `space-y-1.5` for consistent vertical rhythm:

```tsx
<div className="space-y-1.5">
  <Label htmlFor="email">Email</Label>
  <Input id="email" name="email" type="email" required />
</div>
```

Never use raw `<input className="w-full border p-2">` or `<textarea className="w-full border p-2">`.

### Color tokens: use semantic Tailwind classes or CSS variables

| Instead of | Use |
|---|---|
| `text-neutral-500` | `text-muted-foreground` |
| `border-neutral-200`, `border-neutral-300` | `border-border` |
| `bg-neutral-50`, `bg-neutral-100` | `bg-secondary` |
| `bg-white` | `bg-card` |
| `text-red-600`, `text-red-700` | `text-destructive` |
| `text-blue-700` on links | Remove — the global `a` style handles it |
| `bg-blue-50` for highlights | `bg-[var(--brand-primary-tint)]` |
| `dark:bg-neutral-900` | `dark:bg-card` |
| `dark:border-neutral-800` | `dark:border-border` |

For status colors not covered by Tailwind aliases, use CSS variables directly:
- Success: `style={{ color: "var(--status-success)" }}`
- Warning: `style={{ color: "var(--status-warning)" }}`

### Border radius

All interactive elements use `rounded-md` (8px) consistently — this is the default in the Button and Input components. Cards and panels use `rounded-lg` or `rounded-xl`. Chips/badges use `rounded`. Avatars use `rounded-full`.

### Auth pages

Auth forms (sign-in, sign-up, forgot-password, reset-password) are wrapped in an `island-shell` card centered on the page:

```tsx
<div className="flex min-h-[calc(100vh-3.5rem)] items-start justify-center px-4 pt-12 pb-20">
  <div className="island-shell w-full max-w-sm rounded-xl p-8">
    ...
  </div>
</div>
```

### Status tabs

Active status tabs use a brand-colored bottom border, not `border-black`:

```tsx
className={s === status ? "border-b-2 px-2 py-1 font-medium" : "px-2 py-1 text-muted-foreground hover:text-foreground"}
style={s === status ? { borderBottomColor: "var(--brand-primary)" } : undefined}
```

### Pagination disabled state

Disabled pagination links use `pointer-events-none text-muted-foreground/40`, not `text-neutral-300`.

## Mobile-First Design

This project is mobile-first. Write styles for small screens first, then add `md:` (768px+) overrides. Avoid `sm:` breakpoint overrides -- we use a two-tier system: mobile and desktop.

### Page wrapper padding

Every route page root element uses responsive padding:

```tsx
<div className="mx-auto max-w-4xl px-4 py-6 md:p-8">
```

`px-4 py-6` gives comfortable touch-screen margins. `md:p-8` expands to the desktop-standard 32px all-around. Never use `p-8` alone on a page wrapper.

### Interactive element height

All inline form controls share `h-9` (36px) so adjacent elements align without magic numbers:

| Component | How |
|---|---|
| `<Input>` | shadcn default is `h-9` |
| `<Select>` (`<SelectTrigger>`) | shadcn default is `h-9` |
| `<Button size="default">` | shadcn default is `h-9` |
| `<ViewToggle>` | explicit `h-9` in component |

When adding new controls that appear inline with an Input or Select, explicitly set `h-9` to stay aligned.

### Mobile navigation

The header uses a two-layout pattern. Desktop and mobile nodes both live in `SiteHeader` but only one is rendered at a time:

```tsx
{/* Desktop -- hidden on mobile */}
<div className="hidden md:flex h-14 ...">...</div>

{/* Mobile -- hidden on desktop */}
<div className="flex h-14 md:hidden ...">...</div>
```

The mobile layout uses a **shadcn Sheet** (`side="left"`) as the navigation drawer, triggered by a hamburger `<Button variant="ghost">`. The Sheet is focus-trapped and accessible (Radix Dialog under the hood). Key rules:

- Call `setOpen(false)` on every `<Link>` click so the drawer closes after navigation.
- Keep the `SheetHeader` with a visible title (`Navigation`) for screen readers.
- Notification bell renders outside the Sheet, directly in the mobile header bar, so it's always reachable.

```tsx
<Sheet open={open} onOpenChange={setOpen}>
  <SheetTrigger asChild>
    <Button variant="ghost" size="sm" aria-label="Open navigation">
      <Menu className="h-5 w-5" />
    </Button>
  </SheetTrigger>
  <SheetContent side="left" className="w-72 p-0">
    ...
  </SheetContent>
</Sheet>
```

### Admin tables on mobile

Admin tables (`<AdminTable>`) use the CSS `data-label` card pattern -- no JavaScript, no duplicated markup. On mobile, each row becomes a card and each cell shows its column heading inline.

**Step 1 -- add `data-label` to every `<td>` that has a column heading:**

```tsx
<td data-label="Name" className="border border-border p-2">{row.name}</td>
<td data-label="Type" className="border border-border p-2 text-muted-foreground">{row.type}</td>
<td className="border border-border p-2">  {/* action cell -- no label */}
  <Link to="...">Edit</Link>
</td>
```

**Step 2 -- the `.admin-table` CSS class** (defined in `src/styles.css`) handles the rest automatically at `max-width: 767px`. It hides the `<thead>`, turns each `<tr>` into a card, and injects the label as a `::before` pseudo-element using `content: attr(data-label)`.

Never use a `<table>` inside an admin page without wrapping it in `<AdminTable>` and adding `data-label` attributes.

### Responsive steppers

Multi-step progress indicators (like the staff status stepper) use a two-axis layout:

```tsx
{/* One item: vertical stack on mobile, horizontal row on desktop */}
<div className="flex flex-col md:flex-row md:items-center">
  {i > 0 && (
    <>
      {/* Connector line -- vertical on mobile */}
      <div aria-hidden className="ml-3.5 h-4 w-px bg-border md:hidden" />
      {/* Connector line -- horizontal on desktop */}
      <div aria-hidden className="hidden h-px w-5 bg-border md:block" />
    </>
  )}
  <button ...>{label}</button>
</div>
```

The connector renders as a sibling of the pill button inside a `flex-col` container. On mobile the connector appears above the pill (vertical track). On desktop `md:flex-row` puts the connector to the left (horizontal track). The outer stepper container uses `md:overflow-x-auto` for long status lists.

### Select with empty / "all" sentinel

Radix UI `SelectItem` does not accept `value=""`. When a Select needs an "All" / unset option, use the `"_all_"` sentinel and convert it at the call site:

```tsx
<Select
  value={filter ?? "_all_"}
  onValueChange={(v) => setFilter(v === "_all_" ? null : v)}
>
  <SelectTrigger className="h-9 w-full">
    <SelectValue placeholder="All" />
  </SelectTrigger>
  <SelectContent>
    <SelectItem value="_all_">All</SelectItem>
    {items.map((item) => (
      <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
    ))}
  </SelectContent>
</Select>
```