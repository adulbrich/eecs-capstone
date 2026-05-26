# Framework Quirks and Project Conventions

A running log of every gotcha we have hit and the conventions that grew out of them. Read this before debugging anything that "should just work."

The stack is fast-moving: **TanStack Start** is pre-v1 as of 2026, **Better Auth** 1.5.x changed several method names from earlier docs, and **Drizzle 0.45** has gaps the docs do not warn about. Treat the official docs as a starting point, this file as the ground truth for THIS codebase.

## Table of contents

1. [TanStack Start](#tanstack-start)
2. [TanStack Router](#tanstack-router)
3. [TanStack Form](#tanstack-form)
4. [Better Auth](#better-auth)
5. [Drizzle ORM + Postgres](#drizzle-orm--postgres)
6. [Vitest test infrastructure](#vitest-test-infrastructure)
7. [Biome and code style](#biome-and-code-style)
8. [Project conventions](#project-conventions)

---

## TanStack Start

### `createServerFn` must be a top-level exported `const` initializer

TanStack Start's bundler transform recognizes `createServerFn(...).handler(fn)` ONLY when it appears as the direct initializer of a top-level exported const. Calls wrapped in factory functions are not recognized, the handler body is shipped to the browser intact, and any imports it references (like `db`, `pg`, `drizzle`) end up in the client bundle. Symptom: `ReferenceError: Buffer is not defined`.

```ts
// ✅ Recognized: stripped on client, RPC stub remains.
export const createProject = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => schema.parse(d))
  .handler(async ({ data }) => { /* server work */ });

// ❌ NOT recognized: ships to the browser, drags db into the client bundle.
function makeTransition(target: Status) {
  return createServerFn({ method: "POST" })
    .handler(async ({ data }) => { /* never stripped */ });
}
export const submitProject = makeTransition("submitted");
```

Even if there are 10 near-identical server functions, write them out as 10 top-level constants. Verbose, but the only shape the framework understands.

### Server-only modules must not match `**/*.server.*`

TanStack Start's `import-protection` plugin denies any client-chain import (static OR dynamic) where the resolved path matches `**/*.server.*` OR the specifier matches `@tanstack/react-start/server` (or similar denylist entries). The denial is based on static name analysis; the fact that the import lives inside a stripped `createServerFn` handler does not exempt it.

We use the `_internal/` directory convention instead:

- `src/server/x.ts` — client-importable wrapper. Imports ONLY `createServerFn`, `z`, types. Each `createServerFn().handler()` does `const { xImpl } = await import("./_internal/x"); return xImpl(...)`.
- `src/server/_internal/x.ts` — server-only impl. Can statically import `db`, schema, drizzle, auth helpers, anything.
- `src/lib/_internal/auth-guards.ts` — the server-only auth helpers (`readSession`, `requireUser`, `requireRole`).
- `src/lib/auth-guards.ts` — the client-safe wrapper exposing `getSession` as a server function.

The wrapper does ONE dynamic import per handler (just `./_internal/x`). The impl handles auth itself (statically imports `requireUser` and calls it). Two dynamic imports per handler (one for impl, one for auth) also works, but doubles the warning surface if anything goes wrong.

### `getRequest`, not `getWebRequest`

The currently installed version of `@tanstack/react-start/server` exports `getRequest`. Older docs and examples reference `getWebRequest`, which does not exist. Use `getRequest()` to access the in-flight `Request`.

### `.inputValidator(...)`, not `.validator(...)`

`createServerFn(...).inputValidator((d) => schema.parse(d)).handler(...)`. The method was renamed; older docs (and even some sub-versions of the plugin) still show `.validator`.

### `redirect()` throws an object whose target lives at `.options.to`

```ts
throw redirect({ to: "/sign-in" });  // works
// In tests, the caught error shape is { options: { to: "/sign-in" } },
// NOT { to: "/sign-in" }.
```

Tests asserting on the thrown shape need `.toMatchObject({ options: { to: "/sign-in" } })`.

### Sign-out: use `window.location.href`, not `router.navigate`

After `authClient.signOut()`, `router.navigate({ to: "/sign-in" })` does not always land the user on a public page because the in-memory route context still holds the protected route. `window.location.href = "/sign-in"` forces a fresh request, the server sees no cookie, and everything renders from scratch. Use it for sign-out specifically; SPA navigation is fine everywhere else.

### `useEffect` exhaustive deps

Biome's `useExhaustiveDependencies` rule enforces complete dependency arrays. There is no `// eslint-disable-next-line` because we use Biome, not ESLint. The fix is to wrap the function in `useCallback` (with its OWN dep array) so the effect's dep can be just the stable callback reference.

### Default not-found route

Add `defaultNotFoundComponent` in `getRouter()` (see `src/router.tsx`). Without it, TanStack Router prints a "no notFoundComponent configured" warning on every missing-route hit.

### Generated route tree

`src/routeTree.gen.ts` is auto-regenerated by the TanStack Router plugin during `npm run dev`. To pick up new route files after editing, boot the dev server briefly. New `<Link to="/x">` calls referencing routes that do not yet exist trigger a TS error; either add the route first, or add a temporary `as string` cast and remove it once the route is in the tree (TypeScript will then flag the cast as unused).

---

## TanStack Router

### Pathless layouts nested under pathless layouts resolve to `/`

`src/routes/_authed.tsx` is a pathless layout. A child `src/routes/_authed/_admin.tsx` (also pathless) resolves to the same path as `_authed` plus nothing, which is `/`, which conflicts with `src/routes/index.tsx`. We use `src/routes/_authed/admin.tsx` (non-pathless, URL `/admin`) instead.

If a layout needs a child route to be a meaningful destination, give it at least one URL segment.

### `beforeLoad` runs on both client and server

A route's `beforeLoad` is executed during SSR AND on every client-side navigation. So `beforeLoad` cannot directly call any module that imports server-only deps (like `@tanstack/react-start/server`). Wrap the server-only code in a `createServerFn` and call that from `beforeLoad`. See `src/lib/auth-guards.ts` for the pattern.

### Route search params via `validateSearch`

```ts
const searchSchema = z.object({ page: z.number().int().min(1).default(1) });

export const Route = createFileRoute("/projects/")({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({ page: search.page }),
  loader: async ({ deps }) => listPublishedProjects({ data: { page: deps.page } }),
});
```

Search-driven loaders need `loaderDeps` so navigation with a new search param re-runs the loader.

### Single canonical URL per resource

Convention adopted in Spec 2: each project has ONE URL (`/projects/$id`), and staff-only sections (notes, internal comments, action buttons) render conditionally inside that page based on viewer role. We deliberately do NOT have a separate `/admin/projects/$id`. This avoids URL duplication and lets staff share URLs with non-staff. List views can still live at separate URLs (`/admin/projects` IS distinct from `/projects`) because the underlying query is genuinely different.

---

## TanStack Form

### Zod adapter does not accept schemas directly in `validators.onSubmit`

In the installed version, passing a Zod schema directly to `validators.onSubmit` fails type-checking. The workaround:

```ts
validators: {
  onSubmit: ({ value }) => {
    const result = projectFormSchema.safeParse(value);
    if (result.success) return undefined;
    const fields: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join(".");
      if (key && !fields[key]) fields[key] = issue.message;
    }
    return { fields };
  },
},
```

### `useForm` generics are unstable; we use a localized `any` for the `Field` helper

`ReturnType<typeof useForm<ProjectFormValues, unknown>>` does not match the installed version's generics. Inside the shared `Field` component we use `// biome-ignore lint/suspicious/noExplicitAny: TanStack Form generics are unstable` plus `type AnyForm = any`. The PUBLIC API of `ProjectForm` (`initial`, `onSubmit`, `ProjectFormValues`) stays fully typed; only the internal field helper escapes.

### `field.state.meta.errors` is a heterogeneous array

Entries can be strings or `{ message }` objects depending on which validator produced them. Render them with a small coercer:

```tsx
{field.state.meta.errors.length > 0 && (
  <p>{field.state.meta.errors
    .map((e: unknown) =>
      typeof e === "string" ? e : (e as { message?: string })?.message ?? String(e),
    )
    .join(", ")}
  </p>
)}
```

### Server errors via `applyServerErrors`

When a server function throws a `ZodError`, the helper `src/lib/apply-server-errors.ts` maps issues back to field-level errors via `setFieldMeta`. Wrap form `onSubmit` with `try` / `catch` and call it; if it returns false (non-Zod error), surface the message in a top-level banner. Don't expect server validation errors to appear silently next to fields without this helper.

---

## Better Auth

### `authClient.requestPasswordReset`, not `forgetPassword`

In 1.5.x the password-reset trigger method is `authClient.requestPasswordReset({ email, redirectTo })`. Older docs and some examples show `forgetPassword`, which does not exist.

### `user.id` is `text`, not `uuid`

Better Auth's CLI generates `text` PKs by default. Overriding requires `advanced.database.generateId` config and risks breaking plugin assumptions about ID format. We accept the default. Every FK that previously was a `uuid` referencing the old `users.id` is now a `text` column referencing `user.id`. Drizzle declarations and integration test mocks use `text` accordingly.

### `additionalFields` are restored across CLI regenerations

If you change Better Auth plugins or `additionalFields` and re-run `npx @better-auth/cli generate`, the CLI overwrites `src/db/auth-schema.ts`. Custom additionalFields (e.g., `affiliation`, `linkedin`) come back automatically because they live in `user.additionalFields` in `src/lib/auth.ts`. The generated file has a hand-written comment marking them so a maintainer knows what to preserve if they ever DO need to edit by hand.

### Console email transport in dev

`EMAIL_TRANSPORT=console` (set in `.env.local`) routes verification and password-reset emails to stderr. Watch the dev server console for the link blocks. Real outbound email (Resend / SES) is a future swap behind the `EmailSender` interface in `src/lib/email/sender.ts`.

### `trustHost` is enabled in non-development

`src/lib/auth.ts` sets `trustHost: process.env.NODE_ENV !== "development"`. Required behind proxies (Railway, AWS) so origin detection works. Disabled in dev where `localhost:3000` is direct.

### Session role typing

`session.user.role` is typed as `string | null | undefined`. Always coerce with `?? ""` or default before comparing:

```ts
["admin", "instructor"].includes(session.user.role ?? "")
```

### Sign-up returns optional `user`

`auth.api.signUpEmail({ body: { email, password, name } })` returns `{ user, token }` but the type allows `user` to be undefined. Check and throw if missing (see `scripts/seed-admin.ts`).

### Ban enforcement reads `user.banned`; sessions linger until next server call

Better Auth's session-validation middleware checks `user.banned` on every request. Setting the row alone is enough to prevent future sign-ins, but an already-signed-in user keeps their cookie until the next server-touch. Our `banUserAs` impl wraps both writes (`UPDATE user` + `DELETE FROM session WHERE user_id = ?`) in one transaction so the next request fails session lookup and forces sign-out. Skipping the session-delete would leave a banned user nominally signed in until their cookie expired naturally.

`ban_expires` is informational at write time; Better Auth's runtime check compares it to `now()` and treats a past timestamp as no-longer-banned. We do not run a cron to clear the row; the data simply ages out of relevance.

---

## Drizzle ORM + Postgres

### tsvector / generated columns need `customType` + hand-written SQL

Drizzle 0.45 has no built-in `tsvector` column type. Declare with the `customType` helper as read-only:

```ts
const tsvector = customType<{ data: string; driverData: string }>({
  dataType: () => "tsvector",
});

searchVector: tsvector("search_vector").notNull(),
```

The column is created in a hand-written migration as `GENERATED ALWAYS AS (...) STORED`. Drizzle's `db:generate` will not produce this for you; do not write the migration by tweaking the generated SQL — author it directly.

If you ever need to change the weight expression, drop the column and re-add it. Generated-always-stored columns cannot be altered in place.

### Self-referential FKs need the AnyPgColumn cast

```ts
parentId: uuid("parent_id").references(
  (): import("drizzle-orm/pg-core").AnyPgColumn => projectComments.id,
  { onDelete: "cascade" },
),
```

The cast is the documented Drizzle idiom to avoid a circular initialization error.

### Pool reuse

`src/db/index.ts` exports a single `db` instance (`drizzle(DATABASE_URL)`). Pass this to Better Auth's `drizzleAdapter`. Do not let any code path open a second pool via raw `pg.Pool`; the Drizzle shortcut already manages one.

### FK rules in this project

| Rule | Where it lives |
| --- | --- |
| `CASCADE` | Pure junction tables (`program_instructors`, `project_collaborators`, `project_bookmarks`, `project_categories`), `session`, `account`, `notifications`. |
| `RESTRICT` | Content authorship (`projects.proposer_id`, `project_comments.author_id`, `project_bids.student_id`, `project_status_history.changed_by`, `project_assignments.assigned_by`). A user with content cannot be hard-deleted. |
| `SET NULL` | `inventory_requests.reviewed_by`, `projects.program_id` (from Spec 3). Review attribution and program assignment can be lost without losing the record. |

Cascade rules are encoded in the schema, not in application code. Never recompute them at runtime.

### Timestamps always `withTimezone: true`

Every timestamp column uses `timestamp("col", { withTimezone: true })`. Stored as `timestamptz`. Required ones chain `.notNull().defaultNow()`. Optional event timestamps (`publishedAt`, `archivedAt`, `deletedAt`, `reviewedAt`, `banExpires`) are nullable but still `withTimezone`.

### TRUNCATE in tests wipes dev data

The integration test setup (`src/test/setup.integration.ts`) calls `TRUNCATE TABLE ... CASCADE` on every table before each test. The test config uses the same `DATABASE_URL` as dev. **Running `npm run test:integration` deletes your dev data.** If your project disappears after running tests, that is why.

Long-term fix: use a separate `cs_capstone_test` database with its own `DATABASE_URL` in `vitest.integration.config.ts`. Not yet implemented.

---

## Vitest test infrastructure

### Scripts: dotenv inside the script does NOT work; use `tsx --env-file`

ESM imports hoist above all statements. Writing `import { config } from "dotenv"; config({ path: ".env.local" }); import { db } from "..."` looks correct but is wrong: the `db` import runs at module-load time BEFORE the `config()` call ever fires, so `DATABASE_URL` is unset when `src/db/index.ts` evaluates and the script crashes.

Pattern that works: pass `--env-file=.env.local` to `tsx` at the command line.

```json
"db:seed:dev": "tsx --env-file=.env.local scripts/seed-dev.ts",
"db:seed:admin": "tsx --env-file=.env.local scripts/seed-admin.ts"
```

The seed scripts themselves should not import dotenv. A comment at the top of each script explains the invocation pattern.

### Integration tests need DATABASE_URL at config-load time

`src/db/index.ts` reads `DATABASE_URL` at module-import time and throws if missing. Vitest setup files (`setupFiles`) run AFTER the test files start importing. So loading dotenv from `setup.integration.ts` is too late. Load it from `vitest.integration.config.ts` itself:

```ts
import { config as loadDotenv } from "dotenv";
loadDotenv({ path: [".env.local", ".env"] });

export default defineConfig({ /* ... */ });
```

### Vitest 4 `poolOptions` moved

Older docs show `test.poolOptions.forks.singleFork: true`. Vitest 4 removed that path. Use top-level `test.fileParallelism: false` instead.

### Pre-existing infra noise

`npm test` runs print two harmless warnings:

- `ReferenceError: module is not defined at .../react/index.js` — React's CJS module loading under Vite's ESM runner.
- `Tests closed successfully but something prevents Vite server from exiting` — connection-lingering, no impact.

Tests still pass. Ignore both.

### `as ReturnType<typeof vi.fn>` triggers TS2352

Use the double-cast variant for mock typings:

```ts
(auth.api.getSession as unknown as ReturnType<typeof vi.fn>)
  .mockResolvedValueOnce({ /* ... */ });
```

### `vi.spyOn` mock-calls callback typing

If you get TS7006 ("Parameter implicitly has 'any' type") on `mock.calls.map((c) => ...)`, annotate as `(c: unknown[])`. The cleaner alternative is to let vitest's generics infer, but the installed version's types don't always cooperate.

### Integration helpers: the `*As(viewer, ...)` pattern

Every workflow / mutation server function in `src/server/_internal/` exposes an `*As(viewer, data)` helper alongside the production `*ForCurrentUser` helper. Tests import the `*As` helpers directly with a freshly-seeded user object and skip the auth round-trip. The `createServerFn` wrappers call `*ForCurrentUser` which calls `requireUser()` then delegates to `*As`. The pattern lives in `src/server/_internal/projects.ts`, `comments.ts`, etc.

---

## Biome and code style

### Hard rules

- 2-space indent.
- Double quotes for JS / TS strings.
- Imports auto-sorted by the Biome assist organize-imports rule. Don't fight it.
- All files under `src/` are checked. Files outside (`scripts/`, top-level configs) are excluded by `biome.json`.
- `npm run check` must be clean before committing. Run `npx biome format --write` or `npx biome check --write` to auto-fix.

### Soft rules / project conventions

- **No emdashes** anywhere in prose, comments, commit messages, or string literals. Also no `--` substitutes used as sentence dashes (hyphens in compound words like `read-only` are fine). Use commas, colons, semicolons, parens, or new sentences.
- **No emojis** unless explicitly requested by the user.
- **Lowercase imperative commit messages**, no Conventional Commits prefix. Examples: `add foo`, `fix bar in baz`, `move x into _internal/`.
- **Co-author trailer** on every assistant-authored commit: `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>`. Use a HEREDOC to keep the multi-line body intact.
- **Component file naming** is `kebab-case.tsx` (`project-card.tsx`, `status-badge.tsx`).
- **`#/` import alias** for cross-directory imports inside `src/` (defined in `package.json`). Avoid `../../../...` chains.

### Biome formatter quirks we hit

- Single-line index entries in Drizzle table configs sometimes get reformatted across runs. Accept the format Biome wants.
- TanStack Router `<Link>` JSX with three or more attributes will be split to multi-line. Don't pre-format yourself; let `npx biome format --write` handle it.

---

## Project conventions

### `AGENTS.md` is permanently dirty

The user has uncommitted edits to `AGENTS.md`. Agents must NEVER:

- `git add AGENTS.md`
- `git add -A` or `git add .`

Always name files explicitly when staging. The user commits `AGENTS.md` themselves when they want to.

### Stay on `main`

The user has explicitly consented to assistant commits landing on `main` for this project. Do not create feature branches unless the user asks.

### Path-by-path convention summary

| Path | What goes there |
| --- | --- |
| `src/lib/*.ts` | Pure modules, client-safe wrappers. |
| `src/lib/_internal/*.ts` | Server-only helpers (auth-guards). |
| `src/lib/__tests__/*.test.ts` | Pure-module unit tests. |
| `src/server/*.ts` | createServerFn wrappers (Zod schemas + dynamic-import handlers). Client-importable. |
| `src/server/_internal/*.ts` | Impl + `*As(viewer, ...)` + `*ForCurrentUser(...)` helpers. Server-only. |
| `src/server/__tests__/*.integration.test.ts` | Integration tests against docker Postgres. |
| `src/components/*.tsx` | Plain Tailwind components. shadcn is installed but NOT used yet. |
| `src/routes/...` | TanStack file-based routes. `_layout.tsx` are pathless. `routeTree.gen.ts` is auto-generated; do not hand-edit. |
| `src/db/schema.ts` | Hand-written Drizzle schema for app tables. |
| `src/db/auth-schema.ts` | Better Auth CLI-generated tables. Do not hand-edit; preserved through regen via `additionalFields`. |
| `drizzle/*.sql` | Generated migrations. New tsvector / FK-rule changes are HAND-AUTHORED (see Drizzle section). |
| `scripts/*.ts` | Operational scripts (seeding, one-shot fixes). Not Biome-checked. |
| `docs/superpowers/specs/*` | Design docs per feature. One per "spec". |
| `docs/superpowers/plans/*` | Implementation plans per spec. One per "spec". |
| `docs/QUIRKS.md` | This file. |

### Workflow conventions

- **Brainstorm before writing code** for any new feature. The brainstorming skill is the entry point. Output is a spec doc.
- **Spec then plan then implement.** The plan is the bite-sized task list. The implementation is dispatched per phase via subagent-driven-development.
- **`*As` first, `*ForCurrentUser` second.** Always design the impl helper to accept an explicit viewer so integration tests can call it directly. The wrapper that resolves the viewer is layered on top.
- **One server-fn per workflow action.** Never collapse multiple actions into one mega-mutation. Grep-ability matters more than line count.
- **Single canonical URL per resource.** Render staff sections conditionally on the same URL rather than maintaining a separate admin detail.

---

## Object storage (S3-compatible)

### Sharp is server-only; never ships to the client

Sharp is a Node.js native binding (compiled C++ via libvips). It
physically cannot run in a browser. Bundlers exclude native modules
from client builds automatically. The ~30MB on-disk install is purely
server-side. If you need image processing in the browser, use the
built-in `<canvas>` API (which is what our ImageUploader does for crop +
resize).

### Sharp's `.withMetadata({})` does NOT strip EXIF

This is the opposite of what you'd expect. In Sharp 0.34.x,
`.withMetadata()` preserves metadata; passing an empty options object
does NOT mean "strip everything," it means "preserve with these
options." To strip EXIF, GPS, and orientation, simply omit
`.withMetadata()` entirely. Sharp's default is metadata-free output.

The EXIF-strip test in `src/lib/__tests__/image-processing.test.ts`
caught this when an explicit fixture with EXIF Orientation came out
with the metadata intact.

### Storage keys vs URLs

The DB columns (`projects.imageUrl`, `user.image`) hold storage keys
(e.g., `projects/<id>/<uuid>.webp`), NOT full URLs. The
`getPublicUrl(key)` helper in `src/lib/storage.ts` builds the URL at
render time. It has a pass-through for legacy `http(s)://` values so
the same column can hold both shapes.

Why keys: swapping to a CDN, changing buckets, or moving to signed
URLs is a one-line change in the helper, not a data migration.

### TanStack Start FormData server functions

`createServerFn(...).inputValidator(...)` accepts FormData when the
validator returns the input as-is:

```ts
export const uploadProjectImage = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (!(data instanceof FormData)) throw new Error("Expected FormData");
    return data;
  })
  .handler(async ({ data }) => { /* data is FormData */ });
```

The client sends:

```ts
const form = new FormData();
form.append("file", file);
await uploadProjectImage({ data: form });
```

If the framework version stops accepting raw FormData in `data`, the
fallback is a plain API route in `src/routes/api/upload/<name>.tsx`
that reads `request.formData()` directly and calls the same
`_internal/uploads.ts` helpers via fetch from the client.

### `requireUser()` blocks integration tests; layer `*As(viewer, ...)`

`requireUser()` reads from TanStack Start's AsyncLocalStorage request
context, which the Vitest integration harness cannot provide. Server
helpers that need to be exercised by an integration test should split
into two layers:

- `*As(viewer, ...)`: pure logic, takes an explicit viewer.
- `*ForCurrentUser(...)`: thin wrapper that calls `requireUser()` and
  delegates to `*As`.

Integration tests construct a synthetic viewer (`{ id, role }`) via
the local `makeUser` helper and call the `*As` variant directly. See
`uploadProjectImageAs` / `uploadProjectImageForCurrentUser` in
`src/server/_internal/uploads.ts` for the canonical pair. The avatar
upload path is not test-covered because the same split would be
needed; the project test covers the same Sharp + bucket + row update
pipeline.

### Buffer is not a BlobPart in lib.dom

When building a `new File([bytes], ...)` in a Node test where `bytes`
is a `Buffer`, tsc rejects with a BlobPart type error. Wrap in a
`Uint8Array` view: `new File([new Uint8Array(bytes)], ...)`. No copy,
same memory.

### RustFS local bucket bootstrap

The container starts without a bucket. Run `npm run storage:init`
once per fresh docker volume to create the bucket. The script is
idempotent (catches `BucketAlreadyOwnedByYou` / `BucketAlreadyExists`).

### `react-image-crop` SSR safety

`react-image-crop` uses DOM APIs (FileReader, document, canvas). The
ImageUploader component never accesses these at the module top level;
all DOM work happens inside event handlers or after the user picks a
file. The component renders a button-only state during SSR.

## When you add a quirk

If you discover a new framework behavior that surprised you, add it here. The rule of thumb: "if it cost more than 30 minutes to figure out, future-us deserves to find it written down."

When updating, keep the structure: short headline, one-paragraph explanation, code example if relevant. The point of this file is grep-friendly recall, not narrative writing.

## Inventory

### Lazy deadlines, no scheduler

`pickup_by` and `due_at` on `inventory_request_items` are informational only. There is no cron. The "past pickup window" / "overdue" badges are computed at query time. Lazy idempotent notifications are inserted on read via `recordOverdueNotificationsAs`, scoped to the viewer's own request lines, using a partial unique index `notifications_overdue_unique_idx` on `(user_id, type, link)` for the two overdue types so re-reads do not duplicate. `onConflictDoNothing` declares the target + where explicitly so future unique indexes on `notifications` cannot silently swallow unrelated conflicts.

### Hard delete is narrow

`inventory_items.id` is referenced by `inventory_request_items` with `ON DELETE RESTRICT`. Hard delete works only when no historical request lines reference the item. `hardDeleteInventoryItemAs` pre-checks this and throws a friendly error instead of letting Postgres surface `23503`. Use retire for anything that has been requested.

### `transitionItem` is the only writer

Every status change to an inventory item must go through `src/server/_internal/inventory-transitions.ts::transitionItem`. It is the only place that writes `inventory_item_status_history` rows and the only place that syncs `current_holder_*` columns with the item status. Approve always delegates to it via `transitionItem(viewer, input, tx)` from inside the approve transaction (the new optional `externalTx` argument). Reject and cancel bypass it intentionally because they emit custom notifications and need different transaction shapes; both are documented in their impls.

### Deferred FK

`inventory_items.current_request_item_id` references `inventory_request_items.id` but the FK is declared in raw SQL inside the migration (not in `schema.ts`) because the two tables reference each other. `ON DELETE SET NULL`.

### submitCart is lock-first

`submitCartAs` locks each cart item with `SELECT FOR UPDATE` and re-checks `status === "available"` before treating it as a survivor. The `inventoryRequests` envelope is inserted only after the lock phase confirms at least one survivor, so an all-race path never leaves an orphaned request row. Items that lost the race are returned in the `skipped` array with reason `"no_longer_available"`.
