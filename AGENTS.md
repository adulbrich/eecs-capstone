# AI Agent Instructions

This project is a TanStack Start application with React SSR, TanStack Query, TanStack Router, Drizzle ORM, and Better Auth. Object storage is handled with S3-compatible RustFS locally. The UI is built with shadcn/ui components and Radix primitives.

## Quick Start

```bash
# Install dependencies
npm install

# Start local PostgreSQL database and S3 storage
docker compose up -d

# Start development server
npm dev
```

To stop the database:

```bash
docker compose down
```

## Key Commands

| Command | Description |
|---------|-------------|
| `npm dev` | Start dev server on port 3000 |
| `npm build` | Build for production |
| `npm db:generate` | Generate Drizzle migrations |
| `npm db:migrate` | Run Drizzle migrations |
| `npm db:push` | Push schema to database |
| `npm db:studio` | Open Drizzle Studio |
| `npm format` | Format with Biome |
| `npm lint` | Lint with Biome |
| `npm check` | Run Biome checks |
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
npm db:generate
npm db:migrate
```

## UI Components

Use shadcn/ui with the `npm dlx shadcn@latest add <component>` command. Existing components are in `src/components/ui/`.

## Code Quality

This project uses Biome for formatting and linting. Always run `npm run check` after finishing work and fix any formatting or linting issues before committing.

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