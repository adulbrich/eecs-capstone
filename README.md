# EECS Capstone App

The Oregon State University EECS Capstone application: browse and propose capstone
projects, run them through a review workflow, and manage shared inventory.

This README covers how to run and develop the app, plus the known issues in what
is built and the roadmap of what is not. For the full, exhaustive feature list
(built and planned), see [`PRD.md`](./PRD.md). For implementation quirks and
gotchas, see [`docs/QUIRKS.md`](./docs/QUIRKS.md). For agent/contributor
conventions, see [`AGENTS.md`](./AGENTS.md).

## Pending

None.

## Known issues

None.

## Roadmap (not yet implemented)

These are the features still on the table. Everything already built is documented
in [`PRD.md`](./PRD.md).

- Preview deployment on AWS: a "Deploy (Preview)" workflow that runs any branch on the same stack as production, with a reset and dev-seeded database, a banner on every page, and labelled email. Specced and ready to build, including per-PR previews as a second phase, in [`docs/superpowers/specs/2026-08-10-preview-deployment-design.md`](./docs/superpowers/specs/2026-08-10-preview-deployment-design.md).
- Check all the nice shadcn/ui components and see if we use them everywhere we can. Audit where we could update the app accordingly. The most important things are that the UI is consistent across the app + accessibility.
- Review the "Improve with AI" feature at the project level (model, prompt, etc.)
- Ability to delete users, admins only (not instructors), behind a confirmation modal. **Delete here means anonymize, not remove.** Nine of the ten `ON DELETE RESTRICT` edges into `user.id` are authorship or audit records (see the FK table in [`docs/QUIRKS.md`](./docs/QUIRKS.md)), so a real `DELETE` fails for anyone who has ever submitted or edited a project. Instead: replace name and email with an id-derived placeholder, drop sessions and linked sign-in accounts, and set a new `deleted_at` on `user`, which has to be added to both `src/db/auth-schema.ts` and `user.additionalFields` in `src/lib/auth.ts`. Authored records stay, attributed to "Deleted user". Linked records need no decision because the schema already made it: proposed projects are unlinked but kept, and bookmarks, cart, collaborator, and program-instructor rows cascade. The modal has to say all of that before it acts, the way the program delete already reports how many projects it will unlink. Two things still open: whether `proposer_email` is scrubbed too, since `claimProjectsForVerifiedUser` re-links projects by address if the person signs up again; and whether anonymized accounts drop out of `/admin/users` by default. Purging a test account outright is a different operation and already built, see "Delete a test account" in [`DEPLOYMENT.md`](./DEPLOYMENT.md).

### Authentication

- Additional SSO providers beyond GitHub: Oregon State University ONID. Nothing
  is built yet and the next step is a request to OSU, not code: what to ask for,
  the paste-able ticket, and what each answer costs to implement are in
  [`docs/ONID-SSO.md`](./docs/ONID-SSO.md).

### Discovery & taxonomy

- Gen-AI category suggestion: auto-suggest the best categories for a project from
  its content.
- Per-type faceted category filtering on the public listing. Category filtering
  exists, but the category types (project type, technology stack, industry,
  field) are not yet broken out into separate, individually filterable facets.

### Project bidding & assignment (stretch)

The `project_bids` and `project_assignments` tables exist, but there is no UI or
server logic yet.

- Students bid on preferred projects (top 5) at the start of the year for a
  specific program, with motivation and qualifications. Bids visible to admins
  and project proposers, not to other students.
- Admins assign students to projects from bids and preferences (automatic or
  manual).

We might need to scrap that because different sections handle project assignment differently. Users can already bookmark favorite projects.

### Analytics dashboard (stretch)

- Charts for project trends and user engagement (projects published per academic
  year, projects submitted per period).
- Customizable date ranges, since "academic year" varies and recruitment starts
  before the academic year does.

### Handbook integration

- The handbook is currently a separate Astro site. Integrate it into this app as
  a set of static pages, linked from the landing page.

## Getting Started

```bash
npm install
docker compose up -d
npm run db:migrate    # nothing applies migrations on boot
npm run dev
```

To stop the database and storage:

```bash
docker compose down
```

### Port conflicts

The stack publishes Postgres on 5432 and RustFS on 9000/9001. If another
project already holds those host ports, the containers still start but silently
publish nothing, and the app talks to the *other* project's services instead:
Postgres fails with `password authentication failed`, while S3 may quietly
accept writes, because the default `rustfsadmin` credentials are the same.

Give this stack its own host ports in `.env` (docker compose reads `.env`, and
**not** `.env.local`), then mirror them in `.env.local`:

```bash
# .env — read by docker compose
POSTGRES_PORT=5433
STORAGE_PORT=9100
STORAGE_CONSOLE_PORT=9101
```

```bash
# .env.local — read by the app and the scripts
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/eecs_capstone"
S3_ENDPOINT=http://localhost:9100
VITE_STORAGE_PUBLIC_BASE=http://localhost:9100/cs-capstone
```

Then `docker compose up -d --force-recreate`. Confirm the ports actually bound
with `docker compose ps` and check the publishers column is not empty.

To build for production:

```bash
npm run build
```

## Architecture

This is a TanStack Start app (React SSR) with TanStack Router (file-based routes
in `src/routes`), TanStack Query, Drizzle ORM on PostgreSQL, Better Auth, and
S3-compatible object storage (RustFS locally). UI is shadcn/ui + Radix.

A few conventions worth knowing before you contribute:

- The project workflow state machine (`src/lib/project-workflow.ts`) and
  visibility rules (`src/lib/project-visibility.ts`) are pure modules. Keep
  business logic there, not in routes.
- A project's proposer is `proposer_id` when an account exists and
  `proposer_email` otherwise. Staff cannot retype a linked address directly;
  the edit form routes that through a re-assign modal (see
  [`docs/QUIRKS.md`](./docs/QUIRKS.md)).
- Every project/comment/inventory mutation is one server function in
  `src/server/`, each enforcing its own gate and wrapping writes in a
  transaction. The companion `*As(viewer, ...)` helpers next to each
  `createServerFn` let integration tests exercise business logic directly,
  without the HTTP layer.
- Forms with more than two fields use [TanStack Form](https://tanstack.com/form)
  with Zod validators shared with the server. Server-thrown `ZodError` is mapped
  back to field-level errors via `src/lib/apply-server-errors.ts`.
- Full-text search uses a Postgres generated `tsvector` column with a GIN index.
  To change field weights, drop and re-add the column in a new migration (see
  [`docs/QUIRKS.md`](./docs/QUIRKS.md)).
- Interest-based recommendations use pgvector. Projects are embedded only on
  publish and re-embedded when a published project's indexed text changes; see
  `src/server/_internal/project-embeddings.ts`, the single writer of every
  vector. `npm run embeddings:backfill` is the safety net.
- All filter/search state lives in URL search params so links are shareable.

## Authentication setup (Better Auth)

This project uses Better Auth backed by Drizzle + Postgres. Identity lives in the
`user`, `session`, `account`, and `verification` tables (generated by Better
Auth's CLI into `src/db/auth-schema.ts` and re-exported from `src/db/schema.ts`).

1. Copy `.env.example` to `.env.local` and fill in values.
1. Generate a Better Auth secret if you don't have one:

   ```bash
   npx -y @better-auth/cli secret
   ```

1. Register a GitHub OAuth App at <https://github.com/settings/developers> with
   callback `http://localhost:3000/api/auth/callback/github`, then put the
   credentials into `.env.local`.
1. Start Postgres and run the dev server:

   ```bash
   docker compose up -d
   npm run dev
   ```

1. Seed your dev database (safe to re-run):

   ```bash
   npm run db:seed:dev
   ```

   In production, seed an admin user (configured via environment variables).

> Keep at least two `admin` users in production. The self-action guard prevents a
> sole admin from accidentally demoting or banning themselves into a one-way
> trap. Use `npm run db:seed:admin` or a direct `db:studio` edit to bootstrap the
> second admin.

### Changing the Better Auth schema

`src/db/auth-schema.ts` is **hand-maintained**. Do not run `@better-auth/cli
generate` against it: that package lags the library (the CLI is stuck on 1.4.x
while we run `better-auth` 1.6.x), and its output silently drops the
timezone-aware timestamps, the session/account/verification indexes, and the
`role` NOT NULL default that this file carries. Running it would produce a
destructive migration.

To add or change a Better Auth `additionalField`:

1. Add the field to `user.additionalFields` in `src/lib/auth.ts` (this is what
   Better Auth reads at runtime).
2. Add the matching column to the `user` table in `src/db/auth-schema.ts` by
   hand, with the correct type and a DB default (so existing rows backfill).
3. Generate and apply the migration, reviewing the SQL to confirm it only adds
   your column:

   ```bash
   npm run db:generate
   npm run db:migrate
   ```

If the `@better-auth/cli` package ever catches up to the installed `better-auth`
version, this file could return to CLI generation; until then, edit it directly.

### Email transport

`EMAIL_TRANSPORT` selects the sender behind the `EmailSender` interface in
`src/lib/email/sender.ts`:

- `console` (the default, and what local development uses): every email below is
  written to the server's stderr instead of being sent, review notices included.
- `ses`: real outbound mail through AWS SES v2 (`src/lib/email/ses-sender.ts`),
  which additionally requires `EMAIL_FROM` to be a verified sender identity.
  `EMAIL_REPLY_TO` is optional: set it and every message carries that
  `Reply-To`, leave it blank and the header is omitted.

The app sends four emails, all through `src/lib/email/templates.ts`:

| Email | Trigger | Recipient |
|---|---|---|
| Verify your email | Sign-up | The new account |
| Reset your password | Forgot-password form | The account |
| New project submitted | A project moves to `submitted` | `EMAIL_REVIEW_INBOX` |
| Approved / Changes requested | Staff review a project | The proposer |

Everything else the app notifies about is in-app only, a row in `notifications`
rendered by the bell, and never reaches an inbox. Staff can skip either review
email per action from the transition dialog.

Production runs `ses` and has done since task definition revision 22: the domain
identity verifies with DKIM `SUCCESS`, the account has production access (so the
sandbox recipient restriction no longer applies), and mail sends From
`noreply@capstone.eecs.oregonstate.edu`.

`EMAIL_FROM` must align with the verified identity or DKIM fails, which is why
both it and `var.domain_name` derive from the same variable in `infra/ecs.tf`.
It is also not optional under `ses`: `getEmailSender()` runs at module scope in
`src/lib/auth.ts`, so a missing `EMAIL_FROM` throws during import and stops the
app booting rather than merely stopping its email. Terraform always writes the
two into the same task definition revision, which is why the transport must
never be flipped by hand in the ECS console. `EMAIL_REPLY_TO` is not
DKIM-aligned and so carries an ordinary OSU mailbox,
`eecs-capstone@oregonstate.edu`.

## Object storage

Images live in an S3-compatible bucket (RustFS locally, AWS S3 in production).

```bash
docker compose up -d rustfs
npm run storage:init    # idempotent
```

Production note: configure the bucket as public-read at the bucket policy level on
AWS, or run with `S3_ENDPOINT` set to your CDN base. Set
`VITE_STORAGE_PUBLIC_BASE` to the customer-facing URL prefix.

## AI-assisted proposal review

The project form can request per-field improvement suggestions, backed by AWS
Bedrock. Set `BEDROCK_MODEL_ID` (and the relevant AWS credentials) to configure
the model.

## Testing

This project uses [Vitest](https://vitest.dev/).

```bash
npm run test
```

The auth and server surfaces have integration tests that hit the docker-compose
Postgres:

```bash
npm run test:integration
```

Each test starts from a TRUNCATEd database, so they share a single fork and run
serially. They read the schema as it exists, so run `npm run db:migrate` after
pulling a migration or every one of them fails on the missing column.

Accessibility is checked separately, with Playwright and axe against the running
app (the config starts `npm run dev` itself, or reuses one already listening on
port 3000):

```bash
npm run test:accessibility
```

> TODO (future): integration tests currently run against the same database as
> dev and TRUNCATE every table before each test, which wipes dev data. Point them
> at a dedicated `eecs_capstone_test` database via a separate `TEST_DATABASE_URL`.
> See the Drizzle section of [`docs/QUIRKS.md`](./docs/QUIRKS.md) for details.

## Linting & Formatting

This project uses [Ultracite](https://www.ultracite.ai/) (Biome under the hood).

```bash
npm run lint
npm run format
npm run check
```

Always run `npm run check` after finishing work and fix any issues before
committing.

## UI components (shadcn)

Add components using the latest version of [shadcn](https://ui.shadcn.com/):

```bash
npx shadcn@latest add button
```

## Deploy to AWS

Production runs on AWS, provisioned with Terraform (`infra/`) and deployed via a
one-click GitHub Actions workflow (`.github/workflows/deploy.yml`):

- **Compute**: a single arm64 ECS Fargate task running the app's multi-stage
  Docker image.
- **Ingress**: CloudFront is the only public entry point, serving HTTPS at
  `capstone.eecs.oregonstate.edu` (`var.domain_name`). Two DNS records live in
  the OSU-managed `eecs.oregonstate.edu` zone rather than in this Terraform
  configuration: one validating the ACM certificate, and one pointing the
  hostname at the CloudFront distribution. That is why the certificate is a
  read-only `data` lookup in `infra/cloudfront.tf` instead of a managed
  resource. CloudFront reaches an internal Application Load Balancer through a
  VPC origin, so the ALB itself has no public IP.
- **Data**: a private RDS Postgres instance and a private S3 bucket for
  uploaded images, the latter served through its own CloudFront distribution
  via Origin Access Control.
- **Images/build**: ECR holds built images; the deploy workflow builds
  natively on an arm64 GitHub-hosted runner (matching the Fargate
  architecture), pushes to ECR, runs migrations as a one-off ECS task, then
  rolls the service.
- **Secrets/config**: app credentials come from the ECS task role (no static
  AWS keys); secrets live in Secrets Manager, non-secret config in the task
  definition and SSM.

See [`DEPLOYMENT.md`](./DEPLOYMENT.md) for the full operational runbook
(first-time setup through teardown) and [`infra/README.md`](./infra/README.md)
for the Terraform specifics.
