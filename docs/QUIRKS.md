# Framework Quirks

A running log of every gotcha we have hit: framework behaviour, test infrastructure, storage, Bedrock, Biome. Read this before debugging anything that "should just work."

This file is one of three. The vocabulary is in [`../CONTEXT.md`](../CONTEXT.md), the decisions (things we chose, with a trade-off) are one paragraph each in [`adr/`](./adr/), and this is the gotchas (things the world did to us). A section here that used to argue a decision now points at its ADR in one line.

The stack is fast-moving. TanStack Start, TanStack Router, Better Auth and Drizzle all ship breaking changes faster than any model's training data tracks, and the ones here have already renamed methods and moved APIs under this project. Check them with the context7 MCP server rather than recalling them, treat the official docs as a starting point, and treat this file as the ground truth for THIS codebase. Do not restate a version here to say how current the stack is; `package.json` carries that and cannot go stale. A version number that IS the gotcha stays, as with the Better Auth OAuth path change below: there the number is the fact, not decoration.

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
13. [Amazon Bedrock](#amazon-bedrock)
14. [Site traffic](#site-traffic)
15. [Site metadata](#site-metadata)

---

## TanStack Start

### `createServerFn` must be a top-level exported `const` initializer

Start's compiler strips a handler from the client bundle only when `createServerFn(...).handler(fn)` is the direct initializer of a top-level exported const. Built inside a factory, the handler ships to the browser with its server imports (`ReferenceError: Buffer is not defined`). Write ten near-identical functions as ten constants. `src/server/__tests__/access-contract.test.ts` fails on a shape it cannot read.

```ts
// Stripped on the client.
export const submitProject = createServerFn({ method: "POST" })
  .validator((d: unknown) => schema.parse(d))
  .handler(async ({ data }) => { /* server work */ });

// Ships to the browser, server imports and all.
const make = (s: Status) => createServerFn({ method: "POST" }).handler(/* ... */);
```

### Server-only modules must not match `**/*.server.*`

Start's import protection fails the build on any client-chain import of a `*.server.*` path, even one inside a stripped handler. Server-only code goes under `_internal/`: [ADR-0001](./adr/0001-internal-directory-for-server-only-code.md).

### An impl imports its input types back from its domain's wrapper, type-only

`import type { XInput } from "../x"`, never the schema value, which would pull `createServerFn` into the impl. [ADR-0001](./adr/0001-internal-directory-for-server-only-code.md) has the rule; `verbatimModuleSyntax` turns a dropped `type` into a tsc error.

### `.validator(...)`, not `.inputValidator(...)`

The method is `.validator`. `.inputValidator` is a deprecated alias the Start compiler warns about at every call site, and the plans under `docs/superpowers/plans/` still use it.

### Code that must run at boot goes in a Nitro plugin, not `src/server.ts`

Nitro loads the server entry (`src/server.ts`) on the first request, not at start. Measured on the built output, a throw there leaves the process up and answering 500 on every route, `/api/healthz` included. A plugin listed in `nitro({ plugins })` in `vite.config.ts` runs before the listener binds, so a throw there is exit code 1 and no port. `src/nitro/config-check.ts` is that plugin, and `src/lib/_internal/startup-config.ts` holds the fatal list. The pool warm-up runs on the first request on purpose: [ADR-0052](./adr/0052-the-pool-keeps-a-warm-floor.md).

### A loader that throws during SSR logs nothing unless `src/server.ts` does it

On the server, router-core catches a loader's or `beforeLoad`'s error, renders the error component and answers 500; no error boundary and no `onCatch` runs, so nothing reaches the log. `src/server.ts` writes one line per failed match through `renderFailureLines` (`src/lib/_internal/render-failure.ts`) and answers 403 for a role refusal. Keep the entry thin: it loads on the first request.

### The SSR pass hashes `?url` assets on its own, so Tailwind's scan set is pinned

The client and SSR builds each hash `src/styles.css`, and only the client build writes it. When Tailwind's automatic source detection scans different files in the two passes (in Docker, without `.gitignore`, it scanned `.output/`), the SSR HTML links a stylesheet that 404s. `source("../src")` in `src/styles.css` pins the scan set, and `scripts/check-asset-manifest.mjs` fails CI and the Docker build when the server bundle names a missing asset. A `?url` import outside `src/` extends `source()`.

### The HTTP server's timeouts are only reachable by wrapping `createServer`

Nitro hands srvx no `node` options, so `keepAliveTimeout` and the other server timeouts stay at Node's defaults unless `src/nitro/keep-alive-timeout.ts` wraps `http.createServer`. The numbers are in `src/lib/_internal/keep-alive-timeout.ts`; [ADR-0041](./adr/0041-the-task-outlasts-the-load-balancer-idle-timeout.md) is why.

### Generated route tree

`src/routeTree.gen.ts` is written by the router plugin; boot `npm run dev` to regenerate it after adding a route. `.claude/hooks/guard-edits.mjs` refuses a hand edit.

---

## TanStack Router

### Pathless layouts nested under pathless layouts resolve to `/`

A pathless child of `_authed` resolves to `/` and collides with `src/routes/_public/index.tsx`, so the admin layout is `_authed/admin.tsx` (URL `/admin`). `_public.tsx` is a sibling of `_authed`, not a child, so it is unaffected. A layout whose children are destinations gets at least one URL segment.

### Guards below `_authed` read `context.user`, not the session

`_authed.tsx` reads the session once and returns `{ user }`. Every `beforeLoad` below it guards on `context.user` with `requireStaff` or `requireAdmin` from `src/lib/access-denied.ts`, which refuse in place rather than redirect ([ADR-0057](./adr/0057-a-missing-role-is-refused-in-place.md)); `src/test/route-guards.test.ts` enforces both. The refusal is a thrown plain object, because the router dehydrates an `Error` subclass without its fields. It renders through `defaultErrorComponent` in `src/router.tsx`, since the router never falls back to a parent's `errorComponent`, and its 403 comes from `src/server.ts`. A hard load logs the refusal once in the browser console; that is React reporting a caught error.

### Route search params via `validateSearch`

```ts
export const Route = createFileRoute("/projects/")({
  validateSearch: z.object({ page: z.number().int().min(1).catch(1).default(1) }),
  loaderDeps: ({ search }) => ({ page: search.page }),
  loader: ({ deps }) => listPublishedProjects({ data: { page: deps.page } }),
});
```

A search-driven loader needs `loaderDeps` to re-run. Every field takes a `.catch`: the router JSON-parses each value before the schema sees it, and a bad value otherwise fails `validateSearch` with a 500. `src/test/route-search-fallbacks.test.ts` enforces it. A `q` field is `searchParamQuerySchema` from `src/lib/search-query.ts`. A param naming where to go next, `?redirect=` on `/sign-in`, goes through `sameOriginPath` (`src/lib/same-origin-path.ts`) ahead of its `.catch`; that is the one off-site check the app owns.

### A route component is reused across a param change; key any child that holds a draft

Navigating from `/projects/A` to `/projects/B` re-renders the same component instance, and nothing remounts unless the route sets `remountDeps`. A child holding a draft in `useState` keeps A's draft while B loads, and a Save posts it onto B. Key the outermost child that holds a draft, as `$projectId.tsx` keys `StaffProjectPanel` on `project.id` (`staff-project-panel.test.tsx` pins it), rather than setting `remountDeps`, which also discards state the page should keep.

### The router blocks on a stale reload, and a `useState` seeded from loader data depends on it

A `useState` initializer never re-runs, so an input seeded from loader data is correct only because `src/router.tsx` sets `defaultStaleReloadMode: "blocking"`. [ADR-0029](./adr/0029-a-revisit-waits-for-its-loader.md) is the decision; the census of seeds is `CENSUS` in `src/test/loader-seed-scan.test.ts`, which fails on an unclassified one. A route opts out on its loader object, `loader: { handler, staleReloadMode: "background" }`, not as a route option.

### A redirect thrown from a `queryFn` navigates the tab

`setupRouterSsrQueryIntegration` in `src/router.tsx` leaves `handleRedirects` on, so a TanStack redirect thrown by any query navigates the tab. `requireUser` refuses with `redirect({ to: "/sign-in" })`, so a background refetch after a session ends carries the tab to `/sign-in`, unsaved edits included. A query over a `requireUser` server function catches `isRedirect` and returns an empty result, as `notification-bell.tsx` does.

### `Route.useSearch()` lags `navigate()` by the loader round trip

The URL changes at once, but `useSearch` reads the rendered match, and a search change that alters `loaderDeps` renders only when its loader resolves. Code that writes a search param and watches it for outside changes sees its own write come back late. `useDebouncedDraft` compares against what it last committed; `src/lib/__tests__/use-debounced-draft.test.tsx` covers the echo, a cancelled commit, and Back and Forward.

---

## TanStack Form

### Pass the schema to `validators.onSubmit` directly; `.default()` is what breaks it

Zod 4 schemas are Standard Schemas, so `onSubmit: projectFormSchema` type-checks. If it stops, look for a `.default()`: it makes the schema's input type differ from the form's values. Supply defaults through `defaultValues` instead.

### `useForm` generics are unstable; we use a localized `any` for the `Field` helper

The `biome-ignore` reason at each `type AnyForm = any` is the explanation; the forms' public props stay typed.

### `field.state.meta.errors` is a heterogeneous array

Render every field's errors through `FieldError` (`src/components/ui/field.tsx`), which handles strings and `{ message }` objects alike. A raw render shows nothing, leaving a disabled Save and no message. A `z.boolean()` checkbox cannot fail and needs none.

### Both forms own their save; the route components only navigate

`InventoryForm` and `ProjectForm` call their server functions and hand the saved id back through `onSaved`, because `src/test/` cannot render a route component. The project form has no staff-only control: staff set the proposer and the categories from the staff panel on the project page, and `updateProjectProposerAs` is the only writer of the proposer address after create ([ADR-0007](./adr/0007-proposer-linking-by-email.md)).

### Server errors via `applyServerErrors`

Wrap a form's submit in `try`/`catch` and pass the error to `src/lib/apply-server-errors.ts`, which maps a `ZodError` onto field errors; when it returns false, show the message in a banner.

### `defaultValues` follows new props only until a field is touched, and a blur touches it

`FormApi.update` swaps new `defaultValues` into a form only while nothing is touched, and a blur touches a field. No form here follows new defaults into a touched form, because the router blocks on a stale reload: [ADR-0029](./adr/0029-a-revisit-waits-for-its-loader.md) has the reason, and `CENSUS` in `src/test/loader-seed-scan.test.ts` the two form seeds.

---

## Better Auth

### `betterAuth()` does not reject an option it does not know

The config literal is inferred as a type parameter, so TypeScript's excess-property check never runs and a misspelled key compiles and does nothing. When an option seems to have no effect, check its key against `@better-auth/core/dist/types/init-options.d.mts`.

### `user.id` is `text`, not `uuid`

Better Auth generates `text` primary keys and we keep the default, so every FK to `user.id` is `text`.

### `additionalFields` are restored across CLI regenerations

`npx @better-auth/cli generate` overwrites `src/db/auth-schema.ts`, and the custom fields come back because they live in `user.additionalFields` in `src/lib/auth.ts`. Change them there; `.claude/hooks/guard-edits.mjs` refuses an edit to the generated file.

### Console email transport in dev

`EMAIL_TRANSPORT=console` writes every email the app sends to stderr, which is where a local sign-in code arrives. `EMAIL_TRANSPORT=ses` needs `EMAIL_FROM`, and `getEmailSender()` runs at import in `src/lib/auth.ts`, so a missing one takes down the app, not just mail. All email markup comes from `src/lib/email/templates.ts`, which owns the escaping.

### `trustHost` is enabled in non-development

`trustHost` is `NODE_ENV !== "development"` while `useSecureCookies` is `=== "production"`. The gap is residue, not a decision; `buildAuthConfig` in `src/lib/_internal/auth-config.ts` says why nothing rides on it, and `auth-config.test.ts` pins it.

### Rate limiting is production-only, and needs `trustedProxies` to see a client

The limiter runs only under `NODE_ENV=production`, so nothing local exercises it. With no `advanced.ipAddress.trustedProxies`, Better Auth believes only a one-entry `X-Forwarded-For` and otherwise keys every viewer into one shared bucket. `TRUSTED_PROXY_CIDR` fills the list, and production refuses to boot without it. The value names no real hop: the ALB runs `xff_header_processing_mode = "preserve"` (`infra/ecs.tf`), so the task sees CloudFront's header, whose last entry is the viewer, and the VPC range only keeps the list non-empty. `src/lib/__tests__/trusted-proxies.test.ts` pins the walk. Counters are per task and reset on deploy.

### The rate limit numbers are configured, not inherited

`src/lib/_internal/auth-rate-limits.ts` holds every number and [ADR-0039](./adr/0039-sign-in-limits-are-sized-for-a-shared-address.md) argues them. Rules apply in three layers: Better Auth's own, then each plugin's `rateLimit` array (`emailOTP()` sets 3 per 60 seconds on all nine of its paths), then `customRules`, which overrides both. In `customRules` the first matching key wins and `*` does not cross a slash, so spell every path out; a key naming an unmounted path is silently ignored, which `auth-rate-limits.test.ts` catches. A max is a budget between lulls, not a rate: every accepted request pushes the reset out. The key is always `(ip, path)`, so no rule can count per account.

### Two `APIError` classes reach an after-hook, and only one is `instanceof` yours

better-call throws its own `APIError` for a body that fails validation, so `instanceof` the one from `better-auth/api` is false for a malformed request. Use `isAPIError`, or detect success positively, as the code sign-in's after-hook does with `ctx.context.newSession`. An after-hook also runs when the endpoint threw, with the error in `ctx.context.returned`, so the send's after-hook issues a claim only when `returned.success` is true. "Requests Better Auth refuses" in `email-otp.integration.test.ts` pins it.

### Session role typing

`session.user.role` is `string | null | undefined`. Ask `isStaff` or `isAdmin` from `src/lib/viewer.ts`. The legal values are `USER_ROLES` in `src/lib/vocabularies.ts` ([ADR-0016](./adr/0016-the-role-vocabulary-lives-with-the-statuses.md)), and `vocabulary-scan.ts` fails on a copy under `src/`.

### Ban enforcement reads `user.banned`; sessions linger until next server call

Setting `user.banned` stops new sign-ins, but a signed-in user keeps their session until something next checks it, so `banUserAs` deletes the user's sessions in the same transaction. A past `ban_expires` reads as not banned, and nothing clears the row.

### The ONID callback path is not the GitHub callback path, and the version pin holds it there

ONID's callback is `/api/auth/oauth2/callback/onid` on Better Auth 1.6; 1.7 moves it, and Entra matches redirect URIs exactly. So `better-auth` and `@better-auth/core` stay on the 1.6 line with a tilde range, and `.github/dependabot.yml` skips their minor and major updates. The upgrade needs a new URI allowlisted first (#278).

### `user.name` is trimmed and refused blank in the create hook

Better Auth accepts `""` for a name, so `requireUserName` (`src/lib/_internal/user-name.ts`) runs in `databaseHooks.user.create.before` and `update.before`. No render site needs a fallback for a missing name ([ADR-0015](./adr/0015-addresses-are-normalized-on-write.md)).

### `databaseHooks` covers `user` and `session`, never `account`

No hook fires when an OAuth identity links to an existing row. The only seams ahead of the link are the provider's `getUserInfo` and a `hooks.after` on the callback; `onidUserInfo` in `src/lib/auth.ts` uses the first, so `requireLocalEmailVerified` keeps its safe default.

### A plugin mounts every endpoint it has, whatever its options say

An option turns a feature off inside a handler; the route stays mounted, served and rate-counted, and `/verify-email` redeems any link it ever signed. Only top-level `disabledPaths` makes a path 404, matched exactly against the path without the base path (`/email-otp/verify-email`), before routing and the limiter, so a path with a parameter cannot be listed. `auth.integration.test.ts` and `email-otp.integration.test.ts` assert each disabled path 404s.

### `resolveOTP` rotates the record BEFORE `sendVerificationOTP` runs

So a refusal taken inside the sender has already replaced the live code with one nobody was told. Anything that can refuse a send goes in the `hooks.before` on `/email-otp/send-verification-otp`; `email-otp.integration.test.ts` fails if the per-recipient cap moves back.

### `hooks.before` sees a body Better Auth has not validated yet

Validation runs inside the endpoint, after every before-hook, so a before-hook reads raw JSON: missing fields, wrong types, padded addresses. `isMalformedCodeRequest` in `src/lib/auth.ts` leaves such a body to Better Auth. The endpoint can still refuse after the hook, so the send's after-hook refunds the reservation (`refundVerificationMail`) when the send did not succeed. Ask of any new auth hook what it does with a request the handler is about to reject.

### Better Auth skips its origin and cross-site checks under a test runner

`skipOriginCheck` defaults to `isTest()`, so under Vitest both checks are off. To test a refusal they make, set `(await auth.$context).skipOriginCheck = false` for one request and restore it in a `finally`, since every test in the file shares the context.

### `throw new APIError("OK", ...)` short-circuits a hook, but only over the router

A `hooks.before` can answer 200 without running the handler by throwing `APIError("OK", ...)`; the send guard does so to answer `{ success: true }` to a request it refuses, since any other answer enumerates accounts. Only `auth.handler` converts it, and `auth.api.*` rethrows, so test those paths through `auth.handler` with a built `Request`.

---

## Drizzle ORM + Postgres

### tsvector / generated columns need `customType` + hand-written SQL

Drizzle has no `tsvector` type: declare it read-only with `customType`, and create the column as `GENERATED ALWAYS AS (...) STORED` in a hand-written migration. Changing the expression means dropping and re-adding the column, and dropping it silently drops every index on it, so re-issue the GIN index in the same migration, as `drizzle/0010_category_domains.sql` does.

### Pool reuse

`src/db/index.ts` exports the one `db` and builds the `pg.Pool` itself, so `logPoolErrors` attaches before the first query. The sizing is in `src/lib/_internal/db-pool.ts`; [ADR-0034](./adr/0034-the-pool-is-sized-against-the-instance.md) says why, and names the one second pool, the traffic writer's in `src/db/traffic.ts`.

### The pool reports itself as a CloudWatch metric, through stdout

`startPoolMetrics` prints one Embedded Metric Format line a minute, which CloudWatch Logs turns into `PoolWaiting`, `PoolTotal` and `PoolIdle`. Anything else printed on that line, or a new dimension, silently breaks the metric the `db_pool_waiting` alarm watches. `db-pool.test.ts` pins the names to `infra/alarms.tf`.

### The listing's filter options are cached per task, and a direct insert is missing from them for a minute

A category or program inserted outside the `*As` writers (a script, a fixture, another task) is missing from the `/projects` filters until the cache expires. A new writer to either table calls `clearAllReferenceListCaches()`. [ADR-0051](./adr/0051-reference-lists-are-cached-per-task.md).

### FK rules in this project

Cascade rules live in the schema files, never in application code, and `account.integration.test.ts` pins the ones into `user.id` ([ADR-0008](./adr/0008-account-deletion-anonymizes.md)). The trap: `SET NULL` on `inventory_items.current_holder_id` leaves `status` alone, so removing a user who holds an item by any path but `deleteAccountAs`, which refuses, strands it `checked_out` with no holder.

### `categories` uniqueness needs an expression index, not a plain UNIQUE

`UNIQUE (domain, coalesce(type, ''), lower(name))`, from `drizzle/0015_categories_unique_name.sql`: every inventory category has `type = null`, and Postgres treats nulls as distinct, so a plain constraint leaves inventory unconstrained. `db-reset.ts` only truncates, so the index outlives a test: the dedupe test drops it and restores it in a `finally`, and a test that drops it and dies disarms every uniqueness assertion after it.

### The status enums take their values from `src/lib/vocabularies.ts`

Each `pgEnum` and every union over a status set derives from an `as const` tuple in `src/lib/vocabularies.ts`; add a status by editing the tuple and generating a migration. `src/lib/__tests__/vocabulary-scan.ts` fails on a complete copy elsewhere in `src/` ([ADR-0014](./adr/0014-status-vocabularies-live-in-src-lib.md)).

### Retyping a column under a SQL-only partial index

`notifications_overdue_unique_idx` exists only in SQL (`drizzle/0004`), so `drizzle-kit` cannot see it, and retyping `notifications.type` failed because Postgres rebuilds the index predicate against the old type. Drop the index, retype, recreate it by hand. Check `drizzle/*.sql` for hand-written indexes before retyping any column.

### Addresses are lowercase in the four columns we write

`inventory_items.current_holder_email`, `inventory_item_status_history.holder_email`, `projects.proposer_email` and `projects.mentor_email` are stored trimmed and lowercase through `normalizeEmailAddress` (`src/lib/email-address.ts`); [ADR-0015](./adr/0015-addresses-are-normalized-on-write.md) is the decision. Three direct writers fold by hand: `giveFixtureHold` in `src/test/e2e/fixtures.ts`, the project insert in `src/test/a11y/global-setup.ts`, and `proposerEmailOf` in `scripts/import-legacy.mjs`, which inlines `.trim().toLowerCase()` because the production image has no `src/`. Better Auth lowercases `user.email` itself, on sign-up, on OAuth link and in its internal adapter; the read-side folds on it stay, so an upgrade that changes that cannot silently stop linking accounts.

### A correlated subquery in a select projection: `db.$count`, aliased, mapped

In a `.select({...})` with no joins, Drizzle strips the table from every column interpolated at the top level of a `sql` template, so a hand-written correlated subquery compares two columns of its own table: an error when their types differ, a silently wrong answer when they match. `db.$count(table, where)` survives, because the strip does not descend into its nested `eq()`.

```ts
const aiCallCount = sql<number>`${db.$count(aiReviewUsage, eq(aiReviewUsage.userId, user.id))}`
  .mapWith(Number)
  .as("aiCallCount");
```

`.as` lets a sort read the alias instead of evaluating the subquery twice, and `.mapWith` restores the number node-postgres returns as a string. A projection that must work with and without a join uses `sql.raw('"projects"."id"')`, as `project-summary.ts` does.

### Timestamps always `withTimezone: true`

Every timestamp column is `timestamp("col", { withTimezone: true })`, nullable or not.

### TRUNCATE in tests wipes dev data

`npm run test:integration` truncates every table in the dev database before each test; `npm run db:seed:dev` puts it back. [ADR-0011](./adr/0011-integration-tests-truncate-the-dev-database.md).

### A `DrizzleQueryError` carries the bound parameters, including in its message

Its `message` includes the parameters, and a session lookup's parameter is the session token, so logging `error.message` leaks as much as logging the error. Log `redactQueryError(error)` from `src/lib/_internal/redact-query-error.ts`. [ADR-0042](./adr/0042-a-log-line-takes-a-string-never-an-error.md) has the rule and the Better Auth seams.

---

## Vitest test infrastructure

### Run the tests on the Node in `.nvmrc`, not whatever is on PATH

Another major fails about 65 jsdom tests that have nothing to do with your change. `scripts/nvmrc-node.sh` says why and is what the `pre-push` hooks run through; check `node --version` inside the same invocation before trusting a strange red.

### A test that spawns git under a hook must drop `GIT_DIR` first

A git hook exports `GIT_DIR` to everything it runs, `pre-push` runs the unit suite, and a `git init` under it once re-initialized this repository as bare. A test or hook script that spawns git strips every `GIT_*` key from its environment, as `src/test/claude-hooks.test.ts` and `.claude/hooks/lib.mjs` do.

### Scripts get their environment from `--env-file`, not from dotenv imports

ESM hoists imports above a `config()` call, so a script that loads dotenv and then imports `#/db` reads `DATABASE_URL` before it is set. Pass `--env-file=.env.local` to `tsx`, as the `db:seed:*` scripts do.

### Vitest needs the agent tool sandbox disabled

Inside the agent's command sandbox Vitest dies with `EMFILE`, `gh` fails TLS, and anything that writes `.git/config` (`git branch -d`, `git worktree add`, `git remote`) half-completes. Run them with the sandbox off, Vitest with `ulimit -n 8192` as well. Every Vitest run prints a harmless `ReferenceError: module is not defined` from the nitro plugin.

### A scratch script that reaches `src/lib/brand.ts` needs an `.svg` loader stub

Run a `$TMPDIR` probe as `node --import tsx/esm "$TMPDIR/probe.mts"` from the repository root. A module that reaches the `.svg?url` import in `src/lib/brand.ts` also needs a load hook that answers `.svg` with an empty string, passed as a second `--import`:

```js
// svg-stub.mjs
import { register } from "node:module";
register(
  "data:text/javascript," +
    encodeURIComponent(
      'export async function load(url, context, next) { if (/\\.svg(\\?.*)?$/.test(url)) { return { format: "module", shortCircuit: true, source: "export default \\"\\"" }; } return next(url, context); }'
    )
);
```

### Vitest 5 and better-auth's optional peer range

`better-auth` 1.6 declares an optional `vitest` peer that excludes 5, and npm refuses the pair with `ERESOLVE` on the next install that re-resolves the edge. The `overrides` entry in `package.json` satisfies it with `$vitest`; drop it with the 1.7 upgrade.

### A test that spawns a subprocess needs a budget above the subprocess's own

When a test drives a process that has its own timeouts, give that test a ceiling above their sum as the third argument to `it`. Do not raise the global `testTimeout`, which hides slow tests everywhere else.

### `npm run start` gets no dotenv, unlike the dev server

`playwright.e2e.config.ts` loads dotenv at module scope for that reason, and its comment says what breaks without it. `VITE_STORAGE_PUBLIC_BASE` is inlined at build time, so a build without it serves relative `/storage` URLs that resolve to nothing.

### Smoke fixtures are created per attempt, and swept by prefix

`src/test/e2e/fixtures.ts` creates mutated rows inside the test, because global setup runs once before the first attempt and cannot repair what a retry inherits. The sweep's docblock in `fixtures.ts` says what it removes, in what order, and what escapes it on purpose.

### Assert that a transition landed, not that its dialog closed

A popover closes on failure as readily as on success. Assert something the page shows only on success, such as the row leaving a list filtered to pending.

### The browser suites read a sign-in code from the log in one place and the database in the other

The end-to-end flows read the code from `src/test/e2e/.server.log` through `src/test/e2e/mail.ts`, and must read only what was appended after the click or they find a spent code. The storage-state capture reads the `verification` row instead (`src/test/shared/sign-in-code.ts`), which needs the server's `BETTER_AUTH_SECRET` and clears the address's `verification_sends` rows first so the hourly cap does not swallow the send.

### Browser suites select by role and name, and add no test IDs

Locate by accessible role and name, then `data-slot`, never by a test id added to a production component. A structural or attribute selector carries its reason inline; the shared ones live in `src/test/e2e/locators.ts`.

### A structural selector fails open when the markup under it changes

A `> div > div` chain kept matching the table wrapper after the markup it described was gone, and its test stayed green. Check the failure's accessibility snapshot before trusting a structural selector.

### `getByText` is case-insensitive substring matching, so status words need `exact`

A status word also appears in prose and in select triggers on the pages that show it. Pass `{ exact: true }` for a status label, and scope to `statusSection` from `locators.ts` where a staff page shows the badge twice.

### Do not navigate away from a write that has not answered

A `goto` or `reload` over an in-flight server function aborts it, and the page looks as if the write succeeded. Wait for the URL where the app navigates on success, or for the `/_serverFn/` response where it does not.

### `getByText` finds a draft typed into a controlled textarea

React mirrors a controlled textarea's value into its text content, so `getByText(draft)` matches the composer before anything posts. Assert on the node that renders the comment, `page.getByRole("paragraph").filter({ hasText })`.

### The header avatar is a page load behind the profile page

`site-header.tsx` reads `authClient.useSession()`, which `router.invalidate()` does not refresh, so a new avatar reaches the header on the next full load. Assert the header after a reload.

### The smoke and accessibility suites share one local database

Locally both use the dev database as `user@example.com`, and the end-to-end sweep runs at the start of a run, so an accessibility run after one meets its leftover rows and notifications. Run `npm run test:e2e:sweep` before treating that red as a regression.

### One hydrated button does not mean a hydrated page

Route chunks hydrate after the root layout, so a click on a route's button can land before its handler exists: the click succeeds and nothing happens, and the route's first server calls fire after it. `waitForHydration` in `src/test/shared/playwright.ts` waits for every match, and skips the Solid-rendered TanStack Devtools.

### A Columns menu that scrolls must be focusable itself

A Columns menu tall enough to scroll fails axe's `scrollable-region-focusable` unless its content is tabbable, so `admin-data-table.tsx` passes it `tabIndex={0}`.

### A Radix surface is visible before it has finished entering

`toBeVisible` passes at the first frame of a Radix enter animation, and axe can then measure contrast at partial opacity. Call `waitForSurfaceSettled` from `src/test/shared/playwright.ts` before scanning an open dialog, sheet or menu.

### A Select item's `aria-selected` is selected *and* focused

Radix sets it to `isSelected && isFocused`, and a stray pointer moves focus, so it flips while the value stays put. Read the trigger's text, or `data-state="checked"`. An open Select is modal and hides the rest of the page from role queries, so a helper that opens one closes it.

### A `waitForURL` pattern that matches the page it is called from is a no-op

`waitForURL` resolves at once when the current URL matches, and an unanchored pattern like `/\/admin\/categories/` matches the detail page the action starts from. End the pattern at something only the destination has (`$` or `\?`), and read something the destination has before asserting an absence, which passes trivially on the wrong page.

### axe skips a disabled control, so a disabled pill's colours are yours to measure

axe's `color-contrast` does not evaluate a disabled control. When one carries text a person must read, compute the ratio yourself and say so in the PR.

### The unit suite sees your dotenv files, so an env-dependent test is machine-dependent

The unit run reads `.env` and `.env.local` into `process.env`, and CI writes neither, so an assertion on a value the process resolved tests the author's machine. Assert through a builder handed a literal environment, as `aws-config.test.ts` calls `buildS3Config({ S3_REGION: "us-west-2" } as NodeJS.ProcessEnv)`.

### A unit test that transitively imports `#/db` passes locally and fails in CI

`src/db/index.ts` throws at import without `DATABASE_URL`, which the unit run gets locally from your dotenv files and CI does not have. Keep pure logic in a module that imports nothing, and let the query layer import it. `DATABASE_URL= npm test` reproduces CI.

### The integration suite refuses to run with embeddings enabled

`vitest.integration.config.ts` sets `BEDROCK_EMBEDDINGS_ENABLED=false`, and `src/test/setup.integration.ts` throws if it did not arrive. Fix the config, not your shell.

### An integration test reads a refresh only after `settleProjectRefreshes()`

A save returns before its embedding and summary refresh run ([ADR-0053](./adr/0053-a-save-does-not-wait-for-its-ai-refresh.md)), so await `settleProjectRefreshes()` from `src/server/_internal/project-refresh.ts` before asserting on either. Without it, `expect(embed).not.toHaveBeenCalled()` passes without testing anything.

### The browser suites get their vectors from the seed, never from Bedrock

The browser suites run with embeddings off, so the recommended sort relies on the vectors `scripts/seed-recommendations.ts` writes through `npm run db:seed:dev`. `recommendations.e2e.test.ts` imports its expected order from that module.

### Radix Popover / cmdk need jsdom polyfills

Call `installResizeObserver()` from `src/test/radix-jsdom.ts` before rendering a Radix primitive. A Popover or a cmdk `Command` also needs `scrollIntoView` and the three pointer-capture methods stubbed with `vi.fn()`, as `src/test/proposer-picker.test.tsx` does. A Radix `Select` opens on `pointerdown`, not `click`: `fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" })`.

### A route module under test needs a partial router mock, not a full one

The Start plugin injects router imports into a route file, so a full `vi.mock("@tanstack/react-router")` fails the import. Spread the real module and override only what the test renders, as `src/test/admin-inventory-columns.test.tsx` does:

```ts
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (/* plain anchor */) => null,
}));
```

### Integration tests call the `*As(viewer, ...)` seam, never `requireUser()`

`requireUser()` needs Start's request context, which Vitest cannot provide, so a test builds a viewer and calls the `*As` function ([ADR-0002](./adr/0002-one-named-wrapper-per-action.md)). `seam-convention.test.ts` enforces the pairing.

### `captureStderr` sees the console email transport but not `console.*`

`captureStderr` in `src/test/shared/console-email.ts` patches `process.stderr.write`, and Vitest intercepts `console.*` before it gets there, so spy on `console.warn` separately.

---

## Biome / Ultracite and code style

`biome.json` extends Ultracite's core and React presets. `npm run check` runs `ultracite check`; `npm run format` runs `ultracite fix`.

### Hard rules

Biome owns the formatting (2-space indent, double quotes) and the import order; do not fight either. `biome.json` excludes `src/routeTree.gen.ts`, `src/styles.css`, `scripts/`, `drizzle/` and `**/*.svg`.

### The git hooks

`lefthook.yml` runs the checks and `CONTRIBUTING.md` has the table. `prepare` is `lefthook install || true` because neither image stage has `.git`, and the install would otherwise fail the build. `scripts/check-commit-message.mjs` and `scripts/check-prose.mjs` are the one implementation lefthook, CI and the Claude Code hooks share, and `src/test/check-scripts.test.ts` drives them as processes, because the exit code is the contract. They spell the characters they reject as `\u` escapes, since a literal one would fail their own `--all` run.

### Rules deliberately relaxed or deferred

`biome.json` turns these off on purpose:

- `noVoid`: fire-and-forget `void promise()` is intended.
- `useFilenamingConvention` under `src/routes/**`: TanStack's `$param` and `__root` names.
- `useImageSize`: off everywhere except `institution-logo.tsx`.
- `noJsxPropsBind` and `noLeakedRender`: inline arrows and `cond && <X />` are the idiom here.
- `noAwaitInLoops`: the seeds, migrations and Bedrock callers await in sequence on purpose.
- `noIncrementDecrement` and `useDestructuring`: style with no defect behind it.
- The assists `useSortedKeys` and `useSortedTypeFields`: object literals here are ordered by meaning.
- In tests (`*.test.ts(x)`, `__tests__/`, `src/test/`): `useTopLevelRegex`, `noEmptyBlockStatements`, `useAwait` and `noNonNullAssertion`.

Inline ignores cover `noNamespaceImport` (`import * as schema`, shadcn) and `noBarrelFile` (the schema re-export).

### Do not run `biome check --write --unsafe` blindly

Its unsafe fixes changed behaviour here: `viewer!.id` became `viewer?.id`, and a `type` became an `interface` that broke a cast. Use `npm run format`, and review any unsafe fix diff by diff.

### Soft rules / project conventions

Component files are `kebab-case.tsx`, and cross-directory imports inside `src/` use the `#/` alias. The prose and commit rules are in [`../AGENTS.md`](../AGENTS.md).

---

## Project conventions

The git rules (stage by name, never commit to `main`, no session links on a remote)
bind every turn, so they live in [`../AGENTS.md`](../AGENTS.md) instead of here.

### A TanStack Query key for the viewer's own data carries their user id

The query cache outlives the session that filled it, and a session can end without a reload (another tab, expiry, a ban), so a key like `["notifications"]` shows the next user the last one's rows. Key per-viewer reads on `useSignedInUserId` (`src/lib/use-signed-in.ts`) with `enabled: userId !== undefined`, as `notification-bell.tsx` does. Writers invalidate the bare prefix (`["cart"]`), which reaches every viewer's entry.

### Every search field is `searchQuerySchema`, and it clamps rather than rejects

`searchQuerySchema` (`src/lib/search-query.ts`) trims and cuts at `SEARCH_QUERY_MAX` without throwing, because a server function is reachable without the UI; `search-query-schemas.test.ts` fails a search field that is a bare `z.string()`. Route `q` params stay uncapped and inputs carry no `maxLength`; `searchQueryNote` tells the reader their query was cut.

### Every server function declares its access level

[ADR-0003](./adr/0003-every-server-function-declares-its-access-level.md); `src/server/__tests__/access-contract.ts` is the table. The scan fails on a shape it cannot read, since an unreadable endpoint would otherwise report as nothing. A route guard protects the page, not the endpoint. A join added to a bare `select()` nests the row under table keys, which `programs.integration.test.ts` pins.

### A shared admin column const uses `satisfies`, not an annotation

`docs/UI-CONVENTIONS.md`, "A shared column const uses `satisfies`, not an annotation".

### The mobile card layout keeps the table a table, so its layout mode is fixed

`docs/UI-CONVENTIONS.md`, "The mobile card layout". `tr[data-row-detail]` is a contract between `admin-data-table.tsx` and `src/styles.css`, pinned by `admin-data-table.test.tsx`.

### A listing's filters render twice, so their ids come from `useId`

`docs/UI-CONVENTIONS.md`, "A listing's filters".

### A Cancel button that sets `open` itself skips the dialog's `onOpenChange`

Radix fires `onOpenChange` only for closes it initiates (Escape, the overlay, `DialogClose`), not when the component sets a controlled `open` itself. When a dialog has close-time cleanup, every control that closes it calls the same function; `approve-all-dialog.test.tsx` and `custom-line-actions.test.tsx` check reopen-after-Cancel.

### Path-by-path convention summary

| Path | What goes there |
| --- | --- |
| `src/lib/*.ts` | Pure, client-safe modules. |
| `src/lib/_internal/*.ts` | Server-only helpers. |
| `src/lib/placement/` | Placement (ADR-0056), browser and Node only; `plugins/` holds the source converters (ADR-0059). |
| `src/nitro/*.ts` | Nitro plugins named in `vite.config.ts`; the only code that runs at boot. |
| `src/server/*.ts` | `createServerFn` wrappers: Zod schema plus dynamic-import handler. Client-importable. |
| `src/server/_internal/*.ts` | Impl, `*As(viewer, ...)` and `*ForCurrentUser(...)`. Server-only. |
| `src/server/__tests__/` | Integration suites (`*.integration.test.ts`) and the structural unit tests (`seam-convention`, `access-contract`). |
| `src/components/` | Components on shadcn/ui and Radix (`ui/`). |
| `src/routes/` | File routes. `_authed` holds every signed-in page, `_public` the pages the traffic writer records. `routeTree.gen.ts` is generated. |
| `src/db/` | `schema.ts` is hand-written; `auth-schema.ts` is generated by the Better Auth CLI. |
| `drizzle/*.sql` | Generated migrations; tsvector and FK-rule changes are hand-authored. |
| `scripts/` | Operational scripts, not Biome-checked, and seven checks tested from `src/test/`: `check-prose`, `check-commit-message`, `check-compression`, `check-asset-manifest`, `check-pr-screenshots`, `check-workspace`, `check-doc-size`. |
| `.claude/` | Hooks (tested from `src/test/claude-hooks.test.ts`) and the repo-local review skills. |
| `docs/agents/` | What the mattpocock skills read about this repo. |
| `docs/superpowers/` | The specs and plans of features built before 2026-10, kept for reference. The issue is the spec for all new work. |

### `/privacy` is a promise the deletion flow makes, so the two move together

`src/components/privacy-policy.tsx` states what `DeleteAccountDialog` promises ([ADR-0008](./adr/0008-account-deletion-anonymizes.md)) and what the traffic writer records; change one, change the other, and `src/test/privacy-policy.test.tsx` asserts each claim. The page is outside `_authed` so anyone can read it before signing in, and `public.e2e.test.ts`, loading it with no cookie, proves it stays there.

### Workflow conventions

- **The issue is the spec, the pull request is the plan, the review loop is the gate.** [ADR-0013](./adr/0013-specs-live-in-github-issues.md).
- **`*As` first, `*ForCurrentUser` second.** [ADR-0002](./adr/0002-one-named-wrapper-per-action.md). An implementation that needs no viewer object is `*Impl`; a `My` stem names whose rows are read, so it stays on both halves of a pair. `seam-convention.test.ts` fails a wrapper with no seam sharing its stem; it replaced a grep that could not fail, so if you write a check for a convention, make yourself see it red before you trust it.
- **One server function per workflow action**, never one mega-mutation.
- **Single canonical URL per resource.** [ADR-0010](./adr/0010-single-canonical-url-per-resource.md).

---

## Object storage (S3-compatible)

### Sharp is server-only; never ships to the client

Sharp is a native binding. Browser image work (the ImageUploader's crop and resize) uses `<canvas>`.

### Sharp's `.withMetadata({})` does NOT strip EXIF

`.withMetadata()` with any argument preserves metadata; omit it to strip EXIF, GPS and orientation. `image-processing.test.ts` checks a fixture with EXIF Orientation.

### Storage keys vs URLs

Image columns hold storage keys (`projects/<id>/<uuid>.webp`), not URLs; `getPublicUrl(key)` in `src/lib/storage.ts` builds the URL at render time.

### One image upload policy, and a scan that has to be mutation-tested

[ADR-0009](./adr/0009-one-image-upload-policy.md). `image-upload-policy.test.ts` fails any file outside the policy module that names two or more image MIME types. If you touch that scan, mutate more than the form it was written for: every narrowing it needed was found by mutation, not by reading.

### What `image_url` may accept, and where each check sits

A write may set `image_url` only to empty or to one filename directly under the row's own prefix. `assertOwnedKey` (`src/lib/_internal/storage.ts`) checks it through `KeySpace.owns`, which `deleteOwnedObject` shares; `startsWith(prefix)` would accept `../` and render another row's image. Cleanup runs after the row write, never inside the transaction, or a rollback leaves the row pointing at a deleted object.

### TanStack Start FormData server functions

`.validator(...)` accepts FormData when it returns the input unchanged, as `src/server/uploads.ts` does; the client passes `{ data: form }`.

```ts
export const uploadProjectImage = createServerFn({ method: "POST" })
  .validator((data: unknown) => expectFormData(data))
  .handler(async ({ data }) => { /* data is FormData */ });
```

### Buffer is not a BlobPart in lib.dom

`new File([buffer], ...)` fails tsc with a BlobPart error. Wrap it: `new File([new Uint8Array(buffer)], ...)`, a view over the same memory.

### RustFS local bucket bootstrap

A fresh docker volume has no bucket; run `npm run storage:init` once. It is idempotent.

### `react-image-crop` SSR safety

`ImageUploader` touches DOM APIs only in event handlers and renders a button-only state during SSR.

## When you add a quirk

If you discover a new framework behavior that surprised you, add it here. The rule of thumb: "if it cost more than 30 minutes to figure out, future-us deserves to find it written down."

Keep the structure: short headline, one-paragraph explanation, code example if relevant. The point of this file is grep-friendly recall, not narrative writing. `scripts/check-doc-size.mjs` holds each `###` entry to 1000 bytes, heading included; code blocks and table rows do not count, since an example states a rule exactly and a table row is reference data. History belongs in git and the PR; the rule belongs here.

Two things do not go here. A decision (something chosen, with a trade-off, that a later reader would otherwise re-propose) goes in `docs/adr/`, and the section here that touches it gets a one-line pointer. An ADR is one paragraph under its title, with the consequences as its closing sentences and no `## Consequences` heading. The same check holds it to 1300 bytes after the title line. A term goes in `CONTEXT.md`, with the synonyms to avoid. A rule that restates a module (a transition table, a notification decision) is a pointer at the module and its unit tests, not a copy.

## Inventory

The vocabulary is in [`../CONTEXT.md`](../CONTEXT.md). The rules are pure modules under `src/lib/`, unit tested with no docker: `inventory-workflow.ts` (item transitions), `inventory-custom-workflow.ts` (custom lines), `hold.ts`, `inventory-deadlines.ts`, `inventory-notifications.ts`, `inventory-visibility.ts`, `inventory-timeline.ts`, `my-items-filter.ts`. Read the module first; a new rule belongs in its unit test, not the integration suite. Decisions: ADR-0004 (one writer), 0005 (lazy deadlines, no scheduler), 0006 (retired is the archive), 0009, 0015, 0017 (custom requests reuse the envelope), 0018 (`sourcing`).

### Categories: `domain` is closed, `type` is a project-only facet, filtering is all-match

`categories.domain` never changes after creation. Both listings filter all-match with `HAVING count(*) = <number selected>` over the junction (`buildInventoryScope`, `searchProjectsImpl`); a plain `inArray` gives any-match. The param is `categories: z.array(z.string().uuid())`, and `.catch([])` in `validateSearch` turns a malformed value into no filter. A column on `projects` never also becomes a category ([ADR-0021](./adr/0021-a-column-on-projects-never-becomes-a-category.md)).

### Two role predicates, in `src/lib/viewer.ts`

`isStaff` admits instructors; `isAdmin` does not, and neither is defined through the other. Role changes, bans and the user counts in `getAnalyticsAs` ask the admin question; widening one to `isStaff` fails silently. Route guards use `requireStaff` and `requireAdmin`, since `assertStaff` throws "Forbidden" rather than the access-denied refusal. An owner-or-staff seam reads `isStaff` (`performTransitionAs`, `canEditProject`), so a missing `assertStaff` is not evidence of a missing guard; check `project-visibility.ts`.

### Hold: what `hold.ts` does not guarantee

Its JSDoc is the list. The one that bites: read paths build a `Hold` from stored columns, never through `holdFromInput`, so the per-status checks in `inventory-workflow.ts` stay.

### Notifications: two rules that look wrong

Both live in `inventory-notifications.ts` and its tests. A denial is answered before the recipient guard, so a hold on a bare label cannot swallow it. Suppression keys on `authority === "self_cancel"`, not actor-equals-recipient, because staff holding an item for themselves still want the deadline.

### The overdue scan: two overlaps and one narrowing

`recordOverdueNotificationsAs` scans approved lines and staff holds with `current_holder_id IS NOT NULL`; they overlap on purpose when a line and a hold name two people. The hold scan skips an unlinked hold that `/my/items` matches by verified email, because resolving an address on a write path reopens impersonation. Its call in `listMyItemsAs` reports a failure rather than swallowing it.

### Retired: the status set is data, not a predicate

`visibleStatuses` returns data because `buildInventoryScope` feeds it to SQL; never write `ne(status, "retired")`.

### `/my/items` has its own two projections

`listMyItemsAs` returns three kinds of `MyItemsRow`. A request row carries `itemName` and `itemStatus` flat beside its `line`, never an item view, because `holdItemView` renames `current_pickup_by` to `pickupBy` and the row would hold two different `pickupBy` values. `inventory.integration.test.ts` pins the key set of all three kinds.

### `/my/items` disables sorting so the grouped view cannot be sorted away

The table groups only while the sort equals `defaultSort`, and the borrow list's Submit lives on its group header, so no column sorts and the search schema carries `filter` alone. Do not add a hidden rank column; a URL could sort it.

### `transitionItem`: what the callers carry

`authority` is default-deny and the only way past `assertStaff`; `lineDecision` carries an outcome with its line id. **`transitionSchema` in `src/server/inventory.ts` must never declare `authority`**: that endpoint has only `requireUser()`, so Zod stripping the key is its staff gate, and `inventory-schemas.test.ts` asserts the strip. Locks run line then item, as in `approveRequestItemAs`; inverting them deadlocks.

### The dev seed drives the real write path

[ADR-0004](./adr/0004-one-writer-per-status-history.md). Seed state changes go through the seams, never through `status` directly.

### Deferred FK

`inventory_items.current_request_item_id` references `inventory_request_items.id` through raw SQL in the migration, not `schema.ts`, because the two tables reference each other. `ON DELETE SET NULL`.

### The three lifecycles

The transition tables are code: `inventory-workflow.ts` (item and request line) and `inventory-custom-workflow.ts` (custom line), normative with their unit tests.

### An `inventory_requests` row no longer implies an item line

An envelope holds item lines or custom lines, so a join to `inventory_request_items` alone drops every custom request.

### Fulfil locks items in ascending id order

`fulfillCustomLineAs` locks the line, then its items by ascending id, and reserves with `silent: true` so only the fulfil notice is written. A separate rule from the batch approve below.

### Batch approve iterates lines in ascending id order

`approveRequestLinesAs` sorts the ids and approves all in one transaction, each line then its item, so overlapping batches wait instead of deadlocking. One line no longer pending fails the batch, since the ids are what staff confirmed.

### submitCart is lock-first

`submitCartAs` locks each cart item and re-checks `available` before inserting the envelope, so an all-race submit leaves no orphan request; losers return in `skipped`.

## Projects

The vocabulary is in [`../CONTEXT.md`](../CONTEXT.md); the rules are `src/lib/project-workflow.ts`, `project-visibility.ts` and `project-notifications.ts`. Decisions: ADR-0004 (`commitTransition` is the one status writer), 0007 (proposer linking), 0024 (ops scripts), 0025 (embedded text is prose), 0053 (AI refresh after the save).

### Paging a listing needs a total ordering, or rows repeat and vanish

Postgres orders ties arbitrarily per query, so `LIMIT`/`OFFSET` pages repeat and drop rows. Every listing ordering ends in the row id, passed as the last `.orderBy` argument so a new sort cannot forget it. The listing-order integration tests use 400 tied rows over pages of 20, because a small tied set fits one top-N heapsort and passes the broken order; do not trim them.

### `projects.updated_at` moves only for a change a visitor can see

It orders "Recently updated", so a writer sets it only when a field in `projectDetailView` changes. There is no `$onUpdate`: a writer names it in `.set()`, and `project-updated-at.integration.test.ts` pins each one.

### Both domains name the fields their reads return, and a key-set test pins each

`projectDetailView` names every field of the public `/projects/$id` payload, so a new column is invisible until named; `proposerEmail` is absent, not nulled. `projectSummarySelect` may carry what an anonymous detail read returns, minus `notes`, `isSponsored` and `deletedAt`, plus `updatedAt` and `categories`; the staff selects extend it. Key-set tests in four integration suites fail on a new column: the moment to ask whether it is public.

### The edit diff has no field list; it reads the writer's keys

`diffRowFields` (`src/lib/edit-diff.ts`) reads the keys of the writer's object, typed `Partial<typeof projects.$inferSelect>` so a non-column fails typecheck. A separate field list drifted and dropped writes. `changedFields` follows the writer's literal order, which the edit log shows; `edit-diff.test.ts` and `inventory.integration.test.ts` pin it. Categories are compared separately, before the zero-change early return.

### There are two embedding backfills, and only the `.mjs` runs in production

The `.ts` needs `tsx` and runs on a workstation; the `.mjs` is the ECS task. Both re-embed a row whose stored hash no longer matches. **Run a sweeper after every import, not only the first:** `import-legacy.mjs` writes text without touching the embedding columns.

### `sendEmail` is decided by role in `performTransitionAs`, not by the schema

Skipping an email is staff-only, decided from the caller's role, because one validator serves staff and owners; a non-staff `sendEmail: false` is ignored. `SEND_EMAIL_FIELD` is spread into each wire schema, and the `*ForCurrentUser` wrapper moves it into `EmailOptions`, off the row input. The bell row is still written. Inventory's `silent` differs: it drops both channels and is refused for self-service. UI: `docs/UI-CONVENTIONS.md`, "The email skip".

### An unset `BETTER_AUTH_URL` logs, it no longer just drops the mail

The comment above the `appBaseUrl` check in `src/server/_internal/project-emails.ts` says why it is an `if` in the body.

### The proposer field locks on divergence, not on the act

`ProposerPicker` locks once an account is linked and routes a change through a "Re-assign" modal; the lock compares against a mount-time snapshot, so retyping the original address re-locks it. `proposer_email` is the private link key, `contact_email` a separate public field. An admin's create-user accepts `emailVerified`, so an admin can make an unproven address claim; tolerated.

### Mentorship is one nullable address, and the mark is the proposer's

`mentor_email`, `student_proposed` and `project_programs` each have one staff-only writer (`updateProjectMentorshipAs`, `updateProjectProposerAs`, `updateProjectProgramsAs`), none on `ProjectInput` and none re-embedding ([ADR-0023](./adr/0023-mentorship-is-the-mentor-address.md)). No `mentor_id`, no claim: a mentor links by signing up with the address. `mentorNameSql` is a correlated subquery with `LIMIT 1`, since a join on `lower(email)` would fan a project into two rows. Only staff projections carry the mentor.

### A comment's edit lock is computed before the viewer filter, and the row says so

`listProjectCommentsAs` derives `hasReply` over every comment before `filterCommentsForViewer`, since a proposer never sees an internal staff reply. The client gets that fact, not a `canEdit`, so `updateCommentAs` keeps the one guard ([ADR-0033](./adr/0033-a-comment-is-edited-in-place.md)).

### A date typed into a range is an office day, not a UTC day

`src/lib/day-range.ts` maps `from` and `to` to a half-open span between Pacific midnights; `OFFICE_TIME_ZONE` names the zone once.

---

## Amazon Bedrock

Embeddings use `bedrock-runtime` through the AWS SDK; AI review uses `bedrock-mantle` through a hand-signed `fetch` ([ADR-0012](./adr/0012-bedrock-mantle-by-sigv4-embeddings-behind-a-flag.md)). A fact about one says nothing about the other.

### Mantle rejects `minimal` as a reasoning effort, and the value production uses is not the one in `src`

Mantle 400s on `minimal`, a valid OpenAI value that mocked unit tests pass. Production takes each effort from the `infra/variables.tf` default, never from the fallback in `src`. `reasoning-effort-contract.test.ts` checks both, and `.env.example`, against `MANTLE_REASONING_EFFORTS`.

### Rewording an AI writer's log line silently zeroes the `ai_write_failures` alarm

The metric filter in `infra/alarms.tf` matches exact, case-sensitive wording at the line start, so a reworded line leaves the alarm OK through an outage. `project-refresh.test.ts` runs the pattern against the real lines. Change a message, the pattern and the `DEPLOYMENT.md` log recipe together.

### A failed Mantle call's real error is in the log, not in `run.error`

The error can carry signed values, so each `*-core.ts` logs it through `redactQueryError` and gives the user a fixed message. Diagnose from the log.

### A social summary staff wrote is never overwritten, and a hash cannot express that

A hash detects change, not intent, so both writers test `social_summary_is_manual` before the hash; the parity test pins both.

### The embedded text is capped in characters against a model limit in tokens

[ADR-0037](./adr/0037-the-embedding-source-limit-stands-in-for-a-token-ceiling.md). An overflowing row keeps a null vector, quietly.

### Model ids are not portable between the two endpoints

Mantle takes the bare id (`openai.gpt-5.6-luna`) under `/openai/v1`; `bedrock-runtime` needs an inference profile (`us.` or `global.`). Each endpoint rejects the other's form; `BEDROCK_MODEL_ID` holds the Mantle form.

### Reasoning models reject sampling parameters and spend the output budget

The review sends no `temperature` or `top_p`. Reasoning tokens spend `max_output_tokens` before the tool call, and running out arrives as `status: "incomplete"`, which `parseReviewResponse` reports as its own error.

### A review without a project is authorized on the session alone

Unsaved text belongs to nobody else, so a verified session is the gate and `assertWithinLimit` (`ai-review-usage.ts`) is the only bound on spend; it runs in the `*As` seam. The client omits `projectId` rather than sending `undefined`.

### `ai_review_usage` is both the limiter and the usage log

One row per call that reached Bedrock, failed or not, with token counts. Concurrent calls may overshoot by one. A new per-user counter table goes in `TABLES` in `src/test/db-reset.ts`, or a later test trips its limit.

### Field length ceilings have one home, and the review enforces them twice

`FIELD_MAX_LENGTHS` (`src/lib/project-review-fields.ts`). `parseReviewResponse` drops an over-cap suggestion and keeps the rest.

### The scope assessment is a second Mantle call, not a second output of the review

It has its own tool, prompt, effort and ceiling, so a review never pays for staff-only reasoning. Its three `projects` columns go stale like the embedding, and `scope-assessment.integration.test.ts` keeps them out of public projections.

### Function call arguments arrive as a JSON string

Parse `arguments` before Zod. The item can sit at the top of `output` or inside an item's `content`; `findToolCall` checks both.

## Site traffic

### The traffic writer takes the viewer from the last `X-Forwarded-For` entry

`viewerAddress` (`src/lib/_internal/traffic-request.ts`) walks from the right past `TRUSTED_PROXY_CIDR`, the walk Better Auth runs for `session.ipAddress`. With no `X-Forwarded-For`, as in local dev and the browser suites, nothing is recorded.

### `traffic_salt` is UNLOGGED, and a crash splits the day's visitors

Drizzle cannot declare an unlogged table, so the migration is hand-written and `traffic.integration.test.ts` asserts `relpersistence = 'u'`. [ADR-0048](./adr/0048-a-visitor-is-a-daily-salted-hash.md) accepts the split.

### The traffic writer records `_public` routes only, and `location` rather than `resolvedLocation` on mount

`traffic-scope.test.ts` holds `isTrafficRoute` to every route id. On mount `resolvedLocation` still names the page being left, so `useTraffic` reads `location`.

### `/admin/traffic` reads visits from a rollup that a page load fills

`getTrafficAs` rolls closed days into `traffic_visits` first ([ADR-0050](./adr/0050-closed-days-of-traffic-are-rolled-up.md)); `TRUNCATE traffic_visits` is always safe. A day closes two minutes after local midnight, and a test that omits `now` sees every fixture day closed. `traffic-filters.test.ts` holds the zone literal to `OFFICE_TIME_ZONE` and the filter defaults to their listings. `traffic_events.day` is generated from that literal, so changing the zone means a migration that drops and re-adds the column and a truncate of the rollup.

## Site metadata

### The `noindex` tags must survive server rendering

A crawler runs no JavaScript, so a `noindex` meta tag that appears only after hydration is not there at all. Keep `NOINDEX` (`src/lib/social-meta.ts`) in the server-rendered `head()`; [ADR-0055](./adr/0055-the-catalog-is-shareable-but-not-indexed.md) says why `robots.txt` stays permissive.

### The social card is a committed PNG, not a build artifact

The header of `scripts/generate-social-card.mjs` says why.

### `VITE_SITE_URL` is build-time, and `BETTER_AUTH_URL` cannot stand in for it

`head()` runs on both sides of SSR and preview tags need absolute URLs, so the origin is a `VITE_` variable (`src/lib/site-url.ts`). It travels through `infra/secrets.tf`, SSM, the deploy build args and a `Dockerfile` ARG; miss one and previews point at `localhost` with nothing failing. `env-contract.test.ts` scans only `process.env`.
