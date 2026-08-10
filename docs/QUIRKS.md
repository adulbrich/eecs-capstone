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
7. [Biome / Ultracite and code style](#biome--ultracite-and-code-style)
8. [Project conventions](#project-conventions)
9. [Object storage (S3-compatible)](#object-storage-s3-compatible)
10. [When you add a quirk](#when-you-add-a-quirk)
11. [Inventory](#inventory)
12. [Projects](#projects)

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

- `src/server/x.ts`: client-importable wrapper. Imports ONLY `createServerFn`, `z`, types. Each `createServerFn().handler()` does `const { xImpl } = await import("./_internal/x"); return xImpl(...)`.
- `src/server/_internal/x.ts`: server-only impl. Can statically import `db`, schema, drizzle, auth helpers, anything.
- `src/lib/_internal/auth-guards.ts`: the server-only auth helpers (`readSession`, `requireUser`, `requireRole`).
- `src/lib/auth-guards.ts`: the client-safe wrapper exposing `getSession` as a server function.

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

`EMAIL_TRANSPORT=console` (set in `.env.local`) routes every email the app sends to stderr, not just the auth ones: review notices go through the same `getEmailSender()`. Watch the dev server console for the link blocks. The SES transport behind the same `EmailSender` interface (`src/lib/email/ses-sender.ts`) is what production selects in `infra/ecs.tf`, though it reaches the running container only after a `terraform apply` and a deploy.

Note that `EMAIL_TRANSPORT=ses` requires `EMAIL_FROM`, and the failure is louder than it looks: `getEmailSender()` is called at module scope in `src/lib/auth.ts`, so `createSesEmailSender`'s throw happens during import and takes down the whole app rather than just email. The two are always set together by Terraform. See DEPLOYMENT.md §9.5.

Every email renders through `src/lib/email/templates.ts`, which owns the HTML escaping. There are five render functions; the README's table shows four rows because it merges the approved and changes-requested outcomes. Interpolating a project title or staff comment into `html` without `escapeHtml` is an injection into the staff review inbox, so the templates are the only place that builds email markup.

### `trustHost` is enabled in non-development

`src/lib/auth.ts` sets `trustHost: process.env.NODE_ENV !== "development"`. Required behind the CloudFront/ALB proxy chain in production so origin detection works. Disabled in dev where `localhost:3000` is direct.

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

The column is created in a hand-written migration as `GENERATED ALWAYS AS (...) STORED`. Drizzle's `db:generate` will not produce this for you. Do not write the migration by tweaking the generated SQL; author it directly.

If you ever need to change the weight expression, drop the column and re-add it. Generated-always-stored columns cannot be altered in place.

Dropping a `GENERATED ALWAYS AS ... STORED` column also drops every index defined on it; Postgres does not preserve or warn about this. `drizzle/0010_category_domains.sql` drops and recreates `inventory_items.search_vector` (to migrate `category` off the table and onto the `inventory_item_categories` junction table) and its migration explicitly re-issues `CREATE INDEX ... USING GIN ("search_vector")` in the same file, after the `ADD COLUMN`. Skipping that step leaves full-text search working (Postgres will still plan a sequential scan) but silently un-indexed. Confirm the index exists after any such migration:

```sql
SELECT indexname FROM pg_indexes WHERE tablename = 'inventory_items';
```

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

Cascade rules are encoded in the schema, not in application code. Never recompute them at runtime.

**Into `user.id`.** These are the ones that decide whether an account can be deleted, so they are listed in full.

| Rule | Columns |
| --- | --- |
| `CASCADE` | `session.user_id`, `account.user_id`, `notifications.user_id`, `user_interests.user_id`, `program_instructors.user_id`, `project_collaborators.user_id`, `project_bookmarks.user_id`, `inventory_cart_items.user_id`. Sessions, credentials, and things the account merely marked. |
| `RESTRICT` | `project_comments.author_id`, `project_status_history.changed_by`, `project_edit_log.editor_id`, `inventory_item_status_history.changed_by`, `inventory_item_edit_log.editor_id`, `inventory_requests.user_id`, `project_bids.student_id`, `project_assignments.student_id`, `project_assignments.assigned_by`, `projects.program_manager_id`. Authorship and audit trail: history has to outlive the person, so an account with any of this cannot be hard-deleted. |
| `SET NULL` | `projects.proposer_id`, `inventory_items.current_holder_id`, `inventory_request_items.reviewed_by`, `inventory_request_items.closed_by`, `inventory_item_status_history.holder_id`. Attribution that can be lost without losing the record. A deleted proposer's `proposer_id` nulls out while `proposer_email` retains the link for re-linking (see "Projects" below). |

Note `inventory_items.current_holder_id`: nulling it does **not** change `status`, so deleting a user who holds an item strands it in `checked_out` with no holder and no way to return it. Return the item first.

**Everywhere else.** `CASCADE` on junction tables and on anything scoped to a parent row (`project_categories`, `inventory_item_categories`, and the comment, history, and edit-log tables against their project or item). `SET NULL` on `projects.program_id`, `inventory_item_status_history.request_item_id`, and `inventory_items.current_request_item_id`. `RESTRICT` on `inventory_request_items.item_id`, so an item with request lines cannot be deleted.

`project_bids.project_id`, `project_bids.program_id`, and `project_assignments.project_id` declare no rule at all and so are `NO ACTION`. Those two tables have no UI yet; if they ever get one, give them explicit rules first.

Deleting an account outright is an operator task, not a feature: `scripts/delete-user.mjs` purges a test account and its own content and refuses when it acted on anything else. See "Delete a test account" in `DEPLOYMENT.md`.

### Timestamps always `withTimezone: true`

Every timestamp column uses `timestamp("col", { withTimezone: true })`. Stored as `timestamptz`. Required ones chain `.notNull().defaultNow()`. Optional event timestamps (`publishedAt`, `archivedAt`, `deletedAt`, `reviewedAt`, `banExpires`) are nullable but still `withTimezone`.

### TRUNCATE in tests wipes dev data

The integration test setup (`src/test/setup.integration.ts`) calls `TRUNCATE TABLE ... CASCADE` on every table before each test. The test config uses the same `DATABASE_URL` as dev. **Running `npm run test:integration` deletes your dev data.** If your project disappears after running tests, that is why.

Long-term fix: use a separate `eecs_capstone_test` database with its own `DATABASE_URL` in `vitest.integration.config.ts`. Not yet implemented.

---

## Vitest test infrastructure

### Run the tests on the Node in `.nvmrc`, not whatever is on PATH

`.nvmrc` pins 24.16.0 and CI uses the same. On Node 26 the jsdom environment
comes up without `localStorage`, and every test that touches it dies with
`TypeError: Cannot read properties of undefined (reading 'clear')`. That is
about 65 tests across `table-state`, `view-preference`, `use-seed-view`,
`view-toggle` and `admin-data-table`, none of which have anything to do with
whatever you were changing.

`package.json` says `"engines": { "node": ">=24" }`, which Node 26 satisfies,
so nothing warns you. A Homebrew or system Node is the usual way to end up
there.

The trap worth knowing: if your shell loads nvm through a function (the common
lazy-load pattern), anything that bypasses shell function resolution silently
gets the *other* Node. `env FOO=bar npx vitest ...` does exactly that, and so
does any wrapper that execs a binary directly. `npx vitest` passes and
`env npx vitest` fails, on the same machine, in the same directory, with no
other difference. Check `node --version` from inside the same invocation before
believing a strange test failure.

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

- `ReferenceError: module is not defined at .../react/index.js`: React's CJS module loading under Vite's ESM runner.
- `Tests closed successfully but something prevents Vite server from exiting`: connection-lingering, no impact.

Tests still pass. Ignore both.

### Radix Popover / cmdk need jsdom polyfills

Component tests that mount a Radix Popover or a cmdk `Command` (for example the proposer account picker) throw on render unless you stub the DOM APIs jsdom omits. Add them in a `beforeAll`: `Element.prototype.scrollIntoView`, `hasPointerCapture`, `setPointerCapture`, `releasePointerCapture` (each `vi.fn()`), plus a no-op `globalThis.ResizeObserver` class. Also, `PopoverContent` only mounts when the popover is open, so click the trigger before querying anything inside it. The canonical setup is in `src/test/proposer-picker.test.tsx`. Most form tests dodge this by mocking the heavy Radix children instead (see `src/test/project-form-ai-review.test.tsx`).

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

## Biome / Ultracite and code style

Linting and formatting run through **Ultracite** (a strict Biome preset). `biome.json` extends `ultracite/biome/core` + `ultracite/biome/react`. `npm run check` runs `ultracite check`; `npm run format` runs `ultracite fix`.

### Hard rules

- 2-space indent.
- Double quotes for JS / TS strings.
- Imports auto-sorted by the Biome assist organize-imports rule. Don't fight it.
- Everything is checked except generated / tool-managed paths excluded in `biome.json`: `src/routeTree.gen.ts`, `src/styles.css`, `scripts/`, and `drizzle/`. (Biome respects `.gitignore` via `vcs.useIgnoreFile`, so `playwright-report/` etc. are skipped too.)
- `npm run check` must be clean before committing. Run `npm run format` (or `npx ultracite fix`) to auto-fix.

### Rules deliberately relaxed or deferred

Tuned in `biome.json` rather than fought file-by-file:

- **Disabled (idiom / framework conflict):** `noVoid` (intentional fire-and-forget `void promise()`), `useFilenamingConvention` under `src/routes/**` (TanStack `$param` / `__root` files), plus inline ignores for `noNamespaceImport` (drizzle `import * as schema`, shadcn) and `noBarrelFile` (the schema re-export).
- **Relaxed in tests** (`*.test.ts(x)`, `__tests__/`, `src/test/`): `useTopLevelRegex`, `noEmptyBlockStatements`, `useAwait`, `noNonNullAssertion`.
- **Deferred (need real a11y/UX work, tracked as findings):** `useImageSize` (add intrinsic image dimensions) and `noAlert` (replace `alert()`/`confirm()` with proper UI). Re-enable when addressed.

### Do not run `biome check --write --unsafe` blindly

The unsafe autofix rewrote `viewer!.id` to `viewer?.id` (changing a throw into a silent `undefined`) and converted a `type` alias to an `interface` (which broke a `Record<string, unknown>` cast). Review unsafe fixes diff-by-diff; prefer `npm run format` (safe fixes only).

### Soft rules / project conventions

The prose and commit-message rules (no emdashes, no emojis, lowercase imperative
subject) bind every turn, so they live in [`../AGENTS.md`](../AGENTS.md) instead of
here.

- **Component file naming** is `kebab-case.tsx` (`project-card.tsx`, `status-badge.tsx`).
- **`#/` import alias** for cross-directory imports inside `src/` (defined in `package.json`). Avoid `../../../...` chains.

### Biome formatter quirks we hit

- Single-line index entries in Drizzle table configs sometimes get reformatted across runs. Accept the format Biome wants.
- TanStack Router `<Link>` JSX with three or more attributes will be split to multi-line. Don't pre-format yourself; let `npx biome format --write` handle it.

---

## Project conventions

The git rules (stage by name, stay on `main`, leave `AGENTS.md` unstaged) bind every
turn, so they live in [`../AGENTS.md`](../AGENTS.md) instead of here.

### Path-by-path convention summary

| Path | What goes there |
| --- | --- |
| `src/lib/*.ts` | Pure modules, client-safe wrappers. |
| `src/lib/_internal/*.ts` | Server-only helpers (auth-guards). |
| `src/lib/__tests__/*.test.ts` | Pure-module unit tests. |
| `src/server/*.ts` | createServerFn wrappers (Zod schemas + dynamic-import handlers). Client-importable. |
| `src/server/_internal/*.ts` | Impl + `*As(viewer, ...)` + `*ForCurrentUser(...)` helpers. Server-only. |
| `src/server/__tests__/*.integration.test.ts` | Integration tests against docker Postgres. |
| `src/components/*.tsx` | App components built on shadcn/ui + Radix primitives (see `src/components/ui/`). |
| `src/routes/...` | TanStack file-based routes. `_layout.tsx` are pathless. `routeTree.gen.ts` is auto-generated; do not hand-edit. |
| `src/db/schema.ts` | Hand-written Drizzle schema for app tables. |
| `src/db/auth-schema.ts` | Better Auth CLI-generated tables. Do not hand-edit; preserved through regen via `additionalFields`. |
| `drizzle/*.sql` | Generated migrations. New tsvector / FK-rule changes are HAND-AUTHORED (see Drizzle section). |
| `scripts/*.ts` | Operational scripts (seeding, one-shot fixes). Not Biome-checked. |
| `docs/superpowers/specs/*` | Design docs per feature. One per "spec". |
| `docs/superpowers/plans/*` | Implementation plans per spec. One per "spec". |
| `docs/QUIRKS.md` | This file. |
| `docs/UI-CONVENTIONS.md` | Design system rules: components, tokens, responsive layout. |

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

### Categories: `domain` is closed, `type` is an open project-only facet, filtering is all-match

`categories.domain` is a closed enum (`"project" | "inventory"`) fixed at creation and immutable on update; it decides which picker a category can appear in and, for inventory, is enforced again at the junction-table read (`listInventoryCategoriesImpl` in `src/server/_internal/inventory.ts` re-filters on `domain = 'inventory'` even though nothing today writes a project-domain row into `inventory_item_categories`: belt and suspenders, not a defense against something that currently happens). `categories.type` is a separate, nullable, free-text facet (grouping label like "technology" or "industry") that only the project domain uses for grouping in the UI; inventory categories always carry `type = null` and are rendered as one flat list, not grouped. An inventory item can carry many categories through `inventory_item_categories` (many-to-many), the same shape `project_categories` already used for projects.

Both listings filter categories as all-match, not any-match: every selected category id must be present on the item/project, not merely one of them. The shape is a subquery grouped by item/project id with `HAVING count(*) = <number of selected ids>` (`buildInventoryScope` in `src/server/_internal/inventory.ts`, mirroring `searchProjectsImpl` in `src/server/_internal/search.ts:40-46`); a plain `inArray` on the junction table would silently give any-match semantics instead. Every category filter's `.inputValidator` therefore expects `categories: z.array(z.string().uuid())`, not a singular `category: z.string().uuid().nullable()`. A route that still sends the singular key gets it silently stripped by Zod (the array param defaults to `[]`), and the filter does nothing while looking fine. `.catch([])` on the array schema is what lets a stale pre-multi-select `?category=<slug>` link degrade to "no filter" instead of a 500.

Inventory full-text search no longer matches category names. Before this feature, `inventory_items.search_vector` weighted a `category` text column into the vector (`drizzle/0003_last_invaders.sql:61`, weight `'C'`). That column is gone; categories now live in the `categories` table, reached through the `inventory_item_categories` junction table. `search_vector` is a `GENERATED ALWAYS AS (...) STORED` column (see the tsvector quirk above), and a generated column can only read other columns on the same row, so it cannot follow that join to pull category names back in. The rebuilt column (`drizzle/0010_category_domains.sql`) simply drops the category term rather than trying to fake it. This is treated as an accepted gap, not a bug to fix: searching "electronics" no longer also surfaces every item merely tagged with a category named "electronics," but the all-match category filter documented above already covers that use case directly, and correctly, for a caller who wants it.

### A Hold is a union, and `src/lib/hold.ts` owns it

**Hold** is the domain term for who is holding an item. A hold is on a person or on a thing, never both and never neither, and `src/lib/hold.ts` is the one place that rule lives. It is a pure, client-safe module in the same shape as `src/lib/project-visibility.ts`, unit tested in `npm test` with no docker.

Four cases, of which the first two are both person holds:

| Case | Columns written | Notes |
| --- | --- | --- |
| `account` | `current_holder_id`, `current_holder_email` | Carries no `program`, and its `name` comes from the account |
| `walk_in` | `current_holder_email`, `current_holder_name`, `current_holder_program` | An address that matched no account |
| `thing` | `current_holder_label`, and a name and program if given | A label, e.g. "Lab 204" |
| `none` | all five null | An available, maintenance or retired item |

Two rules are structural rather than checked. **An account beats a typed name**: the `account` case has nowhere to put a name or program, so a name typed for an address that turns out to have an account is dropped by the shape rather than by a ternary, and `holdToColumns` writes `null` to `current_holder_name` because a second copy of the account's name is what lets the two drift. **A walk-in is identified by its address**, so that case requires an `email`.

What the union does **not** guarantee, and this matters before you delete anything that looks redundant:

- **"Never neither" is status-dependent and cannot be enforced here.** `{ kind: "none" }` is legal and necessary. Only `validateInvariants` knows a `reserved` or `checked_out` transition may not have it, which is why its `reserved`/`checked_out` arm stays. That arm also catches `holderId` together with `holderLabel`, which the `holderId` resolution path never routes through the constructor, and `inventory.integration.test.ts` asserts its exact wording.
- **Not every hold is built through `holdFromInput`.** Read paths construct cases directly from stored columns. A union constrains only what passes through its constructor.

Whitespace is not trimmed here, deliberately: `validateInvariants` decides person-versus-thing on raw truthiness and `transitionItemInTx` stores the raw strings, so the constructor matches both and an input cannot pass one guard then be re-judged by a stricter one. Trimming is the input layer's job. An empty string **is** normalized to null, which is a change from the old inline writes and a fix rather than a regression: `??` does not treat `""` as absent, so an empty `current_holder_name` stopped the admin table's `name ?? email ?? label` chain from falling through and rendered a blank cell for an item that did have a holder.

The precedence order (name, then address, then label) has two renderings, and the module owns the order rather than collapsing the formats: `formatHoldDetailed` gives the lifecycle panel `Name (address) · Program`, `formatHoldShort` gives the admin table a bare one-liner. A TanStack Table `accessorFn` paired with `sortUndefined: "last"` must map the module's `null` to `undefined`, because `sortUndefined` does not special-case `null`.

`holderFields` in `src/components/inventory-lifecycle-panel.tsx` deliberately does **not** call `holdFromInput`. The constructor asks "is there an account?"; the dialog asks "do I know there is no account?", and `AccountStatus` has a third state, `unknown`, because the lookup is debounced. Expressing "an account exists but I do not know which" would need a fabricated account id. The client refusing to compose an illegal payload and the server defining what is illegal are two different jobs, and the server re-derives independently either way.

### Lazy deadlines, no scheduler

`pickup_by` / `due_at` on `inventory_request_items` and `current_pickup_by` / `current_due_at` on `inventory_items` are informational only. There is no cron. The "past pickup window" / "overdue" badges are computed at query time. Lazy idempotent notifications are inserted on read via `recordOverdueNotificationsAs`, which runs two scans: request lines with `status = 'approved'` (scoped to the viewer's own requests), and staff holds (`current_holder_id IS NOT NULL`, `status IN ('reserved', 'checked_out')`), both folded into one `values` array for a single insert. The two scans deliberately overlap. A request line and a hold can describe two different people, because a teammate can collect an item someone else requested: the requester is accountable for the request and the picker is holding the thing, so both are notified. `notifications_overdue_unique_idx` on `(user_id, type, link)` does not collapse that case, and must not, because the user ids differ. The far more common case, where requester and picker are the same person, has both scans return the same row twice in one batch. `onConflictDoNothing` already collapses intra-batch duplicates on its own (it is `DO UPDATE` that errors with "cannot affect row a second time"), so the database would handle that case either way. The candidates are also deduped in JS on `(userId, type, link)` before the insert, which keeps the statement smaller and puts the intent where a reader will look for it, not because the index is unable to. That same index, a partial unique index for the two overdue types keyed on `/inventory/${itemId}` rather than the request line, lets `onConflictDoNothing` collapse re-reads (the same scan producing the same row again on a later call) into the same key space. The target + where are declared explicitly so future unique indexes on `notifications` cannot silently swallow unrelated conflicts.

The hold scan additionally requires `current_holder_id IS NOT NULL`, narrower than the `/my/items` read path (`listMyItemsAs`), which also matches an unlinked hold by verified email. `notifications.user_id` is a foreign key to an account; an email-matched hold with no resolved account has no id to attribute a message to, and resolving the email here would reintroduce, on a write path, the impersonation risk the read path guards against. Net effect: a walk-in hold assigned by email shows in `/my/items` once the address matches a verified account, but does not notify until staff link it to an account. That linking happens automatically on the next transition that resolves the holder's email to an account and keeps the hold (e.g. reserved to checked_out); a transition that releases the item to `available` instead clears `current_holder_email` outright, so if the item is released before that resolution happens there is no longer a hold to notify about.

### Hard delete is narrow

`inventory_items.id` is referenced by `inventory_request_items` with `ON DELETE RESTRICT`. Hard delete works only when no historical request lines reference the item. `hardDeleteInventoryItemAs` pre-checks this and throws a friendly error instead of letting Postgres surface `23503`. Use retire for anything that has been requested.

### `transitionItem` is the only writer

Every status change to an inventory item goes through `src/server/_internal/inventory-transitions.ts::transitionItem`. It is the only place that writes `inventory_item_status_history` rows and the only place that syncs `current_holder_*` columns with the item status. This is now literally true, and checkable: `grep -rn '\.update(inventoryItems)\|insert(inventoryItemStatusHistory)' src --include='*.ts' | grep -v __tests__` returns four hits, two in `inventory-transitions.ts` and two in `inventory.ts` that touch attribute columns only (`updateInventoryItemAs` and `uploadInventoryImageAs`, neither of which writes status or holder).

An earlier version of this entry granted reject and cancel a standing exemption "because they emit custom notifications and need different transaction shapes". Both were routed through `transitionItem`, along with `submitCartAs`, which had been writing inline without the entry mentioning it at all. The exemption had already cost one bug: `4c22016 fix(inventory): clear the walk-in name and program on reject and cancel` is what happens when two new hold columns are added and only two of four writers learn about them.

The four callers each keep what is genuinely theirs (who may act, and which line is eligible) and pass the rest:

- **Approve** delegates via `transitionItem(viewer, input, tx)` from inside the approve transaction, using the optional `externalTx` argument.
- **Reject** passes `lineDecision: { outcome: "rejected", requestItemId }` plus the review comment.
- **Cancel** passes `authority: "self_cancel"` and `lineDecision: { outcome: "cancelled", ... }`.
- **submitCart** passes `authority: "self_request"`, once per surviving cart line, on its open transaction. Re-locking a row the transaction already holds is free, which is why it shares the writer rather than a private helper.

Two fields carry the variation, and both default to the previous behavior when absent:

**`authority`** is the only way past `assertStaff`, and it is default-deny. `AUTHORITY_TARGET` is the single source of truth for which values exist and which status each may reach (`self_cancel` releases, `self_request` requests); an unrecognized value is rejected rather than ignored, and a self-service transition may not name a `holderId` other than its own viewer. **`transitionSchema` in `src/server/inventory.ts` must never declare this field.** `transitionInventoryItem` carries only `requireUser()`, so `assertStaff` inside `transitionItem` is that endpoint's entire staff gate, and `z.object().parse` stripping the unknown key is what keeps it shut. `src/test/inventory-schemas.test.ts` asserts the stripping, including through `__proto__`; adding `.passthrough()` or `.catchall()` there would let any signed-in user retire any item.

**`lineDecision`** overrides what a released item's request line becomes, and carries the id of the line it was decided about. The two travel together on purpose: a release cannot carry `requestItemId` (`validateInvariants` forbids it on those statuses), so an outcome alone would land on whatever line the item points at, which need not be the line the caller locked. A mismatch throws. A `rejected` outcome additionally requires the line to still be `pending` and the comment to be non-empty, matching the guards `rejectRequestItemAs` has always had.

The denial notification goes to the **requester**, read from the line by `closeRequestItemOnRelease`, not to the item's current holder. Those are usually the same person and are not always: staff can take a still-pending item straight to `checked_out` for a teammate (`syncRequestItem`'s `checked_out` arm writes only `dueAt`, leaving the line pending), and a denial belongs to whoever asked.

### Deferred FK

`inventory_items.current_request_item_id` references `inventory_request_items.id` but the FK is declared in raw SQL inside the migration (not in `schema.ts`) because the two tables reference each other. `ON DELETE SET NULL`.

### submitCart is lock-first

`submitCartAs` locks each cart item with `SELECT FOR UPDATE` and re-checks `status === "available"` before treating it as a survivor. The `inventoryRequests` envelope is inserted only after the lock phase confirms at least one survivor, so an all-race path never leaves an orphaned request row. Items that lost the race are returned in the `skipped` array with reason `"no_longer_available"`.

## Projects

### Staff-only columns leak unless stripped in `stripStaffOnlyFields`

`getProjectImpl` (`src/server/_internal/projects-queries.ts`) returns the WHOLE project row through `stripStaffOnlyFields(project, viewer)`, and that object is serialized into the public SSR loader payload of `/projects/$id` for any viewer, including anonymous ones. A new staff-only column does NOT stay private just because no component renders it: it rides the payload unless you null it for non-staff inside `stripStaffOnlyFields` (`src/lib/project-visibility.ts`). Today `notes` and `proposer_email` are stripped there. Add any future sensitive column to that function and verify with a non-staff read before shipping.

### Proposer linking is by email; `proposer_id` is canonical

A project's proposer is either linked to an account (`proposer_id`, a nullable FK) or pending (`proposer_email` set with no account yet). Email is the link key; `proposer_id` is the source of truth once an account exists. Staff set it through the proposer field on the project form (`ProposerPicker`, see below); the server resolves the email to an account id on every write via `resolveProposerId` (`src/server/_internal/projects.ts`), and a non-staff request carrying `proposer_email` is ignored, not honored. `proposer_id` is never accepted from the client.

Two emails, do not conflate them: `proposer_email` is the private link key (stripped from public reads, see above); `contact_email` is a separate, manually entered, publicly visible field. The edit form prefills `proposer_email` from the linked account's CURRENT email (`getProposerForEditAs` / `getProposerForEditImpl` in `src/server/_internal/projects-queries.ts`, returning a `ProposerForEdit`) so an untouched staff save re-resolves to the same proposer; a blank email on create defaults the proposer to the creator, while clearing it on edit is an explicit unlink. Once an account is linked, the field is read-only: `ProposerPicker` (`src/components/proposer-picker.tsx`) locks the input and routes any change through a "Re-assign" modal instead of letting staff retype the address; picking a new account, or explicitly unlinking, in that modal unlocks the field, because the lock is keyed off whether the current value still equals a mount-time snapshot of the saved one. That means it is the divergence that unlocks, not the act: retyping the original address exactly re-locks the field, which is harmless but surprising if you are looking for it. The design spec's Phase B listed a "live back-fill hook" as future work alongside the OSU ONID provider itself; the hook is built now, see "Projects are claimed only by a verified address" below, and it applies to any provider whose create hook reports `emailVerified`. Only the ONID provider configuration is still future work; see `docs/superpowers/specs/2026-06-07-proposer-account-linking-design.md`.

### Projects are claimed only by a verified address

`projects.proposer_id` is set at write time by `resolveProposerId`, which only
matches accounts that already exist. A project proposed for someone who has not
signed up yet stays unlinked, and an unlinked proposer gets no "My projects"
entry, no status notifications, and no review emails.

`claimProjectsForVerifiedUser` closes that gap from two hooks in
`src/lib/auth.ts`: `afterEmailVerification` for the password path, and
`databaseHooks.user.create.after` for OAuth, guarded on `emailVerified`.

The guard is the point. Claiming on account creation alone would let anyone take
a colleague's projects by registering at their address. Anything that adds a
third claim path must be able to name the proof of ownership it relies on.

The guard bounds the ordinary paths, not every path. Better Auth's admin plugin
takes an open `data` record on create-user, so an admin can set `emailVerified`
for an address nobody has proven and the create hook will claim for it. That is
tolerated only because an admin is already trusted with far more; it is not a
license to add a third caller on the same reasoning.

Note that one address with both a password account and GitHub ends up as a
single user row with two `account` rows: Better Auth links them implicitly, and
only when the local row is already verified. So no third hook is needed, and the
`proposer_id is null` guard makes the claim idempotent anyway.
