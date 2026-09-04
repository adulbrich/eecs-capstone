# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues on `adulbrich/eecs-capstone`.
Use the `gh` CLI for all operations, with the agent tool sandbox off (the Vitest
section of `docs/QUIRKS.md` says why).

## What an issue is here

**The issue is the spec.** There is no separate spec document for ordinary work: an
issue in `ready-for-agent` carries an agent brief (current behavior, desired
behavior, key interfaces, acceptance criteria, out of scope) and the pull request
that closes it is the plan. The superpowers brainstorm, spec and plan workflow under
`docs/superpowers/` is reserved for a few large new features; `CONTRIBUTING.md` says
which.

Two local deltas from the default agent-brief guidance:

- **Briefs name file paths on purpose.** The guidance says paths go stale; here they
  are the grep targets the codebase is organized around (one named wrapper per
  action, one `*As` seam per wrapper) and issues are picked up within days. Name
  the path, not the line number.
- **Every issue that touches data says which fields are public, who may see the
  rest, and who may edit them**, as a table. The issue forms under
  `.github/ISSUE_TEMPLATE/` carry it.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`, with a heredoc
  for a multi-line body. The Claude Code hook `.claude/hooks/guard-gh.mjs` refuses a
  body with an emdash, an emoji or a `claude.ai/code/session` link, which is the
  same rule the commit message check applies.
- **Read an issue**: `gh issue view <number> --comments`.
- **List issues**: `gh issue list --state open --json number,title,labels --jq ...`
  with `--label` filters. `ready-for-agent` plus a priority label is the queue.
- **Comment**: `gh issue comment <number> --body "..."`.
- **Labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`.
  The vocabulary is in [`triage-labels.md`](./triage-labels.md).
- **Close**: `gh issue close <number> --comment "..."`. A pull request closes its
  issue with `Closes #N` in the body.

## Rejected concepts

`.out-of-scope/` holds one Markdown file per concept this project has decided not to
build: the decision, the reason, and links to every issue that asked. `/triage` reads
it before evaluating a new enhancement and writes a file there when it closes one as
`wontfix`; its `README.md` carries the format. The maintainer confirms a match by
hand.

## Pull requests as a triage surface

**PRs as a request surface: no.** Every pull request comes from a collaborator and
goes through the review loop in `AGENTS.md`, not through triage.

GitHub shares one number space across issues and PRs, so a bare `#42` may be either;
resolve with `gh pr view 42` and fall back to `gh issue view 42`.

## When a skill says "publish to the issue tracker"

Create a GitHub issue, apply `ready-for-agent` and a priority label, and put the
fields table in the body.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as tickets.

- **Map**: a single issue labelled `wayfinder:map`, holding the Notes /
  Decisions-so-far / Fog body. `gh issue create --label wayfinder:map`.
- **Child ticket**: an issue linked to the map as a GitHub sub-issue (`gh api` on the
  sub-issues endpoint). Where sub-issues are not enabled, add the child to a task
  list in the map body and put `Part of #<map>` at the top of the child body.
  Labels: `wayfinder:<type>` (`research`, `prototype`, `grilling`, `task`). Once
  claimed, the ticket is assigned to the driving dev.
- **Blocking**: GitHub's native issue dependencies. Add an edge with
  `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`,
  where `<blocker-db-id>` is the blocker's numeric database id
  (`gh api repos/<owner>/<repo>/issues/<n> --jq .id`, not the `#number`). Where
  dependencies are not available, fall back to a `Blocked by: #<n>` line at the top
  of the child body. A ticket is unblocked when every blocker is closed.
- **Frontier query**: the map's open children with no open blocker and no assignee;
  first in map order wins.
- **Claim**: `gh issue edit <n> --add-assignee @me`, the session's first write.
- **Resolve**: `gh issue comment <n> --body "<answer>"`, then `gh issue close <n>`,
  then append a context pointer (gist plus link) to the map's Decisions-so-far.
