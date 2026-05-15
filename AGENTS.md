# AI Agent Instructions

This project is a TanStack Start application with React SSR, TanStack Query, TanStack Router, Drizzle ORM, and Better Auth.

## Quick Start

```bash
# Install dependencies
npm install

# Start local PostgreSQL database
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

This project uses Biome for formatting and linting. Always run `npm check` before committing.

## Configuration

- `biome.json` - Biome configuration
- `drizzle.config.ts` - Drizzle configuration
- `vite.config.ts` - Vite configuration
- `tsconfig.json` - TypeScript configuration