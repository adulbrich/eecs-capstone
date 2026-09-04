# Contributing

How work moves through this repo, for a person. `AGENTS.md` carries the rules that
bind an agent on every turn; this file is the map of the process those rules sit in,
and the first thing to read if you are joining as a developer or an instructor.
`README.md` covers install and running the app, and `docs/ONBOARDING.md` is day
one: accounts, the setup wizard, and what Claude Code does in your terminal.

## The process

```
pick up         branch            commit               push              pull request        merge
--------        ------            ------               ----              ------------        -----
GitHub issue    fetch, then       lefthook:            lefthook:         verify, smoke,      squash, merge
ready-for-*     branch from       biome, prose,        typecheck,        a11y-smoke,         or rebase
p0/p1/p2        origin/main       branch, message      unit suite        pr-text (CI)        no human
claim it        fix/ feat/ ...                                           review loop         approval
```

1. **Pick up an issue.** The queue is `ready-for-agent` or `ready-for-human`,
   sorted by `p0-now`, `p1-next`, `p2-later`. Assign yourself before the first edit.
   The issue is the spec: an agent brief with acceptance criteria, and a table of
   which fields are public and who edits them. Filing one goes through the forms
   under `.github/ISSUE_TEMPLATE/`. Labels are explained in
   `docs/agents/triage-labels.md`.
2. **Branch from a fresh `origin/main`.** `git fetch origin main` first; a stale
   local `main` is how rebase conflicts start. Prefix the branch with the commit
   type: `fix/`, `feat/`, `test/`, `docs/`, `chore/`, `ci/`, `refactor/`.
3. **Commit, by name.** Stage paths, never `git add -A`. The subject is Conventional
   Commits with a lowercase imperative: `fix(projects): stop the proposer field
   lying about pending changes`. `AGENTS.md` has the full rule and the reason.
4. **Push and open a pull request.** The template asks for the closing issue, what
   changed, what ran locally, the review passes, and the docs touched.
5. **Run the review loop.** `mattpocock-skills:code-review` until a pass raises
   nothing unanswered, then merge. No approving review is required by GitHub, so
   this loop is the review. Record the pass count in the PR.

## The gates

One script per rule, run at the earliest point that can see the violation. The
first column is what stops you locally; the last is what stops the merge.

| Rule | Local (lefthook) | Claude Code hook | CI |
| --- | --- | --- | --- |
| Conventional subject; no emdash, emoji or session link in the message | `commit-msg` | `guard-git.mjs` reads the `-m` text first | `verify` walks the PR's commits; `pr-text` checks the title and body |
| No emdash or emoji in tracked prose and code | `pre-commit`, staged files | `after-edit.mjs` on the edited file | `verify`: `npm run check:prose` |
| No session link in PR or issue text | (never sees it) | `guard-gh.mjs` refuses the command | `pr-text`, for the PR title and body; issue text has no CI gate |
| Stage by name; never commit on `main` | `pre-commit` branch check | `guard-git.mjs` refuses `add -A`, `commit -a`, a commit on `main` | ruleset rejects a push to `main` |
| No force push at `main`, `reset --hard`, `clean -f`, `branch -D` | | `guard-git.mjs` | ruleset (force push) |
| Generated and personal files are not hand-edited | | `guard-edits.mjs` | |
| Biome clean | `pre-commit`, staged files | `after-edit.mjs` | `verify` |
| Typecheck and unit suite green | `pre-push` | | `verify` |
| Browser smoke and accessibility smoke green | you, when a covered flow changes | | `smoke / suite`, `accessibility-smoke / suite`, required |
| Integration suite green | you, when the database layer changes | | `integration / suite`, advisory until #22 is settled |

Skipping locally: `LEFTHOOK=0 git commit` or `--no-verify`. The Claude Code hooks and
CI catch what was skipped, so skipping moves the failure rather than removing it.

The three checks that block a merge are registered on the `main` ruleset. The list
endpoint does not carry the rules, so it takes two calls:

```bash
gh api repos/adulbrich/eecs-capstone/rulesets --jq '.[].id'
```

```bash
gh api repos/adulbrich/eecs-capstone/rulesets/<id> --jq '.rules[] | select(.type=="required_status_checks")'
```

## Which suites to run yourself

`npm test` is the unit suite and runs at push. The others are yours to run when the
change reaches them, because CI's integration result does not block and the
browser suites are slow:

- `npm run test:integration` when the database layer changes. Needs `docker compose
  up -d` and `npm run db:migrate`. It truncates the dev database; reseed with
  `npm run db:seed:dev` afterwards.
- `npm run test:smoke` when one of the flows in the `smoke` job comment in
  `.github/workflows/ci.yml` changes. Builds the production output itself.
- `npm run test:accessibility:smoke` when a page in the `accessibility-smoke` job
  comment changes; `npm run test:accessibility` for a page outside that set. Both
  need the seed and `npx playwright install chromium`.

Run tests on the Node in `.nvmrc`. `docs/QUIRKS.md` has the Vitest section for
everything that goes wrong here.

## Working with Claude Code

The repo enables the `mattpocock-skills` plugin through `.claude/settings.json`; a
fresh clone answers one prompt to trust the marketplace. The same file installs the
hooks under `.claude/hooks/`, which is what the middle column above describes.
`SessionStart` prints the branch, the working tree state, the Node version and the
running compose services into every session.

The agent sandbox refuses `gh` and anything that writes `.git/config`; the Vitest
section of `docs/QUIRKS.md` says which commands and why, and they run with the
sandbox off.

Working several issues at once: put a worktree outside the repo and symlink
`node_modules` and `.env.local` into it. The smoke and accessibility suites want the
main checkout, since both share one local database and one port.

The superpowers plugin (brainstorm, spec, plan, subagent-driven implementation) is
for a few large new features, and its specs and plans live in `docs/superpowers/`.
Ordinary work does not go through it: the issue is the spec.

## What to read for what

- `docs/ONBOARDING.md`: day one. Accounts, the setup wizard, Claude Code, a first
  week.
- `AGENTS.md`: the rules that bind every turn, and the reference docs.
- `docs/QUIRKS.md`: how this codebase actually behaves. First stop when something
  that should work does not.
- `docs/UI-CONVENTIONS.md`: the design system.
- `docs/agents/`: what the engineering skills read about this repo.
- `PRD.md`: what exists and what is planned. Check before assuming a feature is
  missing.
- `DEPLOYMENT.md` and `infra/`: AWS, Terraform, environment variables.
- `docs/ONID-SSO.md`: ONID sign-in.
