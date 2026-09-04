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

---

## TanStack Start

### `createServerFn` must be a top-level exported `const` initializer

TanStack Start's bundler transform recognizes `createServerFn(...).handler(fn)` ONLY when it appears as the direct initializer of a top-level exported const. Calls wrapped in factory functions are not recognized, the handler body is shipped to the browser intact, and any imports it references (like `db`, `pg`, `drizzle`) end up in the client bundle. Symptom: `ReferenceError: Buffer is not defined`.

```ts
// Recognized: stripped on client, RPC stub remains.
export const createProject = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => schema.parse(d))
  .handler(async ({ data }) => { /* server work */ });

// NOT recognized: ships to the browser, drags db into the client bundle.
function makeTransition(target: Status) {
  return createServerFn({ method: "POST" })
    .handler(async ({ data }) => { /* never stripped */ });
}
export const submitProject = makeTransition("submitted");
```

Even if there are 10 near-identical server functions, write them out as 10 top-level constants. Verbose, but the only shape the framework understands.

### Server-only modules must not match `**/*.server.*`

TanStack Start's `import-protection` plugin denies any client-chain import (static OR dynamic) where the resolved path matches `**/*.server.*` OR the specifier matches `@tanstack/react-start/server` (or similar denylist entries). The denial is based on static name analysis; the fact that the import lives inside a stripped `createServerFn` handler does not exempt it. The `_internal/` directory convention is the answer, and [ADR-0001](./adr/0001-internal-directory-for-server-only-code.md) is the layout: wrapper in `src/server/x.ts` doing one dynamic import per handler, impl in `src/server/_internal/x.ts`, auth helpers in `src/lib/_internal/auth-guards.ts` with the client-safe `getSession` wrapper beside it.

### An impl imports its input types back from its domain's wrapper, type-only

The wrapper owns the Zod schema, so the impl takes `import type { XInput } from "../x"` rather than hand-writing an interface that drifts from it. `import type` is erased, so no runtime edge to a `createServerFn` module survives; `verbatimModuleSyntax` is what turns a dropped `type` into a tsc error instead of a silent bundler hazard. **Type-only, never the schema value**: reaching for `listInventorySchema` itself pulls `createServerFn` into a server-only impl and makes the cycle real. An impl that needs a schema as a value means the schema belongs in a client-safe logic module under `src/lib/`.

A domain split across several impls points every impl that needs an input type at its one wrapper (`inventory-catalog.ts` and `inventory-holdings.ts` import from `../inventory`; there is no `_internal/inventory.ts`). Do not read the pattern as requiring matching filenames. Grep for it with `grep -rn 'from "\.\./' src/server/_internal/*.ts`; multi-line imports undercount a grep for `import type`, and `__tests__/` files match on ordinary sibling imports, so count the files the recipe prints rather than trusting a list.

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

### Code that must run at boot goes in a Nitro plugin, not `src/server.ts`

Nitro loads TanStack Start's optional server entry (`src/server.ts`, `createServerEntry`) on the first request, not when the process starts, and ESM evaluates its imports before its body. Measured on the built output with `NODE_ENV=production` and a variable missing: a throw at the top of the entry left the process up with the port bound, answering 500 on every route including `/api/healthz`, and with nothing set `src/db/index.ts` threw first so the check never ran. A Nitro plugin named in `nitro({ plugins })` in `vite.config.ts` runs synchronously inside `useNitroApp` before the listener binds, so a throw there is exit code 1, the message on stderr, and no port. `src/nitro/config-check.ts` is that plugin; it only calls `assertProductionConfig` from `src/lib/_internal/startup-config.ts`, which holds the fatal list and the production gate and is what the unit test imports. Module-level code in `src/lib/auth.ts` or `src/db/index.ts` is not a home either: tests import both, against a CI `.env.local` with no provider credentials. #137.

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

One detail URL per project and per item, staff sections rendered conditionally on it. [ADR-0010](./adr/0010-single-canonical-url-per-resource.md).

### A route component is reused across a param change; key any child that holds a draft

Navigating from `/projects/A` to `/projects/B` re-runs the loader and re-renders the same component instance with new props. Nothing remounts unless the route sets `remountDeps`, and nothing in `src/` does. So a child that keeps draft state in `useState` and loads its record in an effect keeps A's drafts on screen while B's record is in flight, and a Save clicked in that window posts A's values onto B. `StaffMentorshipSection` had exactly this until it was keyed, and `StaffProjectPanel` had the same shape one level up: its open transition dialog kept A's target status and comment, and Confirm posted them with B's id. The key now sits on the panel where `$projectId.tsx` renders it, `<StaffProjectPanel key={project.id} ... />`, which remounts the panel and every section under it on a param change; the sections carry no key of their own. Two tests in `staff-project-panel.test.tsx` rerender the panel with a second id to prove it. Key the outermost child that holds a draft, not the route: `remountDeps` would also discard state the page should keep, such as an open dialog's scroll position.

---

## TanStack Form

### Pass the schema to `validators.onSubmit` directly; `.default()` is what breaks it

```ts
validators: {
  onSubmit: projectFormSchema,
},
```

`@tanstack/react-form` types the validator as `FormValidateFn<T> | StandardSchemaV1<T, unknown>`, and Zod 4 schemas declare `"~standard"`, so they are Standard Schemas. `@tanstack/zod-form-adapter` is not installed and is not the mechanism.

**When this fails to type-check, the cause is almost certainly `.default()`, not the adapter.** `FormValidateOrFn<TFormData>` requires `StandardSchemaV1<TFormData, unknown>`, so the schema's INPUT type must equal the form's data type. A `.default("")` makes that field optional on input and never on output, so input stops matching and the assignment fails. The compiler names the offending field:

```
The types of 'input.description' are incompatible between these types.
  Type 'string | undefined' is not assignable to type 'string'.
```

Neither form schema carries defaults now, and neither needs them: `defaultValues` supplies every field (`initial?.x ?? ""`) and is annotated `satisfies XFormValues`. `z.infer` reads the OUTPUT type, so removing them changed `ProjectFormValues` and `InventoryFormValues` not at all.

**This entry used to say the opposite**, and it was true when written: passing a schema directly did fail, and both forms carried a hand-rolled `safeParse` loop until an architecture review found the constraint had gone. If you hit a typing error here, check your input type before you write the loop again.

### `useForm` generics are unstable; we use a localized `any` for the `Field` helper

`ReturnType<typeof useForm<ProjectFormValues, unknown>>` does not match the installed version's generics. Inside the shared `Field` component we use `// biome-ignore lint/suspicious/noExplicitAny: TanStack Form generics are unstable` plus `type AnyForm = any`. The PUBLIC API of `ProjectForm` (`initial`, `onSubmit`, `ProjectFormValues`) stays fully typed; only the internal field helper escapes.

### `field.state.meta.errors` is a heterogeneous array

Entries can be strings or `{ message }` objects depending on which validator produced them, and since the forms pass a Standard Schema the object shape is now the common path rather than the unusual one. `FieldError` (`src/components/ui/field.tsx`) is the one place that knows this; render field errors through it rather than inline:

```tsx
<FieldError errors={field.state.meta.errors} />
```

**Every `form.Field` render prop needs this.** The one exception is a checkbox behind a `z.boolean()` (`requiresNdaIp`, `isSponsored`, `acceptingApplicants`): it cannot fail validation, so there is nothing to render. Six fields rendered through a raw `form.Field` once displayed nothing at all: type a malformed address into the proposer field, click Save, and validation failed, `canSubmit` flipped false so the button greyed out, and no message appeared anywhere, because `formError` only ever carries server errors.

### Both forms own their save; the route components only navigate

`InventoryForm` and `ProjectForm` import the server functions and write the row themselves. A route passes configuration in and gets a saved id back through `onSaved`; its loader still loads, but its component does nothing but navigate. `ProjectForm` took an `onSubmit` prop until 2026-09-02, so `new.tsx` and `edit.tsx` each held a copy of the payload rules, and nothing could test either: `src/test/` renders no route component, because a route is a `createFileRoute` call rather than a renderable component. A test can still import a route module to read something it exports, which is what `src/test/admin-inventory-columns.test.tsx` does with that page's column list; see the partial router mock in the Vitest section below.

Three rules live in that save, and each looks like cleanup waiting to happen:

- **`proposerEmail` is three-state.** Absent leaves the proposer alone, `null` unlinks, an address links. Create's second write, the one saving the image key, sends `undefined` rather than the form's blank value, or it unlinks the proposer `createProject` just set. `src/server/_internal/projects.ts` tests `data.proposerEmail !== undefined`, which is what makes the three states real.
- **The category write is asymmetric.** Edit calls `setProjectCategories` unconditionally for staff, because clearing every category must reach the server. Create guards on a non-empty list, because a new project has nothing to clear.
- **`isStaff` is its own required prop, not `showProposer`.** `showProposer` and `showCategories` decide what is drawn; `isStaff` decides what is sent. A display prop gating the payload would make hiding a control change the request.

### Server errors via `applyServerErrors`

When a server function throws a `ZodError`, the helper `src/lib/apply-server-errors.ts` maps issues back to field-level errors via `setFieldMeta`. Wrap form `onSubmit` with `try` / `catch` and call it; if it returns false (non-Zod error), surface the message in a top-level banner. Don't expect server validation errors to appear silently next to fields without this helper.

---

## Better Auth

### `authClient.requestPasswordReset`, not `forgetPassword`

The password-reset trigger method is `authClient.requestPasswordReset({ email, redirectTo })`. Older docs and some examples show `forgetPassword`, which does not exist.

### `betterAuth()` does not reject an option it does not know

`betterAuth` is declared `<Options extends BetterAuthOptions>(options: Options)`, so the config literal is inferred as `Options` and TypeScript's excess-property check never runs on it. A misspelled or invented key compiles and does nothing. `emailVerification.callbackURL` sat in `src/lib/auth.ts` that way until 2026-09-01 (#149): there is no such option, and Better Auth reads the landing page from the request body of the call that mails the link. When an option seems to have no effect, check the key against `@better-auth/core/dist/types/init-options.d.mts` before looking anywhere else.

### The sign-in body's `callbackURL` also steers a successful sign-in

Passing `callbackURL` to `authClient.signIn.email` is how the caller used to say where a mailed verification link should land. It has a second effect nothing warns you about: `signInEmail` echoes it back as `redirect: true` with that `url` on the **success** path too, and the client's `redirectPlugin` acts on that with `window.location.href`. A verified person signing in therefore got a full-page navigation to the verification page, racing whatever the sign-in route navigated to itself, and their `?redirect=` return path with it (#254). `signIn.social` has a `disableRedirect` flag for this; `signIn.email` does not.

So the landing page is set in `sendVerificationEmail` (`withVerificationLanding` in `src/lib/auth.ts`), which rewrites the `callbackURL` on the built link. That hook is the last word for every verification email, so no caller passes `callbackURL` to `signIn.email` or `signUp.email` any more, and adding one back reintroduces the race. It also means the landing page is the same for every flow that mails a verification link: `user.changeEmail` is not configured today, and enabling it would want this function to look at which flow it is serving.

### `user.id` is `text`, not `uuid`

Better Auth's CLI generates `text` PKs by default. Overriding requires `advanced.database.generateId` config and risks breaking plugin assumptions about ID format. We accept the default. Every FK that previously was a `uuid` referencing the old `users.id` is now a `text` column referencing `user.id`. Drizzle declarations and integration test mocks use `text` accordingly.

### `additionalFields` are restored across CLI regenerations

If you change Better Auth plugins or `additionalFields` and re-run `npx @better-auth/cli generate`, the CLI overwrites `src/db/auth-schema.ts`. Custom additionalFields (e.g., `affiliation`, `linkedin`) come back automatically because they live in `user.additionalFields` in `src/lib/auth.ts`. The generated file has a hand-written comment marking them so a maintainer knows what to preserve if they ever DO need to edit by hand.

### Console email transport in dev

`EMAIL_TRANSPORT=console` (set in `.env.local`) routes every email the app sends to stderr, not just the auth ones: review notices go through the same `getEmailSender()`. Watch the dev server console for the link blocks. The SES transport behind the same `EmailSender` interface (`src/lib/email/ses-sender.ts`) is what production selects in `infra/ecs.tf`, though it reaches the running container only after a `terraform apply` and a deploy.

Note that `EMAIL_TRANSPORT=ses` requires `EMAIL_FROM`, and the failure is louder than it looks: `getEmailSender()` is called at module scope in `src/lib/auth.ts`, so `createSesEmailSender`'s throw happens during import and takes down the whole app rather than just email. The two are always set together by Terraform. See DEPLOYMENT.md §9.5.

Every email renders through `src/lib/email/templates.ts`, which owns the HTML escaping. There are five render functions; the README's table shows four rows because it merges the approved and changes-requested outcomes. Interpolating a project title or staff comment into `html` without `escapeHtml` is an injection into the staff review inbox, so the templates are the only place that builds email markup.

### `trustHost` is enabled in non-development

`buildAuthConfig` in `src/lib/_internal/auth-config.ts` resolves `trustHost` as `NODE_ENV !== "development"`, and `src/lib/auth.ts` passes it straight through. Required behind the CloudFront/ALB proxy chain in production so origin detection works. Disabled in dev where `localhost:3000` is direct.

Note the predicate is not the one beside it: `useSecureCookies` is `NODE_ENV === "production"`. The two agree under `development` (both off) and `production` (both on), and disagree under every other value, unset included, where `trustHost` is on and secure cookies are off. Nothing rides on the gap, because deployed code never sees a value in it: `Dockerfile` sets `NODE_ENV=production` in the runtime stage and `infra/ecs.tf` sets it again in the task definition. The difference is residue from the two lines arriving in separate commits, not a decision, so do not read intent into it or build on it.

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

### `genericOAuth` prefers the userinfo endpoint whenever the email claim is missing

The default `getUserInfo` in `better-auth/dist/plugins/generic-oauth/routes.mjs` takes its ID-token branch only when the decoded token has BOTH `sub` and `email`. Anything else falls through to the discovered `userinfo_endpoint` with a bearer GET. That is a reasonable default and it is wrong for ONID in the one case that matters.

Two facts collide. Tenant-custom claims ride in the ID token and are absent from Microsoft Graph's `/oidc/userinfo` response, which carries a fixed set (`sub`, `name`, `given_name`, `family_name`, `email`, `picture`). And Entra does not guarantee `email`. So a user without an email claim is routed to the one source that cannot supply the `username` claim we fall back to, and sign-in fails with `email_is_missing`.

`src/lib/_internal/onid-profile.ts` is why: a custom `getUserInfo` that reads the ID token and nothing else. Do not "simplify" it back to the default. Note also that a tenant's discovery document is tenant-wide and says nothing about per-application claim policies, so `claims_supported` will not list a custom claim that is genuinely being released.

### The ONID callback path is not the GitHub callback path, and the version pin holds it there

GitHub sits at `/api/auth/callback/github`; ONID sits at `/api/auth/oauth2/callback/onid`. Better Auth 1.6 mounts generic OAuth on the `oauth2` path, 1.7 converges the two, and Entra matches redirect URIs exactly against what UIT allowlisted. `package.json` therefore pins `better-auth` to `~1.6.13`. Under the old caret range a routine `npm update` would break ONID sign-in with no code change and no failing test. Upgrading to 1.7 means getting a new URI allowlisted first, and removing `genericOAuthClient()` from `src/lib/auth-client.ts`, which 1.7 deletes. See `docs/ONID-SSO.md`.

### Deleting an account anonymizes the row, and the avatar goes after the commit

[ADR-0008](./adr/0008-account-deletion-anonymizes.md) is the decision; `deleteAccountAs` in `src/server/_internal/account.ts` is the code, and `account.integration.test.ts` pins its cascade list against the schema files. Three things that are easy to get wrong when touching it: the avatar object is deleted after the commit through `deleteOwnedObject`, which swallows the failure, because an orphan is a sweep problem and a half-deleted person is a broken promise; two scrubs live outside the FK rule because the columns are addresses (`projects.proposer_email` where the proposer is this user, `projects.mentor_email` wherever it matches), while `contact_*` and `inventory_item_status_history.holder_*` stay, as the privacy page says; and the held-item block reads `heldByViewer` from `inventory-holdings.ts`, the predicate `/my/items` reads, so the page that shows a person their items and the check that refuses to delete their account while they hold one cannot disagree. See #84.

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

Dropping a `GENERATED ALWAYS AS ... STORED` column also drops every index defined on it; Postgres does not preserve or warn about this. `drizzle/0010_category_domains.sql` drops and recreates `inventory_items.search_vector` and explicitly re-issues `CREATE INDEX ... USING GIN ("search_vector")` in the same file, after the `ADD COLUMN`. Skipping that step leaves full-text search working (Postgres will still plan a sequential scan) but silently un-indexed. Confirm the index exists after any such migration:

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

**Into `user.id`.** These are the ones that decide what account deletion removes ([ADR-0008](./adr/0008-account-deletion-anonymizes.md)), so they are listed in full.

| Rule | Columns |
| --- | --- |
| `CASCADE` | `session.user_id`, `account.user_id`, `notifications.user_id`, `user_interests.user_id`, `program_instructors.user_id`, `project_collaborators.user_id`, `project_bookmarks.user_id`, `inventory_cart_items.user_id`. Sessions, credentials, and things the account merely marked. |
| `RESTRICT` | `project_comments.author_id`, `project_status_history.changed_by`, `project_edit_log.editor_id`, `inventory_item_status_history.changed_by`, `inventory_item_edit_log.editor_id`, `inventory_requests.user_id`, `project_bids.student_id`, `project_assignments.student_id`, `project_assignments.assigned_by`. Authorship and audit trail: history has to outlive the person, so an account with any of this cannot be hard-deleted. |
| `SET NULL` | `projects.proposer_id`, `inventory_items.current_holder_id`, `inventory_request_items.reviewed_by`, `inventory_request_items.closed_by`, `inventory_item_status_history.holder_id`. Attribution that can be lost without losing the record. |

Note `inventory_items.current_holder_id`: nulling it does **not** change `status`, so deleting a user who holds an item strands it in `checked_out` with no holder and no way to return it. Return the item first.

**Everywhere else.** `CASCADE` on junction tables and on anything scoped to a parent row (`project_categories`, `inventory_item_categories`, and the comment, history, and edit-log tables against their project or item). `SET NULL` on `projects.program_id`, `inventory_item_status_history.request_item_id`, and `inventory_items.current_request_item_id`. `RESTRICT` on `inventory_request_items.item_id`, so an item with request lines cannot be deleted.

`project_bids.project_id`, `project_bids.program_id`, and `project_assignments.project_id` declare no rule at all and so are `NO ACTION`. Those two tables have no UI; if they ever get one, give them explicit rules first.

### `categories` uniqueness needs an expression index, not a plain UNIQUE

`UNIQUE (domain, coalesce(type, ''), lower(name))`, declared in `schema.ts` and created in
`drizzle/0015_categories_unique_name.sql`.

```sql
CREATE UNIQUE INDEX "categories_domain_type_name_unique_idx"
  ON "categories" USING btree ("domain", coalesce("type", ''), lower("name"));
```

`coalesce(type, '')` is load-bearing: Postgres treats NULLs as distinct in a unique index
and every inventory category carries `type = null`, so a plain `UNIQUE (domain, type, name)` leaves the whole inventory domain unconstrained. `NULLS NOT DISTINCT` says the same thing on PG15+, but Drizzle's `nullsNotDistinct` is on unique *constraints*, which cannot take expressions, so using it would mean a SQL-only index invisible in `schema.ts`. The migration dedupes before creating the index, since `CREATE UNIQUE INDEX` fails outright on existing duplicates; the two non-obvious parts of that step (a `created_at, id` tie-break, and moving junction rows by insert-then-delete rather than `UPDATE`) are commented in the file.

`db-reset.ts` only truncates, so this index is schema state that outlives a test. The
dedupe test drops it to create the duplicates it exists for and restores it in a `finally`; a test that drops it and dies without restoring disarms every uniqueness assertion after it.

### The status enums take their values from `src/lib/vocabularies.ts`

`projectStatusEnum`, `inventoryItemStatusEnum` and `inventoryRequestItemStatusEnum` are declared with an `as const` tuple imported from `src/lib/vocabularies.ts` rather than an inline array, and the client-safe modules derive their unions from the same tuple with `(typeof T)[number]`. `pgEnum`'s overload is `pgEnum<U extends string, T extends Readonly<[U, ...U[]]>>`, so a readonly tuple is accepted as is. Add a status by editing the tuple and generating a migration: the union derives from it, so the two cannot disagree. Every consumer that names a whole vocabulary derives from it too, but that half was swept by hand rather than enforced, so check for a fresh copy before adding one (#271). [ADR-0014](./adr/0014-status-vocabularies-live-in-src-lib.md) says why the tuples live in `src/lib` rather than being derived from `enumValues` here. `categoryDomainEnum` is still inline: nothing outside the server names a category domain, and `src/server/_internal/categories.ts` derives its type from `enumValues` directly.

### Addresses are lowercase in the four columns we write

`inventory_items.current_holder_email`, `inventory_item_status_history.holder_email`, `projects.proposer_email` and `projects.mentor_email` are stored trimmed and lowercase. `normalizeEmailAddress` in `src/lib/email-address.ts` is the only normalizer, reached through `holdToColumns` for the two holder columns and through `createProjectAs`, `updateProjectAs` and `updateProjectMentorshipAs` for the two project ones. `drizzle/0023_normalize_address_columns.sql` backfilled the rows written before it. [ADR-0015](./adr/0015-addresses-are-normalized-on-write.md) is the decision and what it costs, including why the edit log now records a normalized address.

**`user.email` is not one of them, and its folds stay.** Better Auth lowercases that column itself, in 1.6.25, at two layers: `api/routes/sign-up.mjs:165`, `oauth2/link-account.mjs:101` (which every OAuth provider routes through, ONID and GitHub alike) and the admin plugin's `routes.mjs:191` each lowercase before calling, and `db/internal-adapter.mjs` lowercases again inside `createUser` and `createOAuthUser`. That makes the folds in `resolveHold`, `lookupUserByEmailAs`, `resolveProposerId` and `mentorNameSql` defensive rather than load-bearing, and they stay: an upgrade changing that behavior would otherwise stop linking accounts with nothing to show for it. Only a `lower()` applied to one of the four columns above may be dropped, and only after the migration has run against a deployed database, which is why this release drops none.

**Two direct writers bypass the normalizer and are held to it by hand:** `giveFixtureHold` in `src/test/e2e/fixtures.ts` and the project insert in `src/test/a11y/global-setup.ts` both write the columns straight rather than through a server function, so both call `normalizeEmailAddress` themselves. Another added without it would put a mixed-case address in a column everything else assumes is folded. The integration suites write these columns directly too, sometimes with `toUpperCase()`, and that is deliberate: those rows exist to prove the read-side folds still work, and they are torn down with the test.

### Timestamps always `withTimezone: true`

Every timestamp column uses `timestamp("col", { withTimezone: true })`. Stored as `timestamptz`. Required ones chain `.notNull().defaultNow()`. Optional event timestamps (`publishedAt`, `archivedAt`, `deletedAt`, `reviewedAt`, `banExpires`) are nullable but still `withTimezone`.

### TRUNCATE in tests wipes dev data

The integration test setup (`src/test/setup.integration.ts`) calls `TRUNCATE TABLE ... CASCADE` on every table before each test, against the same `DATABASE_URL` as dev. **Running `npm run test:integration` deletes your dev data.** If your project disappears after running tests, that is why; `npm run db:seed:dev` puts it back. [ADR-0011](./adr/0011-integration-tests-truncate-the-dev-database.md) says why there is no separate test database yet.

---

## Vitest test infrastructure

### Run the tests on the Node in `.nvmrc`, not whatever is on PATH

`.nvmrc` pins 24.16.0 and CI uses the same. On Node 26 the jsdom environment comes up without `localStorage`, and about 65 tests across `table-state`, `view-preference`, `use-seed-view`, `view-toggle` and `admin-data-table` die with `TypeError: Cannot read properties of undefined (reading 'clear')`, none of them related to whatever you were changing. `package.json` says `"engines": { "node": ">=24" }`, which Node 26 satisfies, so nothing warns you.

The trap: if your shell loads nvm through a function (the lazy-load pattern), anything that bypasses shell function resolution silently gets the *other* Node. `env FOO=bar npx vitest ...` does exactly that, and so does a git hook, since lefthook runs its commands under `sh`. The first `pre-push` after the hook was added saw Node 26 and 79 failures while `npm test` from zsh passed. `scripts/nvmrc-node.sh` sources nvm or fnm to switch to the `.nvmrc` major and, when it cannot, fails on the version with the reason rather than on the tests; the `pre-push` commands in `lefthook.yml` go through it. Check `node --version` from inside the same invocation before believing a strange test failure.

### A test that spawns git under a hook must drop `GIT_DIR` first

A git hook exports `GIT_DIR` (and under some commands `GIT_WORK_TREE` and `GIT_INDEX_FILE`) to everything it runs, and `pre-push` runs the unit suite. `src/test/claude-hooks.test.ts` builds a throwaway repository with `git init`; under the hook, with `GIT_DIR` pointing at this checkout's gitdir and no work tree named, that `git init` re-initialized this repository as bare, and every git command afterwards failed with `fatal: this operation must be run in a work tree`. The fix was `git config core.bare false`; the cause took three pushes to find. Any test that spawns git builds its environment from `process.env` with every `GIT_*` key removed, as that file does, and so does a hook script that runs git on the session's `cwd`.

### The git-guard tests run in a fixture repository, because CI checks out `main`

On a push to `main`, CI checks out `main` itself, so a test that ran the git guard with `cwd` at the checkout tripped the never-commit-on-main rule it was not testing; a pull request run never showed it, since that checkout is a detached merge ref. `src/test/claude-hooks.test.ts` drives the guard from a throwaway repository on `fix/test`, with a `sub` directory for the subdirectory case, and a second one on `main` for the rules that are about `main`.

### Scripts get their environment from `--env-file`, not from dotenv imports

ESM imports hoist above all statements. Writing `import { config } from "dotenv"; config({ path: ".env.local" }); import { db } from "..."` looks correct but is wrong: the `db` import runs BEFORE the `config()` call, so `DATABASE_URL` is unset when `src/db/index.ts` evaluates. Pass `--env-file=.env.local` to `tsx` at the command line instead, as every `db:seed:*` script in `package.json` does, and do not import dotenv in the script.

### Vitest needs the agent tool sandbox disabled

Running Vitest inside a sandboxed tool call dies with `EMFILE: too many open files`, and `ulimit -n 8192` does not help: Vite's watcher opens more descriptors than the sandbox allows, and the failure looks like a broken test. Run the suites with the sandbox off. Two more things the sandbox refuses, both of which look like the tool being broken: `gh` fails TLS inside it, and anything that writes `.git/config`, such as `git branch -d`, `git worktree add` and `git remote`, half-completes.

Two harmless things every run prints in this repo:

```
module is not defined
close timed out after 10000ms
Tests closed successfully but something prevents Vite server from exiting
```

The results above those lines and the exit code are still authoritative.

### A test that spawns a subprocess needs a budget above the subprocess's own

Vitest's default `testTimeout` is 5000ms, which was also the cap `.claude/hooks/session-context.mjs` put on each thing it shells out to, so one slow `docker compose ps` spent the entire test budget before the hook printed a line and the test failed on CI while passing on every developer machine (#252). When a test drives a process that has its own timeouts, give that test an explicit ceiling above their sum, as the third argument to `it`; do not raise the global `testTimeout`, which hides slow tests everywhere else. The Playwright `globalTimeout` and `actionTimeout` entries below are the same shape one layer up. And a probe whose answer is a convenience should fail visibly: `session-context.mjs` reports a compose check that timed out as a timeout, because folding it into "nothing running" would tell a session to start a stack that is already up.

### A missing DATABASE_URL fails every route, including `/api/healthz`

`src/routes/api/healthz.ts` returns a hardcoded 200 and avoids the database on purpose, for the ALB. That is true of the route and false of the server: `src/db/index.ts` throws at module scope, so in the built output a missing `DATABASE_URL` fails the whole SSR graph, and the process binds the port, stays up, and answers 500 on every route, healthz included. With `NODE_ENV=production`, `src/nitro/config-check.ts` stops the process first with one message naming every missing variable. This is why `playwright.e2e.config.ts` uses healthz as its `webServer.url`: a misconfigured server never goes ready and the run fails as "server did not start" rather than as five confusing test failures.

### `npm run start` gets no dotenv, unlike the dev server

`start` is bare `node .output/server/index.mjs`, while the dev server gets `.env.local` through Vite. `playwright.e2e.config.ts` calls `loadDotenv` at module scope for this reason, and Playwright passes its `process.env` down to `webServer`; remove that call and you get the 500-on-every-route behaviour above. Related: `VITE_STORAGE_PUBLIC_BASE` is inlined at build time and `src/lib/storage.ts` falls back to `/storage`, so a build without it produces working-looking relative URLs against an origin that serves nothing. The CI job writes `.env.local` before the build.

### The smoke suite runs on port 3001 and never reuses a server

`reuseExistingServer: false` unconditionally, because a dev server left on 3000 would substitute the dev build for the production build the suite exists to exercise, and report green. Port 3001 keeps both runnable at once. `BETTER_AUTH_URL` moves with it, because Better Auth checks the request origin and a mismatch fails sign-in for a reason that looks nothing like a port problem.

### Smoke fixtures are created per attempt, and swept by prefix

`src/test/e2e/fixtures.ts` creates mutated rows inside the test; global setup only sweeps `E2E-` orphans, and it runs before the first attempt, so it cannot repair what an attempt left behind. The inventory flow walks an item through `available -> requested -> reserved -> checked_out -> available`, and an attempt dying at check-out leaves it `reserved`. Sweep order matters: `inventory_request_items.item_id` is the one FK in that graph declared `onDelete: "restrict"`, so request lines and their requests go before the items. Four things outlive the rows and are swept separately: notifications, matched on the prefix inside their title; the accounts the sign-up flow creates, on an `e2e-` address prefix, with their `verification` rows; and the avatar column on the two seeded students, because the upload flow writes to a seeded row. Objects in the bucket are not swept, deliberately.

### Assert that a transition landed, not that its dialog closed

A popover closes on failure as readily as on success, so `expect(confirmButton).toBeHidden()` is not evidence a write happened; the inventory test approved a request on that assertion and died four steps later on a missing `Check out` button. Assert what the page shows only on success: here, the row leaving a list filtered to pending. `actionTimeout` is set, because without it a stuck click is bounded only by the test timeout and names no locator.

### The smoke budget is read, not enforced

The job targets 5 minutes; `globalTimeout` is 8, a hang catcher, because two identical CI runs took 2m31s and 3m33s and a timeout sized to the budget fails on a slow runner rather than on a broken test. Three consecutive runs over the budget is the signal to demote a flow to #143. `test:smoke` and `test:e2e` share `playwright.e2e.config.ts`; `test:e2e` passes `--global-timeout` on the npm script rather than changing the config, which would quietly lengthen the pull-request path's catcher. Only the smoke subset runs on pull requests; the full suite is `workflow_dispatch` in `.github/workflows/full-e2e.yml`, and the trigger is "before a release".

### The account flow reads the server's log, because nothing stores those tokens

Better Auth signs the email-verification and password-reset tokens rather than storing them, so the `verification` table is empty after a sign-up. The console email transport writes to stderr, and there is no file transport. So `playwright.e2e.config.ts` tees the built server's output into `src/test/e2e/.server.log`, and `account.e2e.test.ts` polls that file for the link addressed to its own generated `e2e-<uuid>@example.com` address; `tee` truncates on open, so each run starts empty, and the sweep deletes the accounts by prefix.

### Browser suites select by role and name, and add no test IDs

Both Playwright suites locate by accessible role and name first, falling back to `data-slot`, and never to a test id added to a production component: a selector nobody can reach with a screen reader says nothing about whether the page works. Where the markup offers no role, a structural or attribute selector appears with the reason inline (`time[datetime]` for a rendered date, `p.text-destructive` for a form error); `src/test/e2e/locators.ts` holds the ones more than one flow needs.

### A structural selector fails open when the markup under it changes

When the `/my/items` entries went from plain divs to table rows, the `> div > div` chain that had reached an entry kept matching, on the table's wrapper, so a test that looked for one button inside it stayed green and only the test that asserted on a `time` element went red. The tell is a locator that still finds something after the markup it described is gone; check the accessibility snapshot in the failure's error context before trusting a structural selector's green.

### `getByText` is case-insensitive substring matching, so status words need `exact`

A status word is rarely unique on the page that shows it. On a staff item page the Danger zone reads "allowed only when status is available or retired" from first paint, and the override select renders a lowercase status name in its trigger for the length of an in-flight transition; two assertions passed on those decoys. Pass `{ exact: true }` whenever the text is a status label, and scope to `statusSection` from `locators.ts` when the badge is what you mean: `exact` excludes the decoys, scoping disambiguates the two legitimate badges a staff viewer gets (header and panel, both reading `Retired`), which an unscoped exact match resolves to both and trips strict mode.

### Do not navigate away from a write that has not answered

A `goto` or `reload` over an in-flight server function aborts it, and the page then looks exactly as it does after the write succeeded. Where the app navigates on success, wait for the URL; where it does not, wait for the response. Server functions POST to `/_serverFn/<hash>`, whose hash is a build artifact, so match the prefix on a page that fires only the one request. Three flows were green against code that had done nothing: the avatar upload, the password reset (the test then signed in with the old password and passed), and an item edit.

### `getByText` finds a draft typed into a controlled textarea

React mirrors a controlled `<textarea>`'s value into its `defaultValue`, which is the element's text content, so `page.getByText(draft)` resolves on the composer the moment the draft is typed, before any post has answered. That is how #188 looked like a remount. Assert that a comment rendered on the node that renders it, `page.getByRole("paragraph").filter({ hasText })`, and keep the broad `getByText(...).toHaveCount(0)` for absences. A form that clears itself after a write disables its fields while the write is in flight, as both comment forms in `src/components/comment-thread.tsx` do: a `fill` on a disabled field waits for it.

### The header avatar is a page load behind the profile page

`site-header.tsx` reads `authClient.useSession()`, Better Auth's own client session cache, which `router.invalidate()` does not refresh. Uploading an avatar updates the profile page's preview immediately and leaves the header showing initials until the next full load. The end-to-end test asserts the header only after a reload.

### The smoke and accessibility suites share one local database

In CI they never meet. Locally they share the dev database and both act as `user@example.com`, and `sweepOrphans` runs at the *start* of an end-to-end run, so the database is dirty for whatever runs next: leftover `E2E-` rows, and notifications the smoke flows created, which make the bell render a badge that fails contrast in dark mode (#145). `npm run test:e2e:sweep` runs the sweep on its own; do that before treating a red accessibility run after an end-to-end run as a regression. `db:seed:dev` is not an alternative, because it removes nothing.

### The accessibility suite retries in CI, and only in CI

`playwright.a11y.config.ts` sets `retries: process.env.CI ? 2 : 0`, so a flake stays visible locally and a shared runner gets two tries. The failure that prompted this does not look like what it is:

```
- <vite-error-overlay></vite-error-overlay> intercepts pointer events
```

That is not an accessibility violation and axe never ran: the dev server hit a transient `[vite] Internal server error: socket hang up`, Vite painted its overlay over the page, and the overlay swallowed the click, which failed 30 seconds later as a locator timeout. Search the job log for `vite-error-overlay` before suspecting the element.

### A Columns menu that scrolls must be focusable itself

`AdminDataTable` passes `tabIndex={0}` to its `DropdownMenuContent`. Radix gives menu content `tabindex="-1"` and honours a caller's `tabIndex` because the prop is spread last. With four hideable columns the menu never scrolls; the public projects table has fifteen, the menu is taller than Radix's space, and axe reports `scrollable-region-focusable`, since a pointer-opened menu keeps focus on the content with every item at `-1`. Making the region tabbable satisfies the rule and changes nothing a keyboard user does, because Radix focuses the content on open regardless and unmounts it on close. The scan that catches it, `projects table interactions` in `public.a11y.test.ts`, is not `@smoke`. The neighbouring `modal={false}` comment in `admin-data-table.tsx` is the other Radix menu lesson: a modal menu puts the rest of the page under `aria-hidden`, a different rule with a different fix.

### axe skips a disabled control, so a disabled pill's colours are yours to measure

axe-core's `color-contrast` rule does not evaluate a disabled form control, since WCAG 1.4.3 exempts inactive components. The current-status pill in `staff-project-panel.tsx` is a `<button disabled>`, so the scan was green with the old white on brand orange, which measures 3.48:1 and fails (#208). When a disabled element carries text a person still has to read, compute the ratio yourself and say so in the PR.

### The unit suite sees your dotenv files, so an env-dependent test is machine-dependent

`vite.config.ts` declares no `test` block, which makes it easy to assume the unit run sees no dotenv. It does: the runner populates `process.env` from `.env` and `.env.local` before any test executes, and a plan under `docs/superpowers/plans/` asserts the opposite. So an assertion on a value the process resolved is an assertion about the author's `.env.local`, and CI never catches it, because the `verify` job writes no dotenv file. `bedrock-embed.test.ts` compared `EMBEDDING_DIMENSIONS` against the literal `1024` and went red for anyone who had set the variable; it now asserts the constant matches `buildEmbedConfig(process.env)`. For config generally, assert through a builder handed a literal environment, the way `aws-config.test.ts` calls `buildS3Config({ S3_REGION: "us-west-2" } as NodeJS.ProcessEnv)`.

### Integration tests need DATABASE_URL at config-load time

`src/db/index.ts` reads `DATABASE_URL` at module-import time and throws if missing. Vitest `setupFiles` run AFTER the test files start importing, so loading dotenv from `setup.integration.ts` is too late. Load it from `vitest.integration.config.ts` itself:

```ts
import { config as loadDotenv } from "dotenv";
loadDotenv({ path: [".env.local", ".env"] });

export default defineConfig({ /* ... */ });
```

### A unit test that transitively imports `#/db` passes locally and fails in CI

Same root cause from the other direction: locally the value is present because the app's Vite config picks up `.env`, and CI has no `.env` at all. So a unit test importing any module that imports `#/db`, even for a pure function, passes on your machine and fails on the PR. Keep pure logic in a module that imports nothing, and let the query layer import it rather than the reverse: `src/lib/ai-review-limits.ts` holds the rate limit decision, `server/_internal/ai-review-usage.ts` the queries around it. To reproduce a CI run locally, `DATABASE_URL= npm test`: the check is falsy, and dotenv will not overwrite a variable that is already set.

### The integration suite refuses to run with embeddings enabled

`vitest.integration.config.ts` sets `BEDROCK_EMBEDDINGS_ENABLED=false` in its `env` block, and `src/test/setup.integration.ts` throws at collection if that did not arrive. Unset counts as enabled, because `embeddingsEnabled()` treats anything but that exact string as on, so a deleted config line trips it. Fix the config, not your environment: `test.env` beats the shell. [ADR-0012](./adr/0012-bedrock-mantle-by-sigv4-embeddings-behind-a-flag.md) says why the flag exists; the switch lives in `src/lib/_internal/embeddings-flag.ts` rather than beside the adapter, so reading it costs no `@aws-sdk/client-bedrock-runtime` import.

### Vitest 4 `poolOptions` moved

Older docs show `test.poolOptions.forks.singleFork: true`. Vitest 4 removed that path. Use top-level `test.fileParallelism: false` instead.

### Radix Popover / cmdk need jsdom polyfills

Component tests that mount a Radix Popover or a cmdk `Command` throw on render unless you stub the DOM APIs jsdom omits. Add them in a `beforeAll`: `Element.prototype.scrollIntoView`, `hasPointerCapture`, `setPointerCapture`, `releasePointerCapture` (each `vi.fn()`), plus a no-op `globalThis.ResizeObserver` class. `PopoverContent` only mounts when the popover is open, so click the trigger before querying inside it. The canonical setup is in `src/test/proposer-picker.test.tsx`; most form tests dodge this by mocking the heavy Radix children instead (`src/test/project-form-ai-review.test.tsx`).

A Radix `Select` needs the same stubs and a different gesture: its trigger opens on `pointerdown`, not `click`, and only for a primary mouse button with no ctrl key, so `fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" })` is what opens it. A `fireEvent.click` there does nothing and the `findByRole("option")` that follows times out. The trigger answers to `getByRole("combobox")`, named by its `Label`. `src/test/inventory-lifecycle-panel.test.tsx` drives one.

### `as ReturnType<typeof vi.fn>` triggers TS2352

Use the double-cast variant for mock typings:

```ts
(auth.api.getSession as unknown as ReturnType<typeof vi.fn>)
  .mockResolvedValueOnce({ /* ... */ });
```

### `vi.spyOn` mock-calls callback typing

If you get TS7006 ("Parameter implicitly has 'any' type") on `mock.calls.map((c) => ...)`, annotate as `(c: unknown[])`.

### A route module under test needs a partial router mock, not a full one

A unit test that imports a route module to reach its column list cannot `vi.mock("@tanstack/react-router")` with a plain factory. The TanStack Start plugin rewrites route files and injects its own router imports (`lazyRouteComponent` among them), so a full mock fails the import with "No \"lazyRouteComponent\" export is defined". Spread the real module and override only what the cells render:

```ts
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (/* plain anchor */) => null,
}));
```

The real `createFileRoute` runs fine at import time, so nothing else needs stubbing. `src/test/admin-inventory-columns.test.tsx` is the canonical one. Reaching a route's column list also means exporting it: `/admin/inventory` exports `COLUMNS` and `DEFAULT_SORT` for this, and every other admin route still keeps them private, so a second consumer test starts by adding that export. A column module under `src/components/` (`inventory-table-columns.tsx`) has neither constraint: it exports its columns already and mocks the whole router.

### Integration tests call the `*As(viewer, ...)` seam, never `requireUser()`

`requireUser()` reads TanStack Start's AsyncLocalStorage request context, which the Vitest integration harness cannot provide. Tests construct a synthetic viewer (`{ id, role }`) with a local `makeUser` helper and call the `*As` variant directly; [ADR-0002](./adr/0002-one-named-wrapper-per-action.md) is the convention that guarantees one exists. `uploadProjectImageAs` / `uploadProjectImageForCurrentUser` in `src/server/_internal/uploads.ts` is the canonical pair.

---

## Biome / Ultracite and code style

Linting and formatting run through **Ultracite** (a strict Biome preset). `biome.json` extends `ultracite/biome/core` + `ultracite/biome/react`. `npm run check` runs `ultracite check`; `npm run format` runs `ultracite fix`.

### Hard rules

- 2-space indent.
- Double quotes for JS / TS strings.
- Imports auto-sorted by the Biome assist organize-imports rule. Don't fight it.
- Everything is checked except generated / tool-managed paths excluded in `biome.json`: `src/routeTree.gen.ts`, `src/styles.css`, `scripts/`, and `drizzle/`. (Biome respects `.gitignore` via `vcs.useIgnoreFile`, so `playwright-report/` etc. are skipped too.)
- `npm run check` must be clean before committing. Run `npm run format` (or `npx ultracite fix`) to auto-fix.

### The git hooks

`lefthook.yml` runs `npx ultracite check` on the staged files at pre-commit, so the
rule above is enforced rather than remembered; `CONTRIBUTING.md` has the table of
the other gates it runs. `npm install` installs the hooks via the `prepare` script;
nobody runs anything by hand.

- **`prepare` is `lefthook install || true`, and the guard is load-bearing.**
  `.dockerignore` excludes `.git`, and the Dockerfile's runtime stage runs
  `npm ci --omit=dev`, so `lefthook install` fails in both image stages. Without
  the guard, the image build fails with it.
- **A missing `node_modules` does not block commits.** The generated
  `.git/hooks/pre-commit` falls through to `echo "Can't find lefthook in PATH"`
  and exits 0, so committing before `npm install` warns instead of failing.
- **To skip it:** `LEFTHOOK=0 git commit ...`, or `git commit --no-verify`.

The message and prose checks are `scripts/check-commit-message.mjs` and
`scripts/check-prose.mjs`, the same files CI's `verify` and `pr-text` jobs and the
Claude Code hooks under `.claude/hooks/` run, so a rule has one implementation.
`src/test/check-scripts.test.ts` drives them as processes, exit code and all,
because the exit code is the contract every caller reads. They are written with
`\u` escapes for the characters they reject, which is not decoration: the
scripts are tracked, so a literal emdash in them fails `--all`.

### Rules deliberately relaxed or deferred

Tuned in `biome.json` rather than fought file-by-file:

- **Disabled (idiom / framework conflict):** `noVoid` (intentional fire-and-forget `void promise()`), `useFilenamingConvention` under `src/routes/**` (TanStack `$param` / `__root` files), plus inline ignores for `noNamespaceImport` (drizzle `import * as schema`, shadcn) and `noBarrelFile` (the schema re-export).
- **Relaxed in tests** (`*.test.ts(x)`, `__tests__/`, `src/test/`): `useTopLevelRegex`, `noEmptyBlockStatements`, `useAwait`, `noNonNullAssertion`.
- **Deferred (needs real a11y/UX work, tracked as a finding):** `useImageSize` (add intrinsic image dimensions). Re-enable when addressed.
- **Re-enabled 2026-08-22:** `noAlert`. It was off while the app still used native `alert()`/`confirm()`; those are now `ConfirmDialog` and `sonner` toasts, so the rule passes and catches a regression at edit time. `src/test/no-native-modals.test.ts` guards the same thing at test time, including the `window.`-prefixed forms the linter also sees.

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

The git rules (stage by name, never commit to `main`, no session links on a remote)
bind every turn, so they live in [`../AGENTS.md`](../AGENTS.md) instead of here.

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

### Path-by-path convention summary

| Path | What goes there |
| --- | --- |
| `CONTEXT.md` | The glossary: one definition per domain term, with the synonyms the codebase does not use. |
| `docs/adr/*.md` | One paragraph per decision that is hard to reverse, surprising without context, and the result of a trade-off. |
| `src/lib/*.ts` | Pure modules, client-safe wrappers. |
| `src/lib/_internal/*.ts` | Server-only helpers (auth-guards). |
| `src/lib/__tests__/*.test.ts` | Pure-module unit tests, plus two integration suites (`auth`, `role-gate`) that need a database, plus two suites that also read source off disk (`env-contract`, which reads `src`, `scripts`, `.env.example` and `infra/`, and `image-upload-policy`, whose other cases import the module normally). |
| `src/nitro/*.ts` | Nitro runtime plugins, named in `vite.config.ts`; the only code that runs at boot. |
| `src/server/*.ts` | createServerFn wrappers (Zod schemas + dynamic-import handlers). Client-importable. |
| `src/server/_internal/*.ts` | Impl + `*As(viewer, ...)` + `*ForCurrentUser(...)` helpers. Server-only. |
| `src/server/__tests__/*.integration.test.ts` | Integration tests against docker Postgres. |
| `src/server/__tests__/*.test.ts` | Unit tests over the server layer, including the structural ones (`seam-convention`, `access-contract`) that read source off disk and need no database. `access-contract.ts` and `server-fn-scan.ts` sit beside them and are not test files. |
| `src/components/*.tsx` | App components built on shadcn/ui + Radix primitives (see `src/components/ui/`). |
| `src/routes/...` | TanStack file-based routes. `_layout.tsx` are pathless. `routeTree.gen.ts` is auto-generated; do not hand-edit. |
| `src/db/schema.ts` | Hand-written Drizzle schema for app tables. |
| `src/db/auth-schema.ts` | Better Auth CLI-generated tables. Do not hand-edit; preserved through regen via `additionalFields`. |
| `drizzle/*.sql` | Generated migrations. New tsvector / FK-rule changes are HAND-AUTHORED (see Drizzle section). |
| `scripts/*.ts` | Operational scripts (seeding, one-shot fixes). Not Biome-checked. |
| `scripts/check-*.mjs` | The rule checks (`check-prose`, `check-commit-message`, `check-compression`) that lefthook, CI and the Claude Code hooks share. Not Biome-checked; tested from `src/test/`. |
| `.claude/hooks/*.mjs` | Claude Code hooks: refuse the git and `gh` commands and the edits the rules forbid, report Biome and prose on each edit, print session context. Biome-checked; tested from `src/test/claude-hooks.test.ts`. |
| `docs/agents/*.md` | What the mattpocock engineering skills read about this repo: issue tracker, triage labels, domain docs. |
| `docs/superpowers/specs/*` | Design docs for the large features that went through the superpowers workflow. Ordinary work is specified in its GitHub issue instead. |
| `docs/superpowers/plans/*` | Implementation plans for those same specs. |
| `docs/QUIRKS.md` | This file. |
| `docs/UI-CONVENTIONS.md` | Design system rules: components, tokens, responsive layout. |

### `/privacy` is a promise the deletion flow makes, so its copy and #84 move together

`src/routes/privacy.tsx` is public, outside `_authed`, and static: the body lives in `src/components/privacy-policy.tsx` and only a developer changes it. Its account-closure paragraph names what deletion removes and keeps, because `DeleteAccountDialog` (#84) makes exactly those promises and a policy that said less would leave them backed by nothing. Change one and change the other; [ADR-0008](./adr/0008-account-deletion-anonymizes.md) says what the server actually does. The sign-up line pointing here is a notice, not a checkbox; nothing writes to `user`. `brand.supportEmail` reaches the page through `SupportEmailLink` (`src/components/support-email-link.tsx`), which is also what the ONID refusal banner on `/sign-in` renders (#71); grep for the component to find every surface that shows the address. `public.e2e.test.ts` loads it with no cookie, which is the only proof a route outside `_authed` stays outside it. See #91.

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

The vocabulary (item, hold, holder, request line, borrow list, release, retire, the two status sets) is in [`../CONTEXT.md`](../CONTEXT.md). The rules are five pure, client-safe modules under `src/lib/`, each unit tested in `npm test` with no docker: `inventory-workflow.ts` (what a transition may do), `hold.ts` (who holds an item), `inventory-deadlines.ts` (what overdue means), `inventory-notifications.ts` (who is told), `inventory-visibility.ts` (who sees what). Read the module before this section; a new rule or a new case belongs in its unit test, not in the integration suite, which is for assertions about a row.

The decisions: `transitionItem` is the only writer ([ADR-0004](./adr/0004-one-writer-per-status-history.md)), deadlines are lazy and there is no scheduler ([ADR-0005](./adr/0005-lazy-deadlines-no-scheduler.md)), retired is the archive and hard delete is narrow ([ADR-0006](./adr/0006-retired-is-the-archive.md)), one image policy ([ADR-0009](./adr/0009-one-image-upload-policy.md)), addresses are lowercased on write ([ADR-0015](./adr/0015-addresses-are-normalized-on-write.md)).

### Categories: `domain` is closed, `type` is a project-only facet, filtering is all-match

`categories.domain` is fixed at creation and immutable on update, and `listInventoryCategoriesImpl` re-filters on `domain = 'inventory'` at the junction read even though nothing writes a project-domain row there. Both listings filter categories as all-match: a subquery grouped by item or project id with `HAVING count(*) = <number of selected ids>` (`buildInventoryScope` in `inventory-catalog.ts`, `searchProjectsImpl` in `search.ts`); a plain `inArray` on the junction table would silently give any-match. Every category filter's `.inputValidator` therefore expects `categories: z.array(z.string().uuid())`, not a singular `category`. A route that still sends the singular key gets it silently stripped by Zod and the filter does nothing while looking fine; `.catch([])` on the array schema is what lets a stale `?category=<slug>` link degrade to "no filter" instead of a 500.

Inventory full-text search no longer matches category names: `search_vector` is a generated column, which can only read columns on its own row, and the category text column it used to weight is gone. Accepted gap, since the all-match filter covers that case directly.

### One staff predicate, in `src/lib/viewer.ts`

`isStaff` and `assertStaff` live there and nowhere else. Consumers import from `viewer.ts` directly, because Biome's `noBarrelFile` rejects a re-export and so does the no-shims rule. `assertStaff` carries `asserts viewer is NonNullable<Viewer>`, and the narrowing is load-bearing: call sites read `viewer.id` immediately afterwards with no second null check.

`assertStaff` is the gate on every staff-only seam in `src/server/`, read and write alike, and no call site reshapes a viewer into `{ id, role: role ?? null }` before asking a predicate. Routes are the exception, and not a small one: fifteen `beforeLoad` guards under `src/routes/_authed/` still hand-roll the role check rather than asking either predicate, most as `["admin", "instructor"].includes(session.user.role ?? "")` and the two `admin/users/` routes as `role !== "admin"`, which are admin-only rather than staff, so `STAFF_ROLES` has a copy per route (#266). A gate that admits the **owner as well as** staff cannot use it, because `assertStaff` refuses unconditionally: `performTransitionAs` and `hardDeleteProjectAs` read `isStaff` directly, and `updateProjectAs` reaches it through `canEditProject` and `canWritePrivateNotes`. A missing `assertStaff` is therefore evidence the seam is owner-or-staff, not that it is unguarded; check `project-visibility.ts` before concluding either. The several `AuthUser` interfaces in `_internal/` are byte-identical to `NonNullable<Viewer>` except the one in `uploads.ts`, which adds an optional `image`, so they pass straight to a predicate taking `Viewer`; count before you cite a number, since the last count here stood wrong for months.

### Hold: what `hold.ts` does not guarantee

`Hold` is a union of `account`, `walk_in`, `thing` and `none`, and `holdToColumns` maps each to the five `current_holder_*` columns; an account beats a typed name by shape (the `account` case has nowhere to put one), and a walk-in requires an `email`. Three things that look wrong until you know why:

- **"Never neither" is status-dependent and cannot live in the union.** `{ kind: "none" }` is legal and necessary; only the invariants in `inventory-workflow.ts` know a `reserved` or `checked_out` transition may not have it. Read paths also construct cases directly from stored columns, so the union constrains only what passes through `holdFromInput`.
- **Whitespace is not trimmed here**, deliberately: `inventory-workflow.ts` decides person-versus-thing on raw truthiness and the writer stores the raw strings, so the constructor matches both. An empty string **is** normalized to null, which fixed a blank admin cell: `??` does not treat `""` as absent. A TanStack Table `accessorFn` paired with `sortUndefined: "last"` must map the module's `null` to `undefined`, because `sortUndefined` does not special-case `null`.
- **`holderFields` in `inventory-lifecycle-panel.tsx` does not call `holdFromInput`.** The constructor asks "is there an account?"; the dialog asks "do I know there is no account?", and its `AccountStatus` has a third state, `unknown`, because the lookup is debounced. The server re-derives independently either way.

### Notifications: two rules that look wrong

`notificationFor(prev, input, holderId, closed)` in `inventory-notifications.ts` returns one row or null, `overdueNotifications(candidates, now)` returns many and owns the dedupe, and `transitionItem` and `recordOverdueNotificationsAs` only insert what comes back. `src/lib/project-notifications.ts` is the project half, to the same shape, with `notify.ts` keeping the transaction; `commentNotifications` takes `parentAuthorId` as a parameter because finding it is a query a pure module cannot run. `NotificationRow` lives in `src/lib/notification-row.ts` so neither domain imports the other for a type.

- **A denial is answered before the recipient guard.** The guard asks who holds the item, and a hold on a bare label answers nobody, which would swallow the notice owed to the person who asked. The rejection branch comes first and reads its recipient off the closed line.
- **Inventory does not suppress the actor**, unlike the project module. Suppression is keyed on `authority === "self_cancel"` instead, because staff assigning a hold to their own address is also actor-equals-recipient and *does* want the pickup deadline in their bell.

### The overdue scan: two overlaps and one narrowing

`recordOverdueNotificationsAs` runs two scans, approved request lines scoped to the viewer's requests and staff holds with `current_holder_id IS NOT NULL`, and they overlap on purpose: a line and a hold can name two people (a teammate collected), and both are notified, which the `(user_id, type, link)` index does not collapse because the ids differ. The common case, same person twice in one batch, is deduped in JS before the insert and would be collapsed by `onConflictDoNothing` anyway; the index is declared with explicit target and where so a future unique index on `notifications` cannot swallow unrelated conflicts. The hold scan is narrower than `/my/items`, which also matches an unlinked hold by verified email: a notification needs an account id, and resolving the email on a write path would reintroduce the impersonation risk the read path guards against. The call in `listMyItemsAs` is wrapped in a `catch` that **reports** rather than discards; a bare `catch {}` meant every overdue notification could stop with the page looking fine.

### Retired: the status set is data, not a predicate

`visibleStatuses(viewer, { retiredOnly })` returns the statuses a listing may show, as data, because it has to cross into SQL: `buildInventoryScope` builds its `inArray` from it. Do not reintroduce a literal `ne(status, "retired")` in the query. `canReadInventoryItem` answers the single-row question, so staff opening a retired item by URL is correct. `retiredOnly` is on `listAdminInventorySchema` only, and `visibleStatuses` ignores it for a viewer who may not see retired, so a request has to defeat two independent things to reach a retired row.

### `/my/items` has its own two projections

`holdItemView` and `myRequestLineView` are the third audience for `inventory_items`, beside `publicItemView` and `staffItemView`. A **hold** entry carries `item: HoldItemView`; a **request** entry carries `itemName` and `itemStatus` flat plus `line`, and must not carry an item view, because `holdItemView` renames `current_pickup_by` to `pickupBy` and the entry would hold two different `pickupBy` values under one name; **history** carries `itemName` only, because the item's current dates describe whoever holds it now. `itemStatus` is what gates the Cancel button, which is what stops a requester cancelling an item a teammate has already collected. `inventory.integration.test.ts` asserts the exact key set of both arms, because `listMyItemsAs` once selected whole table objects and shipped `serial`, `notes`, `reviewComment` and the rest to the student; a projection function guarantees only what passes through it.

### `transitionItem`: what the callers carry

The four callers keep what is theirs (who may act, which line is eligible) and pass the rest as two fields. **`authority`** is the only way past `assertStaff` and is default-deny; `AUTHORITY_TARGET` says which status each value may reach. **`transitionSchema` in `src/server/inventory.ts` must never declare it**: `transitionInventoryItem` carries only `requireUser()`, so `assertStaff` inside `transitionItem` is that endpoint's entire staff gate, and `z.object().parse` stripping the unknown key is what keeps it shut. `src/test/inventory-schemas.test.ts` asserts the stripping, including through `__proto__`; `.passthrough()` there would let any signed-in user retire any item. **`lineDecision`** carries the outcome together with the id of the line it was decided about, because a release cannot carry `requestItemId` and an outcome alone would land on whatever line the item points at. The denial notification goes to the **requester** read from the line, not the item's holder: staff can check a pending item straight out for a teammate.

The rules that stayed in `inventory-transitions.ts` are the ones about a row read under `FOR UPDATE` (a line is still open, belongs to this item, the item is free, a rejection lands on a pending line). A single `plan(viewer, input, currentRow)` is not available: it would read the item before the line, and `lockAttachableRequestLine` takes them line-then-item to match `approveRequestItemAs`; inverting that deadlocks the two paths. `TransitionActor` in `inventory-workflow.ts` is the non-null arm of `Viewer` rather than the union, because the self-service path reads `viewer.id` without `assertStaff` having narrowed it first. One integration case stays on purpose under `defense in depth` in `inventory.integration.test.ts`: `transitionItem throws Forbidden for a non-staff viewer` proves the impl re-checks role on every staff write, which a unit test of the rules module cannot show.

### The dev seed drives the real write path

`scripts/seed-dev.ts` writes catalog data directly and runs the **lifecycle** through `addToCartAs`, `submitCartAs`, the approve, reject and cancel seams and `transitionItem` with a synthetic admin viewer. It used to write `status` and `current_holder_id` itself, and seeded holds had a holder and nothing else. Deadlines are relative to run time (`daysFromNow(-9)`). Overdue notifications are **not** seeded; they appear on first opening `/my/items`, because the scan is lazy. Anything added to the seed that changes item state goes through the same helpers.

### Deferred FK

`inventory_items.current_request_item_id` references `inventory_request_items.id` but the FK is declared in raw SQL inside the migration (not in `schema.ts`) because the two tables reference each other. `ON DELETE SET NULL`.

### submitCart is lock-first

`submitCartAs` locks each cart item with `SELECT FOR UPDATE` and re-checks `status === "available"` before treating it as a survivor. The `inventoryRequests` envelope is inserted only after the lock phase confirms at least one survivor, so an all-race path never leaves an orphaned request row. Items that lost the race are returned in the `skipped` array with reason `"no_longer_available"`.

## Projects

The vocabulary (project, proposal, proposer, status, transition, closed to applicants, soft delete, private notes, mentorship) is in [`../CONTEXT.md`](../CONTEXT.md). The rules are two pure modules: `src/lib/project-workflow.ts` (which transitions each role may make) and `src/lib/project-visibility.ts` (who sees and edits what), with `project-notifications.ts` beside them.

The decisions: `commitTransition` is the only status-history writer ([ADR-0004](./adr/0004-one-writer-per-status-history.md)), proposers link by email and only a verified address claims ([ADR-0007](./adr/0007-proposer-linking-by-email.md)), reads are staff-only when they reach an account column ([ADR-0003](./adr/0003-every-server-function-declares-its-access-level.md)), one image policy ([ADR-0009](./adr/0009-one-image-upload-policy.md)), one URL per project ([ADR-0010](./adr/0010-single-canonical-url-per-resource.md)), addresses are lowercased on write ([ADR-0015](./adr/0015-addresses-are-normalized-on-write.md)).

### Both domains name the fields their reads return, and a key-set test pins each

`getProjectAs` returns `projectDetailView(project, viewer)`, which names every field the two consuming routes read; that object is the public SSR payload of `/projects/$id` for any viewer, so a new column on `projects` is invisible there until someone names it. `notes` is the one viewer-dependent field, assigned inside the projection from `canSeePrivateNotes`, which is why this cannot become a SQL column map. `proposerEmail` is **absent, not nulled**: the staff panel gets it through `getProposerForEditAs`, staff-gated at the server. `searchVector` and the embedding columns still cross from Postgres into the server process and stop there.

`projectSummarySelect` feeds the listing, my projects and bookmarks, and carries every public field because the table mode shows them; the rule for what may be in it is whatever `projectDetailView` returns to an anonymous viewer minus `notes`, `isSponsored`, `programId` and `deletedAt`. `adminProjectSummarySelect` spreads it and adds proposer identity and lifecycle dates; do not add a field there that the public one already carries. `projects.integration.test.ts` pins the detail key set for an anonymous and a staff read, `search.integration.test.ts` and `bookmarks.integration.test.ts` pin the listing's; adding a column fails them until the literals are updated, which is the moment to ask whether the column is public. `proposerEmail` and `notes` must never appear in either. `canEdit` on the detail payload reads `canEditProject` directly and is authoritative; it used to disagree with the predicate for staff on an archived project (#40).

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

`commitTransition` orders notifications inside the transaction (enforced by the type: `recordStatusChangeNotifications` takes a `Tx`), the embedding refresh strictly after commit, and the email strictly after commit. The middle one is enforced by nothing: `refreshProjectEmbedding` takes no `tx`, uses the module `db`, re-reads the row, and returns `"skipped"` unless the status is already `published`. Called inside the transaction it does not throw; you get a project that publishes and never embeds. Checkable:

```bash
# one hit, in commitTransition
grep -rn 'insert(projectStatusHistory)' src --include='*.ts' | grep -v __tests__
```

`update(projects)` has five legitimate non-status writers, so a grep on that proves nothing.

### `sendEmail` is decided by role in `performTransitionAs`, not by the schema

Skipping a transition's mail is a staff affordance. The decision is made from the `ActorRole` the function already derives, and a non-staff caller's `sendEmail: false` is ignored. The schema cannot be the gate, unlike inventory's `authority`: `performTransition` takes its target status from the request, so one validator serves staff and owners alike. What it protects: an owner reaching `submitted` mails `EMAIL_REVIEW_INBOX`, which is the **only** push telling staff a project arrived; the pull surface is the "Awaiting review" count on `/admin`. That email also fails quietly twice over: an unset inbox only warns, and `notifyTransitionByEmail` swallows its own errors so a failed send cannot undo an approval.

### An unset `BETTER_AUTH_URL` logs, it no longer just drops the mail

Transition emails carry absolute links from `BETTER_AUTH_URL`. `notifyTransitionByEmail` used to return early when it was unset, silently, so a submitted project sat in a queue nobody had been told about. It now throws when `appBaseUrl` is null, and the throw lands in the function's own `catch`, which logs naming the variable. **The check is an `if` in the body, not a throw inside `buildNotificationConfig`**: the config arrives as a default parameter, evaluated before the body, so a throw in the builder would skip the `try` and report a failure on an approval that had already committed. In production `BETTER_AUTH_URL` is one of the variables `startup-config.ts` refuses to boot without (#137).

### The proposer field locks on divergence, not on the act

`ProposerPicker` locks the input once an account is linked and routes any change through a "Re-assign" modal; picking a new account or unlinking unlocks the field, because the lock is keyed off whether the current value still equals a mount-time snapshot of the saved one. Retyping the original address exactly re-locks it, which is harmless but surprising. Two emails, do not conflate them: `proposer_email` is the private link key; `contact_email` is a separate, hand-typed, public field. A blank email on create defaults the proposer to the creator; clearing it on edit is an explicit unlink. One caveat on the claim rule in [ADR-0007](./adr/0007-proposer-linking-by-email.md): Better Auth's admin plugin takes an open `data` record on create-user, so an admin can set `emailVerified` for an unproven address and the create hook will claim for it; tolerated because an admin is already trusted with more, not a license for a third caller. One address with both a password account and GitHub ends up as one user row with two `account` rows, linked implicitly and only when the local row is already verified.

### Mentorship is two staff-written columns and one derived flag

`projects.student_proposed` and `projects.mentor_email` are written only by `updateProjectMentorshipAs`; neither is on `ProjectInput`, so `updateProjectAs` cannot touch them. The mentor is resolved at read time by `mentorNameSql`, a case-insensitive correlated subquery with `LIMIT 1` rather than a `LEFT JOIN`, because a join on `lower(email)` would fan a project out into two rows if two accounts differed only by case. There is no `mentor_id`: mentorship grants no permission. `seekingMentor` is `student_proposed AND mentor_email IS NULL`, computed in SQL, because the public payload does not carry the address and a client cannot otherwise tell "no mentor" from "a mentor who has not signed up yet"; the second state shows nothing, on purpose. `mentor_email` leaves the server through `getProjectMentorship` and the edit log only. See #75.

---

## Amazon Bedrock

This app talks to two different Bedrock endpoints, and almost nothing is shared between them. Embeddings use `bedrock-runtime` through the AWS SDK (`src/lib/_internal/bedrock.ts`). AI project review uses `bedrock-mantle` through a hand-signed `fetch` (`src/lib/_internal/bedrock-mantle.ts`); [ADR-0012](./adr/0012-bedrock-mantle-by-sigv4-embeddings-behind-a-flag.md) says why. Treat a fact about one as saying nothing about the other.

### A blank `BEDROCK_EMBEDDING_DIMENSIONS` is zero, not the default

`buildEmbedConfig` (`src/lib/_internal/bedrock-embed.ts`) resolves the value as `Number(env.BEDROCK_EMBEDDING_DIMENSIONS ?? "1024")`. `??` catches only `undefined` and `null`, so an empty string reaches `Number("")`, which is `0`; unset is the only spelling of "missing" that gets 1024. This is worse than a bad request: the model id and the dimension count are both interpolated into the sha256 `embeddingHash` (`src/lib/embedding-source.ts`) stores as `projects.embedding_source_hash`, so a dimension count that changes for an environment changes every hash, every project looks modified, and each re-embeds at one paid call. The blank case is pinned by a test rather than fixed for that reason: whatever the stored hashes were computed with is what the code has to keep computing until someone migrates them deliberately. Not a live state; `.env.example` and `infra/ecs.tf` both set the variable. See #137.

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
