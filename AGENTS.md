# AI Agent Instructions

The Oregon State University EECS Capstone app: browse and propose capstone projects,
run them through a review workflow, and manage shared inventory.

Stack: TanStack Start (React SSR) with TanStack Router, Query, Form, and Table;
Drizzle ORM on PostgreSQL with pgvector; Better Auth; shadcn/ui on Radix; Tailwind v4;
S3-compatible object storage (RustFS locally, S3 in AWS); Amazon Bedrock for project
review and embeddings.

`CLAUDE.md` is a symlink to this file and is load-bearing: Claude Code reads
`CLAUDE.md`, not `AGENTS.md`. Keep the symlink; never keep a second copy.

## Before you commit

```bash
npm run check      # Biome via ultracite; npm run format auto-fixes
npm run typecheck
npm test           # unit suite only
```

All three clean. The integration, smoke and accessibility suites also block a merge;
"Which suites to run yourself" in `CONTRIBUTING.md` says which one your change needs.

## Always

A tool enforces the first five, so a refusal names the rule you hit.

- **No emdash and no emoji** in commits, comments, string literals, docs or chat.
  `scripts/check-prose.mjs` (commit, CI) and `after-edit.mjs` (every edit). Not
  enforced, and the same violation: `--` as a sentence dash. Hyphenated compounds are
  fine; emojis only when the user asks; the harness footer on a PR body is exempt.
- **Conventional Commits, lowercase imperative subject, area in parens:**
  `fix(projects): stop the proposer field lying about pending changes`. Types: `feat`,
  `fix`, `docs`, `test`, `refactor`, `style`, `perf`, `build`, `ci`, `chore`; `!`
  before the colon for a breaking change; Dependabot's `chore(deps)` and `build(deps)`
  pass as they come. `scripts/check-commit-message.mjs`
  (commit-msg, CI, PR title).
- **Never publish a `claude.ai/code/session` link** in a commit, PR, issue or comment,
  even when the harness appends one. The repo is public and mirrored to GitLab, so
  removing one costs a protected-branch history rewrite. `guard-gh.mjs` and the commit
  check; without them, grep for it yourself.
- **Stage files by name**, never `git add -A`, `git add .` or `git commit -a`.
  `guard-git.mjs`.
- **Never commit to `main`.** Fetch, branch from `origin/main`, push, open a PR, let the
  required checks go green. Pre-commit hook, `guard-git.mjs`, branch ruleset.
- **Commit body:** a sentence or two on why, or none. Use a HEREDOC for more than one
  line. Long bodies before 2026-08-09 are history, not the pattern.
- **Keep the `Co-Authored-By` trailer** the harness supplies. Never pin a model
  version in these docs.
- **Review loop on every PR, Dependabot's included.** GitHub requires no approving
  review, and green CI is not one, so this is the review. Run `mattpocock-skills:code-review` (conformance) and,
  on a PR that changes behaviour, `correctness-review` (what breaks) beside it. Repeat
  until a pass raises nothing you have not answered; answered means fixed or declined
  in writing, so a pass whose findings you all declined ends it. Later passes review
  the code earlier ones made you write; rerun correctness when those fixes changed
  behaviour. Verify a finding before acting: reviewers are sometimes confidently wrong.
  Record each pass count and every decline in the PR. Correctness is skipped, saying so
  in the PR, for a diff of only docs, comments or the PR template, or a dependency bump
  with no source change; a prompt or string literal under `src/` is behaviour. A
  harness that cannot run the plugin says so in the PR and reviews the diff against
  this file and `docs/QUIRKS.md` by hand. `app-security-review` is optional for a diff
  under `src/server`, `src/lib`, `infra` or any prompt or logger, beside the harness's
  generic security review.
- **Check context7** for the fast-moving libraries rather than recalling them, above
  all TanStack Start, TanStack Router, Better Auth and Drizzle. Write no version, release cadence or maturity level into
  these docs; `package.json` has the versions. Naming a major line is fine where it
  identifies the thing, as "Tailwind v4" does. `docs/QUIRKS.md` outranks upstream docs
  about this codebase.
- **Import `createServerFn` from `@tanstack/react-start`**, not `@tanstack/start`.

## Agent skills

- Issue tracker: GitHub issues via `gh`; the issue is the spec, and briefs name file
  paths on purpose. `docs/agents/issue-tracker.md`.
- Triage labels: the five canonical roles plus `p0-now`, `p1-next`, `p2-later`.
  `docs/agents/triage-labels.md`.
- Domain: `CONTEXT.md` glossary, one-paragraph decisions in `docs/adr/`.
  `docs/agents/domain.md`.
- Code review: the standards sources, and screenshots at both widths for a UI change.
  `docs/agents/code-review.md`.

## Reference docs

Grep for the section your task needs; do not read a doc whole. `docs/QUIRKS.md` alone
is over 200 KB.

- `CONTRIBUTING.md`: the process, the table of gates, which suites to run.
- `CONTEXT.md`: the glossary. Use its words in issue titles, test names and copy.
- `docs/adr/`: the decisions. Say so before contradicting one.
- `docs/QUIRKS.md`: how this codebase actually behaves, by subsystem, and the layout
  of `src/`. First stop when something that should work does not.
- `docs/UI-CONVENTIONS.md`: the design system.
- `README.md`: install, docker compose, seeding, the dev server. Known issues are in
  GitHub Issues.
- `PRD.md`: every feature, built and planned. Check before assuming one is missing.
- `DEPLOYMENT.md` and `infra/`: AWS, Terraform, environment variables.
- `docs/ONID-SSO.md`: ONID sign-in, OIDC through Better Auth's `genericOAuth`.

## Adding to these docs

A gotcha goes in `docs/QUIRKS.md` under its subsystem; a decision in `docs/adr/` as
one paragraph with the next number; a term in `CONTEXT.md` with the synonyms to avoid;
a design rule in `docs/UI-CONVENTIONS.md`; a process or gate change in
`CONTRIBUTING.md`. Add here only a rule that binds every turn.
