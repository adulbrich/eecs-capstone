# Architecture Review Closeout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the thirteen open issues filed out of the architecture review and the
#93 code review, then raise the CI gate so the integration suite blocks a merge.

**Architecture:** The work is sequenced net-first. Two of the issues (#110, #108) build
executable checks over source structure, and those checks are what make the large moves in
#104 and #105 safe to review, so they land before the moves rather than after. The CI gate
change lands in the same early wave for the same reason: a five-PR namespace split is only
as reviewable as the suite that runs against it. Everything after that is one issue per PR,
ordered smallest blast radius first.

**Tech Stack:** TanStack Start, Drizzle ORM on PostgreSQL, Vitest (unit and integration
configs), Playwright (accessibility), Biome via ultracite, GitHub Actions.

**Spec:** The GitHub issues are the specs. Each carries its own problem statement, plan and
access-and-visibility section, per the repo convention that deferred work goes in an issue
carrying its plan. Issue numbers are cited per task; read the issue before starting the task.
Three tasks (#105, #104, #101) are too large for their issue body to serve as a plan and
carry an explicit spec gate.

## Global Constraints

- Prose contains no emdashes and no emojis. Commit messages, code comments, string
  literals, docs and PR bodies all count. A `--` standing in for a sentence dash is the
  same violation.
- Conventional Commits, lowercase imperative subject, area in parens:
  `refactor(inventory): move overdue scanning out of the namespace file`.
- Keep the body short or leave it out. Never publish a `claude.ai/code/session` link.
- Keep the `Co-Authored-By` trailer the harness supplies.
- Stage files by name. Never `git add -A` or `git add .`.
- Never commit to `main`. One branch and one PR per task below, merged once `verify` is
  green.
- No back-compat shims. This repo is pre-production: delete and restructure rather than
  adding redirects, aliases, re-export barrels or parallel columns.
- `*As` first, `*ForCurrentUser` second, kept adjacent. A helper that needs no viewer
  object takes the `*Impl` name. See `docs/QUIRKS.md:533`.
- `transitionItem` stays the only writer of inventory item status and holder columns.
- Before every commit: `npm run check`, `npm run typecheck`, `npm test`. Run
  `npm run test:integration` when the change touches the database layer.
- Run Vitest with `ulimit -n 8192` set.

**Baseline recorded 2026-08-28 before any task:** `npm test` passes, 73 files, 626 tests.

---

## Wave A: the net, and the gate that enforces it

Nothing in this wave changes application behavior. It exists so waves B and C are
reviewable.

### Task A1: Make the seam convention executable (#110)

`docs/QUIRKS.md:538` documents an audit that prints all 59 `*ForCurrentUser` wrappers
unconditionally and pairs none of them, so it cannot fail. Replace it with a unit test.

**Files:**
- Create: `src/server/__tests__/seam-convention.test.ts`
- Modify: `docs/QUIRKS.md` (the audit passage at the `*As` first bullet)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: nothing later tasks import. The test reads `src/server/_internal/*.ts` off
  disk with `node:fs`, so it needs no imports from the modules under test and cannot be
  broken by a circular import.

- [ ] **Step 1: Write the failing test**

```ts
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const INTERNAL_DIR = join(process.cwd(), "src/server/_internal");
const EXPORTED_FN = /export (?:async )?function (\w+)/g;

function exportedFunctionNames(source: string): string[] {
  return [...source.matchAll(EXPORTED_FN)].map((m) => m[1]);
}

describe("the *As / *Impl seam convention", () => {
  it("gives every *ForCurrentUser wrapper a seam with the same stem in the same file", () => {
    const unpaired: string[] = [];

    for (const file of readdirSync(INTERNAL_DIR).filter((f) => f.endsWith(".ts"))) {
      const names = exportedFunctionNames(
        readFileSync(join(INTERNAL_DIR, file), "utf8")
      );
      const seams = new Set(names.filter((n) => /(?:As|Impl)$/.test(n)));

      for (const wrapper of names.filter((n) => n.endsWith("ForCurrentUser"))) {
        const stem = wrapper.slice(0, -"ForCurrentUser".length);
        if (!(seams.has(`${stem}As`) || seams.has(`${stem}Impl`))) {
          unpaired.push(`${file}: ${wrapper}`);
        }
      }
    }

    // Names the bug rather than reporting a count, per the issue.
    expect(unpaired).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and read the output before assuming it passes**

```bash
ulimit -n 8192 && npx vitest run src/server/__tests__/seam-convention.test.ts
```

This is the step the issue's step 2 asks about: if any wrapper legitimately cannot share a
stem with its seam, the run names it here. Two outcomes, both fine:
- Empty list: stem matching is the right key. Continue.
- A short list: read each one. If the wrapper genuinely cannot share a stem, rename the
  seam so it can (that is what #107 did for three helpers), and only if a rename is wrong
  fall back to a declared exception map with a comment per entry naming why.

Do not weaken the assertion to make it pass.

- [ ] **Step 3: Assert the test itself can fail**

Temporarily rename `listMyBookmarksAs` to `listBookmarkRowsAs` in
`src/server/_internal/bookmarks.ts`, re-run, and confirm the failure names
`bookmarks.ts: listMyBookmarksForCurrentUser`. Revert the rename.

A test over source structure that has never been seen red is the same class of thing as
the grep it replaces.

- [ ] **Step 4: Replace the audit passage in QUIRKS**

In `docs/QUIRKS.md`, delete the fenced `grep -rhoE ...` block and the two sentences framing
it ("All 59 wrappers now have a seam under them ..." through "read the list against the
seams beside them rather than expecting empty output to mean clean"). Replace with:

```markdown
  Every wrapper has a seam under it, one of those two shapes, and
  `src/server/__tests__/seam-convention.test.ts` enforces it: it pairs each
  `*ForCurrentUser` against an `*As` or `*Impl` with the same stem in the same file and
  fails naming any wrapper that has none. It runs in `npm test`, so a wrapper added without
  a seam is a red CI check rather than a convention someone remembers.
```

Do not restate the wrapper count. A number in prose goes stale, which is half of what
#110 is about.

- [ ] **Step 5: Verify and commit**

```bash
npm run check && npm run typecheck && ulimit -n 8192 && npm test
git add src/server/__tests__/seam-convention.test.ts docs/QUIRKS.md
git commit -m "test(server): enforce the *As / *Impl seam convention"
```

- [ ] **Step 6: PR, merge, close #110**

```bash
git push -u origin test/enforce-seam-convention
gh pr create --title "test(server): enforce the *As / *Impl seam convention" \
  --body "Closes #110. Replaces the QUIRKS grep, which printed all 59 wrappers unconditionally and paired none, with a test that pairs each wrapper against a same-stem seam in the same file and fails naming the unpaired ones."
```

---

### Task A2: Declare the access level of every server function (#108)

86 `createServerFn` endpoints across 15 files in `src/server/`, no global middleware, and
nothing stating what any of them allows. #103 fixed two that returned every admin's and
instructor's name, email and role to anonymous callers; they had shipped three months
earlier against a design doc that said staff only.

The issue's central finding is that the level must be **declared, not detected**: a grep
mislabelled seven of seventeen endpoints because the gate is spelled three ways, and it
cannot separate a correctly ungated public read from a gate it failed to recognise.

**Files:**
- Create: `src/server/__tests__/access-contract.ts` (the declared table, not a test file,
  so later work can import it)
- Create: `src/server/__tests__/access-contract.test.ts`
- Modify: `docs/QUIRKS.md` (a new entry under the server section)

**Interfaces:**
- Consumes: `src/server/__tests__/seam-convention.test.ts` establishes the
  read-source-off-disk pattern this task reuses. Nothing is imported across the two.
- Produces: `ACCESS_CONTRACT: Record<string, AccessLevel>` exported from
  `src/server/__tests__/access-contract.ts`, keyed `"<file>.ts:<exportName>"`, with
  `type AccessLevel = "public" | "authenticated" | "staff" | "admin" | "owner-or-staff"`.
  Task D3 and any later audit read this table.

- [ ] **Step 1: Reconcile the endpoint count to 86 before writing anything**

`grep -rho 'createServerFn' src/server/*.ts | wc -l` returns 101 textual occurrences, and
the issue says 86 endpoints. That gap of 15 is unexplained: imports, `.handler()` chains,
re-exports. Resolve it before trusting any regex.

```bash
grep -rn 'createServerFn' src/server/*.ts | grep -v 'import'
```

The regex in step 3 is a guess until this reconciles. **A test that silently enumerates 70
of 86 endpoints is worse than no test, because it reports green.** If the count does not
land on 86, the discrepancy is itself a finding and goes in the PR body.

- [ ] **Step 2: Read each endpoint's gate and write the table**

For each endpoint, open its handler, follow it to the `*As` or `*Impl` it calls, and read
the gate. Write one line per endpoint into `ACCESS_CONTRACT`. This is a reading task and
it is the whole value of the issue; do not infer a level from the function name.

Four of the six endpoints the issue names as genuinely ungated are the category reads,
plus `listProjectCategoriesImpl` and `listProgramsImpl`. Declare those `"public"`
deliberately.

- [ ] **Step 3: Record the one open question the issue raises**

`listProjectCategoriesImpl` takes a project id and returns that project's category names
without checking `canSeeProject`, so an unpublished draft's categories are readable by
anyone holding the id. Do not fix it in this task. Declare it `"public"`, add a
`// TODO(#108-followup)`-free comment naming the exposure (this repo does not use TODO
markers; write the sentence), and file a separate issue linking back to #108. A finding
buried in a table is a finding nobody acts on.

- [ ] **Step 4: Write the test that holds the table to the code**

```ts
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACCESS_CONTRACT } from "./access-contract";

const SERVER_DIR = join(process.cwd(), "src/server");
const SERVER_FN = /export const (\w+) = createServerFn/g;

function declaredEndpoints(): string[] {
  const found: string[] = [];
  for (const file of readdirSync(SERVER_DIR).filter((f) => f.endsWith(".ts"))) {
    const source = readFileSync(join(SERVER_DIR, file), "utf8");
    for (const m of source.matchAll(SERVER_FN)) {
      found.push(`${file}:${m[1]}`);
    }
  }
  return found.sort();
}

describe("the server function access contract", () => {
  it("declares a level for every createServerFn endpoint", () => {
    const undeclared = declaredEndpoints().filter((k) => !(k in ACCESS_CONTRACT));
    expect(undeclared).toEqual([]);
  });

  it("declares no endpoint that does not exist", () => {
    const live = new Set(declaredEndpoints());
    const stale = Object.keys(ACCESS_CONTRACT).filter((k) => !live.has(k));
    expect(stale).toEqual([]);
  });
});
```

`SERVER_FN` must be the shape step 1 reconciled to, not this guess. The first assertion
failing with a long list of names is the signal the regex is wrong, not that the table is
incomplete.

- [ ] **Step 5: Run it, then break it on purpose**

```bash
ulimit -n 8192 && npx vitest run src/server/__tests__/access-contract.test.ts
```

Add a throwaway `export const probeFn = createServerFn(...)` to `src/server/programs.ts`,
confirm the first assertion fails naming `programs.ts:probeFn`, and remove it. A new
endpoint must not be able to ship undeclared.

- [ ] **Step 6: Document it**

Add to `docs/QUIRKS.md`, under the server or workflow section:

```markdown
### Every server function declares its access level

There is no global middleware. Each `createServerFn` endpoint is independently
HTTP-reachable and carries its own authorization or carries none, and the gate is spelled
three ways: `requireUser()` inside the impl, a file-local `getViewer()` delegating to an
`*As(viewer, ...)`, or deliberately absent for public catalog reads. Those are
indistinguishable to a grep, which is how two endpoints returning every admin's email
survived three months (#103).

So the level is declared, in `src/server/__tests__/access-contract.ts`, and
`access-contract.test.ts` fails if an endpoint exists with no declaration or a declaration
names an endpoint that does not. Adding an endpoint means adding its line. Answer what it
should allow rather than copying the level of the function above it.
```

- [ ] **Step 7: Verify, commit, PR**

```bash
npm run check && npm run typecheck && ulimit -n 8192 && npm test
git add src/server/__tests__/access-contract.ts src/server/__tests__/access-contract.test.ts docs/QUIRKS.md
git commit -m "test(server): declare the access level of every server function"
```

PR body closes #108 and links the new follow-up issue from step 2.

---

### Task A3: Remove the flake risk from the integration suite (#22)

`recommended-sort.integration.test.ts` failed 2 of 6 full-suite runs, passed in isolation
every time, and has passed 8 consecutive runs since. The issue's own conclusion is that the
next occurrence should be observed in CI rather than guessed at, so **this task does not
try to fix a bug that is not currently reproducible.** It removes the one condition the
investigation identified as able to produce the observed 1.2s against 11s.

The hypothesis: `BEDROCK_EMBEDDINGS_ENABLED` failing open reaches the AWS SDK, which walks
the credential chain and pays an IMDS probe with retries.

**Files:**
- Modify: `.github/workflows/ci.yml` (the integration job's `.env.local` heredoc)
- Modify: `vitest.integration.config.ts` or the integration setup file, whichever owns env
- Modify: `docs/QUIRKS.md` if the integration-test section documents the env contract

- [ ] **Step 1: Find where the integration suite decides the kill switch**

```bash
grep -rn 'BEDROCK_EMBEDDINGS_ENABLED' src/ scripts/ .github/ vitest.integration.config.ts
```

- [ ] **Step 2: Set it explicitly off in CI and in the integration config**

Add `BEDROCK_EMBEDDINGS_ENABLED=false` to the integration job's `.env.local` heredoc in
`.github/workflows/ci.yml`, with a comment naming why:

```yaml
          # Explicitly off, not merely unset: #22's investigation found that a
          # failed-open read reaches the AWS SDK, which walks the credential
          # chain and pays an IMDS probe with retries. That is seconds per call,
          # which fits the 11s the flaky run took against 1.2s in isolation.
          BEDROCK_EMBEDDINGS_ENABLED=false
```

- [ ] **Step 3: Assert it, so the condition cannot come back silently**

In the integration suite's setup, fail fast if the switch is anything but off. An
assertion in setup is cheaper than another six-run bisect.

- [ ] **Step 4: Run the integration suite twice and compare durations**

```bash
docker compose up -d
ulimit -n 8192 && npm run test:integration
ulimit -n 8192 && npm run test:integration
```

Record the `recommended-sort` file's duration both times in the PR body. Two green runs is
not proof the flake is gone and the PR body must say so; the issue stays open until CI has
observed a run, per its own "next step".

- [ ] **Step 5: Commit and PR**

Comment on #22 with the durations rather than closing it. This task earns the right to
make `integration` a required check; it does not resolve the issue.

---

### Task A4: Require the integration job to merge

Only `verify` is a required status check on `main` today (ruleset `20613762`), so the
integration and accessibility jobs run on every PR and a red one merges anyway. The
decision taken: require `verify` and `integration`; accessibility stays advisory.

**Files:** none in the repo. This is a GitHub ruleset change.

- [ ] **Step 1: Read the current ruleset and save it**

```bash
gh api repos/adulbrich/eecs-capstone/rulesets/20613762 > /tmp/ruleset-before.json
```

- [ ] **Step 2: Confirm A3 is merged and the integration job is green on main**

Do not add a required check that is currently failing; it locks the repo.

```bash
gh run list --branch main --workflow CI --limit 5
```

- [ ] **Step 3: Add the check**

```bash
gh api --method PUT repos/adulbrich/eecs-capstone/rulesets/20613762 \
  --input /tmp/ruleset-after.json
```

where `ruleset-after.json` is `ruleset-before.json` with the `required_status_checks`
rule's parameters changed from `[{"context":"verify"}]` to
`[{"context":"verify"},{"context":"integration"}]`.

**This is an outward-facing change to a shared repository setting. Confirm with the user
immediately before running it, and show them the diff.**

- [ ] **Step 4: Verify against a real PR**

Open a throwaway PR with a deliberately failing integration assertion, confirm merge is
blocked, close it. A required check nobody has seen block a merge is a setting, not a gate.

---

## Wave B: the small refactors, one PR each

Ordered smallest blast radius first. Each is independently revertible and none blocks
another, so they can be reordered freely if one turns out larger than its issue suggests.

### Task B1: Drop useAdminTable's forwarded options (#97) [done, PR #118]

The issue is a judgement call filed so the question is answered once. It offers two
resolutions, drop `data` and `getRowId` back to the JSX or keep them and document why,
and leans toward keeping them. **The opposite one shipped**, because the issue's reason
for keeping them does not survive checking.

That reason: `data` fixes `TRow` so `getRowId` infers, so removing it costs a row-type
annotation at seven call sites. True only if `getRowId` stays behind. Removing both takes
`TRow` out of the hook entirely, `AdminDataTable` anchors the row type from its own `data`
prop, and all seven routes typecheck with no annotation. Each route is an exact wash, two
lines out of the hook call and two into the JSX.

`serverSorted` stays, and is the one option the hook takes without reading. The docblock
says so.

- [x] **Done in PR #118.** Do not re-apply the docblock this task originally carried; it
  argued for the resolution that was rejected, and named a generic that no longer exists.

---

### Task B2: Restore search-schema checking on useAdminTable's navigate (#96)

Before #93 each route inlined the reducer against its own `useNavigate({ from })`, so
TanStack Router checked the merged object against that route's `validateSearch` output.
The hook now types it `Record<string, unknown>` and nothing checks it.

No bug today: the `resetPageOnSort` branch at `use-admin-table.ts:87` is opt-in and only
`/admin/users` opts in, whose schema does declare `page`. What is gone is the compiler
stopping the next route from opting in without one.

The issue names option 1 as the one to attempt and option 2 as the fallback. Attempt in
that order; do not skip to option 3.

**Files:**
- Modify: `src/lib/use-admin-table.ts:14-17` and the hook signature
- Modify: the seven `/admin/*` route files that call it, if inference needs help
- Modify: `src/lib/__tests__/use-admin-table.test.tsx`

- [ ] **Step 1: Make the navigate type generic over the route's search type**

```ts
type AdminNavigate<TSearch> = (opts: {
  replace?: boolean;
  search: (prev: TSearch) => TSearch;
}) => unknown;
```

and thread `TSearch` through the hook, inferred from the `search` option the route already
passes.

- [ ] **Step 2: Typecheck, and read what breaks**

```bash
npm run typecheck
```

If inference fights (the issue predicts it might), fall back to option 2: constrain
`resetPageOnSort` so it is only accepted when `TSearch` has a `page`. That is narrower and
targets the one failure actually named. **Do not reach for `as never` or `as any`.** The
issue records that the first attempt in #93 needed three `as never` casts and that this was
judged worse, because a cast silences checking everywhere rather than at one boundary.

- [ ] **Step 3: Prove the type actually rejects the bad case**

Temporarily set `resetPageOnSort: true` on an `/admin/*` route whose search schema has no
`page`, confirm `npm run typecheck` fails, revert. The existing unit test covers the
branch's logic but, as the issue says, a test cannot see which routes opted in. The
compiler error is the deliverable here, so see it.

- [ ] **Step 4: Verify and commit**

```bash
npm run check && npm run typecheck && ulimit -n 8192 && npm test
```

PR closes #96 and says in one line which option was taken and why.

---

### Task B3: Enforce AdminDataTable's column invariants (#94)

Three rules live only in prose, and each fails quietly in a way that reads as a styling
oddity:

1. A non-text column must set its own `sortingFn`, or it sorts as a locale-aware string.
   A `Date` column silently sorts as text.
2. An `accessorFn` must return `undefined`, not `null`, for `sortUndefined: "last"`.
3. At most one column may set `cardHeader`, or mobile renders two card header strips.

The issue splits these deliberately: rule 1 is worth real type work, rules 2 and 3 are
better served by a development-time runtime assertion plus a unit test, since both are
about a whole column list rather than one column.

**Files:**
- Modify: `src/components/` (wherever `AdminColumn<T>` and `AdminDataTable` live; find with
  `grep -rn 'AdminColumn' src/`)
- Create: a `defineAdminColumns<T>()` builder if the check in step 1 says yes
- Create: `src/components/__tests__/admin-columns.test.tsx`
- Modify: `docs/UI-CONVENTIONS.md`

- [ ] **Step 1: Check whether the existing builder pattern carries over**

The issue asks this first, and it decides the shape of the whole task:

```bash
grep -rn 'defineCsvColumns' src/
```

`defineCsvColumns<T>()` gives compile-time exhaustiveness against a projection today. If a
`defineAdminColumns<T>()` in the same shape can carry all three rules, write that. If not,
do rule 1 as a discriminated `AdminColumn` and rules 2 and 3 as assertions.

- [ ] **Step 2: Make rule 1 a compile error**

A discriminated `AdminColumn` that requires `sortingFn` whenever the accessor's return type
is not `string`. Prove it: add a `Date` column with no `sortingFn` to one of the six column
lists, confirm `npm run typecheck` fails, revert.

- [ ] **Step 3: Make rules 2 and 3 a test failure**

```ts
it("rejects a column list with two cardHeader columns", () => {
  expect(() =>
    defineAdminColumns<Row>([
      { id: "a", header: "A", cardHeader: true, accessorFn: (r) => r.a },
      { id: "b", header: "B", cardHeader: true, accessorFn: (r) => r.b },
    ])
  ).toThrow(/at most one cardHeader/i);
});

it("rejects an accessorFn returning null, which sortUndefined does not special-case", () => {
  expect(() =>
    defineAdminColumns<Row>([
      { id: "a", header: "A", accessorFn: (r) => r.maybe ?? null },
    ])
  ).toThrow(/undefined, not null/i);
});
```

Rule 2 cannot be caught by inspecting the function, so catch it on the value: run each
`accessorFn` over the rows at render time in development and throw on `null`. The trap is
already documented in a comment at `src/routes/_authed/admin/inventory/index.tsx`, which is
where someone hit it; move that comment's content into the error message.

- [ ] **Step 4: Convert all six column lists to the builder**

Find them: `grep -rln 'AdminColumn' src/routes/`. This is the step that proves the builder
is usable rather than merely written.

- [ ] **Step 5: Update UI-CONVENTIONS**

Change the three rules from prose to a sentence saying they are enforced, and by which
mechanism, so the next reader does not re-document them as conventions.

- [ ] **Step 6: Verify and commit**

```bash
npm run check && npm run typecheck && ulimit -n 8192 && npm test && npm run test:accessibility
```

The a11y suite renders these tables, so run it. PR closes #94.

---

### Task B4: Remove the unused projects.program_manager_id column (#95)

No writer anywhere. Four references, none a write. The column carries
`onDelete: "restrict"` into `user.id`, which puts it in the FK table in QUIRKS and makes it
look like a reason a user deletion can fail; that cost a wrong recommendation while
designing #84.

**Files:**
- Modify: `src/db/schema.ts:125-127`
- Create: `drizzle/<generated>.sql`
- Modify: `src/server/_internal/projects-queries.ts:231`
- Modify: `src/routes/_authed/admin/projects/index.tsx:336-339`
- Modify: `src/server/__tests__/delete-user-script.integration.test.ts:188`
- Modify: `docs/QUIRKS.md` (the FK table row)

- [ ] **Step 1: Verify there is genuinely no writer, including a spread into an insert**

```bash
grep -rn "programManagerId\|program_manager" src/ scripts/
```

Expect exactly the references listed above. The issue asks for this check explicitly
because a form object spread straight into an insert would not show as a named write. If
anything else appears, stop and report before dropping.

- [ ] **Step 2: Repoint the integration test at a real restrict edge, in its own commit**

`delete-user-script.integration.test.ts:188` sets this column to exercise the restrict
edge. **Do not delete the assertion.** Pick one of the nine remaining restrict edges from
the FK table in QUIRKS and rewrite the case against it.

**Commit this alone, passing against the current schema, before the column is dropped.**
Bundling it with the drop means a bisect lands on one commit where the test rewrite and the
schema change are indistinguishable as the cause.

```bash
ulimit -n 8192 && npx vitest run --config vitest.integration.config.ts src/server/__tests__/delete-user-script.integration.test.ts
git add src/server/__tests__/delete-user-script.integration.test.ts
git commit -m "test(users): exercise the restrict edge on a column that has a writer"
```

- [ ] **Step 3: Drop the column and generate the migration**

```bash
npm run db:generate
```

Read the generated SQL. Per QUIRKS, FK-rule and tsvector migrations are hand-authored; a
plain column drop should not need editing, but check.

- [ ] **Step 4: Remove the read and the CSV column**

The CSV header row on the admin projects export loses "Program manager ID". That is the
only user-visible effect and the PR body should say so.

- [ ] **Step 5: Remove the FK table row in QUIRKS**

- [ ] **Step 6: Migrate and run the full suite**

```bash
npm run db:migrate
npm run check && npm run typecheck && ulimit -n 8192 && npm test && npm run test:integration
```

PR closes #95.

---

### Task B5: Add the categories unique index (#99)

`categories` has no unique index, so two rows may carry identical `name`, `domain` and
`type`. Today only staff create categories. #31 gives the model the ability to create them
on every submission at 100+ projects a term, so this should land before #31's creation path.

The index:

```
UNIQUE (domain, coalesce(type, ''), lower(name))
```

Each detail matters and a plain `UNIQUE (domain, type, name)` gets all three wrong:
- `coalesce(type, '')` because `type` is nullable and Postgres treats NULLs as distinct, so
  every inventory category (always `type = null`) would be unconstrained. `NULLS NOT
  DISTINCT` is the other spelling on PG15+; pick one and comment why.
- `lower(name)` because "Robotics" and "robotics" are the same category.
- `domain` in the key so a project category and an inventory category may share a name.

**Files:**
- Modify: `src/db/schema.ts:71-89`
- Create: `drizzle/<generated>.sql`, hand-edited to add the dedupe step
- Create or modify: `src/server/__tests__/categories.integration.test.ts`
- Modify: `docs/QUIRKS.md` if it documents the categories table

- [ ] **Step 1: Write the five integration cases first, and watch them fail**

```ts
it("rejects a second category with the same domain, type and name");
it("allows the same name in different domains");
it("rejects a name differing only in case");
it("rejects two inventory categories with the same name and type = null");
it("leaves a project that carried both duplicates carrying the survivor exactly once");
```

The fourth is the case a plain unique index lets through, so it is the one that proves the
`coalesce` is doing work. Write real bodies, not names; run them and see four fail.

- [ ] **Step 2: Add the index to the schema and generate**

- [ ] **Step 3: Hand-author the dedupe step ahead of the index**

Creating the index fails if duplicates exist. For each duplicate group: keep the oldest row
by `created_at`, repoint `project_categories` and `inventory_item_categories` at it, delete
the rest. **Repointing must tolerate a project already carrying both rows**: the junction
tables have composite primary keys and a naive `UPDATE` violates them. An
`INSERT ... ON CONFLICT DO NOTHING` followed by a `DELETE` of the loser rows is the shape
that survives that.

- [ ] **Step 4: Prove the dedupe on real duplicates**

Seed two duplicate categories and a project carrying both, run `npm run db:migrate`, and
confirm the fifth test passes. A dedupe migration that has only ever run against clean data
is untested.

- [ ] **Step 5: Verify and commit**

```bash
npm run db:migrate
npm run check && npm run typecheck && ulimit -n 8192 && npm test && npm run test:integration
```

PR closes #99 and mentions the ordering constraint against #31.

---

### Task B6: Re-check visibility when reading bookmarks (#106 piece 1 only)

**Piece 1 only. #106's table (piece 2) stays open**: four of its eight columns need #72,
#75 and #78, and the issue itself says the visibility fix should ship first, alone if
needed.

`addBookmarkAs` gates on `canSeeProject` and its comment names the risk. `listMyBookmarksAs`
re-checks nothing, filtering on `deletedAt` alone (`bookmarks.ts:90-92`). So the check runs
once, at bookmark time, and the bookmark then behaves as a permanent capability: a project
published when a student saved it and later pushed back to `changes_requested` keeps
rendering for that student, including a description the proposer has since rewritten.

Not a guessed-id leak, the write gate prevents that. A stale-authorization disclosure.

**Files:**
- Modify: `src/server/_internal/bookmarks.ts:77-92`
- Modify: `src/server/__tests__/bookmarks.integration.test.ts`

**Interfaces:**
- Consumes: `canSeeProject(project: VisibleProject, viewer: Viewer)` from
  `#/lib/project-visibility`, already imported in this file.
- Produces: `listMyBookmarksAs` keeps its `{ rows }` return shape and its row fields
  unchanged. Callers do not move.

- [ ] **Step 1: Write the failing test**

Bookmark a published project as a student, transition it to `changes_requested`, and assert
it is absent from `listMyBookmarksAs`. Then assert a staff viewer and the proposer still see
their own non-published bookmarked project, which is why the fix filters through
`canSeeProject` rather than a hardcoded status list.

- [ ] **Step 2: Run it and see it fail**

```bash
docker compose up -d
ulimit -n 8192 && npx vitest run --config vitest.integration.config.ts src/server/__tests__/bookmarks.integration.test.ts
```

- [ ] **Step 3: Select the columns canSeeProject needs, without widening the shared projection**

`VisibleProject` requires `id`, `proposerId`, `status`, `deletedAt` and `notes`.
`projectSummarySelect` carries `id` and `status` only, and it is deliberately narrow:
its docblock says the public listing and "my projects" share it and that proposer identity
is staff information. **Do not widen it.** Select the extra columns locally in this query
and drop them before returning.

**Keep the `isNull(projects.deletedAt)` predicate.** It is tempting to delete it now that
`canSeeProject` also considers `deletedAt`, but the two do not agree: `canSeeProject`
returns `true` for staff *before* it looks at `deletedAt`, so dropping the SQL predicate
would start showing soft-deleted projects in a staff member's bookmark list, which they do
not see today. That is a behavior change nobody asked for, in a task whose whole point is a
narrow authorization fix. Keeping both means the filter only ever removes rows.

```ts
export async function listMyBookmarksAs(viewer: BookmarkViewer) {
  const rows = await db
    .select({
      ...projectSummarySelect,
      bookmarkedAt: projectBookmarks.createdAt,
      // Selected to decide visibility, dropped before returning: the shared
      // projection stays narrow because proposer identity is staff information.
      proposerId: projects.proposerId,
      deletedAt: projects.deletedAt,
      notes: projects.notes,
    })
    .from(projectBookmarks)
    .innerJoin(projects, eq(projectBookmarks.projectId, projects.id))
    .leftJoin(programs, eq(projects.programId, programs.id))
    // A project soft-deleted after it was bookmarked drops out of the listing
    // rather than rendering as a dead row. Kept alongside the canSeeProject
    // filter below, not replaced by it: that check passes staff before it
    // reaches deletedAt, so removing this would newly show staff soft-deleted
    // bookmarks.
    .where(
      and(eq(projectBookmarks.userId, viewer.id), isNull(projects.deletedAt))
    )
    .orderBy(desc(projectBookmarks.createdAt));

  // The check runs at read time, not only at bookmark time. Without this a
  // bookmark is a permanent capability: a project pushed back to
  // changes_requested after it was saved keeps rendering, description and all.
  // Filtering through canSeeProject rather than a status list keeps the rule in
  // one place and still shows a proposer or staff member their own draft.
  const visible = rows.filter((row) =>
    canSeeProject(row, { id: viewer.id, role: viewer.role ?? null })
  );

  return { rows: visible.map(toBookmarkRow) };
}
```

- [ ] **Step 4: Drop the three helper columns without tripping the linter**

A rest-sibling destructure (`({ proposerId, deletedAt, notes, ...row }) => row`) creates
three bindings nothing reads, which Biome's `noUnusedVariables` may reject. Check
`docs/QUIRKS.md` for which rules ultracite relaxes and why before assuming either way:

```bash
grep -n -i 'noUnusedVariables\|relaxed' docs/QUIRKS.md
```

If it is not relaxed for rest siblings, write `toBookmarkRow` as an explicit projection
instead of a destructure. An explicit builder is the better shape here regardless, because
it makes the returned field list readable at a glance, which is the same property the
`listMyItemsAs` "names every field it returns" test exists to protect.

- [ ] **Step 5: Run the tests, then the whole integration suite**

The bookmark row survives, so a republished project reappears. Assert that too.

- [ ] **Step 6: Commit and PR**

```bash
git add src/server/_internal/bookmarks.ts src/server/__tests__/bookmarks.integration.test.ts
git commit -m "fix(bookmarks): re-check project visibility when listing bookmarks"
```

PR body: does **not** close #106. Say "Addresses #106 piece 1. Piece 2, the table, stays
open pending #72, #75 and #78." Comment on #106 with the same.

---

### Task B7: Derive the status unions from the pgEnums (#102)

Three vocabularies are written out twice with nothing linking the copies. A value added to
one and not the other is either a row Postgres accepts that the app cannot name, or a
status the app hands to a column that rejects it at runtime.

| Vocabulary | Database | TypeScript |
| --- | --- | --- |
| project status | `projectStatusEnum` (`src/db/schema.ts:31`) | `Status` (`src/lib/project-workflow.ts:1`) |
| inventory item status | `inventoryItemStatusEnum` (`schema.ts:325`) | `ItemStatus` (`src/lib/inventory-visibility.ts:23`) |
| request line status | `inventoryRequestItemStatusEnum` (`schema.ts:334`) | `RequestLineOutcome` (`src/lib/inventory-workflow.ts`), a subset |

`src/server/_internal/categories.ts:20` already shows the pattern:

```ts
type CategoryDomain = (typeof categoryDomainEnum.enumValues)[number];
```

- [ ] **Step 1: Answer the bundle question before writing anything**

This is the gate the issue names and it decides whether the task is a rename sweep or a
wider change. `src/lib/*` is pure and client-safe by design and `project-workflow.ts`
currently imports nothing at all. Deriving from `enumValues` means those modules import
`src/db/schema.ts`, which pulls `drizzle-orm` into the client bundle.

```bash
npm run build
npm run check:compression
```

Record the client bundle size. Then make the change on one vocabulary only, rebuild, and
compare. `schema.ts` opens no connection and the import is type-only at the use sites, so
it may tree-shake to nothing; it may also not.

- [ ] **Step 2a: If the bundle is unchanged, do the sweep**

Derive all three unions, delete the hand-written copies, and delete
`src/lib/__tests__/workflow-vocabularies.test.ts`, which the issue says becomes redundant
once the duplication is unrepresentable. Do not keep it "just in case": that is the shim
rule.

- [ ] **Step 2b: If the bundle grows, stop and report**

The alternative is a shared vocabulary module both the schema and the lib modules import,
which is a wider change. Bring the bundle numbers to the user and let them choose rather
than picking unilaterally. Do not add a runtime schema validator dependency; the issue
rules that out explicitly.

- [ ] **Step 3: Verify and commit**

```bash
npm run check && npm run typecheck && ulimit -n 8192 && npm test && npm run test:integration && npm run build
```

PR closes #102, links #98 and #100, and states the bundle delta either way.

---

## Wave C: the large refactors

Both of these are too large for their issue body to serve as a plan. Per
`docs/QUIRKS.md:531`, they get a spec then a plan then an implementation, and the plan is
what gets executed.

### Task C1: Write the spec and plan for the config seam (#105)

Nineteen environment variables across ten files, read inline at the point of use, and only
one of them (`src/db/index.ts:9`) fails loudly when missing. `auth.ts:97-98` and `:150-151`
do `process.env.GITHUB_CLIENT_ID ?? ""`, so a missing credential becomes an empty string and
a provider that fails at sign-in rather than at boot.

Two readers already take `env` as an argument and are unit-tested against literals with no
AWS and no docker: `buildS3Config(env)` (`src/lib/_internal/storage.ts:19`) and
`buildBedrockConfig(env)` (`src/lib/_internal/bedrock.ts:19`). The plan extends that shape
rather than inventing one.

- [ ] **Step 1: Write `docs/superpowers/specs/2026-08-<dd>-config-seam-design.md`**

It must settle, at minimum: which variables are required versus optional per subsystem;
what "required" means for a subsystem that is not in use (Bedrock is behind a kill switch);
whether the throw happens at module load or at first call, and what that does to the
integration suite, which boots modules without a full environment.

- [ ] **Step 2: Write the plan, one builder per subsystem, `auth.ts` first**

`auth.ts` has the most reads and the most damaging silent fallbacks, so it goes first and is
its own PR.

- [ ] **Step 3: The last task in that plan asserts the config against DEPLOYMENT.md**

Once every read goes through a builder, the union of their inputs answers "what does this
app need to run", and a test can hold `DEPLOYMENT.md` and `infra/` to it. That is the
payoff the issue names and it should not be dropped as a nice-to-have.

**Do not** add a runtime schema validator as a dependency. The issue rules it out: the
builders are pure functions and the tests pass literals.

---

### Task C2: Write the spec and plan for the inventory namespace split (#104)

`src/server/_internal/inventory.ts` is 1,650 lines and 38 exported functions covering five
subsystems that change for unrelated reasons. The projects domain is already split this way
and is the precedent.

The issue gives the seams with line ranges and the order to do them in, smallest blast
radius first: overdue scanning, cart, request lifecycle, holdings reads, then catalog keeps
the filename. **Five PRs, not one.** Each `*ForCurrentUser` wrapper travels with its `*As`.

Constraints that must appear verbatim in the plan:
- `transitionItem` stays the only writer of item status and holder columns.
- Every new file goes under `_internal/`; client-importable wrappers in
  `src/server/inventory.ts` dynamically import the impl.
- No re-export barrel to soften the move. That is the shim rule.
- `listMyItemsAs` has a "names every field it returns" test that must keep passing
  **unedited**. If it needs editing, the move was not faithful.
- The integration suite is the evidence the split is faithful, so it runs on every one of
  the five PRs.

Tasks A1 and A2 are the reason this is safe: the seam test catches a wrapper that loses its
seam in transit, and the access contract catches one that loses its gate.

---

## Wave D: test coverage

### Task D1: Decide the scope of route and component unit tests (#101)

`src/routes` (5,779 lines) and `src/components` (9,522 lines) have no unit tests at all,
against `src/server` at 6,727 lines of implementation to 8,468 of test.

The issue opens with a decision that changes the size of the work considerably: whether
route modules are testable in isolation under TanStack Start, or whether route-level
coverage properly belongs to #23 and this issue scopes down to components only.

- [ ] **Step 1: Answer it with a spike, not an opinion**

Write one throwaway test against one route module's search-param derivation. If it needs a
router harness, a memory history and a query client to render at all, that is the answer:
scope to components and hand routes to #23.

- [ ] **Step 2: Write the plan against whichever scope survived**

The issue names the highest-value targets, which carry logic rather than markup:
`AdminDataTable` and `useAdminTable`'s consumers, `inventory-lifecycle-panel.tsx` (which
pre-checks two transition rules client-side and renders server error messages verbatim),
the form components with validators, and route modules with non-trivial `loader` /
`beforeLoad` derivation.

`@testing-library/react` and jsdom are already set up and used by
`src/lib/__tests__/use-admin-table.test.tsx`, so there is no tooling to add.

Note that Task B3 already delivers the `AdminDataTable` column tests; do not duplicate them.

---

### Task D2: Write the E2E spec (#23)

Labelled `ready-for-human` and the issue says explicitly that it needs its own spec naming
the flows and what each asserts, because "without that it becomes a suite that passes
without asserting much, which is worse than no suite because it looks like coverage".

The flows the issue names: request an item then staff approve, collect and return it;
propose a project, submit, review, publish; upload an image and see it render.

The smoke subset that runs in CI on every push must be much smaller than full PRD coverage.

- [ ] **Step 1: Bring the flow list to the user before writing the suite**

This is the one task in the plan that should not be executed straight through. Its own
issue asks for a human decision on scope first.

---

## Out of scope, and why

- **#109, staff edit notification.** Has a literal "Decisions needed before this is
  implementable" section with three product questions: which edits notify, which channel,
  and whether image edits count (they cannot today, per #88). Comment on the issue naming
  the three questions as the blocker and leave it open.
- **#106 piece 2, the bookmarks table.** Four of eight columns need #72, #75 and #78.
- **#22 closure.** Task A3 removes the identified flake condition and records durations.
  The issue closes when CI observes a run, per its own next step.

---

## Self-review notes

- Every issue in the agreed scope maps to a task: #110 to A1, #108 to A2, #97 to B1, #96 to
  B2, #94 to B3, #95 to B4, #99 to B5, #106 piece 1 to B6, #102 to B7, #105 to C1, #104 to
  C2, #101 to D1, #22 to A3, #23 to D2.
- Two tasks carry a stop-and-report branch rather than a predetermined outcome (B7 step 2b
  on the bundle size, D1 step 1 on route testability). Both are gates the issues themselves
  name, not deferred decisions.
- Tasks C1, C2, D1 and D2 produce a spec and a plan rather than code, which is the repo's
  documented workflow for work of that size. Their implementation plans are written when
  they are reached, against what the codebase looks like then.
