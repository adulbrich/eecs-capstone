# Framework Quirks and Project Conventions

A running log of every gotcha we have hit and the conventions that grew out of them. Read this before debugging anything that "should just work."

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

TanStack Start's `import-protection` plugin denies any client-chain import (static OR dynamic) where the resolved path matches `**/*.server.*` OR the specifier matches `@tanstack/react-start/server` (or similar denylist entries). The denial is based on static name analysis; the fact that the import lives inside a stripped `createServerFn` handler does not exempt it.

We use the `_internal/` directory convention instead:

- `src/server/x.ts`: client-importable wrapper. Imports ONLY `createServerFn`, `z`, types. Each `createServerFn().handler()` does `const { xImpl } = await import("./_internal/x"); return xImpl(...)`.
- `src/server/_internal/x.ts`: server-only impl. Can statically import `db`, schema, drizzle, auth helpers, anything.
- `src/lib/_internal/auth-guards.ts`: the server-only auth helpers (`readSession`, `requireUser`, `requireRole`).
- `src/lib/auth-guards.ts`: the client-safe wrapper exposing `getSession` as a server function.

The wrapper does ONE dynamic import per handler (just `./_internal/x`). The impl handles auth itself (statically imports `requireUser` and calls it). Two dynamic imports per handler (one for impl, one for auth) also works, but doubles the warning surface if anything goes wrong.

### An impl imports its input types back from its domain's wrapper, never the schema

The wrapper owns the Zod schema, so the impl takes `import type { XInput } from "../x"` rather than hand-writing an interface that drifts from it. This is the house pattern, not an exception: `categories`, `comments`, `profile`, `programs`, `projects`, `search` and `users` each import from the wrapper of the same name, by relative path.

A domain split across several impls points every impl that needs an input type at its one wrapper. Inventory is the case (#104): `inventory-catalog.ts` and `inventory-holdings.ts` import from `../inventory`, and the other five import nothing from it, taking inline parameter shapes or, in `inventory-transitions.ts`, input types from `#/lib/inventory-workflow`, which is the third route the next paragraph prescribes. There is no `_internal/inventory.ts` any more. Do not read the pattern as requiring matching filenames.

`import type` is erased, so no runtime edge to a `createServerFn` module survives; `verbatimModuleSyntax` is what turns a dropped `type` into a tsc error instead of a silent bundler hazard. The rule that keeps it safe is **type-only, never the schema value**. Reaching for `listInventorySchema` itself pulls `createServerFn` into a server-only impl and makes the cycle real; an impl that needs a schema as a value means the schema belongs in a client-safe logic module under `src/lib/`, alongside `inventory-visibility.ts` and `hold.ts`.

Grep for it with `grep -rn 'from "\.\./' src/server/_internal/*.ts`; the `#/server/` alias form finds none of them. Two things skew a careless count: `categories.ts` and `inventory-catalog.ts` spread their imports over several lines, so a grep for `import type` undercounts, and a recursive grep picks up `__tests__/` files, whose `../` imports are ordinary value imports of a sibling impl and are not this pattern. Count the files the recipe prints rather than trusting the list above, which #104 changed once already.

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

Convention adopted in Spec 2: each project has ONE URL (`/projects/$id`), and staff-only sections (notes, internal comments, action buttons) render conditionally inside that page based on viewer role. We deliberately do NOT have a separate `/admin/projects/$id`. This avoids URL duplication and lets staff share URLs with non-staff. List views can still live at separate URLs (`/admin/projects` IS distinct from `/projects`) because the underlying query is genuinely different.

### A route component is reused across a param change; key any child that holds a draft

Navigating from `/projects/A` to `/projects/B` re-runs the loader and re-renders the same component instance with new props. Nothing remounts unless the route sets `remountDeps`, and nothing in `src/` does. So a child that keeps draft state in `useState` and loads its record in an effect keeps A's drafts on screen while B's record is in flight, and a Save clicked in that window posts A's values onto B. `StaffMentorshipSection` had exactly this until it was keyed: `<StaffMentorshipSection key={project.id} ... />` in `staff-project-panel.tsx`, which makes a param change a remount for that one child, and a test in `staff-project-panel.test.tsx` rerenders the panel with a second id to prove it. Key the child, not the route: `remountDeps` would also discard state the page should keep, such as an open dialog's scroll position. `StaffProjectPanel`'s own `pending` and `comment` state has the same shape and is not yet keyed; see #190.

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

**This entry used to say the opposite**, and it was true when written: passing a schema directly did fail, and the entry told you to hand-roll a `safeParse` loop. Both forms carried that loop, sixteen identical lines each, until an architecture review proposed extracting it into a shared helper and checking found the constraint had gone. If you hit a typing error here, check your input type before you write the loop again.

### `useForm` generics are unstable; we use a localized `any` for the `Field` helper

`ReturnType<typeof useForm<ProjectFormValues, unknown>>` does not match the installed version's generics. Inside the shared `Field` component we use `// biome-ignore lint/suspicious/noExplicitAny: TanStack Form generics are unstable` plus `type AnyForm = any`. The PUBLIC API of `ProjectForm` (`initial`, `onSubmit`, `ProjectFormValues`) stays fully typed; only the internal field helper escapes.

### `field.state.meta.errors` is a heterogeneous array

Entries can be strings or `{ message }` objects depending on which validator produced them, and since the forms pass a Standard Schema the object shape is now the common path rather than the unusual one. `FieldError` (`src/components/ui/field.tsx`) is the one place that knows this; render field errors through it rather than inline:

```tsx
<FieldError errors={field.state.meta.errors} />
```

**Every `form.Field` render prop needs this, and six of them did not have it.** The one exception is a checkbox behind a `z.boolean()` (`requiresNdaIp`, `isSponsored`, `acceptingApplicants`): it cannot fail validation, so there is nothing to render. The coercer used to be inline inside each form's shared `Field` helper, so any field rendered through a raw `form.Field` (`imageUrl`, `programId`, `teamsSupported`, `proposerEmail`, `categoryIds`) displayed nothing at all. What that cost: type a malformed address into the proposer field, click Save, and validation failed, `canSubmit` flipped false so the button greyed out, and no message appeared anywhere, because `formError` only ever carries server errors. A disabled button and silence.

### Both forms own their save; the route components only navigate

`InventoryForm` and `ProjectForm` import the server functions and write the row themselves. A route passes configuration in and gets a saved id back through `onSaved`; its loader still loads, but its component does nothing but navigate. `ProjectForm` took an `onSubmit` prop until 2026-09-02, so `new.tsx` and `edit.tsx` each held a copy of the payload rules, and nothing could test either: `src/test/` has no route tests, because a route is a `createFileRoute` call rather than a renderable component.

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

`betterAuth` is declared `<Options extends BetterAuthOptions>(options: Options)`, so the config literal is inferred as `Options` and TypeScript's excess-property check never runs on it. A misspelled or invented key compiles and does nothing. `emailVerification.callbackURL` sat in `src/lib/auth.ts` that way until 2026-09-01 (#149): the landing page after verification is read from the request body of the call that mails the link, and there is no server option for it. When an option seems to have no effect, check the key against `@better-auth/core/dist/types/init-options.d.mts` before looking anywhere else.

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

Note the predicate is not the one beside it: `useSecureCookies` is `NODE_ENV === "production"`. The two agree under `development` (both off) and `production` (both on), and disagree under every other value, unset included, where `trustHost` is on and secure cookies are off.

Nothing rides on the gap, because deployed code never sees a value in it: `Dockerfile` sets `NODE_ENV=production` in the runtime stage and `infra/ecs.tf` sets it again in the task definition. The difference is residue from the two lines arriving in separate commits, not a decision, so do not read intent into it or build on it.

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

### Deleting an account anonymizes the row; the schema decides what else goes

`deleteAccountAs` in `src/server/_internal/account.ts` never runs `DELETE FROM "user"`. Nine `onDelete: "restrict"` edges (comments, status history, bids, assignments, edit logs) are audit records the row exists to anchor, so the row stays with `deleted_at` set and every personal column scrubbed: name to "Deleted user", email to `deleted-<id>@invalid`, the rest to null or default. What goes is exactly what a real DELETE would have cascaded, read off `src/db/schema.ts`: every table whose FK into `user.id` says `cascade` is deleted by user id, and `account.integration.test.ts` pins that list against the schema files so a new cascade edge without a matching delete is a red test. `set null` edges keep pointing at the row on purpose: `projects.proposer_id` staying set is what makes a re-registered address unable to reclaim projects, since `claimProjectsForVerifiedUser` claims only `proposer_id IS NULL`. Two scrubs live outside the rule because the columns are addresses, not FKs: `projects.proposer_email` where the proposer is this user, and `projects.mentor_email` wherever it matches. `contact_*` and `inventory_item_status_history.holder_*` stay, as the privacy page says. The avatar object is deleted after the commit through `deleteOwnedObject`, which swallows the failure: an orphan is a sweep problem, a half-deleted person is a broken promise. Deleting `session` and `account` rows is what makes a later sign-in at the same address a fresh user rather than a resurrection; the anonymized email is what frees the address for it. The held-item block reads `heldByViewer` from `inventory-holdings.ts`, the predicate `/my/items` reads, so the page that shows a person their items and the check that refuses to delete their account while they hold one cannot disagree. See #84, and the `/privacy` entry under Project conventions for the copy this has to keep in step with.

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
| `RESTRICT` | `project_comments.author_id`, `project_status_history.changed_by`, `project_edit_log.editor_id`, `inventory_item_status_history.changed_by`, `inventory_item_edit_log.editor_id`, `inventory_requests.user_id`, `project_bids.student_id`, `project_assignments.student_id`, `project_assignments.assigned_by`. Authorship and audit trail: history has to outlive the person, so an account with any of this cannot be hard-deleted. |
| `SET NULL` | `projects.proposer_id`, `inventory_items.current_holder_id`, `inventory_request_items.reviewed_by`, `inventory_request_items.closed_by`, `inventory_item_status_history.holder_id`. Attribution that can be lost without losing the record. A deleted proposer's `proposer_id` nulls out while `proposer_email` retains the link for re-linking (see "Projects" below). |

Note `inventory_items.current_holder_id`: nulling it does **not** change `status`, so deleting a user who holds an item strands it in `checked_out` with no holder and no way to return it. Return the item first.

**Everywhere else.** `CASCADE` on junction tables and on anything scoped to a parent row (`project_categories`, `inventory_item_categories`, and the comment, history, and edit-log tables against their project or item). `SET NULL` on `projects.program_id`, `inventory_item_status_history.request_item_id`, and `inventory_items.current_request_item_id`. `RESTRICT` on `inventory_request_items.item_id`, so an item with request lines cannot be deleted.

`project_bids.project_id`, `project_bids.program_id`, and `project_assignments.project_id` declare no rule at all and so are `NO ACTION`. Those two tables have no UI yet; if they ever get one, give them explicit rules first.

Deleting an account outright is not supported. Nine `onDelete: "restrict"` edges into `user.id` carry authorship and audit records, so the row has to survive; ban a real user, and see #84 (self-service) and #29 (admin-initiated) for the anonymize-in-place path. A one-off purge script for test accounts existed until 2026-09-01 and was removed unused.

### `categories` uniqueness needs an expression index, not a plain UNIQUE

`UNIQUE (domain, coalesce(type, ''), lower(name))`, declared in `schema.ts` and created in
`drizzle/0015_categories_unique_name.sql`.

```sql
CREATE UNIQUE INDEX "categories_domain_type_name_unique_idx"
  ON "categories" USING btree ("domain", coalesce("type", ''), lower("name"));
```

`coalesce(type, '')` is load-bearing: Postgres treats NULLs as distinct in a unique index
and every inventory category carries `type = null`, so a plain `UNIQUE (domain, type,
name)` leaves the whole inventory domain unconstrained. `NULLS NOT DISTINCT` says the same
thing on PG15+, but Drizzle's `nullsNotDistinct` is on unique *constraints*, which cannot
take expressions, so using it would mean a SQL-only index invisible in `schema.ts`. The
migration dedupes before creating the index, since `CREATE UNIQUE INDEX` fails outright on
existing duplicates; the two non-obvious parts of that step (a `created_at, id` tie-break,
and moving junction rows by insert-then-delete rather than `UPDATE`) are commented in the
file.

`db-reset.ts` only truncates, so this index is schema state that outlives a test. The
dedupe test drops it to create the duplicates it exists for and restores it in a `finally`;
a test that drops it and dies without restoring disarms every uniqueness assertion after it.

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

A git hook is that case exactly: lefthook runs its commands under `sh`, which
has no shell function, so `pre-push` saw Node 26 and 79 failures on the first
push after it was added while `npm test` from zsh passed. `scripts/nvmrc-node.sh`
is the answer: it sources nvm or fnm to switch to the `.nvmrc` major and, when
it cannot, fails on the version with the reason rather than on the tests. The
`pre-push` commands in `lefthook.yml` go through it.

### A test that spawns git under a hook must drop `GIT_DIR` first

A git hook exports `GIT_DIR` (and under some commands `GIT_WORK_TREE` and
`GIT_INDEX_FILE`) to everything it runs, and `pre-push` runs the unit suite.
`src/test/claude-hooks.test.ts` builds a throwaway repository with `git init`
to test the commit-on-main refusal. Under the hook that `git init` did not
create a repository in the temp directory: with `GIT_DIR` pointing at this
checkout's gitdir and no work tree named, it re-initialized this repository as
bare, and every git command afterwards, in the worktree and the main checkout
alike, failed with `fatal: this operation must be run in a work tree`. The fix
was `git config core.bare false`; the cause took three pushes to find, because
the first symptom was the push being refused.

Any test that spawns git builds its environment from `process.env` with every
`GIT_*` key removed, as that file does. The same applies to a hook script that
runs git on the session's `cwd`: strip the variables, or the answer is about
the wrong repository.

### The git-guard tests run in a fixture repository, because CI checks out `main`

On a push to `main`, CI checks out `main` itself. A test that ran the git guard
with `cwd` at the checkout tripped the never-commit-on-main rule it was not
testing, and `verify` went red on the first merge after the hooks landed. A pull
request run never showed it, since that checkout is a detached merge ref with no
branch name. `src/test/claude-hooks.test.ts` drives the guard from a throwaway
repository on `fix/test`, with a `sub` directory for the subdirectory case, and
keeps a second one on `main` for the rules that are about `main`. The same
symptom, a wrong author on a commit, came from the fixture's `git config
user.email` landing in this repo's config while `GIT_DIR` was exported.

ESM imports hoist above all statements. Writing `import { config } from "dotenv"; config({ path: ".env.local" }); import { db } from "..."` looks correct but is wrong: the `db` import runs at module-load time BEFORE the `config()` call ever fires, so `DATABASE_URL` is unset when `src/db/index.ts` evaluates and the script crashes.

Pattern that works: pass `--env-file=.env.local` to `tsx` at the command line.

```json
"db:seed:dev": "tsx --env-file=.env.local scripts/seed-dev.ts",
"db:seed:admin": "tsx --env-file=.env.local scripts/seed-admin.ts"
```

The seed scripts themselves should not import dotenv. A comment at the top of each script explains the invocation pattern.

### Vitest needs the agent tool sandbox disabled

Running Vitest inside a sandboxed tool call dies with `EMFILE: too many open
files`, and raising the limit does not help: it still fails with
`ulimit -n 8192`. Vite's watcher opens more descriptors than the sandbox
allows, and the failure looks like a broken test rather than a broken
environment, so it costs time to place. Run the suites with the sandbox off.

Two more things the sandbox refuses, both of which look like the tool being
broken: `gh` fails TLS inside it, and anything that writes `.git/config`, such
as `git branch -d`, `git worktree add` and `git remote`, half-completes. Run
those with the sandbox off too.

Two harmless things it prints on every run in this repo, which are not signs
of a problem and are worth recognising so you stop chasing them:

```
module is not defined
close timed out after 10000ms
Tests closed successfully but something prevents Vite server from exiting
```

The test results above those lines are still authoritative. The exit code is
still correct.

### A missing DATABASE_URL fails every route, including `/api/healthz`

`src/routes/api/healthz.ts` returns a hardcoded 200 and its comment says it
avoids the database on purpose, for the ALB. That is true of the route and false
of the server. `src/db/index.ts` throws at module scope, so in the built output a
missing `DATABASE_URL` fails the whole SSR graph: the process starts, binds the
port, stays up, and answers 500 on every route, healthz included. Measured
directly, both `/` and `/api/healthz` return 500.

That is the behaviour outside production. With `NODE_ENV=production`,
`src/nitro/config-check.ts` stops the process first, exit code 1 and one
message naming every missing variable, `DATABASE_URL` included, so a deployed
task never reaches the bound-port-answering-500 state for a variable on that
list.

This is why `playwright.e2e.config.ts` uses healthz as its `webServer.url`.
Playwright waits for 2xx or 3xx, so a misconfigured server never goes ready and
the run fails as "server did not start" rather than as five confusing test
failures.

### `npm run start` gets no dotenv, unlike the dev server

`start` is bare `node .output/server/index.mjs` with no `--env-file`, while the
dev server gets `.env.local` through Vite. `playwright.e2e.config.ts` calls
`loadDotenv` at module scope for this reason, and Playwright passes its
`process.env` down to `webServer`. Remove that call and you get the 500-on-every-
route behavior above, which reads like an application bug.

Related: `VITE_STORAGE_PUBLIC_BASE` is inlined at build time and
`src/lib/storage.ts` falls back to `/storage`, so a build without it produces
working-looking relative URLs against an origin that serves nothing. The CI job
writes `.env.local` before the build.

### The smoke suite runs on port 3001 and never reuses a server

`reuseExistingServer: false` unconditionally, because a dev server left on 3000
would substitute the dev build for the production build the suite exists to
exercise, and report green. Port 3001 keeps both runnable at once.
`BETTER_AUTH_URL` moves with it, because Better Auth checks the request origin
and a mismatch fails sign-in for a reason that looks nothing like a port problem.

### Smoke fixtures are created per attempt, and swept by prefix

`src/test/e2e/fixtures.ts` creates mutated rows inside the test; global setup
only sweeps `E2E-` orphans. A retry has to mean something: the inventory flow
walks an item through `available -> requested -> reserved -> checked_out ->
available`, so an attempt dying at check-out leaves it `reserved`, and a retry
then fails at "Add to borrow list" for an unrelated reason. Global setup cannot
repair that, having run before the first attempt.

Sweep order matters. `inventory_request_items.item_id` is the one FK in that
graph declared `onDelete: "restrict"`; the others cascade. Request lines, and the
requests holding them, go before the items.

Four things outlive the rows and are swept separately: notifications, which
carry no FK to what they are about and are matched on the prefix inside their
title; the accounts the sign-up flow creates, matched on an `e2e-` address
prefix, with their `verification` rows, which have no FK either; and the avatar
column on the two seeded students, because the upload flow writes to a seeded
row rather than a fixture one. Objects in the bucket are not swept, deliberately:
a few kilobytes of webp per run under keys nothing lists, against a sweep that
would have to reach into storage from a module whose job is the database.

### Assert that a transition landed, not that its dialog closed

A popover closes on failure as readily as on success, so
`expect(confirmButton).toBeHidden()` is not evidence a write happened. The
inventory test approved a request, asserted the popover closed, and died four
steps later on a missing `Check out` button because the item was still
`requested`. Assert what the page shows only on success: here, the row leaving a
list filtered to pending. Relatedly, `actionTimeout` is set, because without it a
stuck click is bounded only by the test timeout and names no locator.

### The smoke budget is read, not enforced

The job targets 5 minutes; `globalTimeout` is 8. Two identical CI runs of the
accessibility suite took 2m31s and 3m33s, so a timeout sized to the budget fails
on a slow runner rather than on a broken test. `globalTimeout` is a hang catcher;
the budget is a number read off the job duration. Three consecutive runs over it
is the signal to demote a flow to #143. One run over is a slow runner.

### The full suite is the same config with a longer leash

`test:smoke` and `test:e2e` share `playwright.e2e.config.ts`; the smoke script is
that config plus `--grep @smoke`. What differs is on the npm script, not in the
config: `test:e2e` passes `--global-timeout`, because the config's 8 minutes is
the smoke run's hang catcher and the full suite has thirteen more flows, two
uploads and a sign-up to get through. Changing the config value instead would
quietly lengthen the pull-request path's catcher.

Only the smoke subset runs on pull requests. The full suite is
`workflow_dispatch` in `.github/workflows/full-e2e.yml`, which drifts by design;
the trigger is "before a release".

### The account flow reads the server's log, because nothing stores those tokens

Better Auth signs the email-verification and password-reset tokens rather than
storing them: the `verification` table is empty after a sign-up, so there is no
row to read a token out of. The console email transport writes to stderr, and
there is no file transport. So `playwright.e2e.config.ts` tees the built
server's output into `src/test/e2e/.server.log`, and `account.e2e.test.ts` polls
that file for the link addressed to its own generated address. `tee` truncates
on open, so each run starts from an empty log.

That test signs up a real account. Addresses are `e2e-<uuid>@example.com` and
the sweep deletes them by prefix. A fixed address would fail at sign-up on the
second run.

### Browser suites select by role and name, and add no test IDs

Both Playwright suites locate by accessible role and name first, falling back to
`data-slot`, and never to a test id added to a production component: a selector
nobody can reach with a screen reader says nothing about whether the page works.
Plenty of the app is plain divs, so structural and attribute selectors do appear
(`> div > div` for a list entry, `time[datetime]` for a rendered date,
`img[src^=]` for a stored image, `p.text-destructive` for a form error). Each
is a place the markup offers no role, and each carries the reason inline;
`src/test/e2e/locators.ts` holds the ones more than one flow needs. Reach for one
only after checking there is no role, and write down which.

### `getByText` is case-insensitive substring matching, so status words need `exact`

A status word is rarely unique on the page that shows it. Two decoys sit on a
staff item page: the Danger zone reads "allowed only when status is available or
retired" from first paint, whatever the item's status is, so bare `"Available"`
and `"Retired"` both match it; and the Status section's override select renders
a lowercase status name in its own trigger for the length of an in-flight
transition, so it matches before the write lands. Two assertions in the
end-to-end suite passed on them. Which decoy satisfied which is not worth
reconstructing: both were on the page, and `.first()` picks by DOM order rather
than by what the test meant.

Pass `{ exact: true }`, which is case-sensitive and whole-string, whenever the
text is a status label, and scope to `statusSection` from
`src/test/e2e/locators.ts` when the badge is what you mean. They do different
jobs. `exact` is what excludes the decoys: the hint is a longer string and the
trigger is lowercase, so neither survives a whole-string case-sensitive match.
Scoping is what disambiguates the two *legitimate* badges, because a staff
viewer gets one in the page header and one in the panel, both reading exactly
`Retired`, and an unscoped exact match resolves to both and trips strict mode.

### Do not navigate away from a write that has not answered

A `goto` or `reload` over an in-flight server function aborts it, and the page
then looks exactly as it does after the write succeeded. Where the app navigates
on success, wait for the URL; where it does not, wait for the response. Server
functions POST to `/_serverFn/<hash>`, whose hash is a build artifact no test can
predict, so match the prefix on a page that fires only the one request.

Three flows were green against code that had done nothing before this: the avatar
upload (the uploader shows a local blob URL, so "an image is on screen" was true
either way), the password reset (the test then signed in with the old password
and passed), and an item edit.

### A second comment posted in one page load needs a reload first

Measured on the project comment composer: after a comment posts and renders, text
typed into the same textarea was gone by the time Post was clicked, the `required`
attribute blocked the empty submit, and the failure read as a missing second
comment rather than as a cleared form. Reload between the two posts.

`confirmed()` in `src/test/e2e/waits.ts` is no substitute for the reload. Its
filter is unambiguous here, since only `addComment` is a POST, but it answers when
the write lands, and the textarea appears to lose its text later, in whatever
`onCommentsChanged` sets off (`src/routes/projects/$projectId.tsx`). The cause was
not established. Issue #188 carries the candidates and what rules each out. Only
this form was measured, and this entry shrinks to the reload once #188 is fixed.

This is not the reverse of the rule above: there a navigation aborted a write in
flight, here the reload is what puts the form in a settled state before the next
write starts.

### The header avatar is a page load behind the profile page

`site-header.tsx` reads `authClient.useSession()`, Better Auth's own client
session cache, which `router.invalidate()` does not refresh. Uploading an avatar
updates the profile page's preview immediately and leaves the header showing
initials until the next full load. The end-to-end test asserts the header only
after a reload, for that reason rather than out of caution.

### The smoke and accessibility suites share one local database

In CI they never meet, each having its own runner and Postgres. Locally they
share the dev database and both act as `user@example.com`. Running smoke then
accessibility produced five failures unrelated to accessibility: three were
leftover `E2E-` rows, which the next smoke run sweeps, and two were notifications
the smoke flows created, which made the notification bell render a badge that had
never been scanned and which fails contrast in dark mode (#145).

`sweepOrphans` deletes notifications whose title carries the `E2E-` prefix and
clears the avatar column on the two seeded students the upload flow writes to,
but it runs at the *start* of an end-to-end run, so the database is dirty for
whatever runs next. `npm run test:e2e:sweep` runs that sweep on its own; do that
before treating a red accessibility run after an end-to-end run as a regression.
`db:seed:dev` is not an alternative, because it creates and updates rows and
removes nothing.

The two shapes it takes, both seen: `color-contrast` on
`notification-bell.tsx`'s unread badge in dark mode (#145), from notifications
the flows filed; and `admin projects table shows its default-hidden columns
when toggled on` failing its own non-empty-cell assertion, because a fixture
project sorts into the first row carrying nothing but a title. Neither is an
accessibility regression. Cleared of `E2E-` rows, the suite is 102 green.

### The accessibility suite retries in CI, and only in CI

`playwright.a11y.config.ts` sets `retries: process.env.CI ? 2 : 0`. Locally you
get none, so a flake stays visible to whoever is writing the test. CI gets two,
because the suite drives a real dev server and a real browser on a shared
runner.

The failure that prompted this is worth recognising, because it does not look
like what it is:

```
- <vite-error-overlay></vite-error-overlay> intercepts pointer events
```

That is not an accessibility violation and axe never ran. The dev server hit a
transient `[vite] Internal server error: socket hang up`, Vite painted its error
overlay over the page, and the overlay then swallowed the click the test was
waiting on, which failed 30 seconds later as a locator timeout. If you see a
Playwright timeout on a click that works locally, search the job log for
`vite-error-overlay` before suspecting the element.

Retried tests are reported as flaky rather than silently swallowed, so a genuine
intermittent bug still surfaces in the log.

### A Columns menu that scrolls must be focusable itself

`AdminDataTable` passes `tabIndex={0}` to its `DropdownMenuContent`. Radix gives menu content `tabindex="-1"` (from `FocusScope`, which overrides roving-focus's own value), and honours a caller's `tabIndex` because the prop is spread last onto the innermost element. With four hideable columns the menu never scrolls and nothing notices. The public projects table has fifteen, the menu is taller than the space Radix gives it, and axe reports `scrollable-region-focusable`: a menu opened by pointer keeps focus on the content with every item at `tabindex="-1"` (a keyboard open moves it to the first item), and axe counts neither a `-1` element nor `-1` descendants as keyboard access to a scrollable region. Making the region itself tabbable satisfies the rule and changes nothing a keyboard user does: Radix focuses the content on open regardless, swallows Tab inside the menu, and unmounts the content on close, so it never joins the page tab order.

The scan that catches it is `projects table interactions` in `public.a11y.test.ts`, which is not `@smoke`, so a regression here shows up in the dispatch-only full run and not on a pull request. The neighbouring `modal={false}` comment in `admin-data-table.tsx` is the other Radix menu lesson: a modal menu puts the rest of the page under `aria-hidden`, which is a different rule (`aria-hidden-focus`) with a different fix.

### axe skips a disabled control, so a disabled pill's colours are yours to measure

axe-core's `color-contrast` rule does not evaluate a disabled form control, since
WCAG 1.4.3 exempts inactive components. The current-status pill in
`staff-project-panel.tsx` is a `<button disabled>`, so the `project detail (staff
panel, scope assessment)` scan in `admin.a11y.test.ts` reports nothing about it in
either colour scheme: measured, it passed with white on the dark brand orange
(3.48:1, #208) and passes now. The five enabled pills beside it are measured and
listed under `passes`. When a disabled element carries text a person still has to
read, compute the ratio yourself (the WCAG relative-luminance formula in a node
one-liner is enough) and say so in the PR, because the scan cannot vouch for it.

### The unit suite sees your dotenv files, so an env-dependent test is machine-dependent

`vite.config.ts` declares no `test` block, which makes it easy to assume the
unit run sees no dotenv at all. It does: the runner populates `process.env`
from `.env` and `.env.local` before any test executes. Probe it rather than
trust either claim, since a plan under `docs/superpowers/plans/` asserts the
opposite:

```ts
it("probe", () => {
  // Passes locally. S3_BUCKET is set in .env.local and not in .env.
  expect(process.env.S3_BUCKET).toBe("cs-capstone");
});
```

So an assertion on a value the process resolved is really an assertion about
the author's `.env.local`, and CI never catches it, because the `verify` job
writes no dotenv file. It fails on some developer machines and nowhere else.

`bedrock-embed.test.ts` had one: it compared `EMBEDDING_DIMENSIONS` against the
literal `1024`, which reds for anyone who set `BEDROCK_EMBEDDING_DIMENSIONS` to
anything else, and `.env.example` ships that variable. It now asserts the
constant matches `buildEmbedConfig(process.env)` instead, which pins the wiring
and holds in any environment. That is the pattern for a module-level constant
that is itself the thing under test.

For config generally, assert through a builder handed a literal environment,
the way `aws-config.test.ts` calls `buildS3Config({ S3_REGION: "us-west-2" } as
NodeJS.ProcessEnv)`.

### Integration tests need DATABASE_URL at config-load time

`src/db/index.ts` reads `DATABASE_URL` at module-import time and throws if missing. Vitest setup files (`setupFiles`) run AFTER the test files start importing. So loading dotenv from `setup.integration.ts` is too late. Load it from `vitest.integration.config.ts` itself:

```ts
import { config as loadDotenv } from "dotenv";
loadDotenv({ path: [".env.local", ".env"] });

export default defineConfig({ /* ... */ });
```

### A unit test that transitively imports `#/db` passes locally and fails in CI

Same root cause from the other direction. `src/db/index.ts` throws at import
time when `DATABASE_URL` is unset, and the unit suite has no dotenv loading of
its own: locally the value is present because the app's Vite config picks up
`.env`, and CI has no `.env` at all. So a unit test importing any module that
imports `#/db`, even for a pure function that never touches the database,
passes on your machine and fails on the PR.

Keep pure logic in a module that imports nothing, and let the query layer
import it rather than the reverse. `src/lib/ai-review-limits.ts` holds the rate
limit decision for exactly this reason, while
`server/_internal/ai-review-usage.ts` holds the queries around it.

To reproduce a CI run locally, blank the variable rather than trusting a clean
pass: `DATABASE_URL= npm test`. The check is falsy, so an empty value fails the
same way an absent one does, and dotenv will not overwrite a variable that is
already set.

### The integration suite refuses to run with embeddings enabled

`vitest.integration.config.ts` sets `BEDROCK_EMBEDDINGS_ENABLED=false` in its `env` block, and `src/test/setup.integration.ts` throws at collection if that did not arrive. Unset counts as enabled, because `embeddingsEnabled()` treats anything but that exact string as on, so a deleted config line is enough to trip it. Fix the config, not your environment.

It exists because a fail-open is expensive rather than merely wrong: the call reaches the AWS SDK, which walks the credential chain and pays an IMDS probe with retries, so it presents as a slow flaky test rather than a configuration error. See #22, which records that link as a hypothesis rather than a confirmed cause.

The switch lives in `src/lib/_internal/embeddings-flag.ts` rather than beside the adapter, so reading it costs no `@aws-sdk/client-bedrock-runtime` import. `test.env` beats the shell, so `BEDROCK_EMBEDDINGS_ENABLED=true npm run test:integration` does not override the config.

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

There is no global middleware, and no grep can tell an ungated endpoint from a gated one, so the level is declared rather than detected. It lives in `src/server/__tests__/access-contract.ts`, one line per endpoint, with the reasoning and the incident behind it (#103, #108) written out there. Read it there: this section says where the check is, not what it concluded, so there is one copy to keep true. Its test fails if an endpoint exists with no line, if a line names an endpoint that does not exist, if the set declared `public` changes, or if any use of `createServerFn` appears in a shape the scan cannot parse. That last one is load-bearing: two legal shapes, a type annotation and a line break before the initializer, were invisible until it was added, and an endpoint the pattern cannot read reports as nothing at all rather than as undeclared. The scan itself lives in `server-fn-scan.ts` so it can be driven with sources written to break it, which is how a renamed import (`import { createServerFn as make }`) was caught escaping both the search and that guard: the only occurrence of the real name sat inside the import, where the guard suppresses it.

Two things the table does that are easy to misread. It records the **effective** level, so five project transition endpoints are `staff` even though their gate admits the proposer, because `TRANSITIONS` in `src/lib/project-workflow.ts` decides per role. And it covers all of `src`, not just `src/server`, because the narrow scan missed `lib/auth-guards.ts:getSession`.

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

`id` needs the `as const` or it widens to `string`, and the diagnostic then says `string` instead of naming the column that broke the rule. That is the difference between an error someone can act on and one they have to bisect. Only the const is affected: annotating the array `defineAdminColumns` returns is redundant but harmless, because that return type mentions no inference variable for the annotation to feed back into.

`/admin/categories` shares column consts between two tables (a project tab and an inventory tab). `/projects` and `/my/bookmarks` share five columns through `projectSummaryColumns<Row>()` in `src/components/project-summary-columns.tsx`, a factory rather than consts because each table's row type differs and a column's `cell` is typed on it; the `satisfies` rule is the same inside the factory.

### Path-by-path convention summary

| Path | What goes there |
| --- | --- |
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

`src/routes/privacy.tsx` is public, outside `_authed`, and static: the body lives in `src/components/privacy-policy.tsx` and only a developer changes it. Its account-closure paragraph names what deletion removes (name, email, affiliation, interests) and what it keeps (projects, re-attributed to "Deleted user"; equipment records, as institutional property), because `DeleteAccountDialog` (#84) makes exactly those promises and a policy that said less would leave them backed by nothing. Change one and change the other; the Better Auth section's deletion entry says what the server actually does. The sign-up line pointing here is a notice, not a checkbox; nothing writes to `user`, and a recorded acceptance would be a schema change plus a policy version, which is its own issue. `brand.supportEmail` reaches the page through `SupportEmailLink` (`src/components/support-email-link.tsx`), which is also what the ONID refusal banner on `/sign-in` renders (#71); grep for the component to find every surface that shows the address. `public.e2e.test.ts` loads it with no cookie, which is the only proof a route outside `_authed` stays outside it. See #91.

### Workflow conventions

- **The issue is the spec, the pull request is the plan, the review loop is the gate.** Ordinary work starts from a `ready-for-agent` issue carrying an agent brief and ends in a PR that goes through `mattpocock-skills:code-review` until a pass raises nothing unanswered. `CONTRIBUTING.md` maps it; `docs/agents/` is what the skills read.
- **The superpowers workflow is for a few large new features.** Brainstorm, then spec, then plan, then subagent-driven implementation, with the spec and plan under `docs/superpowers/`. Everything before 2026-09 went that way; it is not the path for a bug or a bounded enhancement.
- **`*As` first, `*ForCurrentUser` second.** Always design the impl helper to accept an explicit viewer so integration tests can call it directly. The wrapper that resolves the viewer is layered on top. An implementation that needs no viewer at all takes the `*Impl` name instead (`getProjectImpl`, `searchProjectsImpl`, `listUsersImpl`), with the authorization done in the wrapper above it. "Needs no viewer" means no viewer *object*: every `*As` takes `viewer: AuthUser`, `viewer: Viewer` or `viewer: BookmarkViewer` as its first parameter, because deciding is what it is for. The test is the parameter type, not whether an identity reaches the function at all, so an `*Impl` may still take a bare `userId: string` where the id only scopes the query: `searchProjectsImpl(data, viewerId)` on a public path whose wrapper decides nothing, and `getMyInterestsImpl(userId)` under a wrapper that calls `requireUser()`. A `My` stem names whose rows are read, not who resolved the identity, so keep it on both halves of a pair and let the seam and its wrapper share a stem.

  Every wrapper has a seam under it, one of those two shapes, and `src/server/__tests__/seam-convention.test.ts` is what keeps it that way. It pairs each `*ForCurrentUser` against an `*As` or `*Impl` sharing its stem in the same file, and fails naming the wrappers that have none. It runs in `npm test`, so a wrapper added without a seam is a red check rather than a convention someone remembers to apply.

  It replaced a grep that could not fail: that command printed every wrapper unconditionally and paired nothing, so a clean tree and a broken one gave the same output. If you write a check for a convention here, make yourself see it red before you trust it.

  **Collapsing the wrappers into one generic adapter was considered and rejected.** Fifty of them are two lines (`const viewer = await requireUser(); return xAs(viewer, data);`) and an architecture review proposed replacing them with a single `withCurrentUser()`. They stay, for two reasons. One named function per action is 59 grep targets and a generic adapter is none, and grep-ability beats line count in this codebase. And the wrapper is not the interesting part: the `*As` seam below it is what tests cross, so collapsing the layer above would save nothing a reader is confused by while touching eleven files.

  What that review actually found, once the 57 were looked at individually, was six functions with **no** `*As` twin: all four in `bookmarks.ts`, plus `uploadAvatarForCurrentUser` and `clearAvatarForCurrentUser`. The cost was exactly what this convention predicts. `bookmarks.integration.test.ts` could not reach the code, so its two cases inserted rows directly and one re-implemented the join it asserted on; the `canSeeProject` check on the bookmark path had no coverage at all. The avatar tests were `describe.skip` with a comment explaining that `requireUser()` needed a request context the harness does not provide. Both are fixed. If you are tempted to skip the seam, that is what skipping it looks like a few months later.
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

This is the opposite of what you'd expect. `.withMetadata()` preserves
metadata; passing an empty options object
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

### One image upload policy, in `src/lib/image-upload-policy.ts`

The MIME allowlist, the 10MB cap and the `assertImageFile` guard live there,
client-safe, and every upload surface reads them: `_internal/uploads.ts` (project
images and avatars), `_internal/inventory-images.ts`, and the file picker's
`accept` attribute in `components/image-uploader.tsx`. They used to be three
copies, and nothing kept them in step, so the app could have accepted a type on
one form that another rejected. Change the allowlist or the cap there and every
surface moves together.

`src/lib/__tests__/image-upload-policy.test.ts` is what keeps that true. Besides
the guard's own cases it walks `src` and fails any file, other than the policy
module itself and the test files, whose code names two or more distinct image
MIME types, in any arrangement: one comma-separated string, a multi-line `Set`,
a `t !== "image/jpeg" && ...` chain, a union type. Comment lines are dropped
before counting, so prose explaining the rule may quote it. One type on its own
is left alone, because `image/webp` is the output content type Sharp and the
canvas both name rather than a policy being restated. A second rule runs only
when the count did not fire, and catches a picker narrowed by hand to a single
type in a file that names no other.

If you touch that scan, mutate more than the form it was written for. Every
narrowing it has needed was found that way and not by reading. Requiring a
quote straight after `accept=` let `accept={"image/..."}` through. Matching
only next to `accept=` let a `const` holding the list one line above
`accept={LOCAL}` through. Requiring the types be comma-separated on one line
let both a multi-line `Set` copy-pasted from the policy module and a
comparison chain through. Each of those looked airtight until someone wrote
the mutation.

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
`src/server/_internal/uploads.ts` for the canonical pair. Both the
project and avatar paths are covered in
`uploads.integration.test.ts`. Note that since #88 the project upload
writes no row at all: it stores the object and returns the key, and
the caller saves it. Its test therefore covers Sharp plus the bucket, and
asserts the row is NOT written; that an image change reaches the row and the
edit log is asserted on the update path instead.

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

### Who writes an image column, and who deletes the object

Both `projects.image_url` and `inventory_items.image_url` follow one rule, and
the uploads follow none of it by design (#88, #126):

| Path | Writes the column | Deletes the object |
| --- | --- | --- |
| `uploadProjectImageAs`, `uploadInventoryImageAs` | No, returns the key | No |
| `updateProjectAs`, `updateInventoryItemAs` | Yes | Yes |
| `createProjectAs`, `createInventoryItemAs` | On insert, so nothing to replace | No |
| `hardDeleteInventoryItemAs` | Deletes the row | Yes |
| `hardDeleteProjectAs` | Deletes the row | Yes |

Why the uploads write nothing, why the cleanup runs after the row is written
rather than inside the transaction, and why it refuses a key outside the row's
own prefix are all under "An image change is an ordinary edit, and who cleans
up after it" in the Projects section below, and what the column may contain is
under "What `image_url` may contain" beside it. Neither is repeated here. Two
things those sections cannot say because they are inventory's:

- Retiring writes the row, through `transitionItem` like any other status
  change, but it never writes `image_url` and never touches storage, so a
  retired item keeps its photo. That is not the same as saying only a hard
  delete can drop one: `updateInventoryItemAs` gates on staff and not on
  status, and nothing gates the edit form on status either, so staff replacing
  or clearing a retired item's photo deletes the object it replaced exactly as
  for a live item.
- Both create paths reach their first key through a second write, because the
  key is `<domain>/<id>/...` and the upload needs the row to exist. That second
  write is an ordinary edit, so a brand new project or item carries one
  edit-log row naming `imageUrl`.

Both hard deletes clean up. Soft delete does not: a soft-deleted project keeps
its row, so it keeps its image (#159).

Checkable:

```bash
# no hits: neither upload path writes a row
grep -n 'update(projects)' src/server/_internal/uploads.ts
grep -n 'update(inventoryItems)' src/server/_internal/inventory-images.ts
```

### Categories: `domain` is closed, `type` is an open project-only facet, filtering is all-match

`categories.domain` is a closed enum (`"project" | "inventory"`) fixed at creation and immutable on update; it decides which picker a category can appear in and, for inventory, is enforced again at the junction-table read (`listInventoryCategoriesImpl` in `src/server/_internal/inventory-catalog.ts` re-filters on `domain = 'inventory'` even though nothing today writes a project-domain row into `inventory_item_categories`: belt and suspenders, not a defense against something that currently happens). `categories.type` is a separate, nullable, free-text facet (grouping label like "technology" or "industry") that only the project domain uses for grouping in the UI; inventory categories always carry `type = null` and are rendered as one flat list, not grouped. An inventory item can carry many categories through `inventory_item_categories` (many-to-many), the same shape `project_categories` already used for projects.

Both listings filter categories as all-match, not any-match: every selected category id must be present on the item/project, not merely one of them. The shape is a subquery grouped by item/project id with `HAVING count(*) = <number of selected ids>` (`buildInventoryScope` in `src/server/_internal/inventory-catalog.ts`, mirroring `searchProjectsImpl` in `src/server/_internal/search.ts:40-46`); a plain `inArray` on the junction table would silently give any-match semantics instead. Every category filter's `.inputValidator` therefore expects `categories: z.array(z.string().uuid())`, not a singular `category: z.string().uuid().nullable()`. A route that still sends the singular key gets it silently stripped by Zod (the array param defaults to `[]`), and the filter does nothing while looking fine. `.catch([])` on the array schema is what lets a stale pre-multi-select `?category=<slug>` link degrade to "no filter" instead of a 500.

Inventory full-text search no longer matches category names. Before this feature, `inventory_items.search_vector` weighted a `category` text column into the vector (`drizzle/0003_last_invaders.sql:61`, weight `'C'`). That column is gone; categories now live in the `categories` table, reached through the `inventory_item_categories` junction table. `search_vector` is a `GENERATED ALWAYS AS (...) STORED` column (see the tsvector quirk above), and a generated column can only read other columns on the same row, so it cannot follow that join to pull category names back in. The rebuilt column (`drizzle/0010_category_domains.sql`) simply drops the category term rather than trying to fake it. This is treated as an accepted gap, not a bug to fix: searching "electronics" no longer also surfaces every item merely tagged with a category named "electronics," but the all-match category filter documented above already covers that use case directly, and correctly, for a caller who wants it.

### One staff predicate, in `src/lib/viewer.ts`

`isStaff` and `assertStaff` live in `src/lib/viewer.ts` and nowhere else. Do not add a local copy.

Before this there were two `isStaff` and **five** `assertStaff`, and `isStaff` was exported from `src/lib/project-visibility.ts`, which ten files across seven non-project domains imported. That is what made the module's name wrong: a domain module owned something that is not domain-specific. Consumers import from `viewer.ts` directly rather than through a re-export, because Biome's `noBarrelFile` rejects the re-export and this project's no-shims rule would too.

There are **seven** `AuthUser` interfaces in `_internal/` (`comments`, `uploads`, `projects`, `programs`, `users`, `categories`, `project-review`), and six are byte-identical to `NonNullable<Viewer>`, so no adapter is needed at a call site. The seventh, in `uploads.ts`, genuinely extends it with an optional `image` that only the avatar paths read. The inventory impl used to declare a local `Viewer` too, narrower than the shared one by a missing `undefined`; it imports the shared type now. This entry said "four" for several months while the count grew, so treat it as a lower bound and count before you cite it.

`assertStaff` carries `asserts viewer is NonNullable<Viewer>`, and the narrowing is load-bearing: call sites read `viewer.id` immediately afterwards with no second null check.

`assertStaff` is the gate on the write seams of both domains: `inventory-catalog.ts` and `_internal/projects.ts` both open a staff-only write with it, rather than one asserting and the other hand-rolling `isStaff` plus a throw. Say **write** rather than "every staff-only seam", because the read side has not been converted: `_internal/projects-queries.ts` still refuses with `if (!isStaff(viewer)) throw` in `listAdminProjectsAs`, `exportAdminProjectsAs`, `getProposerForEditAs` and `listProjectEditLogImpl`, and the `{ id, role: role ?? null }` reshape this file's entry above calls unnecessary is still written six times: once as a named `viewerToVisibility` in `_internal/categories.ts`, and inline at `_internal/comments.ts`, `_internal/uploads.ts`, `_internal/project-review.ts` and twice in `_internal/bookmarks.ts` (`admin.ts` lost its copy when its stats moved behind `getAdminStatsAs`, #34). A missing `assertStaff` is therefore not evidence a seam is unguarded; read the gate. Count the sites before citing a number here, and grep for the reshape rather than for the function name.

The narrowing above is not what buys that consistency, and `projects.ts` is where the difference shows. Its `AuthUser` is already non-nullable, so `asserts viewer is NonNullable<Viewer>` narrows nothing at any of its call sites. The gate is worth having anyway, for the same reason the predicate module is: one spelling of one question.

A gate that admits the **owner as well as** staff cannot use it, because `assertStaff` refuses unconditionally. Those keep reading `isStaff`, and they are not all obvious from a grep: `performTransitionAs` and `hardDeleteProjectAs` call it directly, and `updateProjectAs` reaches it twice over, through `canEditProject` and again through `canWritePrivateNotes` inside `buildProjectValues`, both of which return true for the proposer. Treat that list as non-exhaustive and check `project-visibility.ts` before concluding a seam is staff-only.

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

- **"Never neither" is status-dependent and cannot be enforced here.** `{ kind: "none" }` is legal and necessary. Only the invariants in `src/lib/inventory-workflow.ts` know a `reserved` or `checked_out` transition may not have it, which is why its `reserved`/`checked_out` arm stays. That arm also catches `holderId` together with `holderLabel`, which the `holderId` resolution path never routes through the constructor, and `src/lib/__tests__/inventory-workflow.test.ts` asserts its exact wording and that exact pair.
- **Not every hold is built through `holdFromInput`.** Read paths construct cases directly from stored columns. A union constrains only what passes through its constructor.

Whitespace is not trimmed here, deliberately: `inventory-workflow.ts` decides person-versus-thing on raw truthiness and `transitionItemInTx` stores the raw strings, so the constructor matches both and an input cannot pass one guard then be re-judged by a stricter one. Trimming is the input layer's job. An empty string **is** normalized to null, which is a change from the old inline writes and a fix rather than a regression: `??` does not treat `""` as absent, so an empty `current_holder_name` stopped the admin table's `name ?? email ?? label` chain from falling through and rendered a blank cell for an item that did have a holder.

The precedence order (name, then address, then label) has two renderings, and the module owns the order rather than collapsing the formats: `formatHoldDetailed` gives the lifecycle panel `Name (address) · Program`, `formatHoldShort` gives the admin table a bare one-liner. A TanStack Table `accessorFn` paired with `sortUndefined: "last"` must map the module's `null` to `undefined`, because `sortUndefined` does not special-case `null`.

`holderFields` in `src/components/inventory-lifecycle-panel.tsx` deliberately does **not** call `holdFromInput`. The constructor asks "is there an account?"; the dialog asks "do I know there is no account?", and `AccountStatus` has a third state, `unknown`, because the lookup is debounced. Expressing "an account exists but I do not know which" would need a fabricated account id. The client refusing to compose an illegal payload and the server defining what is illegal are two different jobs, and the server re-derives independently either way.

### The notification modules decide, the transaction inserts

Both domains split this the same way. Who receives an inventory notification and what it says lives in one pure, client-safe module, beside `hold.ts`, `inventory-deadlines.ts`, `inventory-visibility.ts` and `inventory-workflow.ts`. `notificationFor(prev, input, holderId, closed)` returns one row or null; `overdueNotifications(candidates, now)` returns many and owns the dedupe. `transitionItem` and `recordOverdueNotificationsAs` only insert what comes back.

Before this the decision was welded to the write: ninety-odd pure lines wrapped around five `tx.insert` calls, so the subtlest rule in the domain could only be exercised through a full request lifecycle against docker. Asserting the requester-versus-holder rule cost twenty-four lines of arrange. It is now a line.

`src/lib/project-notifications.ts` is the project half, added later and to the same shape: `statusChangeNotification`, `softDeleteNotification` and `commentNotifications` return rows, and `src/server/_internal/notify.ts` keeps the transaction. Its strings moved verbatim from the old inline writers, so a wording change there is a deliberate change, never a refactor's side effect.

One asymmetry between the two, and it is the interesting part. `commentNotifications` takes `parentAuthorId` as a parameter rather than finding it, because finding a parent comment's author is a `tx.select` and a pure module cannot run one. The seam therefore falls between the lookup and the decision: `notify.ts` runs the query, scoped to the project as well as to the parent id so a parent belonging to another project resolves to nobody, and only the answer crosses. The inventory module never needed this because its equivalent, the closed request line, was already resolved by the time the decision ran.

`NotificationRow` is the five columns both modules return, and it lives in `src/lib/notification-row.ts` rather than in either of them. Inventory declared it first and projects would otherwise have imported an inventory module to borrow a type, which is the coupling that moved `isStaff` out of `project-visibility.ts`. Declared structurally rather than from `typeof notifications.$inferInsert`, which would carry `id`, `read` and `createdAt` and pull Drizzle into a client-safe module.

Two rules that look wrong until you know why:

- **A denial is answered before the recipient guard.** The guard asks who holds the item, and a hold on a bare label answers nobody, which would silently swallow the notice owed to the person who asked. The rejection branch therefore comes first and reads its recipient off the closed line, not off the item.
- **Inventory does not suppress the actor**, unlike the project module, whose two single-recipient decisions open with `proposerToTell`. Its comment writer does not: a reply notifies the parent's author too, so it excludes the actor per recipient rather than up front. Suppression here is keyed on `authority === "self_cancel"` instead, because staff assigning a hold to their own address is also actor-equals-recipient and *does* want the pickup deadline in their bell.

**New recipient or content cases belong in `src/lib/__tests__/inventory-notifications.test.ts` or `project-notifications.test.ts`, not the integration suite.** The integration tests that assert notification rows stay: they are the only proof a row reaches Postgres, and on both extractions they were the evidence it was faithful, since they passed unedited.

### The dev seed drives the real write path

`scripts/seed-dev.ts` used to write `status` and `current_holder_id` into `inventory_items` directly, which made it a second writer against the rule above: `transitionItem` is the only thing that writes `inventory_item_status_history` and syncs the holder columns. The seed disagreed with it quietly, and the symptom was that seeded holds had a holder and nothing else. No deadlines, no request lines, no history, no notifications, so none of the overdue or request behaviour was reachable by hand.

Catalog data (users, programs, categories, items) is still written directly; it has no state machine. The **lifecycle** goes through `addToCartAs`, `submitCartAs`, `approveRequestItemAs`, `rejectRequestItemAs`, `cancelRequestItemAs` and `transitionItem` with a synthetic admin viewer, which the `*As` convention exists to allow. Nine states come out: overdue checkout, overdue pickup, a healthy hold, a pending request, an approved one, a requester who is not the holder, and one each of returned, rejected and cancelled in history.

Deadlines are relative to run time (`daysFromNow(-9)`), not fixed dates, which would drift into being hundreds of days overdue and read as broken data.

Overdue notifications are **not** seeded. They appear when you first open `/my/items`, because the scan is lazy and there is no cron, which is the behaviour documented below. Anything added to the seed that changes item state must go through the same helpers.

### Lazy deadlines, no scheduler

`pickup_by` / `due_at` on `inventory_request_items` and `current_pickup_by` / `current_due_at` on `inventory_items` are informational only. There is no cron. Overdue is **derived**, never stored, and `src/lib/inventory-deadlines.ts` is the one place that derives it: `overdueFlags(pair, now)` takes the clock as a parameter, and `deadlinePairOf(entry)` is the only thing that knows a hold keeps its dates on the item while a request keeps them on the line. Both the `OverdueBadge` on `/my/items` and the notification scan read it, so the page and the bell cannot disagree about what overdue means. One SQL twin is sanctioned: the analytics dashboard's overdue count in `src/server/_internal/analytics.ts` states the same two conditions (a checkout past `current_due_at`, a reservation past `current_pickup_by`) because a count over every item cannot go through a per-entry JS predicate, and `analytics.integration.test.ts` seeds one of each plus a healthy one so the two cannot drift silently (#34). An earlier version of this entry claimed those badges already existed; they did not, and a student whose item was weeks late saw a page identical to one on time. Lazy idempotent notifications are inserted on read via `recordOverdueNotificationsAs`, which runs two scans: request lines with `status = 'approved'` (scoped to the viewer's own requests), and staff holds (`current_holder_id IS NOT NULL`, `status IN ('reserved', 'checked_out')`), both folded into one `values` array for a single insert. The two scans deliberately overlap. A request line and a hold can describe two different people, because a teammate can collect an item someone else requested: the requester is accountable for the request and the picker is holding the thing, so both are notified. `notifications_overdue_unique_idx` on `(user_id, type, link)` does not collapse that case, and must not, because the user ids differ. The far more common case, where requester and picker are the same person, has both scans return the same row twice in one batch. `onConflictDoNothing` already collapses intra-batch duplicates on its own (it is `DO UPDATE` that errors with "cannot affect row a second time"), so the database would handle that case either way. The candidates are also deduped in JS on `(userId, type, link)` before the insert, which keeps the statement smaller and puts the intent where a reader will look for it, not because the index is unable to. That same index, a partial unique index for the two overdue types keyed on `/inventory/${itemId}` rather than the request line, lets `onConflictDoNothing` collapse re-reads (the same scan producing the same row again on a later call) into the same key space. The target + where are declared explicitly so future unique indexes on `notifications` cannot silently swallow unrelated conflicts.

The hold scan additionally requires `current_holder_id IS NOT NULL`, narrower than the `/my/items` read path (`listMyItemsAs`), which also matches an unlinked hold by verified email. `notifications.user_id` is a foreign key to an account; an email-matched hold with no resolved account has no id to attribute a message to, and resolving the email here would reintroduce, on a write path, the impersonation risk the read path guards against. Net effect: a walk-in hold assigned by email shows in `/my/items` once the address matches a verified account, but does not notify until staff link it to an account. That linking happens automatically on the next transition that resolves the holder's email to an account and keeps the hold (e.g. reserved to checked_out); a transition that releases the item to `available` instead clears `current_holder_email` outright, so if the item is released before that resolution happens there is no longer a hold to notify about.

The call in `listMyItemsAs` is wrapped in a `catch` that **reports** rather than discards. The read must never fail because of the write, but a bare `catch {}` meant that if recording broke, every overdue notification stopped and the page carried on looking fine, so nobody would find out.

### Retired is the archive, and staff-only

Retired items are excluded from every listing by default, staff included, and reachable only through the "Show only retired" switch on `/admin/inventory`. That switch is the only way to list them, which matters because hard delete permits only `available` or `retired` and this file tells you to retire anything that has been requested.

One rule, `canSeeRetired` in `src/lib/inventory-visibility.ts`, and two things derive from it:

- `visibleStatuses(viewer, { retiredOnly })` returns the statuses a listing may show. It is **data, not a predicate**, because it has to cross into SQL: `buildInventoryScope` builds its `inArray` from it. Do not reintroduce a literal `ne(status, "retired")` in the query.
- `canReadInventoryItem(item, viewer)` answers the single-row question in `loadInventoryItemRowFor`.

Those two are different questions, not a contradiction: a listing decides what to show by default, the gate decides whether this person may read this row, and staff opening a retired item by URL is correct. Before the module they were two hand-written rules that **disagreed**: the SQL hid retired from staff as well, so staff could read a retired item by URL and had no way to find one.

`retiredOnly` is on `listAdminInventorySchema` only. It is deliberately absent from `listInventorySchema`, and `visibleStatuses` ignores it for a viewer who may not see retired, so a request has to defeat two independent things to reach a retired row.

### `/my/items` has its own two projections

`holdItemView` and `myRequestLineView` (`src/lib/inventory-visibility.ts`) are the third audience for `inventory_items`, beside `publicItemView` and `staffItemView`. They exist rather than reusing `publicItemView` because that one takes a `categories` argument fed by the correlated subquery in `buildInventoryScope`, which this path does not run, and `/my/items` renders neither categories nor a description.

Three shapes, and the asymmetry is the point:

- A **hold** carries `item: HoldItemView`, because only a hold has no request line and the item is genuinely the subject.
- A **request** carries `itemName` and `itemStatus` flat, plus `line: MyRequestLineView`. It must not carry an item view: `holdItemView` renames `current_pickup_by` to `pickupBy`, so an entry holding both the item's and the line's would carry two different `pickupBy` values under one name. A request's deadlines live on its line. `itemStatus` is still needed, and not only for the overdue badge: `/my/items` gates the Cancel button on it, which is what stops a requester cancelling an item a teammate has already collected.
- **History** carries `itemName` only. The item's current status and dates describe whoever holds it now, which is not a closed line, so a returned item would otherwise render "Due tomorrow" against someone else's hold.

Requester and holder are both listed when they differ, so a request entry is exactly what the requester sees while a teammate carries the thing. Both views type `status` as `ItemStatus` rather than `string`; `InventoryItemPublic` still says `string`, so `/inventory` and `/admin/inventory` still cast. Narrowing those is a loose end, along with `InventoryStatusBadge` declaring its own copy of the same six-string union.

`reviewComment` is deliberately not on the line view. `closeRequestItemOnRelease` writes it and `closed_reason` from the same string ("the comment does double duty"), and `closed_reason` is the one the page renders, so the requester already sees the rejection reason.

### Hard delete is narrow

`inventory_items.id` is referenced by `inventory_request_items` with `ON DELETE RESTRICT`. Hard delete works only when no historical request lines reference the item. `hardDeleteInventoryItemAs` pre-checks this and throws a friendly error instead of letting Postgres surface `23503`. Use retire for anything that has been requested.

### `transitionItem` is the only writer

Every status change to an inventory item goes through `src/server/_internal/inventory-transitions.ts::transitionItem`. It is the only place that writes `inventory_item_status_history` rows and the only place that syncs `current_holder_*` columns with the item status. This is now literally true, and checkable: `grep -rn '\.update(inventoryItems)\|insert(inventoryItemStatusHistory)' src --include='*.ts' | grep -v __tests__` returns three hits, two in `inventory-transitions.ts` and one that touches attribute columns only: `updateInventoryItemAs` in `inventory-catalog.ts`, which writes neither status nor holder. It was four until #126 stopped `uploadInventoryImageAs` writing a row at all. The count is the invariant; the file names are not, and #104 moved them once already. Re-run the grep rather than trusting this sentence's attribution.

An earlier version of this entry granted reject and cancel a standing exemption "because they emit custom notifications and need different transaction shapes". Both were routed through `transitionItem`, along with `submitCartAs`, which had been writing inline without the entry mentioning it at all. The exemption had already cost one bug: `4c22016 fix(inventory): clear the walk-in name and program on reject and cancel` is what happens when two new hold columns are added and only two of four writers learn about them.

The four callers each keep what is genuinely theirs (who may act, and which line is eligible) and pass the rest:

- **Approve** delegates via `transitionItem(viewer, input, tx)` from inside the approve transaction, using the optional `externalTx` argument.
- **Reject** passes `lineDecision: { outcome: "rejected", requestItemId }` plus the review comment.
- **Cancel** passes `authority: "self_cancel"` and `lineDecision: { outcome: "cancelled", ... }`.
- **submitCart** passes `authority: "self_request"`, once per surviving cart line, on its open transaction. Re-locking a row the transaction already holds is free, which is why it shares the writer rather than a private helper.

Two fields carry the variation, and both default to the previous behavior when absent:

**`authority`** is the only way past `assertStaff`, and it is default-deny. `AUTHORITY_TARGET` is the single source of truth for which values exist and which status each may reach (`self_cancel` releases, `self_request` requests); an unrecognized value is rejected rather than ignored, and a self-service transition may not name a `holderId` other than its own viewer. **`transitionSchema` in `src/server/inventory.ts` must never declare this field.** `transitionInventoryItem` carries only `requireUser()`, so `assertStaff` inside `transitionItem` is that endpoint's entire staff gate, and `z.object().parse` stripping the unknown key is what keeps it shut. `src/test/inventory-schemas.test.ts` asserts the stripping, including through `__proto__`; adding `.passthrough()` or `.catchall()` there would let any signed-in user retire any item.

**`lineDecision`** overrides what a released item's request line becomes, and carries the id of the line it was decided about. The two travel together on purpose: a release cannot carry `requestItemId` (the invariants in `inventory-workflow.ts` forbid it on those statuses), so an outcome alone would land on whatever line the item points at, which need not be the line the caller locked. A mismatch throws. A `rejected` outcome additionally requires the line to still be `pending` and the comment to be non-empty, matching the guards `rejectRequestItemAs` has always had.

The denial notification goes to the **requester**, read from the line by `closeRequestItemOnRelease`, not to the item's current holder. Those are usually the same person and are not always: staff can take a still-pending item straight to `checked_out` for a teammate (`syncRequestItem`'s `checked_out` arm writes only `dueAt`, leaving the line pending), and a denial belongs to whoever asked.

### The transition rules are a module, not a preamble

`src/lib/inventory-workflow.ts` owns every rule a transition can be refused for before a row is read: the staff gate, `AUTHORITY_TARGET` and what each authority may do, the per-status invariants, and `resolveLineOutcome`. It is pure and client-safe, beside `hold.ts`, `inventory-deadlines.ts`, `inventory-notifications.ts` and `inventory-visibility.ts`, and it is the inventory twin of `src/lib/project-workflow.ts`. `transitionItem` calls `assertTransitionAllowed(viewer, input)` once, before it opens a transaction.

**The split is by whether a rule needs a locked row, not by tidiness.** These
stayed in `inventory-transitions.ts` and should stay there: a line is still open, a line belongs to this item, the item is free to be requested, a rejection lands only on a line that is still pending, and the decision names the line the item is currently holding. Each is a rule about a row read under `FOR UPDATE`, and pulling it out would leave a predicate that means nothing without the read that feeds it.

**A single `plan(viewer, input, currentRow)` covering both halves is not
available.** It would have to read the item before the request line, and `lockAttachableRequestLine` takes them line-then-item to match `approveRequestItemAs`, which locks the line and then calls `transitionItem`. Inverting that deadlocks the two paths against each other.

Two departures from the `inventory-notifications.ts` pattern next door, both deliberate. That module declares a narrow structural `TransitionNotice` because it reads six of its thirteen fields; the rules read all but `itemId`, so `TransitionInput` itself moved and the server file imports it back. And `TransitionActor` is the non-null arm of `Viewer` rather than the union, because the self-service path reads `viewer.id` without `assertStaff` having narrowed it first.

**A new rule, or a new case for an existing one, belongs in
`src/lib/__tests__/inventory-workflow.test.ts`, not the integration suite.** An integration case is warranted only when the assertion is about a row: what was written, what was left untouched, what a concurrent caller saw.

Twelve integration cases left when this moved. Each asserted only that the call was rejected, ten of them on the message and two on the rejection alone, and none looked at a row afterwards, while paying for a user, an item and sometimes a full reserve to get there. The rules now have twenty-four unit cases, including coverage the integration suite never had: the holder fields refused on a release, the `requested` arm, `pickupBy` staying optional on a reservation, and instructor counting as staff. One case stayed an integration test on purpose: `transitionItem throws Forbidden for a non-staff viewer` sits under `defense in depth`, a block whose whole job is to prove the impl re-checks role on every staff write. A unit test of the rules module cannot show that.

### Deferred FK

`inventory_items.current_request_item_id` references `inventory_request_items.id` but the FK is declared in raw SQL inside the migration (not in `schema.ts`) because the two tables reference each other. `ON DELETE SET NULL`.

### submitCart is lock-first

`submitCartAs` locks each cart item with `SELECT FOR UPDATE` and re-checks `status === "available"` before treating it as a survivor. The `inventoryRequests` envelope is inserted only after the lock phase confirms at least one survivor, so an all-race path never leaves an orphaned request row. Items that lost the race are returned in the `skipped` array with reason `"no_longer_available"`.

## Projects

### Both domains name the fields their detail reads return

`getProjectAs` (`src/server/_internal/projects-queries.ts`) returns `projectDetailView(project, viewer)` (`src/lib/project-visibility.ts`), which names every field the two consuming routes read, one by one. That object is serialized into the public SSR loader payload of `/projects/$id` for any viewer, anonymous ones included, so this is the payload with the widest audience in the app. A new column on `projects` is invisible there until someone names it. `notes` is the one viewer-dependent field, assigned inside the projection from `canSeePrivateNotes`, which is why this cannot become a SQL column map: the rule is which columns **for this viewer**, and half of it cannot live in SQL. `projects.integration.test.ts` asserts the exact key set for an anonymous read and for a staff read.

**This entry used to warn that projects did the opposite, and the warning was earned.** `getProjectAs` returned the whole row through a `stripPrivateFields` helper that nulled two columns, and the caller patched three more inline right below it (`embedding`, `embeddingSourceHash`, `embeddingUpdatedAt`). Two places for one rule is what it looks like when someone finds a leak and fixes the call site instead of the module. Seven columns were neither read nor stripped and simply rode the payload: `proposerId`, `programManagerId`, `publishedAt`, `archivedAt`, `searchVector`, `createdAt` and `updatedAt`. `stripPrivateFields` is deleted; `VisibleProject` stays, because four predicates still take it.

Two things worth knowing about the new shape. `proposerEmail` is **absent, not nulled**: nothing reads it there, and the staff panel gets the proposer through `getProposerForEditAs`, which is staff-gated at the server rather than made safe by an assignment on a payload everyone receives. And `searchVector` plus the three embedding columns still cross from Postgres into the server process, because the projection is applied in JS; they stop at the server. Excluding `searchVector` at the SQL level stays available if it ever shows up in a profile.

`canEdit` in that return value **is** authoritative, and reads `canEditProject` directly (`projects-queries.ts:311`). It used to reimplement the rule inline and disagree with the predicate for exactly one case, staff on an archived project: the inline copy said no, the predicate said yes, so the page hid the edit affordance for a write `updateProjectAs` would have accepted. That was issue #40, now closed. `projects.integration.test.ts:718` pins the agreement for staff, owner and anonymous on an archived project, and `project-visibility.test.ts:108` still pins the predicate itself. This paragraph told readers not to trust the value for some time after it became trustworthy.

**Inventory got here first, and an earlier version of this entry said it "does not have this hazard", full stop, which was false for as long as it stood.** A projection function guarantees only what passes through it, and there are three non-staff read paths for `inventory_items`, not two: `listMyItemsAs` called neither view. It selected whole table objects and spread the joined rows, so `/my/items` shipped `serial`, `notes`, `label` and `location` off the item, and `reviewedBy`, `reviewedAt`, `reviewComment`, `closedBy` and `closedAt` off the request line, to the student the row belonged to. The blast radius was the viewer's own items rather than anyone else's, which is why it read as a docs contradiction rather than an exposure, and it is also why nobody found it: this paragraph told them not to look. All three paths now go through the module, and `inventory.integration.test.ts` asserts the exact key set of both `/my/items` arms, because the type system cannot say "every read path must project" and the thing that broke was the `db.select()` above the projection, not the projection.

### The listing projection is bounded by `projectDetailView` and pinned by a key-set test

`projectSummarySelect` (`src/server/_internal/project-summary.ts`) feeds the public listing, "my projects" and "my bookmarks", and since 2026-09-02 it carries every public field rather than nine, because the listing's table mode shows them. The rule for what may be in it is not written in that file: it is whatever `projectDetailView` returns to an anonymous viewer, minus `notes`, `isSponsored`, `programId` and `deletedAt`, which no listing reads. `search.integration.test.ts` ("returns exactly the public field set") pins the sorted key list of `searchProjectsImpl`, and `bookmarks.integration.test.ts` pins the same list plus `bookmarkedAt`. Adding a column to the projection fails both until the literals are updated, which is the moment to ask whether the column is public. `proposerEmail` and `notes` must never appear in either list.

`adminProjectSummarySelect` spreads the public one and adds proposer identity and the lifecycle dates. Do not add a field to the admin projection that the public one already carries; two of those existed (`contactEmail`, `teamsSupported`) and were removed when the public one widened.

The listing's SSR payload is larger for it, on the page anonymous users hit first, times the page size. #78 says a lazy fetch of the prose columns is the fix if that turns out to matter, and not to build it until it has been measured.

### A read is public or staff-only per endpoint, not per domain

`listPrograms` is public and `getProgram` is staff-only, and what separates them is whether the query reaches `user`. `listProgramsImpl` projects the six public `programs` columns by name, none of them personal, so the project listing's program filter reads it without a session; `term_count` and any later staff-only column stay out by omission. `getProgram` joins `programInstructors` to `user` and returns each instructor's address and role, which is a staff view of an account that happens to be reachable through a program. `listEligibleInstructors` is that join without the program: the whole staff roster, which also answers "who are the admins". Only the second of those three returns every admin; `getProgram` returns the instructors of one program.

**Both were reachable without a session until 2026-08-28, and the design table had already got one of them right.** `docs/superpowers/specs/2026-05-17-discovery-and-taxonomy-design.md:246` classifies `listEligibleInstructors()` as `Staff`, and the code shipped ungated anyway. Line 239 classifies `getProgram(id)` as `Public` in the same breath as describing it as "Single program with its instructor list", and `bab385c` shipped that `innerJoin` on `user` the same day, so this one was misclassified when written rather than invalidated later. Two different failures, one consequence, and for three months nothing compared the code against that table. **A classification that lives only in prose cannot fail.**

The rule that replaces it: **a read is staff-only when its query reaches a column of somebody's account**, by projection or by join.

One public fragment reaches `user` on purpose: `mentorNameSql`, which `projectSummarySelect` carries into the listing, search, bookmarks and my-projects, and which `getProjectAs` selects for the detail page. It resolves `projects.mentor_email` to `user.name` and nothing else. It returns a name the person will have typed into a public profile, for a project they are publicly mentoring, and never the address it matched on. That is the whole exception; see "Mentorship is two staff-written columns and one derived flag" below before adding a second one.

The reason it survived review is worth more than the fix. Every consumer of both endpoints is an admin-only page, so reading the call sites says the code is fine, and it is, right until someone calls the endpoint without the page. **A `createServerFn` endpoint is reachable on its own; the route guard protects the page, not the data.** There is no global middleware, so the guard an endpoint carries is the only guard it has, which is the same point the `transitionInventoryItem` note above makes from the other direction.

`programs.integration.test.ts` pins both halves: the two gated reads refuse a non-staff viewer, and the public list is pinned to the six `programs` columns. A future join into that bare `select()` would nest the row under table keys, so `courseId` stops resolving and the test fails rather than leaking.

### The edit diff has no field list; it reads the writer's keys

`diffRowFields` (`src/lib/edit-diff.ts`) iterates the keys of the object the writer produced, not a list of its own. Both domains use it: `buildProjectValues` in `projects.ts` and the `values` literal in `updateInventoryItemAs`. There used to be a `PROJECT_EDITABLE_FIELDS` array beside it, and it drifted: `isSponsored` and `requiresNdaIp` were written by `buildProjectValues` and never named in the list, so a diff blind to them returned no changed fields, and `updateProjectAs` took the `changedFields.length === 0` early return before the UPDATE ran. Toggling sponsorship on its own, or unchecking the NDA flag on a project whose `licenseRestrictions` was already null, reported success and saved nothing.

The reason it survived a test suite that covered the flags is worth knowing before you trust a passing case here. `ndaFields` derives `licenseRestrictions` from `requiresNdaIp`, and `licenseRestrictions` *was* in the list, so unchecking the box persisted whenever there was text to clear. The existing test set the text, so it passed for the sibling field's reason and would have kept passing if the flag had stopped persisting entirely. A test that moves two fields cannot tell you which one carried the write.

Two consequences to respect:

- **`next` is `Partial<typeof projects.$inferSelect>`, and `buildProjectValues` is declared to return it.** That is what makes a key which is not a column a typecheck failure rather than a runtime skip, and it is why the writer must stay typed against the table. Widening it back to `Record<string, unknown>` silently restores the old class of bug.
- **The order of `changedFields` is the order of the literal in `buildProjectValues`**, because object key order is insertion order for string keys. It is observable: it is stored on the edit log and rendered by `EditLogList` in `src/components/edit-log-list.tsx`, which both staff panels use. Reordering that literal changes what staff read, so `edit-diff.test.ts` pins the order to make the change loud. Inventory has the same dependency, `inventory.integration.test.ts` pins its order too, and since 2026-09-02 its log is rendered as well, so reordering either writer's literal changes what staff read.

Inventory carried the same list until 2026-08-28, under the name `EDITABLE_FIELDS`, and it was one added column away from the same bug. Its `satisfies readonly (keyof typeof inventoryItems.$inferSelect)[]` annotation read as protection and was not: it catches a **removed or renamed** column and cannot catch an **added** one, which is the direction the projects list actually drifted. Measured before deleting it, by dropping each field in turn: `npm run typecheck` reported zero errors in all seven cases, and the integration suite caught only `name`, `label` and `location`. `description`, `serial`, `notes` and `imageUrl` could each have fallen out with the whole repo green while an edit touching only that field saved nothing and reported success. `inventory.integration.test.ts` now edits every field alone, so a field that stops being written fails by name.

**Categories are the one thing outside the diff, in both directions.** They live on a join table rather than on `inventory_items`, so `categoryIds` is not a key of the writer's object (and `Partial<typeof inventoryItems.$inferSelect>` would reject it), and they get their own comparison computed **before** the early return. Skipping that would make a categories-only edit take the zero-change path and discard the category write, which is the same silent-write class one level along.

### The lifecycle panel asks the rules; it does not restate them

`needsHolder` and `needsDueAt` (`src/lib/inventory-workflow.ts`) exist for `inventory-lifecycle-panel.tsx`, which used to spell both rules inline as `status === "reserved" || status === "checked_out"` and used the answer to decide `requestItemId` as well as an error message. Two implementations of one rule with nothing linking them is the shape that produced the edit-diff bug above, and a client that disagrees with the server about which transitions need a holder either blocks a legal one or lets an illegal one reach a refusal it could have explained better.

The predicates are still a second spelling of what `validateStatusInvariants` decides in its `case` labels, because those labels are what make a seventh `ItemStatus` a compile error and cannot be collapsed into a helper without losing that. So `inventory-workflow.test.ts` derives the agreement by asking the rules: for every status the panel can target, `needsHolder` must be true exactly when a holderless transition is refused, and `needsDueAt` true exactly when a dated one is required. The panel keeps its friendlier wording; only the decision is shared.

### An image change is an ordinary edit, and who cleans up after it

`imageUrl` used to be a real exception: `uploadProjectImageAs` wrote the column on its own request, so an image change reached neither this diff nor the edit log. #88 closed that by making the upload store the object and return its key, which the caller then passes to `updateProject` as an ordinary field. `createProjectAs` writes a literal `null` and refuses any key a caller sends (see "What `image_url` may contain" below), so `updateProjectAs` (`src/server/_internal/projects.ts`) is the only place `projects.image_url` is ever set to a key at all. It is not the only place a project image is cleaned up: `hardDeleteProjectAs` drops the last one after deleting the row, through the same `deleteOwnedObject` call, because nothing will ever reference that object again (#159). Both go through that one helper rather than calling storage directly, which is what keeps the refusal of a key outside the row's own prefix in one place. Checkable:

```bash
# no hits: the upload path writes no row at all
grep -n 'update(projects)' src/server/_internal/uploads.ts
```

The cleanup runs after the row write lands, never inside the transaction, because a rollback would otherwise destroy the object the surviving row still points at. `hardDeleteProjectAs` opens no transaction at all, so there it simply follows the row delete. Either way it is scoped to the project's own `projects/<id>/` key prefix: `imageUrl` is client-writable, so an unscoped delete lets a caller point their row at another project's key and have the next save destroy it.

### What `image_url` may contain, and why the check is on the change

One rule, both domains: a write may only CHANGE `image_url` to empty, or to a
single filename directly under the row's own prefix. `assertOwnedKey` in
`src/lib/_internal/storage.ts` is the check, and `KeySpace.owns` is the one
predicate behind it and behind `deleteOwnedObject` (#162).

"Single filename" means one segment of letters, digits, underscore or hyphen,
one dot, an alphanumeric extension. That is looser than the `<uuid>.webp`
`newKey` mints, deliberately: a key naming nothing in the bucket renders a
broken image rather than leaking anything, so demanding a uuid buys nothing and
would force every test to mint one to say anything at all. It is still tighter
than "a name", which is what rejects the traversal below.

Until then the column was validated for length and nothing else, so any
signed-in user could set a project's `imageUrl` to a URL they control, and
every viewer of that project fetched it. The reliable target is not the public
but the staff member reviewing the draft. `img` is not in the markdown
allowlist (`ALLOWED_ELEMENTS` in `src/components/markdown.tsx`) and there is no
CSP anywhere in `src/` or `infra/`, so this was the only field a non-staff user
could use to get an image element rendered, with nothing behind it.

Three things about the shape, each of which is load-bearing:

- **The check is on the change, not on the content.** Real rows hold absolute
  URLs from before the upload flow (the dev seed writes Unsplash links), the
  edit form round-trips the field, and `getPublicUrl` returns any `http(s)://`
  value unchanged by design. Checking content would make every one of those
  rows uneditable. Saving a legacy value back unchanged is not a change, so
  nothing checks it. The consequence, stated rather than discovered: a row that
  already holds a bad value keeps it. Remediating those is a separate job: `scripts/image-url-legacy.mjs` reports them and nulls the ids an operator names, see "Find and clear image URLs the app did not mint" in `DEPLOYMENT.md` (#165).
- **Both create paths refuse any `imageUrl` at all**, through
  `assertNoImageKeyOnCreate` in `src/lib/image-upload-policy.ts`, because the
  key is `<domain>/<id>/` and the id does not exist until the insert does.
  Guarding only the edit path is bypassed by never editing, and `createProject`
  is `authenticated`, not staff. It lives beside the upload policy rather than
  beside `assertOwnedKey` because it needs no `KeySpace`, so it can be a plain
  static import at both call sites instead of the dynamic one every other reach
  into the storage module has to be. Both guards throw the one `INVALID_IMAGE`
  message so the wording has a single home.
- **`owns` is tighter than `startsWith(prefix)`**, which accepts
  `projects/<own-id>/../<other-id>/x.webp`. That is a distinct key in S3 so it
  destroys nothing, and it is not the third-party fetch this issue is about
  either: a browser normalizes the path, so it renders another row's image out
  of this app's own bucket. A content integrity nit on its own. The reason to
  reject it is that both call sites read one predicate, and "inside this space"
  should mean one thing.

This narrows what a permitted writer may put in the column. It moves nothing in
`access-contract.ts`: the column is still writable by the project's proposer or
staff, and by staff only on inventory.

### `commitTransition` is the only writer of `project_status_history`

`performTransitionAs` and `forceTransitionAs` (`src/server/_internal/projects.ts`) keep only their gates: who may act, and which target is reachable. Everything after that is `commitTransition`, which owns the transaction (status update, history row, notifications), then the embedding refresh, then the email. Checkable:

```bash
# one hit, in commitTransition
grep -rn 'insert(projectStatusHistory)' src --include='*.ts' | grep -v __tests__
```

**Read the claim narrowly, because the wider one is false.** This says one writer of the *history table*, not one writer of `projects.status`. `update(projects)` has five legitimate non-status writers (`claim-projects.ts`, `project-embeddings.ts`, `softDeleteProjectAs`, `restoreProjectAs`, `updateProjectAs`), so a grep on that proves nothing. `softDeleteProjectAs` and `restoreProjectAs` write `deleted_at` and send their own notifications without writing history, and they are outside this rule on purpose: neither is a transition. This is deliberately narrower than inventory's "`transitionItem` is the only writer", which can make the broader claim because `update(inventoryItems)` has only two hits in total.

Three ordering rules live in `commitTransition` rather than in a comment a caller has to obey:

- **Notifications go inside the transaction.** Enforced by the type: `recordStatusChangeNotifications` takes a `Tx` as its first parameter.
- **`refreshProjectEmbedding` goes strictly after commit.** Enforced by nothing, and this is the trap: it takes no `tx`, uses the module `db`, re-reads the row, and returns `"skipped"` unless the status is already `published`. Called inside the transaction it does not throw. It silently does nothing, and you get a project that publishes and never embeds.
- **The email goes strictly after commit**, so a failed send cannot undo an approval. `notifyTransitionByEmail` swallows its own errors, so this one fails mildly.

Before this, the two functions shared 56 byte-identical lines including both of those comments, and `forceTransitionAs` had **no** test asserting it wrote a history row, a notification, or an embedding. The equivalence of the two copies was a review question rather than a checked one for as long as they existed. The characterization tests added alongside this change (`projects.integration.test.ts`, `project-embeddings.integration.test.ts`) were written against the old code first, precisely so they could prove the extraction preserved behaviour rather than merely agreeing with the new code.

### `sendEmail` is decided by role in `performTransitionAs`, not by the schema

Skipping a transition's mail is a staff affordance, driven by a checkbox in the staff panel. The decision is made in `performTransitionAs` from the `ActorRole` it already derives, and a non-staff caller's `sendEmail: false` is ignored rather than rejected.

**The schema cannot be the gate here, which is why this differs from inventory's `authority`.** That rule works because `transitionSchema` simply never declares the field, so `z.object().parse` strips it. The same trick does not cover this one. `sendEmail` is carried by three owner-reachable endpoints, and the third is the problem: `performTransition` takes its target status from the request, so one validator serves staff and owners alike and there is no schema to split them by. Splitting `transitionInputSchema` would have fixed `submitProject` and `returnToDraft` and left the generic endpoint open.

What it was protecting, before the gate existed: an owner can reach `submitted` from `draft` and from `changes_requested`, both of which mail `EMAIL_REVIEW_INBOX`, and a proposer passing `sendEmail: false` suppressed it. That notice is the **only** push telling staff a project arrived. `recordStatusChangeNotifications` can address exactly one recipient, `project.proposerId`, so no staff in-app notification exists or is meant to; the pull surface is the "Awaiting review" count on `/admin` (`routes/_authed/admin/index.tsx:152`). The email also fails quietly twice over: an unset `EMAIL_REVIEW_INBOX` only warns, and `notifyTransitionByEmail` swallows its own errors on purpose so a failed send cannot undo an approval.

`forceTransitionAs` needs no equivalent; it throws for a non-staff viewer before it reaches `commitTransition`. `TransitionOptions.sendEmail` is untouched and stays available to the nine integration call sites that use it to keep mail out of the suite.

### An unset `BETTER_AUTH_URL` logs, it no longer just drops the mail

Transition emails carry absolute links, because they are followed from a mail client, and the base comes from `BETTER_AUTH_URL`. It used to be optional in the worst sense: `notifyTransitionByEmail` returned early when it was unset, so no mail went out, nothing was logged, and a submitted project sat in a queue nobody had been told about. That is a third quiet failure on top of the two the entry above names, and unlike those two it had no signal at all.

It is required now. `notifyTransitionByEmail` throws when `NotificationConfig.appBaseUrl` is null, and the throw lands in the function's own `catch`, which does `console.error` naming the variable. The function still cannot throw at its caller, which is the property `performTransitionAs` depends on.

**The check is an `if` in the body, not a throw inside `buildNotificationConfig`, and that is not stylistic.** The config arrives as a default parameter, and a default parameter is evaluated before the function body, so a throw in the builder would skip the `try` entirely and reach `projects.ts`. That call happens after the transition is committed, so an escaping error would report a failure on an approval that had already succeeded.

`EMAIL_REVIEW_INBOX` is deliberately not required and still only warns: an unset inbox costs staff a notification, while an unset base URL breaks every transition email including the ones to proposers. In production `BETTER_AUTH_URL` no longer gets as far as this log line: it is one of the seven variables `src/lib/_internal/startup-config.ts` refuses to boot without (#137), so this entry describes development and test.

### Proposer linking is by email; `proposer_id` is canonical

A project's proposer is either linked to an account (`proposer_id`, a nullable FK) or pending (`proposer_email` set with no account yet). Email is the link key; `proposer_id` is the source of truth once an account exists. Staff set it through the proposer field on the project form (`ProposerPicker`, see below); the server resolves the email to an account id on every write via `resolveProposerId` (`src/server/_internal/projects.ts`), and a non-staff request carrying `proposer_email` is ignored, not honored. `proposer_id` is never accepted from the client.

Two emails, do not conflate them: `proposer_email` is the private link key (stripped from public reads, see above); `contact_email` is a separate, manually entered, publicly visible field. The edit form prefills `proposer_email` from the linked account's CURRENT email (`getProposerForEditAs` / `getProposerForEditImpl` in `src/server/_internal/projects-queries.ts`, returning a `ProposerForEdit`) so an untouched staff save re-resolves to the same proposer; a blank email on create defaults the proposer to the creator, while clearing it on edit is an explicit unlink. Once an account is linked, the field is read-only: `ProposerPicker` (`src/components/proposer-picker.tsx`) locks the input and routes any change through a "Re-assign" modal instead of letting staff retype the address; picking a new account, or explicitly unlinking, in that modal unlocks the field, because the lock is keyed off whether the current value still equals a mount-time snapshot of the saved one. That means it is the divergence that unlocks, not the act: retyping the original address exactly re-locks the field, which is harmless but surprising if you are looking for it. The design spec's Phase B listed a "live back-fill hook" as future work alongside the OSU ONID provider itself; the hook is built now, see "Projects are claimed only by a verified address" below, and it applies to any provider whose create hook reports `emailVerified`. The ONID provider is configured now too (`src/lib/auth.ts`, see the Better Auth section above), and it always reports `emailVerified`, so an ONID sign-in claims at creation; what remains future work is only confirming the claim shape against a real ID token. See `docs/ONID-SSO.md` and `docs/superpowers/specs/2026-06-07-proposer-account-linking-design.md`.

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

### Mentorship is two staff-written columns and one derived flag

`projects.student_proposed` and `projects.mentor_email` are written only by
`updateProjectMentorshipAs`. Neither is on `ProjectInput`, so `updateProjectAs`
cannot touch them; keep it that way rather than adding staff branches to the form.
`isSponsored` is not the precedent here: it sits on the shared form and the proposer
edits it.

The mentor is resolved at read time by `mentorNameSql`, a case-insensitive match on
`user.email`. It is a correlated subquery with `LIMIT 1` rather than the `LEFT JOIN` #75
prescribes: a join on `lower(email)` would fan a project out into two rows if two accounts
ever differed only by case, and the subquery lets the four consumers of
`projectSummarySelect` pick it up without touching their joins. There is no `mentor_id`:
mentorship grants no permission, so an id would only be a denormalization.
`seekingMentor` is `student_proposed AND mentor_email IS NULL`, computed in
`seekingMentorSql`, because the public payload does not carry the address and a client
cannot otherwise tell "no mentor" from "a mentor who has not signed up yet". The second
state shows nothing, on purpose. `mentor_email` leaves the server through two staff
reads only: `getProjectMentorship`, and the edit log, whose `oldValues` and `newValues`
record it like any other edited column. Both fragments live in `project-summary.ts` and
ride `projectSummarySelect`, so the admin CSV export, whose column list is
exhaustiveness-checked, carries the three public fields too. See #75.

---

## Amazon Bedrock

This app talks to two different Bedrock endpoints, and almost nothing is shared
between them. Embeddings use `bedrock-runtime` through the AWS SDK
(`src/lib/_internal/bedrock.ts`). AI project review uses `bedrock-mantle`
through a hand-signed `fetch` (`src/lib/_internal/bedrock-mantle.ts`). Treat a
fact about one as saying nothing about the other.

### A blank `BEDROCK_EMBEDDING_DIMENSIONS` is zero, not the default

`buildEmbedConfig` (`src/lib/_internal/bedrock-embed.ts`) resolves the value as
`Number(env.BEDROCK_EMBEDDING_DIMENSIONS ?? "1024")`. `??` catches only
`undefined` and `null`, so a variable set to the empty string skips the default
and reaches `Number("")`, which is `0`. Whitespace behaves the same way. Unset
is the only spelling of "missing" that gets 1024.

**This is worse than a bad request, and that is why it is written down.** The
model id and the dimension count are both interpolated into a sha256 by
`embeddingHash` (`src/lib/embedding-source.ts`), and that hash is stored as
`projects.embedding_source_hash` and compared on every write to decide whether
a project needs re-embedding. A dimension count that changes for a given
environment changes every hash, so every project looks modified and re-embeds
at one paid Bedrock call each. The blank case is pinned by a test rather than
fixed for exactly that reason: whatever the stored hashes were computed with is
what the code has to keep computing until someone migrates them deliberately.

Not a live state. `.env.example` and `infra/ecs.tf` both set the variable
explicitly, so it takes a hand-edit to reach. See #137 for the open question of
which config values should be validated rather than coerced.

### The SigV4 service name is `bedrock-mantle`, not `bedrock`

Signing a Mantle request as `bedrock` produces a well-formed signature that the
endpoint rejects, and the rejection reads as an IAM misconfiguration rather
than a signing bug. The IAM actions are namespaced the same way: Mantle
authorizes `bedrock-mantle:CreateInference`, which `bedrock:InvokeModel` does
not cover. Both statements are on the task role in `infra/iam.tf`.

There is no AWS SDK client for this endpoint. The alternative to signing by
hand is the OpenAI SDK with a long-lived Bedrock API key, which would put a
model credential in the task definition; SigV4 keeps production on the task
role instead.

### Model ids are not portable between the two endpoints

On `bedrock-mantle` the id is bare: `openai.gpt-5.6-luna`. On `bedrock-runtime`
the same model must be named through a cross-region inference profile
(`us.openai.gpt-5.6-luna` or `global.`), because in-region inference is not
offered there for it. Each form is rejected by the other endpoint. `BEDROCK_MODEL_ID`
holds the Mantle form.

The GPT models are also served under `/openai/v1` on Mantle rather than the
endpoint's default `/v1`, so the path is not interchangeable between models
either.

### The Responses API retains inputs and outputs unless you opt out

`store` defaults to `true`, which keeps the request and the response for 30
days. Proposals carry unpublished IP and NDA notes, so `runProjectReview` sends
`store: false` on every call. The Converse path this replaced retained nothing,
so this is a default to hold down, not a feature to enable.

### Reasoning models reject sampling parameters and spend the output budget

`temperature` and `top_p` are incompatible with reasoning mode, so the review
sends neither. Reasoning tokens also burn down `max_output_tokens` before any
visible output appears, which means a ceiling sized only for the answer can be
consumed before the model emits its tool call. That failure arrives as
`status: "incomplete"`, which `parseReviewResponse` reports as its own error
rather than folding into the generic one, because the fix is different.

### A review without a project is authorized on the session alone

`reviewProjectAs` has two authorization paths. With a `projectId` it loads the
project and applies `canEditProject`, unchanged. Without one, the text is
unsaved and belongs to nobody else, so ownership is the wrong question and a
verified session is the whole gate. The submission page (`/projects/new`) takes
the second path, because no row exists until the proposal is saved.

That change removed the only thing bounding spend: you used to need to own a
project to reach a paid endpoint. `assertReviewWithinLimit` replaces it and is
not optional for that reason. It lives in `reviewProjectAs`, not in the
`ForCurrentUser` wrapper, so the integration suite can reach it through the
usual `*As` seam.

The client must omit `projectId` rather than send `undefined`: the input schema
validates it as a uuid when present.

### `ai_review_usage` is both the limiter and the usage log

One row per call that reached Bedrock. The token columns are not decoration:
without them there is no way to answer what a reasoning-effort change costs,
which is the question `BEDROCK_REASONING_EFFORT` raises every time someone
considers turning it up.

What counts, and why:

- **Every attempt that reached Bedrock**, including a truncated or failed one.
  A truncated response is billed in full, so counting only successes would let
  a user spend without limit by repeating a call that fails.
- **Not** a call the limiter refused, and **not** an entirely blank form, which
  short-circuits before the request. `runProjectReview` reports this as
  `called: false`, and metering keys off that rather than off reaching the
  handler.

`runProjectReview` returns a `ReviewRun` rather than throwing on a failed
review, because the failure has to be recorded before it reaches the user. The
caller records, then throws.

Two concurrent requests can both pass the check and overshoot by one. That is
bounded by concurrency and deliberately not locked: this exists to stop a loop,
not to be exact.

Any new table holding per-user counters must be added to `TABLES` in
`src/test/db-reset.ts`. Rows left behind by one test make the next one flaky in
the direction that is hardest to read: a limit that trips when the test expected
room.

### Field length ceilings have one home, and the review enforces them twice

`FIELD_MAX_LENGTHS` in `src/lib/project-review-fields.ts` is the only place the
per-field character caps are written down. `projectFormSchema`, the review server
function's input schema, and the tool schema handed to the model all read from
it. They used to be three independent copies of the same numbers, which is how
the model came to be told nothing about a limit its output had to satisfy.

The prompt states each limit and the tool schema carries `maxLength`, and neither
binds the model. So `parseReviewResponse` drops any suggestion over its field's
cap and keeps the rest of the review. Failing the whole review would throw away
six good suggestions over one long one, and applying it would write text into the
form that fails validation on submit with an error the user did not cause.

### The scope assessment is a second Mantle call, not a second output of the review

`src/server/_internal/scope-assessment-core.ts` is the shape of `project-review-core.ts` with its own tool (`assess_project_scope`), its own prompt, its own effort variable (`BEDROCK_SCOPE_REASONING_EFFORT`, default `high`) and a much lower output ceiling. The two share only the model id and the Mantle client. They are separate on purpose: the review is a proposer's writing assistant and the assessment is staff judgement support, so bundling would make every review pay for reasoning nobody sees. Each has its own limit pair (`AI_REVIEW_LIMIT_*`, `AI_SCOPE_LIMIT_*`) and `ai_review_usage.feature` says which one a row was, which is the only place spend per feature is attributable (#61).

The verdict is stored on `projects` in three columns mirroring the embedding ones (`scope_assessment`, `scope_assessment_source_hash`, `scope_assessment_updated_at`), and the same staleness rule applies: `getScopeAssessmentAs` recomputes the hash of the current text and reports `stale` rather than re-running or hiding. The source includes the program's `term_count`, so changing that goes stale too. None of the three columns enters `projectDetailView` or `projectSummarySelect`: the exact key-set pin in `projects.integration.test.ts` is the enforcement, and `scope-assessment.integration.test.ts` asserts the three keys absent by name after an assessment has been stored. `programs.term_count` is staff-only the same way: `listProgramsImpl` projects the six public columns by name now, rather than a bare `select()`, and `programs.integration.test.ts` pins that key set.

### Function call arguments arrive as a JSON string

A `function_call` item's `arguments` is a string, not an object: parse it
before handing it to Zod. Where the item sits is less certain. The Responses
API spec puts it at the top level of `output`, while the Bedrock tool-use guide
reads it out of an item's `content`, so `findToolCall` looks in both.
