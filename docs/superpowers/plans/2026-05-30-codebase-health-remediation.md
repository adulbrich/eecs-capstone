# Codebase Health Remediation Implementation Plan

> **Status (verified 2026-06-07):** ✅ **Implemented and shipped.** Verified against the codebase; all deliverables exist. The `- [ ]` checkboxes below were never ticked during execution; they are stale, not a sign of incomplete work.


> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the latent type-safety, linting, CI, and documentation gaps found in the 2026-05-30 codebase review, migrate linting to Ultracite, and adopt Ultracite + context7 in the agent workflow, without changing runtime behavior.

**Architecture:** The app builds and ships today. Every problem here is invisible in the normal workflow because three guardrails are missing: a `typecheck` script, a clean lint scope, and CI. This plan adds those guardrails, migrates Biome to the Ultracite preset, fixes the real defects the guardrails expose, bumps Node to 25, and corrects documentation drift. Phases are ordered so each one leaves the tree green.

**Tech Stack:** TanStack Start (React 19 SSR), TanStack Router/Query/Form, Drizzle ORM + Postgres, Better Auth, Biome 2.4.5 via Ultracite, Vitest 4, Playwright (a11y), AWS Bedrock + S3.

**Decisions baked in from the maintainer (2026-05-30):**
1. Node target is the **latest LTS, 24.16.0** (nvmrc, nixpacks, CI). Maintainer uses nvm. Local toolchain is 24.15.0; build/test verified there.
2. **Keep `"latest"`** version specifiers for `@tanstack/*` and nitro for now. No dependency pinning task.
3. Validate the CI workflow locally with **`act`** (installed) before committing.
4. Docker DB + S3 are running, so build and migrations can be exercised.
5. **Do not** isolate the integration-test database now. Add a README TODO for the future instead.
6. Remove faulty/absurd information from `QUIRKS.md` and `AGENTS.md`.
7. **Full** Ultracite migration now, plus add Ultracite and context7 to the agent workflow.

**Repository conventions that override skill defaults (from `docs/QUIRKS.md`):**
- Commit messages: lowercase imperative, no Conventional Commits prefix.
- Co-author trailer on every assistant commit: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` (HEREDOC).
- Never `git add -A`, `git add .`, or `git add AGENTS.md`. Stage files by name. The user commits `AGENTS.md` themselves.
- Work lands on `main`. No emdashes, no emojis.

**Pre-flight baseline (record before starting):**

```bash
npm run build          # built, exit 0
npx tsc --noEmit       # 11 errors across 5 files
npm test               # 92 passed
```

---

## Phase 1: Tooling foundation

### Task 1: Add a `typecheck` script

**Files:** Modify `package.json` (scripts).

- [ ] **Step 1:** Add after the `"check"` script line: `"typecheck": "tsc --noEmit",`
- [ ] **Step 2:** Run `npm run typecheck`. Expected: 11 errors (fixed in Phase 3).
- [ ] **Step 3:** Commit `package.json`: `add typecheck script`.

---

## Phase 2: Ultracite migration

> Full migration to the Ultracite Biome preset. This replaces `biome.json` with `biome.jsonc` extending `ultracite/biome/core` + `ultracite/biome/react`, then fixes the resulting violations. Expect the strict ruleset (no `any`, exhaustive deps, no array-index keys, no `console`, etc.) to surface new diagnostics.

### Task 2: Install Ultracite and migrate the Biome config

**Files:** Modify `package.json` (devDeps + scripts), replace `biome.json` with `biome.jsonc`.

- [ ] **Step 1:** Install: `npm install --save-dev ultracite`.
- [ ] **Step 2:** Run non-interactive init:

```bash
CI=true npx ultracite init --pm npm --linter biome --editors vscode --agents claude --frameworks react --skip-install --quiet
```

Review every file it created or modified before continuing. If it writes agent rule files (for example a `CLAUDE.md` or `.cursor/` entry) that duplicate `AGENTS.md`, delete them; this repo uses `AGENTS.md`.

- [ ] **Step 3:** Port the project-specific Biome settings into `biome.jsonc` so the report-noise fix and generated-file exclusions survive the migration:

```jsonc
{
  "$schema": "https://biomejs.dev/schemas/2.4.5/schema.json",
  "extends": ["ultracite/biome/core", "ultracite/biome/react"],
  "vcs": { "enabled": true, "clientKind": "git", "useIgnoreFile": true },
  "files": {
    "includes": ["**", "!**/src/routeTree.gen.ts", "!**/src/styles.css"]
  }
}
```

The `vcs.useIgnoreFile: true` plus the already-gitignored `playwright-report/` is what removes the ~3,667 phantom errors that the old `**/index.html` glob produced. If `npm run dev` was used to regenerate `routeTree.gen.ts`, the exclusion keeps it out of lint.

- [ ] **Step 4:** Update `package.json` scripts to drive Ultracite (it wraps Biome):

```json
"format": "ultracite fix",
"lint": "ultracite check",
"check": "ultracite check",
```

- [ ] **Step 5:** Run `npx ultracite doctor`. Expected: linter installed, config extends presets, no conflicting `.eslintrc`/`.prettierrc`.
- [ ] **Step 6:** Capture the violation surface: `npx ultracite check 2>&1 | tail -5`. Record the error/warning counts (the Task 3 work item).
- [ ] **Step 7:** Commit `package.json package-lock.json biome.jsonc` and the removal of `biome.json`: `migrate biome config to ultracite preset`.

### Task 3: Fix the Ultracite violations

**Files:** Whatever Task 2 Step 6 surfaced, across `src/`.

- [ ] **Step 1:** Auto-fix the safe ones: `npx ultracite fix`. Re-run `npx ultracite check` and record what remains.
- [ ] **Step 2:** Triage the remaining diagnostics by rule (`npx ultracite check 2>&1 | grep -oE 'lint/[a-zA-Z/]+' | sort | uniq -c | sort -rn`). For each rule:
  - Fix the code where the rule is correct (preferred).
  - For a deliberate, justified exception, add an inline `// biome-ignore lint/<rule>: <reason>` with a concrete reason (the QUIRKS-documented TanStack Form `any` is the canonical example).
- [ ] **Step 3:** After each rule cluster is resolved, run `npm test`. Expected: 92 passed (no behavior change).
- [ ] **Step 4:** Final gate: `npx ultracite check` clean, `npm run build` exit 0.
- [ ] **Step 5:** Commit in logical batches (for example `fix ultracite correctness violations`, `fix ultracite react violations`). Stage files by name.

---

## Phase 3: Real TypeScript errors

> Ultracite's `fix` may already touch some of these files (unused imports, etc.). Re-run `npm run typecheck` after Phase 2 and only do the tasks whose errors remain. Gate each on `npm run typecheck`.

### Task 4: Fix `projects/$projectId.tsx` loader-data type collapse (8 errors)

**Background:** `Route.useLoaderData()` and `head` resolve to `never`/`undefined` because the loader spreads a union (`return { ...data, projectCategories }`). `getProjectImpl` already returns a consistent key set, so listing keys explicitly after the `notFound()` narrowing restores inference. Author left `as string | undefined` casts at lines 26 and 55.

**Files:** Modify `src/routes/projects/$projectId.tsx`.

- [ ] **Step 1:** `npx tsc --noEmit 2>&1 | grep '$projectId'`. Expected: 8 errors.
- [ ] **Step 2:** Replace the loader return `return { ...data, projectCategories };` with explicit keys:

```tsx
    return {
      project: data.project,
      history: data.history,
      canEdit: data.canEdit,
      viewerIsStaff: data.viewerIsStaff,
      viewerIsOwner: data.viewerIsOwner,
      projectCategories,
    };
```

- [ ] **Step 3:** `npx tsc --noEmit 2>&1 | grep '$projectId'`. Expected: zero. If line 109 (`c` any) persists, annotate: `projectCategories.map((c: (typeof projectCategories)[number]) => ...`.
- [ ] **Step 4:** Remove the now-redundant `as string | undefined` casts at line 26 (`loaderData?.project?.title`) and line 55 (`project?.id`); re-run typecheck after each removal and keep only removals that stay green. Leave the `project.imageUrl as string | null` column cast at line 116.
- [ ] **Step 5:** `npm run build`. Expected: exit 0.
- [ ] **Step 6:** Commit `src/routes/projects/\$projectId.tsx`: `fix project detail loader-data typing and drop redundant casts`.

### Task 5: Fix the admin projects search-updater union leak (1 error)

**Background:** `search={(prev) => ({ ...prev, ... })}` spreads the union of every route's search params, dragging inventory statuses and `null` into `status`.

**Files:** Modify `src/routes/_authed/admin/projects/index.tsx:75-86`.

- [ ] **Step 1:** `npx tsc --noEmit 2>&1 | grep 'admin/projects/index'`. Expected: 1 error at line 78.
- [ ] **Step 2:** Replace the `search={(prev) => ({ ...prev, includeSoftDeleted: !includeSoftDeleted })}` with an explicit object (both values already destructured at line 70):

```tsx
      search={{
        status,
        includeSoftDeleted: !includeSoftDeleted,
      }}
```

- [ ] **Step 3:** `npx tsc --noEmit 2>&1 | grep 'admin/projects/index'`. Expected: zero.
- [ ] **Step 4:** Commit: `stop spreading the global search union in admin projects toggle`.

### Task 6: Normalize `role` for `isStaff`, remove view-toggle non-null assertion (2 errors)

**Background:** `requireUser()` returns `session.user` with optional `role`; `isStaff` needs `Viewer = { id; role: string | null | undefined }`. Separately, `view-toggle.tsx:18` uses `props.current!` (Ultracite `noNonNullAssertion`).

**Files:** Modify `src/server/admin.ts:14-15`, `src/components/view-toggle.tsx:18`.

- [ ] **Step 1:** Replace in `admin.ts`:

```tsx
    const viewer = await requireUser();
    if (!isStaff({ id: viewer.id, role: viewer.role ?? null }))
      throw new Error("Forbidden");
```

- [ ] **Step 2:** Replace `view-toggle.tsx:18` `const current = props.value ?? props.current!;` with `const current = props.value ?? props.current ?? "card";`
- [ ] **Step 3:** `npx tsc --noEmit 2>&1 | grep -E 'admin.ts|view-toggle'`. Expected: zero. `npx ultracite check src/components/view-toggle.tsx`. Expected: clean.
- [ ] **Step 4:** Commit: `normalize role for isStaff and drop view-toggle non-null assertion`.

### Task 7: Guard `DATABASE_URL` in `drizzle.config.ts` (1 error)

**Files:** Modify `drizzle.config.ts`.

- [ ] **Step 1:** Add a guard before `defineConfig` and use the narrowed value:

```ts
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error('DATABASE_URL environment variable is not set')
}
```

and set `dbCredentials: { url: databaseUrl }`.

- [ ] **Step 2:** `npm run typecheck`. Expected: PASS, zero errors.
- [ ] **Step 3:** Docker is up, so verify drizzle loads: `npx drizzle-kit check`. Expected: no config error.
- [ ] **Step 4:** Commit: `guard DATABASE_URL in drizzle config so the url type is string`.

---

## Phase 4: Node version

### Task 8: Declare Node 24 LTS (24.16.0)

**Files:** Modify `package.json`, `nixpacks.toml`; create `.nvmrc`.

- [ ] **Step 1:** In `package.json`, after `"imports"`, add:

```json
  "engines": {
    "node": ">=24"
  },
```

- [ ] **Step 2:** Create `.nvmrc` with contents `24.16.0`.
- [ ] **Step 3:** In `nixpacks.toml`, change `nixPkgs = ["nodejs_22"]` to `nixPkgs = ["nodejs_24"]`.
- [ ] **Step 4:** Verify build still works on the local toolchain (24.15.0): `npm run build`. Expected: exit 0.
- [ ] **Step 5:** Commit `package.json .nvmrc nixpacks.toml`: `target node 24 lts via engines, nvmrc, and nixpacks`.

---

## Phase 5: Continuous integration

### Task 9: Add a CI workflow and validate it with `act`

**Files:** Create `.github/workflows/ci.yml`.

- [ ] **Step 1:** Create the workflow:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24.16.0
          cache: npm
      - run: npm ci
      - run: npm run check
      - run: npm run typecheck
      - run: npm test
      - run: npm run build
```

- [ ] **Step 2:** Confirm every step passes locally first: `npm run check && npm run typecheck && npm test && npm run build`. Expected: all succeed.
- [ ] **Step 3:** Dry-run the workflow with `act`: `act pull_request -n` (lists jobs/steps) then `act pull_request --job verify` to execute. If `act` cannot pull the runner image or hits Docker resource limits, record the limitation; the local `npm` gate in Step 2 is the authoritative check.
- [ ] **Step 4:** Commit `.github/workflows/ci.yml`: `add CI workflow for check, typecheck, test, and build`.

---

## Phase 6: Documentation

### Task 10: README TODO for test-DB isolation

**Background:** Integration tests share `DATABASE_URL` with dev and `TRUNCATE` every table, so running them wipes dev data. Not fixing now; record it.

**Files:** Modify `README.md` (Testing section).

- [ ] **Step 1:** Under `## Testing`, add a note:

```markdown
> TODO: Integration tests currently run against the same database as dev and
> TRUNCATE every table before each test, which wipes dev data. Future work:
> point them at a dedicated `cs_capstone_test` database via a separate
> `TEST_DATABASE_URL`. See `docs/QUIRKS.md` (Drizzle section) for details.
```

- [ ] **Step 2:** Fix the stale `## Removing Tailwind CSS` step that references the nonexistent `src/routes/demo/` directory: remove that bullet. Verify with `ls src/routes/demo 2>&1` (expected: no such directory).
- [ ] **Step 3:** Commit `README.md`: `note future test-db isolation and fix stale tailwind removal step`.

### Task 11: Remove faulty/absurd information from QUIRKS.md and AGENTS.md

**Background:** Known-wrong items. `QUIRKS.md` says shadcn is unused (it is used everywhere) and names the co-author trailer as Opus 4.7. `AGENTS.md` uses `npm <script>` commands that npm rejects for everything except `start`/`test`. During execution, scan both files for any other statements that contradict the current code and correct them.

**Files:** Modify `docs/QUIRKS.md`; modify `AGENTS.md` (do NOT stage or commit).

- [ ] **Step 1:** In `docs/QUIRKS.md` path table, replace the `src/components/*.tsx | Plain Tailwind components. shadcn is installed but NOT used yet.` row with: `App components built on shadcn/ui + Radix primitives (see src/components/ui/).`
- [ ] **Step 2:** In `docs/QUIRKS.md`, change `Co-Authored-By: Claude Opus 4.7` to `Co-Authored-By: Claude Opus 4.8`.
- [ ] **Step 3:** In `docs/QUIRKS.md`, scan for any other now-false claims (for example linting instructions that predate Ultracite) and correct them to match the post-migration reality.
- [ ] **Step 4:** In `AGENTS.md`, change every `npm <script>` that is not `start`/`test` to `npm run <script>` (Quick Start, Key Commands table, Database snippet). Also reconcile the Code Quality section with Ultracite (see Task 12). Leave `AGENTS.md` unstaged.
- [ ] **Step 5:** Commit `docs/QUIRKS.md` only: `correct stale shadcn note, co-author trailer, and lint guidance`.

### Task 12: Add Ultracite and context7 to the agent workflow

**Background:** Adopt both tools in the documented workflow so future agents use them.

**Files:** Modify `AGENTS.md` (do NOT stage); modify `docs/QUIRKS.md` if a quirk is worth recording.

- [ ] **Step 1:** In `AGENTS.md` Code Quality section, document Ultracite:

```markdown
## Code Quality

This project uses Ultracite (a strict Biome preset) for formatting and linting.

- `npm run check` runs `ultracite check` (read-only).
- `npm run format` runs `ultracite fix` (auto-fix).
- Config lives in `biome.jsonc`, extending `ultracite/biome/core` and `ultracite/biome/react`.

Always run `npm run check` after finishing work and fix issues before committing.
```

- [ ] **Step 2:** In `AGENTS.md`, add a short "Library documentation" note: use the context7 MCP server for up-to-date docs on the fast-moving stack (TanStack Start, Better Auth, Drizzle) rather than relying on training data.
- [ ] **Step 3:** Leave `AGENTS.md` unstaged (user commits it). No commit from this task.

---

## Final verification

- [ ] `npm run check` clean (Ultracite).
- [ ] `npm run typecheck` clean.
- [ ] `npm test` 92 passed.
- [ ] `npm run build` exit 0.
- [ ] `act pull_request --job verify` green (or limitation recorded).
- [ ] `git status` shows `AGENTS.md` modified but unstaged.

## Out of scope (tracked, not done here)

- Dependency pinning (keeping `"latest"` per maintainer).
- Integration-test DB isolation (README TODO only).
- `scripts/seed-dev.ts` hardening (production guard, transaction).
- Product features in README "Current Bugs"/"Improvements" (proposer-by-email, analytics dashboard).

## Coverage and honesty notes

- Unit tests and build run and pass during the review.
- Integration tests are NOT run (they TRUNCATE the shared dev DB).
- Accessibility tests are NOT run (need a live server on :3000).
