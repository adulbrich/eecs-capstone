---
name: correctness-review
description: Sweep the changes since a fixed point (commit, branch, tag, or merge-base) for known defect classes, the way code-review sweeps for smells, and report each finding with the input or sequence that triggers it. Use when a diff touches behaviour and the question is "is it wrong", not "does it conform"; with `mutate`, also removes each guard in the diff and reports the ones no test catches.
---

Correctness sweep of the diff between `HEAD` and a fixed point the user supplies.
Three read-only sub-agents run in parallel, each with one way of finding things:
reading the diff for sequences, executing pure functions at their boundaries, and
checking what the diff takes on trust. An optional fourth step mutates guards in a
scratch worktree.

It answers a different question from `mattpocock-skills:code-review`, which checks
conformance; see _Why_.

## Process

### 1. Pin the fixed point

Whatever the user said is the fixed point. If they did not name one, ask. Capture the
diff command once, `git diff <fixed-point>...HEAD` (three-dot, against the
merge-base), and the commit list, `git log <fixed-point>..HEAD --oneline`.

Confirm `git rev-parse <fixed-point>` resolves and the diff is non-empty before
spawning anything. Note whether the user passed `mutate`.

### 2. Find the spec

The spec is what the "State, not sequence" entry reads. Look in this order: issue
references in the commit messages, fetched by the workflow in
`docs/agents/issue-tracker.md`; a path the user passed; a design doc under
`docs/superpowers/specs/` matching the branch. If none exists, that entry reports
"no spec".

### 3. The checklist

Each entry reads _what it is_, then _how to find it_. Paste the whole list into every
sub-agent prompt: the sub-agent has no other access to it.

- **Read-then-write across an await.** A condition read, an async call awaited, then
  a write that assumes the condition still holds. Find it: every `await` between a
  guard and a mutation in the diff, and name what a second actor changes in between.
- **Interrupted write.** A multi-column or multi-row write where stopping between
  parts leaves a state a later reader accepts as valid. Find it: for each write, say
  what a reader concludes if only the first part landed.
- **Swallowed failure with a user waiting.** An error caught and logged on a path
  where somebody expects an answer. Find it: every `catch` in the diff, and who is on
  the other end.
- **Boundary conditions in pure functions.** Empty input, exactly at a limit, one
  past it, and characters outside the Basic Multilingual Plane (an emoji is two
  UTF-16 code units). Find it: call the function with each, from a scratch script
  outside the repository. Reading the function is not finding it.
- **Never-executed code.** A script, migration or branch that no run has touched. A
  test that imports the file is not a run. Find it: ask what has to happen for the
  line to execute for the first time, and whether that is production. Prefer a
  rehearsal or dry-run flag where one exists; where none exists, that is the
  finding, not a reason to execute writes against a shared database.
- **Unvalidated assumption about another system.** A column name, response shape,
  status code or documented behaviour taken on trust. Find it: check each against
  the schema, the SDK's own types, or the vendor's documentation. A test fixture
  that hand-writes the other system's output proves nothing about that system.
- **State, not sequence.** An acceptance criterion that describes a
  state ("with the flag set, an edit does not overwrite") when the defect lives in
  an ordering. Find it: for each criterion in the spec, ask whether it mentions
  time; one that cannot fail on a race proves nothing about one.
- **A comment that claims safety.** Every comment saying something is safe,
  impossible or already handled is a hypothesis. Find it: construct the case that
  disproves it, and report the claims that survive as well as the ones that fall.

A finding carries the concrete input or the concrete sequence of actors and calls
that triggers it. A description of the risk is not a finding.

### 4. Spawn three sub-agents in parallel

Every prompt opens with: "You are read only. Write nothing under the repository and
nothing to any database, stage nothing, change no branch. A scratch file goes under
`$TMPDIR`; a query you want to prove runs as a read, or is reported as untested."
Every prompt
carries the diff command, the commit list, the full checklist from step 3, and a
400-word limit on the report.

- **Sequences.** Entries: read-then-write, interrupted write, swallowed failure,
  state not sequence, and comment claims. Also carries the spec from step 2. Brief:
  "For each entry, walk every hunk it applies to. Report each finding under the
  entry's name with the sequence that triggers it, actor by actor, call by call."
- **Boundaries.** Entry: boundary conditions. Brief: "List every pure function the
  diff adds or changes. For each, run it with the four inputs from a scratch script
  under `$TMPDIR` that imports from the checkout, and report the output for each
  input. Read nothing you can run." Add the runner this repo needs: `node --import
  tsx/esm`, and a loader stub for the `.svg` that `src/lib/brand.ts` imports, since
  a module that reaches it fails under plain `tsx` outside Vite.
- **Assumptions.** Entries: never-executed code and unvalidated assumptions. Brief:
  "For each script, migration and new branch, say what would run it for the first
  time. For each name, shape or behaviour the diff takes from another system, say
  where you verified it: schema file, type definition, or vendor document, with the
  path or link."

### 5. Mutate the guards (only with `mutate`)

Guard mutation runs tests against changed code, so it happens in a scratch
worktree and never in the checkout the user is working in. Both `git worktree add`
and Vitest need the command sandbox off and the file-descriptor limit raised; the
Vitest section of `docs/QUIRKS.md` says why.

1. `git worktree add --detach "$TMPDIR/mutate-<sha>" HEAD`, then symlink
   `node_modules` from the checkout. Run `npm test -- <a test file>` once, unchanged,
   to prove the worktree works before trusting a result from it. Always `npm test`,
   never bare `vitest`: the script carries the excludes that keep the integration
   suite, which truncates the dev database, out of the run.
2. List every conditional in the diff that protects something: a permission check, a
   null check before a write, a flag read, a bounds check.
3. For each guard, remove it (or invert it), run `npm test -- <the unit test files
   for the module it lives in>`, and restore it before the next. `git checkout --
   <file>` in the worktree restores it.
4. Report each guard with the tests that failed. A guard whose removal fails no
   related test is **unverified here**: say so in those words, and add whether the
   integration, smoke or accessibility suites, which this step cannot run, cover it.
5. `git worktree remove --force "$TMPDIR/mutate-<sha>"`.

### 6. Aggregate

Present the reports under `## Sequences`, `## Boundaries`, `## Assumptions` and, if
it ran, `## Mutation`, verbatim or lightly cleaned, findings under the checklist
entry names. Keep the sections separate and their order fixed. End with one line
per section: finding count and the worst finding in that section. Name no winner
across sections.

## Why

`mattpocock-skills:code-review` catches code that conforms to the standards but not
the spec, and code that does what the spec says but breaks a convention. A third
case passes both: code that conforms, implements the issue, and is wrong. Its spec
axis verified "with the flag set, an edit does not overwrite" on a change whose bug
was a read of that flag, an await, then a write; the criterion and the code came
from the same reasoning and shared the blind spot. Comparing them cannot find it.
This skill asks the diff what breaks it instead of what it was meant to do, which is
why the sections stay separate: a boundary failure and a lost update are not the
same kind of finding, and ranking them against each other hides one.
