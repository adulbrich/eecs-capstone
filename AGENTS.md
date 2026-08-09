# AI Agent Instructions

The Oregon State University EECS Capstone app: browse and propose capstone projects,
run them through a review workflow, and manage shared inventory.

Stack: TanStack Start (React SSR) with TanStack Router, Query, Form, and Table;
Drizzle ORM on PostgreSQL; Better Auth; shadcn/ui on Radix; Tailwind v4; S3-compatible
object storage (RustFS locally, S3 in AWS).

This file is the entry point. It carries the rules that bind every turn and points at
the reference docs for everything else.

`CLAUDE.md` in the repo root is a symlink to this file, and it is load-bearing:
Claude Code auto-loads `CLAUDE.md` and does not read `AGENTS.md` on its own, so
deleting the symlink leaves it with no project instructions at all. Keep both names
pointing at this one file rather than maintaining a second copy.

## Before you commit

```bash
npm run check      # ultracite check (Biome). Use npm run format to auto-fix.
npm run typecheck  # tsc --noEmit
npm test           # unit tests only
```

All three must be clean. CI (`.github/workflows/ci.yml`) enforces check, typecheck,
test, and build, so a red local run is a red PR.

`npm test` deliberately excludes the integration and accessibility suites. Run
`npm run test:integration` (needs docker Postgres up) and `npm run test:accessibility`
when your change touches the database layer or the UI. Other scripts live in
`package.json`.

## Always

- **Prose contains no emdashes and no emojis.** This covers commit messages, code
  comments, string literals, docs, and chat replies. Use commas, colons, semicolons,
  parens, or a new sentence. A `--` standing in for a sentence dash is the same
  violation; hyphens inside compound words like `read-only` are fine. Emojis only
  when the user asks for one.
- **Commit messages use Conventional Commits with a lowercase imperative subject:**
  `fix(projects): stop the proposer field lying about pending changes`. The types in
  use are `feat`, `fix`, `docs`, `test`, `refactor`, and `style`, each with the
  affected area in parentheses.
- **Keep the body short, or leave it out.** A sentence or two on why, and only when
  the subject does not already carry it. Cut anything that does not change what a
  reader will do or understand. Commits before 2026-08-09 run to several paragraphs;
  they are history, not the pattern to copy. Use a HEREDOC when a body needs more
  than one line.
- **Keep the `Co-Authored-By` trailer** your harness supplies on assistant-authored
  commits. Do not pin a model version in these docs; the harness fills in whichever
  model wrote the commit.
- **Stage files by name.** Never `git add -A` or `git add .`, which sweeps up
  unrelated work in progress.
- **Never commit to `main`.** A branch ruleset rejects direct pushes, including the
  user's. Branch, push, open a PR, and let the `verify` check go green. The PR needs
  no approving review, so you can merge your own once CI passes.
- **Check the docs for the fast-moving libraries with the context7 MCP server**
  rather than recalling them. TanStack Start is pre-v1, and Better Auth and Drizzle
  both move faster than training data. `docs/QUIRKS.md` outranks upstream docs
  wherever the two disagree about this codebase.
- **Import `createServerFn` from `@tanstack/react-start`.** The bare
  `@tanstack/start` package is not what this project uses.

## Reference docs

Read the matching doc before you start; each one is the source of truth for its area.

- **[`docs/QUIRKS.md`](./docs/QUIRKS.md)** is the ground truth for how this codebase
  actually behaves, and the first stop when something that should work does not. It
  covers `createServerFn` and the server/client boundary, route layouts and search
  params, TanStack Form validators, Better Auth sessions and bans, Drizzle tsvector
  columns and FK rules, Vitest and integration-test setup, Sharp and S3 storage keys,
  which Biome rules are relaxed and why, the path-by-path layout of `src/`, the
  spec-then-plan-then-implement workflow, and the inventory and project domain rules.

- **[`docs/UI-CONVENTIONS.md`](./docs/UI-CONVENTIONS.md)** is the design system:
  brand tokens and why hex codes never go in a component, `Button` variants and
  sizes, `asChild` for links, shadcn form inputs, semantic color classes, border
  radius, mobile-first breakpoints and page padding, the `Sheet` mobile nav, and
  `AdminDataTable` for responsive admin tables.

- **[`README.md`](./README.md)** covers install, docker compose, seeding, running the
  dev server, and the current known issues and roadmap.

- **[`PRD.md`](./PRD.md)** is the exhaustive feature list, built and planned. Check it
  before assuming a feature is missing.

- **[`DEPLOYMENT.md`](./DEPLOYMENT.md)** and **[`infra/`](./infra/)** cover the AWS
  deployment, Terraform, and environment variables.

- **[`docs/ONID-SSO.md`](./docs/ONID-SSO.md)** covers the OSU SAML / ONID single
  sign-on request, which is blocked on the university rather than on code.

## Adding to these docs

A new gotcha goes in `docs/QUIRKS.md` under the subsystem it belongs to, following the
pattern in its "When you add a quirk" section. A new design system rule goes in
`docs/UI-CONVENTIONS.md`. Add to this file only when the rule binds every turn
regardless of what is being worked on.
