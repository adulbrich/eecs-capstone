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

The query cache outlives the component and the session that filled it. Signing out reloads the page (`src/lib/sign-out.ts`), but a session can also end without one (another tab, expiry, a ban), and signing in navigates on the client (`email-code-form.tsx`), so a key like `["notifications"]` shows the next user the previous user's cached rows until their own read answers. Key per-viewer reads on the id from `useSignedInUserId` (`src/lib/use-signed-in.ts`), with `enabled: userId !== undefined`, as `notification-bell.tsx`, `bookmarks-button.tsx` and the borrow list's `cartQuery` in `add-to-cart-button.tsx` do (#634, #642). A writer still invalidates the bare prefix, `["cart"]` or `["bookmarks"]`: `invalidateQueries` matches by prefix, so it reaches every viewer's entry.

### Every search field is `searchQuerySchema`, and it clamps rather than rejects

The `q` and `query` fields of the eight search schemas under `src/server/` are all `searchQuerySchema` from `src/lib/search-query.ts`, which trims, cuts at `SEARCH_QUERY_MAX` and never throws. They disagreed until #478: four capped at 200 and threw `too_big` out of `.parse` past it, four had no cap at all, and a 201-character paste into the public listing's box reached the framework's default error page, because no route defined an `errorComponent` then. Clamping happens on the server rather than through a `maxLength` on each input, because a server function is reachable without the UI. `search-query-schemas.test.ts` reads the AST and fails a search field that goes back to a bare `z.string()`.

The reader is told when their query was cut, by `searchQueryNote` in `src/components/search-hint.tsx`, and two things follow from that. The route-level `q` params stay uncapped, so the URL still carries what the reader typed; a `.max()` there would be a router error on a long link, and a `.max()` with a `.catch("")` would drop the search silently. `searchParamQuerySchema` catches to `""` only a value that is not text at all (#609). And no search input carries a `maxLength`, which would have the browser swallow a long paste with nothing said. The note is derived on the client from the same `clampSearchQuery` the schemas use, unlike `order` on the search result, which the server has to report because it resolves against an interest vector the client cannot see.

### Every server function declares its access level

[ADR-0003](./adr/0003-every-server-function-declares-its-access-level.md) is the decision; `src/server/__tests__/access-contract.ts` is the table, one line per endpoint, with the incident behind it (#103, #108) written out there. Read it there, so there is one copy to keep true. Two things about the scan that are easy to get wrong: it lives in `server-fn-scan.ts` so it can be driven with sources written to break it, which is how a renamed import (`import { createServerFn as make }`) was caught escaping both the search and its guard; and two legal shapes, a type annotation and a line break before the initializer, were invisible until the "unparseable shape" failure was added. An endpoint the pattern cannot read reports as nothing at all rather than as undeclared, so that failure is load-bearing. The table covers all of `src`, not just `src/server`, because the narrow scan missed `lib/auth-guards.ts:getSession`.

### A shared admin column const uses `satisfies`, not an annotation

`defineAdminColumns<Row>()` (in `src/components/admin-data-table.tsx`) checks each column against what its `accessorFn` returns, so it needs that return type to survive to the call site. A type annotation destroys it: `const NAME_COLUMN: AdminColumn<Row> = {...}` makes the variable's type the declared one, whose `accessorFn` returns `unknown`, and `[null] extends [unknown]` is true. Every annotated column then reports `ACCESSOR_RETURNS_NULL_USE_UNDEFINED` on an accessor that never returns null, which reads as a bug in the check rather than in the declaration.

`satisfies` type-checks the same fields while leaving the inferred type in place:

```tsx
const NAME_COLUMN = {
  accessorFn: (row) => row.name,
  id: "name" as const,
  header: "Name",
} satisfies AdminColumn<Row>;
```

`id` needs the `as const` or it widens to `string`, and the diagnostic then says `string` instead of naming the column that broke the rule. Only the const is affected: annotating the array `defineAdminColumns` returns is redundant but harmless, because that return type mentions no inference variable for the annotation to feed back into.

`/admin/categories` shares column consts between two tables (a project tab and an inventory tab). `/projects` and `/my/bookmarks` share five columns through `projectSummaryColumns<Row>()` in `src/components/project-summary-columns.tsx`, a factory rather than consts because each table's row type differs and a column's `cell` is typed on it; the `satisfies` rule is the same inside the factory.

### The mobile card layout keeps the table a table, so its layout mode is fixed

Below `md`, `src/styles.css` restacks `.admin-table` into cards: `thead` hidden, `tbody` a flex column, each `tr` a block card, each `td` a flex row. The `table` element keeps `display: table`, on purpose, so assistive tech still gets a table with a caption. That leaves the table's own width under auto table layout, which sizes the box to its content's intrinsic width rather than to the `w-full` it carries, and the restacked body reports an intrinsic width 37px past a 343px container. At 375px every card ran 21px past the viewport on `/projects` and `/inventory` and the page scrolled sideways (#300). `table-layout: fixed` inside the same media query is the whole fix: with no table-row or table-cell boxes left to size, all it does is honour the specified width. `display: block` on the table would also fix it and would stop it being a table. Do not touch `containerClassName` for this; the container was never the thing that was wide. The two signed-in scans in `user.a11y.test.ts` measure both views at 375px with `expectNoHorizontalOverflow`.

A row's `detail` (`tr[data-row-detail]`) is a card of its own in that layout unless something joins it to the card above: the same media query cancels the gap with a negative top margin, drops the detail's top border and radius, and drops the data row's bottom radius through `tr:has(+ tr[data-row-detail])`. The attribute is a contract between `admin-data-table.tsx` and `src/styles.css`, as `data-group-header` is; `admin-data-table.test.tsx` pins it.

### A listing's filters render twice, so their ids come from `useId`

`ListingLayout` mounts the `filters` element in the aside (display `none` below `xl`) and again inside the `Sheet` while it is open, so below `xl` with the sheet open a filters component is mounted twice. Both copies read the same URL state and navigate on change, which is fine. What broke on the first run was a literal `id`: the aside copy comes first in the DOM, so every `htmlFor` in the sheet copy resolved to a hidden control and the sheet's switches had no accessible name (the a11y sheet tests catch this). Every id inside a filters form is `` `${useId()}-program` ``, never a literal, and local draft state (the debounced search input) lives in `search`, which renders once. ADR 0020 has the decision.

### `Button` requires a `type`

`src/components/ui/button.tsx` makes `type` a required prop on a rendered button and forbids it on an `asChild` one, so `npm run typecheck` fails on a `<Button>` that does not say whether it submits. Which value to pick is in `docs/UI-CONVENTIONS.md`, "Buttons and links". The history is #305 and #307.

### A Cancel button that sets `open` itself skips the dialog's `onOpenChange`

Radix fires `onOpenChange` for the closes it initiates (Escape, the overlay, a `DialogClose`), not for a controlled `open` prop the component changes on its own. A dialog that does its cleanup in `onOpenChange`, then gives its Cancel button `onClick={() => setOpen(false)}`, cleans up on Escape and not on Cancel. `ApproveAllDialog` kept a stale server refusal that way and `FulfillCustomLineDialog` kept the links built for one line when opened on the next, until #310 gave each one an `onOpenChange` function that both the `Dialog` and the button call. The rule: when a dialog has close-time cleanup, every control that closes it goes through the same function. `src/test/approve-all-dialog.test.tsx` and `src/test/custom-line-actions.test.tsx` hold the reopen-after-Cancel checks.

### Path-by-path convention summary

| Path | What goes there |
| --- | --- |
| `CONTEXT.md` | The glossary: one definition per domain term, with the synonyms the codebase does not use. |
| `docs/adr/*.md` | One paragraph per decision that is hard to reverse, surprising without context, and the result of a trade-off. |
| `src/lib/*.ts` | Pure modules, client-safe wrappers. |
| `src/lib/_internal/*.ts` | Server-only helpers (auth-guards). |
| `src/lib/placement/` | Placement (ADR-0056): the solver, the CSV parsers, title matching and the workspace. Browser and Node only, never the server; its tests sit in its own `__tests__/`. |
| `src/lib/placement/plugins/` | The plugins that convert a source's own shape to the standard CSV (ADR-0059), and the registry in `index.ts`. `docs/placement-plugins.md` says how to add one. |
| `src/lib/__tests__/*.test.ts` | Pure-module unit tests, plus two integration suites (`auth`, `role-gate`) that need a database, plus two suites that also read source off disk (`env-contract`, which reads `src`, `scripts`, `.env.example` and `infra/`, and `image-upload-policy`, whose other cases import the module normally). |
| `src/nitro/*.ts` | Nitro runtime plugins, named in `vite.config.ts`; the only code that runs at boot. |
| `src/server/*.ts` | createServerFn wrappers (Zod schemas + dynamic-import handlers). Client-importable. |
| `src/server/_internal/*.ts` | Impl + `*As(viewer, ...)` + `*ForCurrentUser(...)` helpers. Server-only. |
| `src/server/__tests__/*.integration.test.ts` | Integration tests against docker Postgres. |
| `src/server/__tests__/*.test.ts` | Unit tests over the server layer, including the structural ones (`seam-convention`, `access-contract`) that read source off disk and need no database. `access-contract.ts` and `server-fn-scan.ts` sit beside them and are not test files. |
| `src/components/*.tsx` | App components built on shadcn/ui + Radix primitives (see `src/components/ui/`). |
| `src/components/placement/*.tsx` | The tabs and controls of `/admin/placement`, and `use-placement-workspace.ts`, the one reader and writer of its localStorage key. |
| `src/routes/...` | TanStack file-based routes. `_layout.tsx` are pathless: `_authed` holds every signed-in page, `_public` the pages the traffic writer records. `routeTree.gen.ts` is auto-generated; do not hand-edit. |
| `src/db/schema.ts` | Hand-written Drizzle schema for app tables. |
| `src/db/auth-schema.ts` | Better Auth CLI-generated tables. Do not hand-edit; preserved through regen via `additionalFields`. |
| `drizzle/*.sql` | Generated migrations. New tsvector / FK-rule changes are HAND-AUTHORED (see Drizzle section). |
| `scripts/*.ts` | Operational scripts (seeding, one-shot fixes). Not Biome-checked. |
| `scripts/check-*.mjs` | The rule checks (`check-prose`, `check-commit-message`, `check-compression`) that lefthook, CI and the Claude Code hooks share. Not Biome-checked; tested from `src/test/`. |
| `.claude/hooks/*.mjs` | Claude Code hooks: refuse the git and `gh` commands and the edits the rules forbid, report Biome and prose on each edit, print session context. Biome-checked; tested from `src/test/claude-hooks.test.ts`. |
| `.claude/skills/*/SKILL.md` | Repo-local review skills (`correctness-review`, `app-security-review`), portable across harnesses, each with an `agents/openai.yaml`. `correctness-review` is required on a PR that changes behaviour, `app-security-review` is optional; `AGENTS.md` has the rule. |
| `docs/agents/*.md` | What the mattpocock engineering skills read about this repo: issue tracker, triage labels, domain docs. |
| `docs/superpowers/specs/*` | Design docs for the large features that went through the superpowers workflow. Ordinary work is specified in its GitHub issue instead. |
| `docs/superpowers/plans/*` | Implementation plans for those same specs. |
| `docs/QUIRKS.md` | This file. |
| `docs/UI-CONVENTIONS.md` | Design system rules: components, tokens, responsive layout. |

### `/privacy` is a promise the deletion flow makes, so its copy and #84 move together

`src/routes/_public/privacy.tsx` is public, outside `_authed`, and static: the body lives in `src/components/privacy-policy.tsx` and only a developer changes it. Its account-closure paragraph names what deletion removes and keeps, because `DeleteAccountDialog` (#84) makes exactly those promises and a policy that said less would leave them backed by nothing. Change one and change the other; [ADR-0008](./adr/0008-account-deletion-anonymizes.md) says what the server actually does. The lines pointing here, on `/sign-in` and on the code form's name step, are notices, not checkboxes; nothing writes to `user`. `brand.supportEmail` reaches the page through `SupportEmailLink` (`src/components/support-email-link.tsx`), which is also what the ONID refusal banner on `/sign-in` renders (#71); grep for the component to find every surface that shows the address. `public.e2e.test.ts` loads it with no cookie, which is the only proof a route outside `_authed` stays outside it. See #91. The page-view paragraph (#591) describes the traffic writer, so it moves with `src/server/_internal/traffic-writer.ts`, `src/lib/use-traffic.ts`, the `traffic_salt` table and `var.access_log_retention_days` in `infra/variables.tf`; `src/test/privacy-policy.test.tsx` asserts each claim and names the test that makes it true, and reads the retention number off the Terraform default.

### Workflow conventions

- **The issue is the spec, the pull request is the plan, the review loop is the gate.** [ADR-0013](./adr/0013-specs-live-in-github-issues.md). `CONTRIBUTING.md` maps it; `docs/agents/` is what the skills read.
- **`*As` first, `*ForCurrentUser` second.** [ADR-0002](./adr/0002-one-named-wrapper-per-action.md), including why the wrappers were not collapsed into one adapter. Two naming rules the seam test enforces: an implementation that needs no viewer *object* takes the `*Impl` name, and may still take a bare `userId: string` where the id only scopes the query (`searchProjectsImpl(data, viewerId)`, `getMyInterestsImpl(userId)`); and a `My` stem names whose rows are read, not who resolved the identity, so keep it on both halves of a pair. `src/server/__tests__/seam-convention.test.ts` pairs each wrapper against a seam sharing its stem in the same file and fails naming the wrappers that have none. It replaced a grep that could not fail; if you write a check for a convention here, make yourself see it red before you trust it.
- **One server-fn per workflow action.** Never collapse multiple actions into one mega-mutation. Grep-ability matters more than line count.
- **Single canonical URL per resource.** [ADR-0010](./adr/0010-single-canonical-url-per-resource.md).

---

## Object storage (S3-compatible)

### Sharp is server-only; never ships to the client

Sharp is a Node.js native binding (compiled C++ via libvips). It physically cannot run in a browser. Bundlers exclude native modules from client builds automatically. The ~30MB on-disk install is purely server-side. If you need image processing in the browser, use the built-in `<canvas>` API (which is what our ImageUploader does for crop + resize).

### Sharp's `.withMetadata({})` does NOT strip EXIF

This is the opposite of what you'd expect. `.withMetadata()` preserves metadata; passing an empty options object does NOT mean "strip everything," it means "preserve with these options." To strip EXIF, GPS, and orientation, simply omit `.withMetadata()` entirely. Sharp's default is metadata-free output.

The EXIF-strip test in `src/lib/__tests__/image-processing.test.ts` caught this when an explicit fixture with EXIF Orientation came out with the metadata intact.

### Storage keys vs URLs

The DB columns (`projects.imageUrl`, `user.image`) hold storage keys (e.g., `projects/<id>/<uuid>.webp`), NOT full URLs. The `getPublicUrl(key)` helper in `src/lib/storage.ts` builds the URL at render time. It has a pass-through for legacy `http(s)://` values so the same column can hold both shapes.

Why keys: swapping to a CDN, changing buckets, or moving to signed URLs is a one-line change in the helper, not a data migration.

### One image upload policy, and a scan that has to be mutation-tested

[ADR-0009](./adr/0009-one-image-upload-policy.md) is the decision: the allowlist, the cap and the guard live in `src/lib/image-upload-policy.ts`, an upload writes no row, the update owns the column, cleanup runs after the write and inside the row's own key prefix. `src/lib/__tests__/image-upload-policy.test.ts` keeps the first part true by walking `src` and failing any file, other than the policy module and the tests, whose code names two or more distinct image MIME types in any arrangement: a comma-separated string, a multi-line `Set`, a comparison chain, a union type. Comment lines are dropped before counting, so prose may quote it; one type on its own is left alone, because `image/webp` is the output content type Sharp and the canvas both name. A second rule catches a picker narrowed by hand to a single type in a file that names no other.

If you touch that scan, mutate more than the form it was written for. Every narrowing it has needed was found that way and not by reading: requiring a quote straight after `accept=` let `accept={"image/..."}` through; matching only next to `accept=` let a `const` one line above `accept={LOCAL}` through; requiring the types on one line let a multi-line `Set` and a comparison chain through.

Checkable, both domains:

```bash
# no hits: neither upload path writes a row
grep -n 'update(projects)' src/server/_internal/uploads.ts
grep -n 'update(inventoryItems)' src/server/_internal/inventory-images.ts
```

### What `image_url` may accept, and where each check sits

A write may only CHANGE `image_url` to empty, or to a single filename directly under the row's own prefix: one segment of letters, digits, underscore or hyphen, one dot, an alphanumeric extension. `assertOwnedKey` in `src/lib/_internal/storage.ts` is the check, and `KeySpace.owns` is the one predicate behind it and behind `deleteOwnedObject` (#162). Looser than the `<uuid>.webp` `newKey` mints, deliberately: a key naming nothing renders a broken image rather than leaking anything, and demanding a uuid would force every test to mint one. Three things about the shape that are load-bearing:

- **`owns` is tighter than `startsWith(prefix)`**, which accepts `projects/<own-id>/../<other-id>/x.webp`. That is a distinct key in S3, so it destroys nothing, but a browser normalizes the path and renders another row's image out of this app's bucket. Both call sites read one predicate, and "inside this space" should mean one thing.
- **`assertNoImageKeyOnCreate` lives in `src/lib/image-upload-policy.ts`, not beside `assertOwnedKey`**, because it needs no `KeySpace` and can be a plain static import at both create sites instead of the dynamic import every other reach into the storage module needs. Both guards throw the one `INVALID_IMAGE` message so the wording has a single home.
- **The cleanup runs after the row write, never inside the transaction**, because a rollback would destroy the object the surviving row still points at. `hardDeleteProjectAs` opens no transaction, so there it simply follows the row delete.

Before #162 the column was validated for length only, so any signed-in user could point a project at a URL they control and every viewer fetched it; `img` is not in the markdown allowlist and there is no CSP, so this was the one field a non-staff user could use to get an image element rendered. It moves nothing in `access-contract.ts`: the column is still writable by the proposer or staff on a project, and by staff only on an item.

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

If the framework version stops accepting raw FormData in `data`, the fallback is a plain API route in `src/routes/api/upload/<name>.tsx` that reads `request.formData()` directly and calls the same `_internal/uploads.ts` helpers via fetch from the client.

### Buffer is not a BlobPart in lib.dom

When building a `new File([bytes], ...)` in a Node test where `bytes` is a `Buffer`, tsc rejects with a BlobPart type error. Wrap in a `Uint8Array` view: `new File([new Uint8Array(bytes)], ...)`. No copy, same memory.

### RustFS local bucket bootstrap

The container starts without a bucket. Run `npm run storage:init` once per fresh docker volume to create the bucket. The script is idempotent (catches `BucketAlreadyOwnedByYou` / `BucketAlreadyExists`).

### `react-image-crop` SSR safety

`react-image-crop` uses DOM APIs (FileReader, document, canvas). The
ImageUploader component never accesses these at the module top level; all DOM work happens inside event handlers or after the user picks a file. The component renders a button-only state during SSR.

## When you add a quirk

If you discover a new framework behavior that surprised you, add it here. The rule of thumb: "if it cost more than 30 minutes to figure out, future-us deserves to find it written down."

Keep the structure: short headline, one-paragraph explanation, code example if relevant. The point of this file is grep-friendly recall, not narrative writing.

Two things do not go here. A decision (something chosen, with a trade-off, that a later reader would otherwise re-propose) goes in `docs/adr/` as one paragraph, and the section here that touches it gets a one-line pointer. A term goes in `CONTEXT.md`, with the synonyms to avoid. A rule that restates a module (a transition table, a notification decision) is a pointer at the module and its unit tests, not a copy.

## Inventory

The vocabulary (item, hold, holder, request line, custom line, borrow list, release, retire, the three status sets) is in [`../CONTEXT.md`](../CONTEXT.md). The rules are pure, client-safe modules under `src/lib/`, each unit tested in `npm test` with no docker: `inventory-workflow.ts` (what an item transition may do), `inventory-custom-workflow.ts` (what a custom line may do, and who may do it), `hold.ts` (who holds an item), `inventory-deadlines.ts` (what overdue means), `inventory-notifications.ts` (who is told), `inventory-visibility.ts` (who sees what), `inventory-timeline.ts` (what happened to a line), `my-items-filter.ts` (what counts as open on a student's page). Read the module before this section; a new rule or a new case belongs in its unit test, not in the integration suite, which is for assertions about a row.

The decisions: `transitionItem` is the only writer ([ADR-0004](./adr/0004-one-writer-per-status-history.md)), deadlines are lazy and there is no scheduler ([ADR-0005](./adr/0005-lazy-deadlines-no-scheduler.md)), retired is the archive and hard delete is narrow ([ADR-0006](./adr/0006-retired-is-the-archive.md)), one image policy ([ADR-0009](./adr/0009-one-image-upload-policy.md)), addresses are lowercased on write ([ADR-0015](./adr/0015-addresses-are-normalized-on-write.md)).

### Categories: `domain` is closed, `type` is a project-only facet, filtering is all-match

`categories.domain` is fixed at creation and immutable on update, and `listInventoryCategoriesImpl` re-filters on `domain = 'inventory'` at the junction read even though nothing writes a project-domain row there. Both listings filter categories as all-match: a subquery grouped by item or project id with `HAVING count(*) = <number of selected ids>` (`buildInventoryScope` in `inventory-catalog.ts`, `searchProjectsImpl` in `search.ts`); a plain `inArray` on the junction table would silently give any-match. Every category filter's `.inputValidator` therefore expects `categories: z.array(z.string().uuid())`, not a singular `category`. A route that still sends the singular key gets it silently stripped by Zod and the filter does nothing while looking fine; `.catch([])` on the array schema is what lets a stale `?category=<slug>` link degrade to "no filter" instead of a 500.

Inventory full-text search no longer matches category names: `search_vector` is a generated column, which can only read columns on its own row, and the category text column it used to weight is gone. Accepted gap, since the all-match filter covers that case directly.

A fact that is a column on `projects` never also becomes a category ([ADR-0021](./adr/0021-a-column-on-projects-never-becomes-a-category.md)); the seed's `project_type` rows went in #374.

### Two role predicates, in `src/lib/viewer.ts`

`isStaff`, `assertStaff`, `isAdmin` and `assertAdmin` live there and nowhere else. Consumers import from `viewer.ts` directly, because Biome's `noBarrelFile` rejects a re-export and so does the no-shims rule. Both asserts carry `asserts viewer is NonNullable<Viewer>`, and the narrowing is load-bearing: call sites read `viewer.id` immediately afterwards with no second null check.

**Staff and admin are not interchangeable, and neither predicate is defined in terms of the other.** `isStaff` admits instructors; `isAdmin` does not. The two `admin/users/` routes and the six user-administration seams in `_internal/users.ts` ask the admin question, because role changes and bans are not an instructor's to make. `getAnalyticsAs` asks it too, for the narrower reason that the user counts are admin-only on a page instructors otherwise see in full. Widening any of them to `isStaff` is the one way this pair goes wrong, and it does not fail loudly.

`assertStaff` is the gate on every staff-only seam in `src/server/`, read and write alike, and no call site reshapes a viewer into `{ id, role: role ?? null }` before asking a predicate. Routes asked their own way until #266: seventeen sites under `src/routes/_authed/` spelled the comparison out, thirteen `beforeLoad` guards as `["admin", "instructor"].includes(session.user.role ?? "")`, the two `admin/users/` guards as `role !== "admin"`, and two display gates the grep for those two shapes does not find, in `projects/new.tsx` and `admin/index.tsx`. All seventeen ask a predicate now, as do the three copies outside the routes, in `_internal/analytics.ts`, `_internal/programs.ts` and `site-header.tsx`. `STAFF_ROLES` is exported for the one caller that cannot ask a predicate, `listEligibleInstructorsAs`, which filters the `user.role` column with `inArray` and so needs the roles as data, and the route guards now go through `requireStaff` and `requireAdmin` (see "Guards below `_authed`" above): `assertStaff` is the wrong tool in a `beforeLoad`, because it throws the server's "Forbidden" rather than the refusal the access-denied page renders. A gate that admits the **owner as well as** staff cannot use it, because `assertStaff` refuses unconditionally: `performTransitionAs` and `hardDeleteProjectAs` read `isStaff` directly, and `updateProjectAs` reaches it through `canEditProject` and `canWritePrivateNotes`. A missing `assertStaff` is therefore evidence the seam is owner-or-staff, not that it is unguarded; check `project-visibility.ts` before concluding either. The several `AuthUser` interfaces in `_internal/` are byte-identical to `NonNullable<Viewer>` except the one in `uploads.ts`, which adds an optional `image`, so they pass straight to a predicate taking `Viewer`; count before you cite a number, since the last count here stood wrong for months.

### Hold: what `hold.ts` does not guarantee

`Hold` is a union of `account`, `walk_in`, `thing` and `none`, and `holdToColumns` maps each to the five `current_holder_*` columns; an account beats a typed name by shape (the `account` case has nowhere to put one), and a walk-in requires an `email`. Three things that look wrong until you know why:

- **"Never neither" is status-dependent and cannot live in the union.** `{ kind: "none" }` is legal and necessary; only the invariants in `inventory-workflow.ts` know a `reserved` or `checked_out` transition may not have it. Read paths also construct cases directly from stored columns, so the union constrains only what passes through `holdFromInput`.
- **Whitespace is not trimmed here**, deliberately: `inventory-workflow.ts` decides person-versus-thing on raw truthiness and the writer stores the raw strings, so the constructor matches both. An empty string **is** normalized to null, which fixed a blank admin cell: `??` does not treat `""` as absent. A TanStack Table `accessorFn` paired with `sortUndefined: "last"` must map the module's `null` to `undefined`, because `sortUndefined` does not special-case `null`.
- **`holderFields` in `inventory-lifecycle-panel.tsx` does not call `holdFromInput`.** The constructor asks "is there an account?"; the dialog asks "do I know there is no account?", and its `AccountStatus` has a third state, `unknown`, because the lookup is debounced. The server re-derives independently either way.

### Notifications: two rules that look wrong

The decisions behind the channels are [ADR-0019](./adr/0019-every-email-is-mandatory-and-staff-share-one-inbox.md) (every email is mandatory, staff share one inbox) and [ADR-0005](./adr/0005-lazy-deadlines-no-scheduler.md) (no scheduler, so no due-soon or overdue email); the table of who is told what, and by which channel, is PRD section 13.

`notificationFor(prev, input, holder, closed)` in `inventory-notifications.ts` returns one notice or null, where `holder` and the notice's `recipient` carry an account id and an address (a walk-in has only the second), `toNotificationRow` turns a notice into a bell row when there is an account, and `EMAILED_INVENTORY_TYPES` says which notices `src/server/_internal/inventory-emails.ts` also mails, after the transaction that wrote the row; `overdueNotifications(candidates, now)` returns many and owns the dedupe, and `transitionItem` and `recordOverdueNotificationsAs` only insert what comes back. `src/lib/project-notifications.ts` is the project half, to the same shape, with `notify.ts` keeping the transaction; `commentNotifications` takes `parentAuthorId` as a parameter because finding it is a query a pure module cannot run. `NotificationRow` lives in `src/lib/notification-row.ts` so neither domain imports the other for a type.

- **A denial is answered before the recipient guard.** The guard asks who holds the item, and a hold on a bare label answers nobody, which would swallow the notice owed to the person who asked. The rejection branch comes first and reads its recipient off the closed line.
- **Inventory does not suppress the actor**, unlike the project module. Suppression is keyed on `authority === "self_cancel"` instead, because staff assigning a hold to their own address is also actor-equals-recipient and *does* want the pickup deadline in their bell.

### The overdue scan: two overlaps and one narrowing

`recordOverdueNotificationsAs` runs two scans, approved request lines scoped to the viewer's requests and staff holds with `current_holder_id IS NOT NULL`, and they overlap on purpose: a line and a hold can name two people (a teammate collected), and both are notified, which the `(user_id, type, link)` index does not collapse because the ids differ. The common case, same person twice in one batch, is deduped in JS before the insert and would be collapsed by `onConflictDoNothing` anyway; the index is declared with explicit target and where so a future unique index on `notifications` cannot swallow unrelated conflicts. The hold scan is narrower than `/my/items`, which also matches an unlinked hold by verified email: a notification needs an account id, and resolving the email on a write path would reintroduce the impersonation risk the read path guards against. The call in `listMyItemsAs` is wrapped in a `catch` that **reports** rather than discards; a bare `catch {}` meant every overdue notification could stop with the page looking fine.

### Retired: the status set is data, not a predicate

`visibleStatuses(viewer, { retiredOnly })` returns the statuses a listing may show, as data, because it has to cross into SQL: `buildInventoryScope` builds its `inArray` from it. Do not reintroduce a literal `ne(status, "retired")` in the query. `canReadInventoryItem` answers the single-row question, so staff opening a retired item by URL is correct. `retiredOnly` is on `listAdminInventorySchema` only, and `visibleStatuses` ignores it for a viewer who may not see retired, so a request has to defeat two independent things to reach a retired row.

### `/my/items` has its own two projections

`holdItemView` and `myRequestLineView` are the third audience for `inventory_items`, beside `publicItemView` and `staffItemView`. `listMyItemsAs` returns one flat array of `MyItemsRow` in display order, each row saying which of three kinds it is. A **hold** row carries `item: HoldItemView`; a **request** row carries `itemName` and `itemStatus` flat plus `line`, and the envelope's `requestId`, `requestedAt` and `note` denormalized onto every line so the page can group by request, and must not carry an item view, because `holdItemView` renames `current_pickup_by` to `pickupBy` and the row would hold two different `pickupBy` values under one name; a **cart** row carries `itemId`, `itemName` and `itemStatus`, because a borrow-list item has no line yet. A closed line is a request row like any other, filed under its request rather than in a separate history arm; only the 50 most recently closed come back. `itemStatus` is what gates the Cancel button, which is what stops a requester cancelling an item a teammate has already collected. `MyRequestLineView` carries `reviewedAt` and `closedAt` for the timeline in the line sheet, and deliberately not `reviewedBy`, `closedBy` or `reviewComment`. `inventory.integration.test.ts` asserts the exact key set of all three kinds, because `listMyItemsAs` once selected whole table objects and shipped `serial`, `notes`, `reviewComment` and the rest to the student; a projection function guarantees only what passes through it.

### `/my/items` disables sorting so the grouped view cannot be sorted away

Every column on `/my/items` is `enableSorting: false` and `enableHiding: false`, and the route's search schema carries `filter` alone, no `sort` or `dir`. That is not a simplification that could be relaxed later. `AdminDataTable` groups only while the sort equals `defaultSort` (see `docs/UI-CONVENTIONS.md`, "Grouping rows that arrived together"), the borrow list's Submit button lives on its group header, and a sortable column would put `?sort=` in reach and take the headers, Submit included, with it. With nothing sortable, `parseSort` returns the inert `defaultSort` whatever the URL says, the sorted row model equals the input, and the page renders the order `listMyItemsAs` returns: borrow list, requests newest first with their lines in cart order, then staff holds by deadline. The `open | closed | all` filter is applied in the browser by `src/lib/my-items-filter.ts`, which is why the route has no `loaderDeps`. For the same reason the route hands `useAdminTable` a no-op `navigate` and an empty `search` rather than its own: the hook's two callbacks only ever write a sort or a hidden-column set, neither of which this page can produce, and the route's real search type has no such keys. Do not add a hidden rank column to "fix" the order; it would be sortable by URL.

### `transitionItem`: what the callers carry

The four callers keep what is theirs (who may act, which line is eligible) and pass the rest as two fields. **`authority`** is the only way past `assertStaff` and is default-deny; `AUTHORITY_TARGET` says which status each value may reach. **`transitionSchema` in `src/server/inventory.ts` must never declare it**: `transitionInventoryItem` carries only `requireUser()`, so `assertStaff` inside `transitionItem` is that endpoint's entire staff gate, and `z.object().parse` stripping the unknown key is what keeps it shut. `src/test/inventory-schemas.test.ts` asserts the stripping, including through `__proto__`; `.passthrough()` there would let any signed-in user retire any item. **`lineDecision`** carries the outcome together with the id of the line it was decided about, because a release cannot carry `requestItemId` and an outcome alone would land on whatever line the item points at. The denial notification goes to the **requester** read from the line, not the item's holder: staff can check a pending item straight out for a teammate.

The rules that stayed in `inventory-transitions.ts` are the ones about a row read under `FOR UPDATE` (a line is still open, belongs to this item, the item is free, a rejection lands on a pending line). A single `plan(viewer, input, currentRow)` is not available: it would read the item before the line, and `lockAttachableRequestLine` takes them line-then-item to match `approveRequestItemAs`; inverting that deadlocks the two paths. `TransitionActor` in `inventory-workflow.ts` is the non-null arm of `Viewer` rather than the union, because the self-service path reads `viewer.id` without `assertStaff` having narrowed it first. One integration case stays on purpose under `defense in depth` in `inventory.integration.test.ts`: `transitionItem throws Forbidden for a non-staff viewer` proves the impl re-checks role on every staff write, which a unit test of the rules module cannot show.

### The dev seed drives the real write path

`scripts/seed-dev.ts` writes catalog data directly and runs the **lifecycle** through `addToCartAs`, `submitCartAs`, the approve, reject and cancel seams and `transitionItem` with a synthetic admin viewer. It used to write `status` and `current_holder_id` itself, and seeded holds had a holder and nothing else. Deadlines are relative to run time (`daysFromNow(-9)`). Overdue notifications are **not** seeded; they appear on first opening `/my/items`, because the scan is lazy. Anything added to the seed that changes item state goes through the same helpers.

### Deferred FK

`inventory_items.current_request_item_id` references `inventory_request_items.id` but the FK is declared in raw SQL inside the migration (not in `schema.ts`) because the two tables reference each other. `ON DELETE SET NULL`.

### The three lifecycles

Normative as of 2026-09-09, and the living copy: `docs/superpowers/specs/2026-09-09-custom-requests-and-inventory-ux-design.md` is the dated record of why, and this table wins wherever the two disagree. `CONTEXT.md` defines what each status means and does not say which transitions are legal; that is this section.

**Request line**, enforced by `inventory-workflow.ts` and the row-locked rules in `inventory-transitions.ts`:

| From | To | Who | What else happens |
| --- | --- | --- | --- |
| (new) | `pending` | requester, by submitting a borrow list | item goes to `requested`, held by the requester |
| `pending` | `approved` | staff | item goes to `reserved`, pickup deadline set |
| `pending` | `rejected` | staff, reason required | item released, usually to `available` |
| `pending` | `cancelled` | requester | item released |
| `approved` | `returned` | staff, on a release from `checked_out` | item released |
| `approved` | `cancelled` | requester, or staff releasing without a return | item released; refused once the item is `checked_out` |

**Custom line**, enforced by `inventory-custom-workflow.ts`:

| From | To | Who | What else happens |
| --- | --- | --- | --- |
| (new) | `pending` | requester, by submitting the form | nothing else; no item exists |
| `pending` | `sourcing` | staff | notification, no item, no dates |
| `pending` | `fulfilled` | staff, linking items we already own | join rows, items reserved unless staff untick it, one notification |
| `sourcing` | `fulfilled` | staff, linking items that arrived | the same |
| `pending` or `sourcing` | `rejected` | staff, reason required | notification carrying the reason |
| `pending` or `sourcing` | `cancelled` | requester | nothing else |

`sourcing` rather than `approved`, and no `returned`: [ADR-0018](./adr/0018-sourcing-not-approved-on-a-custom-line.md). A custom line may be rejected from `sourcing`, unlike a request line, because an order can fall through. Staff may also rewrite `sourcing_note` while the line is `sourcing`, which is the one write that is not a transition; it notifies the requester and never touches the request's own fields. `reviewed_by` and `reviewed_at` are written once, on the first staff decision; `closed_by` and `closed_at` by whichever transition closes the line, the requester included. A line visits at most three of its five statuses, so there is no history table for either kind: the columns are the complete record.

**Item**, unchanged by all of this:

| From | To | Who |
| --- | --- | --- |
| `available` | `requested` | requester, via `submitCartAs` under `self_request`; the only path to `requested` |
| `available` | `reserved` or `checked_out` | staff, with no request line at all; a fulfilment is this, with the requester as holder |
| `requested` | `reserved` | staff, approving the line |
| `requested` | `checked_out` | staff, checking out directly for a teammate |
| `reserved` | `checked_out` | staff, on collection |
| any of `requested`, `reserved`, `checked_out` | `available`, `maintenance` or `retired` | staff; this is a release |
| `available` | `maintenance` and back | staff |
| any | `retired` | staff; the archive |

### An `inventory_requests` row no longer implies an item line

A custom request reuses the envelope ([ADR-0017](./adr/0017-custom-requests-reuse-the-request-envelope.md)), so an envelope holds either item lines or custom lines, never both, and a query that joins `inventory_requests` to `inventory_request_items` sees only the first kind. `countPendingRequests` in `_internal/admin.ts` counts envelopes with a pending line of either kind through two `exists`; `listInventoryRequestsAs` and `listMyItemsAs` run one query per kind and merge. A new join that assumes the old shape silently drops every custom request.

### Fulfil locks items in ascending id order

`fulfillCustomLineAs` locks the line, then each linked item with `SELECT ... FOR UPDATE` in ascending id order, and fails the whole call naming the first item that is not `available`. The reservation is an ordinary staff hold through `transitionItem` with `silent: true`, so the per-item "Reserved" notice is not written and the one fulfil notice is; `assertAuthorized` refuses `silent` under any self-service authority. This is a different rule from the batch approve below, which locks **lines** in ascending id order because each line then locks its item inside `transitionItem`. The two are recorded separately because they are two rules.

### Batch approve iterates lines in ascending id order

`approveRequestLinesAs` in `src/server/_internal/inventory-requests.ts` approves every line the dialog listed inside one transaction, or none of them, and it sorts the ids before it starts. The order is the point, not tidiness. Each line is approved by `approveLineInTx`, which locks the line and then, inside `transitionItem`, the item, the same line-then-item order `lockAttachableRequestLine` takes; two staff running overlapping batches in different orders would each hold a line the other wants next, and Postgres would abort one with a deadlock. Sorted, the second batch waits on the first and then fails with `<item> is no longer pending`, which is what `inventory.integration.test.ts` asserts under `approveRequestLinesAs`. A line no longer pending fails the whole batch rather than being skipped, because the ids are what staff confirmed in the dialog. The fulfill path for custom lines (#80) locks **items** in ascending id order; that is a separate rule and is recorded separately.

### submitCart is lock-first

`submitCartAs` locks each cart item with `SELECT FOR UPDATE` and re-checks `status === "available"` before treating it as a survivor. The `inventoryRequests` envelope is inserted only after the lock phase confirms at least one survivor, so an all-race path never leaves an orphaned request row. Items that lost the race are returned in the `skipped` array with reason `"no_longer_available"`.

## Projects

The vocabulary (project, proposal, proposer, status, transition, team is full, soft delete, private notes, mentorship) is in [`../CONTEXT.md`](../CONTEXT.md). The rules are two pure modules: `src/lib/project-workflow.ts` (which transitions each role may make) and `src/lib/project-visibility.ts` (who sees and edits what), with `project-notifications.ts` beside them.

The decisions: `commitTransition` is the only status-history writer ([ADR-0004](./adr/0004-one-writer-per-status-history.md)), proposers link by email and only a verified address claims ([ADR-0007](./adr/0007-proposer-linking-by-email.md)), reads are staff-only when they reach an account column ([ADR-0003](./adr/0003-every-server-function-declares-its-access-level.md)), one image policy ([ADR-0009](./adr/0009-one-image-upload-policy.md)), one URL per project ([ADR-0010](./adr/0010-single-canonical-url-per-resource.md)), addresses are lowercased on write ([ADR-0015](./adr/0015-addresses-are-normalized-on-write.md)).

### Paging a listing needs a total ordering, or rows repeat and vanish

`searchProjectsImpl` and `listInventoryAs` page with `LIMIT` and `OFFSET`, and each page is a separate query. Where rows tie on every sort key Postgres guarantees nothing about their relative order, so the same row can come back on two pages and another on none. Every ordering therefore ends in the row id, passed as the last argument to `.orderBy` rather than appended inside each branch, so a new sort cannot forget it: `projects.id` after `orderBy`, and `inventory_items.id` after the spread of `INVENTORY_ORDER_BY` (#477). Inventory ties arrive by a different road from projects: anything that writes a batch in one transaction gives every row one `updated_at`. **A new ordering needs no new tie break; it needs only to not bypass that call.**

Two things make this easy to get wrong. The ties are real rather than theoretical: 271 of the 699 legacy projects share a listing date with another, the largest clusters being 17, 12 and 10 on one timestamp, because rows imported with no publish date fall back to a `created_at` carrying a fixed noon time. And the bug hides from small tests. Postgres uses a top-N heapsort for `ORDER BY ... LIMIT n`, whose contents differ per `OFFSET`; at 25 tied rows over a page of 10 the whole set fits one sort and comes back consistently, so a test that size passes against the broken ordering. `src/server/__tests__/listing-order.integration.test.ts` uses 400 over a page of 20, where the unfixed ordering returns 400 rows of which 392 are distinct. `inventory-listing-order.integration.test.ts` copies those numbers and saw the same 392 against the unfixed inventory ordering. Do not trim those numbers: the test's power depends on the planner choosing a heapsort, which it does not control (#429).

### `projects.updated_at` moves only for a change a visitor can see

It orders the public listing under "Recently updated" (#475), so a writer sets it only when a field that reaches `projectDetailView` changes (#502). A mentorship save never does, because the mentor stays on the staff read; a proposer save does only when `studentProposed` changed, since the address and the account link stay staff-only. `updateProjectAs`, `commitTransition` and `updateProjectProgramsAs` always do. The staff "Updated" column, its date filter and the CSV read the same column, so there it means the last visible change rather than the last write, which the column header's `headerHint` tooltip says; the edit log has every write's time. The column has no `$onUpdate`, so a new writer bumps it only by naming it in `.set()`, and `project-updated-at.integration.test.ts` pins each of the five.

### Both domains name the fields their reads return, and a key-set test pins each

`getProjectAs` returns `projectDetailView(project, viewer)`, which names every field the two consuming routes read; that object is the public SSR payload of `/projects/$id` for any viewer, so a new column on `projects` is invisible there until someone names it. `notes` is the one viewer-dependent field, assigned inside the projection from `canSeePrivateNotes`, which is why this cannot become a SQL column map. `proposerEmail` is **absent, not nulled**: the staff panel gets it through `getProposerForEditAs`, staff-gated at the server. `searchVector` and the embedding columns still cross from Postgres into the server process and stop there.

`projectSummarySelect` feeds the listing, my projects and bookmarks, and carries every public field because the table mode shows them; the rule for what may be in it is whatever `projectDetailView` returns to an anonymous viewer minus `notes`, `isSponsored` and `deletedAt`, plus `updatedAt` and `categories`, which the cards show and the detail page renders from its own reads. Until #449 the listing also departed from the rule the other way, carrying program label columns the detail payload lacked, which is why the project page could not name the program its own card had just shown; both now read the same `programs` array from `projectProgramsList`, a correlated subquery rather than a join (#462), so the two projections differ only in the five fields named here. `adminProjectSummarySelect` spreads it and adds proposer identity and lifecycle dates; do not add a field there that the public one already carries. The CSV export reads that one whole, and the staff table reads `adminProjectListSelect`, the same projection less its six prose columns, derived by a rest binding rather than trimmed so the export keeps them (#482); `admin-exports.integration.test.ts` pins the list's key set. `projects.integration.test.ts` pins the detail key set for an anonymous and a staff read, `search.integration.test.ts` and `bookmarks.integration.test.ts` pin the listing's; adding a column fails them until the literals are updated, which is the moment to ask whether the column is public. `proposerEmail` and `notes` must never appear in either. `canEdit` on the detail payload reads `canEditProject` directly and is authoritative; it used to disagree with the predicate for staff on an archived project (#40).

### A `createServerFn` endpoint is reachable on its own

Every consumer of `getProgram` and `listEligibleInstructors` is an admin-only page, so reading the call sites said the code was fine, and it was, until someone called the endpoint without the page: both were reachable without a session until 2026-08-28. The route guard protects the page, not the data, and there is no global middleware. `programs.integration.test.ts` pins both gated reads and the six public `programs` columns; a future join into that bare `select()` would nest the row under table keys, so `courseId` stops resolving and the test fails rather than leaking.

### The edit diff has no field list; it reads the writer's keys

`diffRowFields` (`src/lib/edit-diff.ts`) iterates the keys of the object the writer produced: `buildProjectValues` in `projects.ts` and the `values` literal in `updateInventoryItemAs`. A `PROJECT_EDITABLE_FIELDS` array beside it drifted (`isSponsored` and `requiresNdaIp` were written and never listed), so a diff blind to them returned no changed fields and `updateProjectAs` took the early return before the UPDATE ran: toggling sponsorship alone reported success and saved nothing. Inventory's `satisfies readonly (keyof ...)[]` annotation on the same shape read as protection and was not: it catches a removed column and cannot catch an added one. Two consequences:

- **`next` is `Partial<typeof projects.$inferSelect>`, and `buildProjectValues` is declared to return it.** That is what makes a key which is not a column a typecheck failure. Widening it back to `Record<string, unknown>` restores the bug class.
- **The order of `changedFields` is the order of the literal in the writer**, and it is observable: stored on the edit log and rendered by `EditLogList`, which both staff panels use. `edit-diff.test.ts` and `inventory.integration.test.ts` pin the order to make a reorder loud.

**Categories are the one thing outside the diff, in both directions.** They live on a join table, so `categoryIds` is not a key of the writer's object, and they get their own comparison computed **before** the early return; skipping that would make a categories-only edit take the zero-change path. `inventory.integration.test.ts` edits every field alone, so a field that stops being written fails by name; a test that moves two fields cannot tell you which one carried the write.

### The lifecycle panel asks the rules; it does not restate them

`needsHolder` and `needsDueAt` (`src/lib/inventory-workflow.ts`) exist for `inventory-lifecycle-panel.tsx`, which used to spell both rules inline. The predicates are still a second spelling of what `validateStatusInvariants` decides in its `case` labels, because those labels are what make a seventh `ItemStatus` a compile error, so `inventory-workflow.test.ts` derives the agreement by asking the rules: for every status the panel can target, `needsHolder` must be true exactly when a holderless transition is refused.

### `refreshProjectEmbedding` inside the transaction silently does nothing

`commitTransition` orders notifications inside the transaction (enforced by the type: `recordStatusChangeNotifications` takes a `Tx`), the embedding refresh strictly after commit, and the email strictly after commit. The middle one is enforced by nothing: `refreshProjectEmbedding` takes no `tx`, uses the module `db`, re-reads the row, and returns `"skipped"` unless the status it finds is one `isEmbeddableStatus` names, which since #427 is `published` or `archived`. Called inside the transaction it does not throw; you get a project that publishes and never embeds. Checkable:

```bash
# one hit, in commitTransition
grep -rn 'insert(projectStatusHistory)' src --include='*.ts' | grep -v __tests__
```

`update(projects)` has five legitimate non-status writers, so a grep on that proves nothing.

### A declaration a parity test compares carries no comment and no type annotation

`src/test/backfill-embeddings-parity.test.ts` and `src/test/import-legacy-parity.test.ts` compare whole function bodies as text with whitespace collapsed ([ADR-0024](./adr/0024-ops-scripts-are-plain-mjs.md)), and that comparison strips neither. So a comment inside `buildProjectEmbeddingSource`, or the `(part): part is string` predicate its `filter` used to carry, fails against an `.mjs` copy that can hold neither. Put the explanation in the JSDoc above the function.

### There are two embedding backfills, and only the `.mjs` runs in production

`scripts/backfill-embeddings.ts` calls `refreshProjectEmbedding` and needs `tsx` and `src/`, so it is workstation only; `scripts/backfill-embeddings.mjs` is the ECS task, and pays for that with the copies ADR-0024 describes. **They do the same work by the same rule.** Both select every embeddable row and re-embed the ones whose stored hash no longer matches the text they carry now: the `.ts` by handing each row to `refreshProjectEmbedding`, the `.mjs` by applying that function's hash-and-vector test itself. Either fills a missing vector and refreshes a stale one, and a second run costs no Bedrock call because an unchanged row is skipped before the call. **Run a sweeper after every import, not only the first:** `scripts/import-legacy.mjs` writes project text without going through `refreshProjectEmbedding` and leaves the embedding columns alone, so nothing else corrects those rows. Routine re-embedding after an edit is still `refreshProjectEmbedding`'s own job, and neither sweeper is meant to be the thing that catches that. The `SELECT_SQL` JSDoc in `scripts/backfill-embeddings.mjs` carries the full reasoning, including why the `.mjs` used to select `embedding IS NULL`.

### Editing a project's categories or its program does not re-embed it

The embedded text is the seven prose fields and nothing else, so changing a category or a program leaves `embedding_source_hash` matching and `refreshProjectEmbedding` returns `"unchanged"`. That is the intended answer, not a missed refresh. Expect it when a staff edit to tagging does not move the recommended order. [ADR-0025](./adr/0025-the-embedded-text-is-prose-only.md) is why.

### `sendEmail` is decided by role in `performTransitionAs`, not by the schema

Skipping a transition's mail is a staff affordance. The decision is made from the `ActorRole` the function already derives, and a non-staff caller's `sendEmail: false` is ignored. The schema cannot be the gate, unlike inventory's `authority`: `performTransition` takes its target status from the request, so one validator serves staff and owners alike. Since #379 every email a staff action sends carries the same skip: `SEND_EMAIL_FIELD` in `src/server/send-email-field.ts` is spread into the wire schema, the `*ForCurrentUser` wrapper moves it into `EmailOptions.sendEmail` so the row-writing input never carries it, and the two other owner-reachable writers, `addCommentAs` and `hardDeleteProjectAs`, make the same role decision; the staff-only ones (`updateProjectMentorshipAs`, `updateProjectProposerAs`, and the admin-only `setUserRoleAs` and `banUserAs` since #386) read it as sent. The skip is the email's alone: a bell row is still written where one exists. The inventory writers (#387) honor it in one place, `notifyInventoryByEmail`, which takes the options bag and returns on `sendEmail: false` after the notice's row was written; `TransitionInput.silent` is a different thing, it suppresses the notice itself and so both channels, stays off the wire, and is refused for self-service, while `transitionItem` withholds the skip from any caller with an authority. The UI is `SendEmailCheckbox` inside the dialog or popover the action already has, and `SendEmailDialog` where a plain Save had none. What it protects: an owner reaching `submitted` mails `EMAIL_STAFF_INBOX`, which is the **only** push telling staff a project arrived; the pull surface is the "Awaiting review" count on `/admin`. That email also fails quietly twice over: an unset inbox only warns under the `console` transport (under `ses` the app refuses to boot without it), and `notifyTransitionByEmail` swallows its own errors so a failed send cannot undo an approval.

### An unset `BETTER_AUTH_URL` logs, it no longer just drops the mail

Transition emails carry absolute links from `BETTER_AUTH_URL`. `notifyTransitionByEmail` used to return early when it was unset, silently, so a submitted project sat in a queue nobody had been told about. It now throws when `appBaseUrl` is null, and the throw lands in the function's own `catch`, which logs naming the variable. **The check is an `if` in the body, not a throw inside `buildNotificationConfig`**: the config arrives as a default parameter, evaluated before the body, so a throw in the builder would skip the `try` and report a failure on an approval that had already committed. In production `BETTER_AUTH_URL` is one of the variables `startup-config.ts` refuses to boot without (#137).

### The proposer field locks on divergence, not on the act

`ProposerPicker` locks the input once an account is linked and routes any change through a "Re-assign" modal; picking a new account or unlinking unlocks the field, because the lock is keyed off whether the current value still equals a mount-time snapshot of the saved one. Retyping the original address exactly re-locks it, which is harmless but surprising. Two emails, do not conflate them: `proposer_email` is the private link key; `contact_email` is a separate, hand-typed, public field. The creator is the proposer on create; staff reassign or unlink from the Proposer section of the staff panel afterwards (#322). One caveat on the claim rule in [ADR-0007](./adr/0007-proposer-linking-by-email.md): Better Auth's admin plugin takes an open `data` record on create-user, so an admin can set `emailVerified` for an unproven address and the create hook will claim for it; tolerated because an admin is already trusted with more, not a license for a third caller. One address with both a legacy password account and GitHub ends up as one user row with two `account` rows, linked implicitly and only when the local row is already verified.

### Mentorship is one nullable address, and the mark is the proposer's

`projects.mentor_email` is written only by `updateProjectMentorshipAs`; `projects.student_proposed` is written only by `updateProjectProposerAs`, beside the link, because it says who proposed the project (#336); `project_programs` is written in the app only by `updateProjectProgramsAs` (#450, #462, [ADR-0026](./adr/0026-the-program-is-staff-placed-not-proposed.md), [ADR-0028](./adr/0028-a-project-runs-in-many-programs.md)), `createProjectAs` writing no rows at all so every project arrives unplaced; it compares the incoming ids as a set, so a reorder writes nothing, and hand rolls its edit-log row under the field name `programs` because there is no column left for `diffRowFields` to read. None of the three is on `ProjectInput`, so `updateProjectAs` cannot touch them, and a test fixture that wants a placed project creates it and then calls the staff writer. None of the three refreshes an embedding, because none of their columns is part of the embedded text: the program joined the mentor and the proposer outside it in #463 ([ADR-0025](./adr/0025-the-embedded-text-is-prose-only.md)), which embeds a project's prose and not its categories or program. None touches the scope assessment either, since its source hash already covers each program's `term_count` and reports itself stale on read. The address is the whole of mentorship since #402 ([ADR-0023](./adr/0023-mentorship-is-the-mentor-address.md)): the three-state `mentor_need` column from #373 and the two flags it derived (`seekingMentor`, `noMentorNeeded`) are gone, with their badges, their two listing switches and the refusal that kept `none` away from an address. A project with no mentor is one with a null here, and an instructor who runs a team without an outside mentor records their own address; a mentor on a project that did not strictly need one is a fact, not a contradiction. The mentor is resolved at read time by `mentorNameSql`, a case-insensitive correlated subquery with `LIMIT 1` rather than a `LEFT JOIN`, because a join on `lower(email)` would fan a project out into two rows if two accounts differed only by case. There is no `mentor_id`: mentorship grants no permission. Nothing about the mentor is public: `mentor_email` and the resolved name leave the server through `getProjectMentorship`, the edit log, and the staff projections, `adminProjectSummarySelect` and the table's narrower `adminProjectListSelect` (the staff list, which draws both in its Mentor column and matches both in its search, and the CSV export, #617, #482) only; `projectSummarySelect` and `projectDetailView` carry no key with "mentor" in it, and the key-set pins hold it there. What staff have instead of a public flag is the `withoutMentorOnly` switch on `/admin/projects` (`mentor_email IS NULL`, in `buildAdminProjectScope`, under a label the public listing does not share), which beside `studentProposedOnly` is the to-do the mentors page is matched against, and the dashboard tile "Student proposed, no mentor" on the same two columns over every live status. The Mentor section is the address field with the same `AccountLinkSummary` the Proposer section uses; both sections email a new address on save (the mentor gets no bell row, since they may have no account; the new proposer gets one), and both open `SendEmailDialog` with the skip only when the pending change would send: the address changed to a non-empty value, compared lowercased as the server compares, so a case-only retype saves without a confirm (#379, #385). See #75, #304, #336, #373, #402.

### A comment's edit lock is computed before the viewer filter, and the row says so

`listProjectCommentsAs` reads every comment on the project, derives `hasReply` and `isMine` over that full set, and only then calls `filterCommentsForViewer`. The order is the point. Staff may leave an internal reply under a comment the proposer can see, which `addCommentAs` allows deliberately, and the filter then hands the proposer no child rows for it at all. A thread that counted its own rendered replies would draw an Edit button on a comment `updateCommentAs` refuses, and the refusal could not explain itself without naming a reply the reader is not allowed to know exists. So the server answers the rule and ships one boolean; the refusal message (`COMMENT_LOCKED_MESSAGE`) stays generic for the same reason. `hasReply` is named for the fact rather than the permission on purpose: a `canEdit` on the wire would be a second copy of the guard in `updateCommentAs` and free to drift from it, which is the failure [ADR-0003](./adr/0003-every-server-function-declares-its-access-level.md) exists over. The viewer's own id never crosses, which is why authorship arrives as `isMine` rather than as an id the client compares. An edit writes `edited_at` and nothing else: no email, no `notifications` row, and no rewrite of the `content.slice(0, 200)` snapshot an earlier post left on one, because the recipient already holds the original in their inbox and the bell entry matching what they were told is the honest state (#503). The decision itself, editing in place with no version history, is [ADR-0033](./adr/0033-a-comment-is-edited-in-place.md).

### A date typed into a range is an office day, not a UTC day

`from` and `to` on `/admin/projects` and `/admin/analytics` are `YYYY-MM-DD` strings, and both pages turn them into instants through `src/lib/day-range.ts`: `dayRange(from, to)` is the half-open span from Pacific midnight at the start of `from` to Pacific midnight at the start of the day after `to`, so a `>= start` and `< end` pair keeps the whole of `to`, and a project published at 10pm on the 30th stays in the 30th. Before #335 analytics read the strings as `T00:00:00Z`, which put that project in the next month. There is no date library: `Intl.DateTimeFormat` gives the zone's offset at an instant, and local midnight is a UTC guess corrected once more at the answer, which is what makes the two DST days come out at 23 and 25 hours. The analytics previous period is counted on the calendar (`shiftDay`, `daysInclusive`) rather than in milliseconds for the same reason. `OFFICE_TIME_ZONE` is the one place the zone is named; nothing reads the process zone, so the unit tests hold on any machine.

---

## Amazon Bedrock

This app talks to two different Bedrock endpoints, and almost nothing is shared between them. Embeddings use `bedrock-runtime` through the AWS SDK (`src/lib/_internal/bedrock.ts`). AI project review uses `bedrock-mantle` through a hand-signed `fetch` (`src/lib/_internal/bedrock-mantle.ts`); [ADR-0012](./adr/0012-bedrock-mantle-by-sigv4-embeddings-behind-a-flag.md) says why. Treat a fact about one as saying nothing about the other.

### `robots.txt` and `noindex` are not two strengths of one dial

The catalog is kept out of search results by `<meta name="robots" content="noindex, follow">` on `/projects`, `/projects/$projectId`, `/inventory`, `/inventory/$itemId` and the two `(auth)` routes, spelled once as `NOINDEX` in `src/lib/social-meta.ts`. `public/robots.txt` stays permissive on purpose and must not be tightened to match. A `Disallow` is a ban on fetching, and the preview scrapers (Twitterbot, facebookexternalhit, LinkedInBot, Slackbot, Discordbot) honour it, so it would silently kill the link previews the tags exist to produce. `noindex` is read only by indexers and leaves scrapers alone, which is what lets the catalog be unlisted and shareable at the same time (#498). The tags must also survive server rendering: a crawler runs no JavaScript, so a meta tag that appears only after hydration is not there at all.

### The social card is a committed PNG, not a build artifact

`public/social-card.png` is checked in, and `scripts/generate-social-card.mjs` regenerates it. Two reasons it is not built at deploy time. `og:image` wants a stable URL, because scrapers cache per URL, so hashing it into `/assets/` the way `brand.ts` handles the logo would orphan every preview already scraped on each redesign. And the card renders its text with host fonts through `sharp`, which a slim Linux container does not have: a build-time render would silently substitute whatever fontconfig found. #533 covers per-project cards and has to solve the font problem properly, by committing a licensed font file.

### `VITE_SITE_URL` is build-time, and `BETTER_AUTH_URL` cannot stand in for it

`og:image`, `twitter:image` and `rel=canonical` are specified as absolute URLs, and a scraper has no base to resolve a relative one against: it drops the tag rather than guessing. `head()` runs on both sides of the SSR boundary, so the origin has to reach the client bundle, which means a `VITE_` variable read through `import.meta.env` (`src/lib/site-url.ts`, mirroring `storage.ts`). `BETTER_AUTH_URL` holds the same value in production but is server-only, so it cannot be the source. The value is plumbed from `infra/secrets.tf` through an SSM parameter, the deploy workflow's build args and a `Dockerfile` ARG; miss any one of the four and every production preview points at `http://localhost:3000` while nothing fails. `env-contract.test.ts` cannot catch this one, because it scans for `process.env` and this is `import.meta.env`, which is why `VITE_SITE_URL` has an explicit entry in that test's `NOT_READ_HERE`.

### Mantle rejects `minimal` as a reasoning effort, and the value production uses is not the one in `src`

Bedrock Mantle's model takes `none`, `low`, `medium`, `high`, `xhigh` or `max` for `reasoning.effort` and 400s on anything else, naming its own six. `minimal` is the trap: it is a valid OpenAI API value, so it reads as correct and fails only against a real endpoint. The social summary shipped with it and failed every call in production on 2026-09-21. Two things kept it quiet. The unit tests mock `mantleResponses`, so any string passes them, and the value production ran never came from `src` at all: the task definition sets `BEDROCK_SOCIAL_SUMMARY_REASONING_EFFORT` explicitly, so the `?? "medium"` fallback in `buildSocialSummaryConfig` is dead in ECS and the live value was the `infra/variables.tf` default, which no test read. `src/lib/__tests__/reasoning-effort-contract.test.ts` closes that seam for all three efforts, checking `infra/variables.tf`, `.env.example` and the three `build*Config` fallbacks against `MANTLE_REASONING_EFFORTS` in `src/lib/_internal/bedrock-mantle.ts`. A repeat would no longer be silent in production either: the `ai_write_failures` alarm in `infra/alarms.tf` mails when automatic AI writes keep failing (#548). The general form is worth remembering when reading `env-contract.test.ts`: it proves a variable is present in the task definition, never that its value is one the other system accepts.

### Rewording an AI writer's log line silently zeroes the `ai_write_failures` alarm

Nothing records a failed automatic AI write except the app's own log, so the `ai_write_failures` metric filter in `infra/alarms.tf` counts log lines by their exact, case-sensitive wording, anchored at the start of the line. The anchor is load-bearing: Better Auth logs a rejected `callbackURL` or `Origin` word for word, so a phrase matched anywhere let two unauthenticated requests mail the alarm or hold it in ALARM, and `redactingAuthLogger` collapses newlines so that text cannot start a line of its own. That is the coupling the pool metrics have (Drizzle section): reword a counted line and the filter matches nothing, so the alarm sits in OK through an outage and nothing fails anywhere. `src/server/__tests__/project-refresh.test.ts` runs the pattern against the lines the writers actually print, the ones it must not count included, so a rewording on either side is a red unit test. Change a message and the pattern in the same commit; the comment on the filter says which phrase matches which line. The `aws logs tail` recipe in `DEPLOYMENT.md` that lists them after a mail matches looser, unanchored phrases on purpose, and no test checks it, so it changes in the same commit too.

### A failed Mantle call's real error is in the log, not in `run.error`

`mantleResponses` throws with the response status and up to 500 characters of the body, on one line and with the request's own signed `x-amz-security-token` and `authorization` values removed in any spelling (`redactSignedValues`), or with the undici cause of a failed fetch. That text can carry signed header values or AWS addresses, and each wrapper rethrows `run.error` to a browser, so the `invoke` catch in each `*-core.ts` logs it through `redactQueryError` as `AI review call failed`, `Scope assessment call failed` or `Social summary call failed` and puts the feature's fixed "please try again" message in `run.error` instead (#619). Diagnose from that log line, never from what the user saw. Parse failures still reach the user with their own message, since those are written for them. The automatic social summary refresh therefore logs two lines per failed call: the detail, then its own `Social summary failed for project` line carrying the fixed message.

### A social summary staff wrote is never overwritten, and a hash cannot express that

`projects.social_summary` has two writers: `refreshSocialSummary` (`src/server/_internal/project-social-summary.ts`), which runs automatically wherever `refreshProjectEmbedding` does, in the background ([ADR-0053](./adr/0053-a-save-does-not-wait-for-its-ai-refresh.md)), and the staff panel. `social_summary_source_hash` decides whether the text has moved, exactly as the embedding's does, but a content hash detects change and cannot detect intent. Without `social_summary_is_manual`, an unrelated typo fix in a description would change the hash and silently replace wording staff had corrected, in a field published under the university's name. That flag is tested first, before the hash, in the app's writer and in `scripts/backfill-social-summaries.mjs` alike; the parity test pins both. Nothing human writes to `projects.embedding`, which is why that column needs no equivalent.

### A blank `BEDROCK_EMBEDDING_DIMENSIONS` is zero, not the default

`buildEmbedConfig` (`src/lib/_internal/bedrock-embed.ts`) resolves the value as `Number(env.BEDROCK_EMBEDDING_DIMENSIONS ?? "1024")`. `??` catches only `undefined` and `null`, so an empty string reaches `Number("")`, which is `0`; unset is the only spelling of "missing" that gets 1024. This is worse than a bad request: the model id and the dimension count are both interpolated into the sha256 `embeddingHash` (`src/lib/embedding-source.ts`) stores as `projects.embedding_source_hash`, so a dimension count that changes for an environment changes every hash, every project looks modified, and each re-embeds at one paid call. The blank case is pinned by a test rather than fixed for that reason: whatever the stored hashes were computed with is what the code has to keep computing until someone migrates them deliberately. Not a live state; `.env.example` and `infra/ecs.tf` both set the variable. See #137.

### The embedded text is capped in characters against a model limit in tokens

`EMBEDDING_SOURCE_LIMIT` (`src/lib/embedding-source.ts`) truncates the source at 20,000 characters, but Titan Text Embeddings V2 refuses an input over 8,192 tokens, and no character count can guarantee a token count. A row that overflows fails quietly: `refreshProjectEmbedding` catches the throw and returns `"failed"`, so the row keeps a null vector, sorts last under `recommended` (#427), and every later sweep retries it at one wasted Bedrock call. The limit was 45,000 until 2026-09-20 and had never bound anything, because no project in the corpus came near it. [ADR-0037](./adr/0037-the-embedding-source-limit-stands-in-for-a-token-ceiling.md) carries the trade-off and the arithmetic 20,000 was chosen by.

### The SigV4 service name is `bedrock-mantle`, not `bedrock`

Signing a Mantle request as `bedrock` produces a well-formed signature that the endpoint rejects, and the rejection reads as an IAM misconfiguration rather than a signing bug. The IAM actions are namespaced the same way: Mantle authorizes `bedrock-mantle:CreateInference`, which `bedrock:InvokeModel` does not cover. Both statements are on the task role in `infra/iam.tf`.

### Model ids are not portable between the two endpoints

On `bedrock-mantle` the id is bare: `openai.gpt-5.6-luna`. On `bedrock-runtime` the same model must be named through a cross-region inference profile (`us.openai.gpt-5.6-luna` or `global.`). Each form is rejected by the other endpoint; `BEDROCK_MODEL_ID` holds the Mantle form. The GPT models are also served under `/openai/v1` on Mantle rather than the default `/v1`, so the path is not interchangeable between models either.

### The Responses API retains inputs and outputs unless you opt out

`store` defaults to `true`, which keeps the request and the response for 30 days. Proposals carry unpublished IP and NDA notes, so `runProjectReview` sends `store: false` on every call. This is a default to hold down, not a feature to enable.

### Reasoning models reject sampling parameters and spend the output budget

`temperature` and `top_p` are incompatible with reasoning mode, so the review sends neither. Reasoning tokens also burn down `max_output_tokens` before any visible output appears, so a ceiling sized only for the answer can be consumed before the model emits its tool call. That failure arrives as `status: "incomplete"`, which `parseReviewResponse` reports as its own error, because the fix is different.

### A review without a project is authorized on the session alone

`reviewProjectAs` has two authorization paths. With a `projectId` it loads the project and applies `canEditProject`. Without one, the text is unsaved and belongs to nobody else, so a verified session is the whole gate; the submission page takes that path. That removed the only thing bounding spend, so `assertReviewWithinLimit` is not optional, and it lives in `reviewProjectAs` rather than the wrapper so the integration suite reaches it through the `*As` seam. The client must omit `projectId` rather than send `undefined`: the input schema validates it as a uuid when present.

### `ai_review_usage` is both the limiter and the usage log

One row per call that reached Bedrock, token columns included, because without them nobody can say what a reasoning-effort change costs. Every attempt that reached Bedrock counts, truncated or failed, since a truncated response is billed in full and counting only successes would let a user spend without limit by repeating a failing call. A call the limiter refused does not count, and neither does a blank form, which short-circuits before the request (`called: false`). `runProjectReview` returns a `ReviewRun` rather than throwing, because the failure has to be recorded before it reaches the user; the caller records, then throws. Two concurrent requests can both pass the check and overshoot by one, deliberately unlocked: this exists to stop a loop, not to be exact. Any new table holding per-user counters must be added to `TABLES` in `src/test/db-reset.ts`, or a limit trips in a later test that expected room.

### Field length ceilings have one home, and the review enforces them twice

`FIELD_MAX_LENGTHS` in `src/lib/project-review-fields.ts` is the only place the per-field caps are written; `projectFormSchema`, the review's input schema and the tool schema handed to the model all read it, where three copies once drifted and the model was told nothing about a limit its output had to satisfy. The prompt and the tool schema both state the limit, and neither binds the model, so `parseReviewResponse` drops any suggestion over its cap and keeps the rest: failing the whole review would throw away six good suggestions over one long one.

### The scope assessment is a second Mantle call, not a second output of the review

`src/server/_internal/scope-assessment-core.ts` is the shape of `project-review-core.ts` with its own tool, prompt, effort variable (`BEDROCK_SCOPE_REASONING_EFFORT`, default `high`) and a much lower output ceiling; the two share only the model id and the client. Separate on purpose: the review is a proposer's writing assistant and the assessment is staff judgement support, so bundling would make every review pay for reasoning nobody sees. Each has its own limit pair and `ai_review_usage.feature` says which one a row was (#61). The verdict is stored on `projects` in three columns mirroring the embedding ones, with the same staleness rule; `getScopeAssessmentAs` reports `stale` rather than re-running. The source includes the program's `term_count`. None of the three columns enters `projectDetailView` or `projectSummarySelect`, and `scope-assessment.integration.test.ts` asserts them absent by name.

### Function call arguments arrive as a JSON string

A `function_call` item's `arguments` is a string, not an object: parse it before handing it to Zod. The Responses API spec puts the item at the top level of `output`, while the Bedrock tool-use guide reads it out of an item's `content`, so `findToolCall` looks in both.

## Site traffic

### The traffic writer takes the viewer from the last `X-Forwarded-For` entry

The ALB runs in `preserve` (#556), so it adds nothing and the last entry is CloudFront's append, which is the viewer; anything to its left came from the viewer. `viewerAddress` in `src/lib/_internal/traffic-request.ts` walks from the right past entries inside `TRUSTED_PROXY_CIDR` with `getIPFromHeader` from `@better-auth/core/utils/ip`, the walk Better Auth runs for `session.ipAddress`, so the two can never disagree. The rule recorded on #506, index `length - 2` with `length - 1` inside `var.vpc_cidr`, predates `preserve` and would drop every event. With no `X-Forwarded-For` at all, which is every request to a local dev server and to the smoke and accessibility suites, no address resolves and the event is dropped, so nothing is recorded locally unless a request sets the header; the integration tests do.

### No `CloudFront-*` header is trustworthy before #590 is applied

`Managed-AllViewer` forwards viewer headers and adds none of CloudFront's own, so before the origin request policy changed, any `CloudFront-Viewer-Country` reaching a task was typed by the viewer. #590 records the apply date. `viewerCountry` stores only an exact `^[A-Z]{2}$`, which also refuses a duplicated header that Node joins to `"US, GB"`. The post-deploy check on #591, a forged `AQ` from a real browser outside AWS, is what proves CloudFront overwrites rather than forwards.

### `traffic_salt` is UNLOGGED, and a crash splits the day's visitors

Drizzle cannot declare an unlogged table, so `drizzle/0037_add_traffic_events.sql` says `CREATE UNLOGGED TABLE` by hand and `traffic.integration.test.ts` asserts `relpersistence = 'u'`. A regenerated migration for that table would silently make it logged again. The table is emptied by a crash or failover, which starts a new salt mid-day, and a task that cached the old one keeps it until its next day, so the day's visitors split in two; ADR-0048 accepts that. Rotation reads the row again after `LOCK TABLE`, which is what makes racing tasks agree, and the integration test for the race opens every pooled connection first because a cold pool serializes the four reads and hides a missing re-read.

### The traffic writer records `_public` routes only, and `location` rather than `resolvedLocation` on mount

`src/routes/_public.tsx` renders `useTraffic`, and `isTrafficRoute` refuses any match list with a route outside `_public`, so a route added outside that layout is not recorded, and one added inside it is. `traffic-scope.test.ts` holds the predicate to every id in `routeTree.gen.ts`. On mount the hook reads `router.state.location`: when a client navigation mounts the layout, `resolvedLocation` still names the page being left until `onResolved` fires, which recorded `/admin` against the public matches until `use-traffic.test.tsx` caught it. The search it sends is the leaf match's `_strictSearch`, the keys the route's schema defines; `match.search` also carries any stray key in the URL.

### `/admin/traffic` reads visits from a rollup that a page load fills

Visits for closed days come from `traffic_visits`, filled by `rollUpTrafficVisits` at the top of `getTrafficAs`; today is derived live by the same `visitRowsQuery` (ADR-0050). So the first staff load after a backlog pays for every day since the last rollup at once: about 6 s for a year at a million events, a few milliseconds a day after that. `TRUNCATE traffic_visits` is always safe and is how a change to the visit definition takes effect, since the next load rebuilds everything. A day closes two minutes after local midnight, not at it, so an event timed at 23:59:59 that commits a moment later still lands in its day's rollup. `getTrafficAs` takes `now` so the integration tests can place a day either side of that line; a test that forgets it reads real time and sees every fixture day as closed.

`traffic_events.day` is the office's local date, generated by Postgres from a literal `'America/Los_Angeles'`, because a generated column cannot take a parameter. `src/test/traffic-filters.test.ts` holds the literal to `OFFICE_TIME_ZONE`; changing the zone means a migration that drops and re-adds the column and a truncate of the rollup.

To time the reports locally, `npm run db:seed:traffic` writes a million plausible events (it refuses a database that is not on this machine, and it truncates the traffic tables first) and `npm run db:explain:traffic -- 90` runs `EXPLAIN (ANALYZE, BUFFERS)` over the queries the page actually runs. The seed ends with `VACUUM ANALYZE`: without it the planner has no statistics for the new rows and picks a sort it would otherwise avoid.

`src/lib/traffic-filters.ts` writes the listing filter defaults out by hand, since the project defaults live in a component module the server must not import. A default changed on `/projects` or `/inventory` and not there would count every visit as setting that filter; `traffic-filters.test.ts` fails first.

