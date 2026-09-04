# AI Agent Instructions

The Oregon State University EECS Capstone app: browse and propose capstone projects,
run them through a review workflow, and manage shared inventory.

Stack: TanStack Start (React SSR) with TanStack Router, Query, Form, and Table;
Drizzle ORM on PostgreSQL with pgvector; Better Auth; shadcn/ui on Radix; Tailwind v4;
S3-compatible object storage (RustFS locally, S3 in AWS); Amazon Bedrock for project
review and embeddings.

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

All three must be clean, because a red local run is a red PR. lefthook runs Biome and
the prose check on the staged files at commit, and typecheck and the unit suite at
push, so most of the time a red one is caught before it leaves your machine.
[`CONTRIBUTING.md`](./CONTRIBUTING.md) has the table of every gate, where each runs,
and what catches a skip; `.github/workflows/ci.yml` is what CI actually does.

`npm test` says nothing about the integration, smoke or accessibility suites, and
CI's integration result does not block a merge. "Which suites to run yourself" in
CONTRIBUTING.md says which one a change to the database layer, a covered flow or a
scanned page needs before the PR, and what each needs running.

## Always

- **Prose contains no emdashes and no emojis.** This covers commit messages, code
  comments, string literals, docs, and chat replies. Use commas, colons, semicolons,
  parens, or a new sentence. A `--` standing in for a sentence dash is the same
  violation; hyphens inside compound words like `read-only` are fine. Emojis only
  when the user asks for one. `scripts/check-prose.mjs` enforces the two characters
  at commit, in CI and on every edit; the `--` case is yours. The one exception is
  the footer the harness appends to a PR body, which the check strips before it
  looks.
- **Commit messages use Conventional Commits with a lowercase imperative subject:**
  `fix(projects): stop the proposer field lying about pending changes`. The types in
  use are `feat`, `fix`, `docs`, `test`, `refactor`, `style`, `perf`, `build`,
  `ci` and `chore`. Put the affected area in parens. Bare subjects exist in the
  history and are not the pattern to copy, same as the long bodies below. A
  breaking change takes a `!` before the colon, as in
  `feat(inventory)!: give items many categories`. Dependabot lands `chore(deps)`
  and `build(deps)`. `scripts/check-commit-message.mjs` enforces the subject at
  `commit-msg`, in CI, and on the pull request title, which a squash merge turns
  into the `main` subject.
- **Keep the body short, or leave it out.** A sentence or two on why, and only when
  the subject does not already carry it. Cut anything that does not change what a
  reader will do or understand. Commits before 2026-08-09 run to several paragraphs;
  they are history, not the pattern to copy. Use a HEREDOC when a body needs more
  than one line.
- **Keep the `Co-Authored-By` trailer** your harness supplies on assistant-authored
  commits. Do not pin a model version in these docs; the harness fills in whichever
  model wrote the commit.
- **Never publish a `claude.ai/code/session` link.** Not in a commit message, a PR
  body, an issue, or a comment. Some harnesses append a `Claude-Session:` trailer to
  commits and a session link to PR bodies; this rule overrides that instruction.
  Keep `Co-Authored-By`, drop the session link. The reason it is a hard rule rather
  than a preference: this repo is public and mirrors to GitLab, so a published link
  is on two remotes at once, and taking it back costs a history rewrite against a
  protected branch plus a force sync of the mirror. The commit check and the
  `.claude/hooks/guard-gh.mjs` hook refuse the text before it reaches a remote; if
  you are in a harness without them, grep for it yourself.
- **Stage files by name.** Never `git add -A` or `git add .`, which sweeps up
  unrelated work in progress. `.claude/hooks/guard-git.mjs` refuses both, and
  `git commit -a` with them.
- **Never commit to `main`.** A branch ruleset rejects direct pushes, including the
  user's, and the pre-commit hook refuses the commit. Fetch, branch from
  `origin/main`, push, open a PR, and let the required checks go green. GitHub
  asks for no approving review, so nothing but the rule below stops a PR merging
  unread.
- **Run `mattpocock-skills:code-review` on every PR before merging, then again after
  addressing what it found, until a pass raises nothing you have not already
  answered.** A PR that draws no findings meets that after one pass. Answered
  covers a finding you fixed and one you declined in writing alike, so a reviewer
  repeating a point you argued against does not restart the loop, and a pass whose
  findings you all declined without editing a line is itself the pass that ends it.
  Every pass after the first exists for the code the previous pass caused you to
  write, which otherwise reaches `main` reviewed by nobody. Green CI is not a
  review: it says nothing broke that was already covered, and new code with no new
  tests is the part it cannot speak to. Verify a finding before acting on it. A
  review agent reads a branch, not your intent, and will sometimes be confidently
  wrong about what exists. Record the pass count and any declined finding in the
  PR, where the template asks for it.

  `.claude/settings.json` declares the marketplace and enables the plugin, so nobody
  has to add either by hand. Claude Code still asks each operator once whether to
  trust the marketplace, so a fresh clone answers a prompt, not a setup step. Every
  PR goes through this, Dependabot's included: a bump that draws no findings clears
  the rule in a single pass, which is cheaper than arguing about the exception. If
  you are an agent that cannot run a Claude Code plugin, say so in the PR and review
  the diff against this file and `docs/QUIRKS.md` yourself. That is a fallback for a
  harness that lacks the tool, not a choice between equals.
- **Check the docs for the fast-moving libraries with the context7 MCP server**
  rather than recalling them, for TanStack Start, TanStack Router, Better Auth and
  Drizzle above all: those four are what training data is most likely to be wrong
  about. Do not write down a version, a release cadence or a maturity level here;
  `package.json` carries the versions and cannot go stale; cadence and maturity are
  not facts this repo should be recording at all. Naming a major line is fine where
  it identifies the thing, as "Tailwind v4" does. `docs/QUIRKS.md` outranks upstream
  docs wherever the two disagree about this codebase.
- **Import `createServerFn` from `@tanstack/react-start`.** The bare
  `@tanstack/start` package is not what this project uses.

## Agent skills

The mattpocock engineering skills read three files about this repo before they act.

### Issue tracker

GitHub issues on this repo, driven with `gh`; the issue is the spec, and briefs name
file paths on purpose. See [`docs/agents/issue-tracker.md`](./docs/agents/issue-tracker.md).

### Triage labels

The five canonical roles under their own names, plus `p0-now`, `p1-next` and
`p2-later`. See [`docs/agents/triage-labels.md`](./docs/agents/triage-labels.md).

### Domain docs

Single context: the glossary is `CONTEXT.md` at the root and the decisions are one
paragraph each under `docs/adr/`. See
[`docs/agents/domain.md`](./docs/agents/domain.md).

## Reference docs

Read the matching doc before you start; each one is the source of truth for its area.

- **[`CONTRIBUTING.md`](./CONTRIBUTING.md)** is the process: pick up, branch, commit,
  push, pull request, review loop, merge, and the table of every gate and where it
  runs. It is also where a new developer or instructor starts.

- **[`CONTEXT.md`](./CONTEXT.md)** is the glossary: one definition per term for
  projects, inventory, and the people and roles around them, each with the synonyms
  the codebase does not use. Use its words in issue titles, test names and copy.

- **[`docs/adr/`](./docs/adr/)** holds the decisions, one paragraph each: the
  `_internal/` layout, one wrapper per action, declared access levels, the single
  status writers, lazy deadlines, retired as the archive, proposer linking, account
  anonymization, the image policy, one URL per resource, the shared test database,
  Bedrock through Mantle, and specs in issues. Read the ones that touch your area,
  and say so before contradicting one.

- **[`docs/QUIRKS.md`](./docs/QUIRKS.md)** is the ground truth for how this codebase
  actually behaves, and the first stop when something that should work does not. It
  covers `createServerFn` and the server/client boundary, route layouts and search
  params, TanStack Form validators, Better Auth sessions and bans, Drizzle tsvector
  columns and FK rules, Vitest and integration-test setup, Sharp and S3 storage keys,
  which Biome rules are relaxed and why, the path-by-path layout of `src/`, the
  workflow conventions, Amazon Bedrock, and the gotchas in the inventory and project
  modules that the ADRs and the glossary do not carry.

- **[`docs/UI-CONVENTIONS.md`](./docs/UI-CONVENTIONS.md)** is the design system:
  brand tokens and why hex codes never go in a component, `Button` variants and
  sizes, `asChild` for links, shadcn form inputs, semantic color classes, border
  radius, mobile-first breakpoints and page padding, the `Sheet` mobile nav, and
  `AdminDataTable` for responsive admin tables, the shared component patterns, and
  the confirmation rules for destructive actions.

- **[`README.md`](./README.md)** covers install, docker compose, seeding, and
  running the dev server. Its "Known issues and roadmap" section is a pointer at
  GitHub Issues rather than a list; check the issues before assuming something is
  unreported.

- **[`PRD.md`](./PRD.md)** is the exhaustive feature list, built and planned. Check it
  before assuming a feature is missing.

- **[`DEPLOYMENT.md`](./DEPLOYMENT.md)** and **[`infra/`](./infra/)** cover the AWS
  deployment, Terraform, and environment variables.

- **[`docs/ONID-SSO.md`](./docs/ONID-SSO.md)** covers ONID sign-in: how it works, how
  to operate it, and what is still open with UIT. It is OIDC through Better Auth's
  `genericOAuth`, not SAML, and it shipped; UIT registered the app as a relying party
  on 2026-08-24.

## Adding to these docs

A new gotcha goes in `docs/QUIRKS.md` under the subsystem it belongs to, following the
pattern in its "When you add a quirk" section. A decision (hard to reverse,
surprising without context, the result of a trade-off) goes in `docs/adr/` as one
paragraph with the next number. A term goes in `CONTEXT.md`, with the synonyms to
avoid. A new design system rule goes in `docs/UI-CONVENTIONS.md`. A change to the
process or a gate goes in `CONTRIBUTING.md`.
Add to this file only when the rule binds every turn regardless of what is being
worked on.
