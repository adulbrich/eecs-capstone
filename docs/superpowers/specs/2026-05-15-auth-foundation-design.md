# Spec 1: Auth Foundation

**Date:** 2026-05-15
**Status:** Draft (pending user review)
**Author:** Alexander Ulbrich (with Claude)
**Supersedes:** N/A
**Next spec:** Spec 2 (Project Management), to be written after Spec 1 is implemented.

## 1. Purpose

Establish a single, durable source of truth for user identity in the CS Capstone app. Wire Better Auth into the Drizzle / Postgres stack, ship a small but real set of sign-in methods (email + password, GitHub), enable email verification and password reset end to end via a swappable console-email transport, define three roles with route guards, and harden the parts of the database schema that touch the user table. All work is sized to run identically on local Docker, Railway (testing), and AWS (production).

Spec 2 will build project management features on top of this foundation.

## 2. Goals

1. Better Auth tables (`user`, `session`, `account`, `verification`) are the only place identity lives. The existing custom `users` table is removed.
2. v1 sign-in methods: email + password, GitHub OAuth.
3. Email verification on sign-up and password reset both work end to end. The email sender is an interface; the v1 implementation logs links to stderr.
4. Three roles via Better Auth's `admin` plugin: `user` (default), `instructor`, `admin`.
5. Route-level guards in TanStack Router using `beforeLoad`. Server functions independently re-check auth.
6. Schema hardening for every table that references the user, including FK cascade rules, composite primary keys on junction tables, timestamps with time zone, and the indexes Better Auth needs.
7. `.env.example` checked in. The same key names work on every environment.
8. Idempotent seed script that promotes a designated email to `admin`.
9. Test coverage for guards and a happy-path integration test for the sign-up to sign-in to profile-edit flow.

## 3. Non-Goals (deferred)

- Project CRUD, status workflow, project comments, full-text search, image uploads, S3 abstraction (all in Spec 2).
- Inventory and bidding flows (post-MVP).
- Real outbound email (Resend, SES). The console transport stays until a later spec swaps it in.
- Profile picture upload. v1 uses the OAuth-provided `image` for GitHub users and a deterministic DiceBear identicon URL for email/password users.
- Additional OAuth providers (Google / OSU ONID, LinkedIn, Discord). These are non-breaking to add later since they all live in the same `account` table.
- CAPTCHA. If we add one later, it must not be a Google service (see Section 13).

## 4. Architecture

### 4.1 Server modules

| Path                              | Responsibility                                                                                                                                                                                                                                                              |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/auth.ts`                 | Better Auth instance. Wires the Drizzle adapter, the `tanstackStartCookies()` plugin, the `admin({ defaultRole: 'user' })` plugin, the `additionalFields` (`role`, `affiliation`, `linkedin`), and binds `sendVerificationEmail` / `sendResetPassword` to the email sender. |
| `src/lib/auth-guards.ts`          | `requireUser(request)` and `requireRole(request, roles[])` helpers. Used by both `beforeLoad` and every server function (defense in depth).                                                                                                                                 |
| `src/lib/email/sender.ts`         | `EmailSender` interface (`sendVerification`, `sendPasswordReset`) and the factory that picks an implementation based on `EMAIL_TRANSPORT`.                                                                                                                                  |
| `src/lib/email/console-sender.ts` | v1 implementation. Writes a human-readable block to stderr with the recipient, subject, and link.                                                                                                                                                                           |
| `src/db/schema.ts`                | Combined Drizzle schema. Better Auth's generated tables live here next to the app's tables.                                                                                                                                                                                 |
| `src/db/index.ts`                 | Existing `drizzle(DATABASE_URL)` shortcut. The same `db` is passed to Better Auth's adapter (no second pool).                                                                                                                                                               |
| `src/routes/api/auth/$.ts`        | Existing catch-all. Forwards GET/POST to `auth.handler`. No change.                                                                                                                                                                                                         |
| `scripts/seed-admin.ts`           | Idempotent script that ensures a user with email `SEED_ADMIN_EMAIL` exists with `role='admin'` (creates via Better Auth's server API if missing).                                                                                                                           |

### 4.2 Client modules

| Path                                    | Responsibility                                                                                                             |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/auth-client.ts`                | Adds the `adminClient()` plugin so role and ban APIs are accessible from the React side mirror of the server.              |
| `src/routes/(auth)/sign-in.tsx`         | Email + password form; "Continue with GitHub" button.                                                                      |
| `src/routes/(auth)/sign-up.tsx`         | Name, email, password. On submit, shows a "check your email" message.                                                      |
| `src/routes/(auth)/forgot-password.tsx` | Email input; always shows a generic confirmation (no enumeration).                                                         |
| `src/routes/(auth)/reset-password.tsx`  | New-password form gated by token from URL.                                                                                 |
| `src/routes/(auth)/verify-email.tsx`    | Reads token from URL, calls Better Auth, then redirects to `/`.                                                            |
| `src/routes/_authed/_layout.tsx`        | `beforeLoad` calls `requireUser`. On miss, throws `redirect({ to: '/sign-in', search: { redirect: location.pathname } })`. |
| `src/routes/_authed/_admin/_layout.tsx` | Nested layout. `beforeLoad` calls `requireRole(['admin','instructor'])`.                                                   |
| `src/routes/_authed/profile.tsx`        | Edit name, affiliation, linkedin; change password; sign out.                                                               |

### 4.3 Why these boundaries

- **Auth core is one file (`auth.ts`)**: changing the auth instance always means editing this file. Cross-cutting changes never need a hunt.
- **Guards are not in route files**: every route guard delegates to `auth-guards.ts` so the rule (and any future tweaks like ban handling, MFA enforcement) lives in one place.
- **Email sender is an interface**: swapping the v1 console transport for Resend or SES is a one-line factory change, not a refactor across Better Auth wiring.
- **Seed is a script, not a server function**: avoids any accidental web-exposed admin-creation endpoint.

## 5. Data Model

### 5.1 Better Auth owned tables

These are produced by `npx @better-auth/cli generate` and pasted into `src/db/schema.ts`. They are never hand-edited; app-specific fields are added via `additionalFields` on the Better Auth config and surface as columns on `user` only.

**`user`**

- `id` text PK (Better Auth's default; we don't override it. See Risk #6.)
- `email` text unique not null
- `email_verified` boolean not null default false
- `name` text
- `image` text (URL; for GitHub users this comes from the provider, for email/password users we set a DiceBear URL on creation)
- `role` text not null default `'user'` (from admin plugin)
- `banned` boolean default false
- `ban_reason` text
- `ban_expires` timestamptz
- `affiliation` text (additionalField)
- `linkedin` text (additionalField)
- `created_at` timestamptz not null default now()
- `updated_at` timestamptz not null default now()

**`session`**

- `id` text PK
- `user_id` text not null FK -> `user(id)` ON DELETE CASCADE
- `expires_at` timestamptz not null
- `token` text unique not null
- `ip_address` text
- `user_agent` text
- `impersonated_by` text FK -> `user(id)` (admin plugin)
- `created_at` timestamptz not null default now()
- `updated_at` timestamptz not null default now()
- Indexes: `(user_id)`, `(expires_at)`

**`account`**

- `id` text PK
- `user_id` text not null FK -> `user(id)` ON DELETE CASCADE
- `account_id` text not null (provider account id; for credentials = user.id)
- `provider_id` text not null (`'credential'`, `'github'`, ...)
- `password` text (only set for `provider_id='credential'`)
- `access_token` text, `refresh_token` text, `id_token` text (OAuth only)
- `access_token_expires_at` timestamptz, `refresh_token_expires_at` timestamptz
- `scope` text
- `created_at` timestamptz not null default now()
- `updated_at` timestamptz not null default now()
- Unique: `(provider_id, account_id)`
- Indexes: `(user_id)`

**`verification`**

- `id` text PK
- `identifier` text not null (typically the email)
- `value` text not null (the token)
- `expires_at` timestamptz not null
- `created_at`, `updated_at` timestamptz
- Indexes: `(identifier)`, `(expires_at)`

### 5.2 Migration plan

The dev database is the only place data lives. The user has approved wiping it. Steps, in this order:

1. `docker compose down -v && docker compose up -d postgres` to reset.
2. Drop the existing custom `users` table from `src/db/schema.ts`.
3. Drop the `userRoleEnum`. Roles now live as text in `user.role` (Better Auth's admin plugin convention).
4. Run `npx @better-auth/cli generate --output src/db/auth-schema.ts` to produce the four tables above as a Drizzle schema file.
5. Re-export Better Auth's table objects from `src/db/schema.ts` (`export * from './auth-schema'`) so existing imports of `users` are easy to find and replace with `user`.
6. Repoint every FK that previously referenced `users.id`:
   - `program_instructors.user_id`
   - `project_collaborators.user_id`
   - `project_comments.author_id`
   - `project_status_history.changed_by`
   - `project_bids.student_id`
   - `project_assignments.student_id`, `assigned_by`
   - `project_bookmarks.user_id`
   - `projects.proposer_id`
   - `inventory_requests.user_id`, `reviewed_by`
   - `notifications.user_id`
7. Add `projects.program_manager_id` uuid FK -> `user(id)` ON DELETE RESTRICT. README's "program manager (main instructor)" is a single user per project.
8. Run the hardening pass in Section 5.3.
9. `npm run db:generate` then `npm run db:migrate`. Verify with `npm run db:studio`.
10. `tsx scripts/seed-admin.ts` to create the first admin.

### 5.3 Auth-adjacent schema hardening (in scope for Spec 1)

This pass cleans up only tables touched by the user repointing. Project-internal cleanup (FTS, project indexes, comment threading) is Spec 2.

**Composite primary keys** on junction tables:

- `program_instructors(program_id, user_id)`
- `project_collaborators(project_id, user_id)`
- `project_bookmarks(user_id, project_id)`
- `project_categories(project_id, category_id)`

**Timestamps**: every existing `timestamp(...)` becomes `timestamp({ withTimezone: true }).notNull().defaultNow()`. Stored as `timestamptz`. Where a timestamp is genuinely optional (`published_at`, `archived_at`, `deleted_at`, `reviewed_at`), the `notNull` is dropped but `withTimezone` stays.

**FK cascade rules**:

- Pure junction tables (the four above), session, and account: `ON DELETE CASCADE` from `user(id)`.
- Content-authorship FKs (`projects.proposer_id`, `project_comments.author_id`, `project_bids.student_id`, `project_status_history.changed_by`, `project_assignments.assigned_by`): `ON DELETE RESTRICT`. A user with content cannot be hard-deleted; they must be banned or anonymized in a separate flow.
- `inventory_requests.user_id`: `RESTRICT` (request belongs to a real requester).
- `inventory_requests.reviewed_by`: `SET NULL` (review attribution can be lost without losing the request itself).
- `notifications.user_id`: `CASCADE`. Notifications are per-user UI state. The RESTRICT rules above mean a user with content cannot actually be deleted, so this is mostly defensive.

**`notNull` fixes** on columns that should never have been nullable:

- `user.role` (default `'user'`)
- `*.created_at` and `*.updated_at`

**Indexes** added now (project-table indexes come in Spec 2):

- `session(user_id)`, `session(expires_at)`
- `account(user_id)`, unique `account(provider_id, account_id)`
- `verification(identifier)`, `verification(expires_at)`

### 5.4 What is intentionally NOT touched in Spec 1

- No FTS / tsvector / GIN on `projects`.
- No project-status indexes.
- No `project_comments.parent_id` self-FK or thread-depth constraint.
- No category type enum.
- No general activity log (the one recently dropped). Status changes still recorded by `project_status_history`. We will decide in Spec 2 whether to reintroduce a broader audit table.

## 6. Auth Flows

### 6.1 Sign up (email + password)

1. Client `POST /api/auth/sign-up/email` with `{name, email, password}`.
2. Better Auth creates `user` and `account` (password hashed with scrypt). `user.email_verified` is false. `user.image` is set to the DiceBear identicon URL derived from the user id.
3. Better Auth calls `sendVerificationEmail({user, url, token})`. The console sender prints a labeled block to stderr with the verification URL.
4. UI shows a "check your email" screen.
5. User opens the link. `GET /api/auth/verify-email?token=...` flips `email_verified`, then issues a session cookie via `tanstackStartCookies`.

### 6.2 Sign in (email + password)

`POST /api/auth/sign-in/email` with credentials. Better Auth verifies against `account.password`, issues session.

### 6.3 Sign in (GitHub)

1. `GET /api/auth/sign-in/social?provider=github` triggers Better Auth's OAuth dance.
2. On callback, Better Auth either:
   - Links a new `account` row to an existing `user` matched by email, or
   - Creates both `user` and `account` if no match.
3. Session cookie issued. `user.image` is set from GitHub's profile image.

### 6.4 Password reset

1. `POST /api/auth/forgot-password` with email. Better Auth creates a `verification` row and calls `sendResetPassword`.
2. Server response is generic ("if an account exists, we sent a link"). Console sender prints the URL.
3. `POST /api/auth/reset-password` with token + new password. Better Auth verifies token (one-shot, time-limited), updates `account.password`, deletes the verification row.

### 6.5 Profile

- Server function `updateProfile({name, affiliation, linkedin})` re-checks session, validates with Zod, updates `user`.
- Password change uses Better Auth's `changePassword` (requires current password).
- Sign out clears the session cookie.

## 7. Authorization

### 7.1 Roles

- `user`: default. Can browse, submit projects (Spec 2), edit own profile.
- `instructor`: subset of admin. Can review and publish projects, manage programs and categories (Spec 2). Cannot manage users or unrestricted admin actions.
- `admin`: everything.

The role string lives on `user.role` (admin plugin). Comparisons in code use a tiny helper:

```ts
export const isAdmin = (u: User) => u.role === "admin";
export const isStaff = (u: User) =>
  u.role === "admin" || u.role === "instructor";
```

### 7.2 Guards

**Route layer** (`beforeLoad`):

```ts
// _authed/_layout.tsx
export const Route = createFileRoute("/_authed")({
  beforeLoad: async ({ location }) => {
    const user = await requireUser();
    return { user };
  },
});
```

**Server function layer** (every mutating server function):

```ts
const updateProfile = createServerFn({ method: "POST" })
  .validator(profileSchema)
  .handler(async ({ data, signal }) => {
    const user = await requireUser();
    // ... update
  });
```

This duplication is intentional. Server functions are reachable directly via fetch and must not assume a route guard ran.

### 7.3 What guards do not do

- They do not check fine-grained per-resource permissions (e.g., "is this user the proposer of project X"). Those checks live next to the query that loads the resource, in Spec 2.
- They do not silently no-op on failure. They throw, and the route or server function returns a 401 or 403.

## 8. Environment Contract

`.env.example` (new file, committed):

```bash
# Postgres connection string
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/cs_capstone

# Better Auth
BETTER_AUTH_URL=http://localhost:3000
BETTER_AUTH_SECRET=replace-me-run-npx-better-auth-cli-secret

# OAuth providers
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

# Email transport: 'console' (v1) | future: 'resend', 'ses'
EMAIL_TRANSPORT=console

# Seed (used by scripts/seed-admin.ts, not by the app)
SEED_ADMIN_EMAIL=
SEED_ADMIN_PASSWORD=
```

Per-environment notes:

- **Local**: `.env.local` already has `DATABASE_URL` and `BETTER_AUTH_*`. Add the GitHub OAuth pair (register an OAuth App with callback `http://localhost:3000/api/auth/callback/github`).
- **Railway**: same key names, set in the project's Variables tab. `BETTER_AUTH_URL` is the Railway-issued URL. Register a separate GitHub OAuth App for that origin.
- **AWS**: same key names in Secrets Manager / Parameter Store. `BETTER_AUTH_URL` is the production domain. Better Auth's `trustHost: true` is required when sitting behind ALB or CloudFront so origin detection works.

## 9. Seeding

`scripts/seed-admin.ts`:

1. Reads `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` from env (fail fast if missing).
2. Queries the `user` table; if a row with that email exists, ensures `role='admin'` and exits.
3. Otherwise calls `auth.api.signUpEmail({...})` then `auth.api.setRole({ userId, role: 'admin' })`.
4. Idempotent. Safe to re-run.

Run after every fresh deploy: `tsx scripts/seed-admin.ts`.

## 10. Testing

| Layer       | What we cover                                                                                                        | Tooling                                                                         |
| ----------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Unit        | `requireUser` and `requireRole`: returns user on valid session, throws on missing/wrong role.                        | Vitest + mocked `auth.api.getSession`.                                          |
| Integration | Sign up -> verify (intercept console output to get token) -> sign in -> update profile -> sign out -> sign in again. | Vitest against the live docker-compose Postgres + the real Better Auth handler. |
| Integration | Admin role gate: a `user`-role session is rejected by `requireRole(['admin'])`.                                      | Same harness.                                                                   |
| Smoke       | `npm run check` (Biome lint + format) passes.                                                                        | CI.                                                                             |

The integration suite resets the DB between runs via a `TRUNCATE` helper. No production data; trivially safe.

## 11. Deployment

### 11.1 Local

`docker compose up -d` is already the workflow. The Better Auth and Drizzle setup require no extra services beyond Postgres.

### 11.2 Railway

The repo ships `nixpacks.toml`. After this spec lands, also:

1. Provision Postgres in Railway (auto-injects `DATABASE_URL`).
2. Set every other variable from `.env.example`.
3. Register a GitHub OAuth App with callback `https://<railway-domain>/api/auth/callback/github`.
4. Trigger a deploy. Run `tsx scripts/seed-admin.ts` from the Railway shell once.

### 11.3 AWS (production)

Out of scope to fully design here. Spec 1 only commits to: env keys unchanged, `trustHost: true`, cookies set with `secure: true` and `sameSite: 'lax'`. The actual ECS/Fargate or App Runner topology is a deployment-spec problem.

## 12. Risk Callouts

1. **Drizzle column casing.** Better Auth's CLI generates camelCase TS field names mapped to snake_case columns by default. Our existing tables follow the same pattern (`createdAt` field -> `created_at` column). Verify by inspecting the generated file before committing. If the CLI ever emits camelCase columns, override per-column with explicit `.name('snake_case')` calls.
2. **Single Drizzle pool.** Pass the existing `db` from `src/db/index.ts` to Better Auth's `drizzleAdapter`. Do not let Better Auth open a second pool via raw `pg.Pool`.
3. **Cookies behind proxies.** Railway and AWS both proxy traffic. `BETTER_AUTH_URL` must be the public origin, not the internal hostname, or OAuth redirects break. `trustHost: true` is required in non-local envs.
4. **CLI codegen vs hand edits.** Anything inside the four Better Auth tables can be wiped by a future `cli generate`. The rule: never hand-edit those table definitions. All app columns on `user` are added via `additionalFields` on the auth config, which causes the CLI to include them on regeneration.
5. **Identicon URL stability.** DiceBear URLs are deterministic given a seed. If we ever change the seed input (e.g., from user id to email), all existing avatars change. Document the seed choice (user id) and don't change it.
6. **`user.id` is `text`, not `uuid`.** Better Auth's CLI generates `text` PKs by default; overriding requires `advanced.database.generateId` config and risks breaking plugin assumptions about ID format. We accept the default. Every FK that previously pointed at the old `users.id` (`uuid`) is therefore now `text`. Functionally equivalent for our queries; the only consequence is that Postgres validates the column as a string rather than a UUID type. If at some future point we need true UUID typing for ops or analytics reasons, we can switch by configuring Better Auth's id generator and writing a one-shot migration.

## 13. Future Considerations (out of scope)

- **CAPTCHA on sign-up and password reset.** If abuse becomes a problem, add Cloudflare Turnstile or hCaptcha. **Hard constraint: no Google services (no reCAPTCHA in any form).**
- **Real email transport.** Swap the console sender for Resend (simpler) or SES (cheaper at scale).
- **More OAuth providers.** Google (covers OSU ONID via Workspace), LinkedIn, Discord. Each is a config-only addition; no schema change.
- **MFA.** Better Auth has TOTP and passkey plugins. Both can be added without schema migration of existing tables.
- **Account linking UI.** If users sign up with email and later try GitHub with the same email, Better Auth links automatically. We may want a "Connected accounts" panel later.
- **Rate limiting.** Better Auth has a `rateLimit` config; add when traffic grows.

## 14. Open Questions

None. User confirmed: DB wipe approved, RESTRICT semantics approved, no missing features for v1, no Google CAPTCHA if any CAPTCHA is later added.

## 15. Approval

Awaiting user review. Once approved, the next step is `superpowers:writing-plans` to produce the step-by-step implementation plan.
