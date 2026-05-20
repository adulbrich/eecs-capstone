# CS Capstone App

## Features

### Authentication

- User can sign up, log in, and log out.
- User types: regular user, and admin.
  - Consider adding an instructor type that has some admin privileges but not all (e.g. can manage projects and programs, but not users or categories).
- Log in with email/password, Google SSO, GitHub SSO, LinkedIn SSO, Discord, or Oregon State University ONID SSO.
- Password reset functionality.
- Email verification after sign up.
- Users can update their profile information and change their password.

### Project Management

- Projects have (at least): random uuid, title, description, problem statement, objectives/deliverables, minimum and preferred qualifications, url, contact information, image, license or IP restrictions, project proposer, program, program manager (main instructor), notes (not publicly visible).
- Programs are course ID + course name + instructors (usernames of admins).
- Users can view published projects.
- Users can filter projects by full text search accross all project fields, by category, and by program.
- Users can submit new projects for review.
- Users that created/proposed/submitted projects can see, edit, or delete them (draft project are deleted for good, other statuses are soft-deleted).
- Admins can review and publish submitted projects.
- Admins can archive published projects.
- Admins can soft delete projects (mark as deleted without actually removing them from the database). The soft-deleted projects don't show up for users, but admins can see them in a separate view and restore them if needed.
- Project have various phases/statuses: draft, submitted, approved (not published), changes requested, published, archived.
- Users can change projects from draft to submitted, or from change requested to submitted, or from submitted back to draft.
- Admins can change all statuses.
- Admins can add comments when reviewing projects, and users can reply to those comments if the status goes back to change requested.
- Admins can leave internal comments (for other admins, invisible to users).
- Logs should be kept for project status changes, comments, and edits.
- Users can browse published projects, but also see their own created/submitted projects in a separate view.
- Users can edit their profile information (name, email, password, affiliation, linkedin, profile picture, etc.) and see their account details (user type).
- Admins have access to an admin view to manage projects, programs, users, ctageories (can be 4 separate views or a single view with tabs).
- Categories/tags can only be added by admins on projects, can be managed separately, and we could use Gen AI to find the best categories for a project based on its content.
  - We could consider different type of categories (project type, technology stack, industry, field, etc.) and allow filtering by each of them.

### Project Bidding and Assignment (Stretch)

- (Stretch) Students can bid on preferred projects (top 5) at the beginning of the year, for a specific program, with motivation and qualifications. Bids are visible to admins and project proposers, but not to other students.
- (Stretch) Admins can assign students to projects based on their bids and project preferences (automatically or manually).

### Inventory Management

- Users can browse inventory items.
- Admins can add, edit, and delete inventory items.
- Users can request inventory items (with a cart functionality).
- Admins can approve or reject inventory requests.
- Logs should be kept for inventory changes and requests.

### Index Page

- The index page should explain what the CS Capstone is, and link to Projects/Inventory/Handbook. Right now the handbook is a separate Astro website, but we could consider integrating it into this app as a set of static pages.

## Improvements

## Current Bugs

- On the admin page, the "Users" link should not show for instructors.

## Getting Started

To run this application:

```bash
npm install
docker compose up -d
npm run dev
```

To stop the database:

```bash
docker compose down
```

To build this application for production:

```bash
npm run build
```

## Testing

This project uses [Vitest](https://vitest.dev/) for testing. You can run the tests with:

```bash
npm run test
```

## Styling

This project uses [Tailwind CSS](https://tailwindcss.com/) for styling.

### Removing Tailwind CSS

If you prefer not to use Tailwind CSS:

1. Remove the demo pages in `src/routes/demo/`
2. Replace the Tailwind import in `src/styles.css` with your own styles
3. Remove `tailwindcss()` from the plugins array in `vite.config.ts`
4. Uninstall the packages: `npm install @tailwindcss/vite tailwindcss -D`

## Linting & Formatting

This project uses [Biome](https://biomejs.dev/) for linting and formatting. The following scripts are available:

```bash
npm run lint
npm run format
npm run check
```

Always run `npm run check` after finishing work and fix any formatting or linting issues before committing.

## Deploy to Railway

This project ships with `nixpacks.toml` so Railway detects the build automatically:

1. Push this repo to GitHub
2. Visit https://railway.com/new and create a project from your repo
3. In the **Variables** tab, add the entries from `.env.example` with their production values
4. Railway runs `vite build` and serves from `dist/client`

Need a database? Click **+ New** in your project to provision Postgres, MySQL, or Redis directly into the same environment — the connection string is auto-injected as `DATABASE_URL`.


## Shadcn

Add components using the latest version of [Shadcn](https://ui.shadcn.com/).

```bash
pnpm dlx shadcn@latest add button
```

## Setting up Better Auth

This project uses Better Auth backed by Drizzle + Postgres. Identity lives in the `user`, `session`, `account`, and `verification` tables (generated by Better Auth's CLI into `src/db/auth-schema.ts` and re-exported from `src/db/schema.ts`).

1. Copy `.env.example` to `.env.local` and fill in values.
1. Generate a Better Auth secret if you don't have one:

   ```bash
   npx -y @better-auth/cli secret
   ```

1. Register a GitHub OAuth App at <https://github.com/settings/developers> with callback `http://localhost:3000/api/auth/callback/github`, then put the credentials into `.env.local`.
1. Start Postgres and run the dev server:

   ```bash
   docker compose up -d
   npm run dev
   ```

1. Seed an admin user:

   ```bash
   npx tsx scripts/seed-admin.ts
   ```

   Reads `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` from `.env.local`. Safe to re-run.

### Email transport

Email verification and password-reset URLs are written to the server's stderr via a console transport (`EMAIL_TRANSPORT=console`). Real outbound email (Resend, SES) is a future swap behind the `EmailSender` interface in `src/lib/email/sender.ts`.

### Regenerating the Better Auth schema

If you change Better Auth plugins or `additionalFields`, regenerate:

```bash
npx -y @better-auth/cli generate --config src/lib/auth.ts --output src/db/auth-schema.ts
npm run db:generate
npm run db:migrate
```

Never hand-edit `src/db/auth-schema.ts`; it is overwritten by the CLI. The `affiliation` and `linkedin` columns are restored automatically because they live in `user.additionalFields` in `src/lib/auth.ts`.

### Integration tests

The auth surface has integration tests that hit the docker-compose Postgres:

```bash
npm run test:integration
```

Each test starts from a TRUNCATEd database, so they share a single fork and run serially.

## Project domain (Spec 2)

The `/projects` URL space is the canonical surface for the project domain:

- `/projects`: public list of published projects.
- `/projects/$id`: canonical project detail. Staff sections (notes, internal comments, edit log, transition actions) appear conditionally when the viewer is staff.
- `/projects/new` and `/projects/$id/edit`: authed-only via the `_authed` layout.
- `/my/projects`: the signed-in user's own projects with a status filter.
- `/admin/projects`: staff list view with filters and an include-soft-deleted toggle.

The workflow state machine lives in `src/lib/project-workflow.ts` as a pure module. The visibility rules live in `src/lib/project-visibility.ts`, also pure. Every project mutation is one server function in `src/server/projects.ts` or `src/server/comments.ts`, each enforcing its own gate and wrapping writes in a transaction. The companion `*As(viewer, ...)` helpers next to each `createServerFn` let integration tests exercise the business logic directly without going through the HTTP layer.

Forms with more than 2 fields use [TanStack Form](https://tanstack.com/form) with Zod validators, sharing schemas with the server. Server-thrown `ZodError` is mapped back to field-level errors via `src/lib/apply-server-errors.ts`.

## Discovery + taxonomy (Spec 3)

The `/projects` URL space supports full-text search (over title, description, problem statement, objectives, and qualifications), plus filters for program and category. All filter state lives in URL search params so links are shareable.

Admin pages:

- `/admin/categories`: create / edit / delete categories. Each category has a `type` (free text; admin form suggests existing types as autocomplete). Categories assigned to projects only by staff.
- `/admin/programs`: create / edit / delete programs, manage per-program instructors (drawn from users with role `admin` or `instructor`).

User-facing:

- Bookmark button on the project detail page (authed only).
- `/my/bookmarks`: the signed-in user's bookmarked projects.
- Project form: the Program field is a real dropdown for everyone; staff additionally see a category multi-select.

The full-text search uses a Postgres generated `tsvector` column on `projects` with a GIN index. To change field weights, drop and re-add the column in a new migration (see `docs/QUIRKS.md`).

## User admin (Spec 4)

The `/admin/users` URL is admin-only (instructors are redirected to `/admin`). It lists every user with text search (email + name), role filter, and an include-banned toggle. The detail page at `/admin/users/$id` shows a profile block, project + bookmark counts, the user's five most recent projects, a role select, and a ban form.

Admins cannot change their own role or ban themselves; the server refuses self-actions. Ban atomically updates the user row and revokes that user's sessions in the same transaction, so the banned user is signed out on their next request.

Production note: keep at least two `admin` users. The self-action guard prevents a sole admin from accidentally demoting themselves into a one-way trap. Use `npm run db:seed:admin` or a direct `db:studio` edit to bootstrap the second admin.

## Media + revised listing (Spec 5)

Images are stored in an S3-compatible bucket (RustFS locally, AWS S3
in production). Project images and user avatars are uploaded via a
client-side crop + canvas-resize pipeline so the network payload is
~150-400KB regardless of source file size. The server runs Sharp on the
already-small upload to strip EXIF and re-encode WebP at consistent
quality.

Storage rows hold *keys* (`projects/<id>/<uuid>.webp`,
`avatars/<userId>/<uuid>.webp`), not URLs. The `getPublicUrl(key)`
helper builds the rendered URL with a pass-through for legacy
`http(s)://` values so existing rows (DiceBear identicons, OAuth
images) keep rendering.

Bucket setup (local):

```bash
docker compose up -d rustfs
npm run storage:init    # idempotent
```

The `/projects` listing has a `?view=card|row` URL toggle. Card mode
(default) renders a 16:9 image at the top of each tile; row mode
renders an 80x80 thumbnail at the left of each line. Filters and
search still apply identically in both modes.

Production note: configure the bucket as public-read at the bucket
policy level on AWS, or run with `S3_ENDPOINT` set to your CDN base.
Set `VITE_STORAGE_PUBLIC_BASE` to the customer-facing URL prefix.

## Routing

This project uses [TanStack Router](https://tanstack.com/router) with file-based routing. Routes are managed as files in `src/routes`.

### Adding A Route

To add a new route to your application just add a new file in the `./src/routes` directory.

TanStack will automatically generate the content of the route file for you.

Now that you have two routes you can use a `Link` component to navigate between them.

### Adding Links

To use SPA (Single Page Application) navigation you will need to import the `Link` component from `@tanstack/react-router`.

```tsx
import { Link } from "@tanstack/react-router";
```

Then anywhere in your JSX you can use it like so:

```tsx
<Link to="/about">About</Link>
```

This will create a link that will navigate to the `/about` route.

More information on the `Link` component can be found in the [Link documentation](https://tanstack.com/router/v1/docs/framework/react/api/router/linkComponent).

### Using A Layout

In the File Based Routing setup the layout is located in `src/routes/__root.tsx`. Anything you add to the root route will appear in all the routes. The route content will appear in the JSX where you render `{children}` in the `shellComponent`.

Here is an example layout that includes a header:

```tsx
import { HeadContent, Scripts, createRootRoute } from '@tanstack/react-router'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'My App' },
    ],
  }),
  shellComponent: ({ children }) => (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <header>
          <nav>
            <Link to="/">Home</Link>
            <Link to="/about">About</Link>
          </nav>
        </header>
        {children}
        <Scripts />
      </body>
    </html>
  ),
})
```

More information on layouts can be found in the [Layouts documentation](https://tanstack.com/router/latest/docs/framework/react/guide/routing-concepts#layouts).

## Server Functions

TanStack Start provides server functions that allow you to write server-side code that seamlessly integrates with your client components.

```tsx
import { createServerFn } from '@tanstack/react-start'

const getServerTime = createServerFn({
  method: 'GET',
}).handler(async () => {
  return new Date().toISOString()
})

// Use in a component
function MyComponent() {
  const [time, setTime] = useState('')
  
  useEffect(() => {
    getServerTime().then(setTime)
  }, [])
  
  return <div>Server time: {time}</div>
}
```

## API Routes

You can create API routes by using the `server` property in your route definitions:

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'

export const Route = createFileRoute('/api/hello')({
  server: {
    handlers: {
      GET: () => json({ message: 'Hello, World!' }),
    },
  },
})
```

## Data Fetching

There are multiple ways to fetch data in your application. You can use TanStack Query to fetch data from a server. But you can also use the `loader` functionality built into TanStack Router to load the data for a route before it's rendered.

For example:

```tsx
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/people')({
  loader: async () => {
    const response = await fetch('https://swapi.dev/api/people')
    return response.json()
  },
  component: PeopleComponent,
})

function PeopleComponent() {
  const data = Route.useLoaderData()
  return (
    <ul>
      {data.results.map((person) => (
        <li key={person.name}>{person.name}</li>
      ))}
    </ul>
  )
}
```

Loaders simplify your data fetching logic dramatically. Check out more information in the [Loader documentation](https://tanstack.com/router/latest/docs/framework/react/guide/data-loading#loader-parameters).

# Demo files

Files prefixed with `demo` can be safely deleted. They are there to provide a starting point for you to play around with the features you've installed.

# Learn More

You can learn more about all of the offerings from TanStack in the [TanStack documentation](https://tanstack.com).

For TanStack Start specific documentation, visit [TanStack Start](https://tanstack.com/start).
