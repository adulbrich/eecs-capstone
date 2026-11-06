---
name: correctness-review
description: Sweep the changes since a fixed point (commit, branch, tag, or merge-base) for known defect classes, the way code-review sweeps for smells, and report each finding with the input or sequence that triggers it. Use when a diff touches behaviour and the question is "is it wrong", not "does it conform"; with `mutate`, also removes each guard in the diff and reports the ones no test catches.
---

Correctness sweep of the diff between `HEAD` and a fixed point the user supplies.
Three read-only sub-agents run in parallel, each with one way of finding things:
reading the diff for sequences, running properties over pure functions, and
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
`docs/agents/issue-tracker.md`; a path the user passed; for pre-2026-10 work only,
a design doc under `docs/superpowers/specs/` matching the branch. If none exists,
that entry reports "no spec".

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
  UTF-16 code units). Find it: a `test.prop` property whose generator reaches each
  of those, run against the checkout from a scratch file outside the repository. A
  random string almost never lands on a cap of 12,000, so aim the generator at the
  cap. Reading the function is not finding it.
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
- **Boundaries.** Entry: boundary conditions. Brief: _The Boundaries brief_ below,
  pasted whole. The property source it hands back sits outside the 400 words.
- **Assumptions.** Entries: never-executed code and unvalidated assumptions. Brief:
  "For each script, migration and new branch, say what would run it for the first
  time. For each name, shape or behaviour the diff takes from another system, say
  where you verified it: schema file, type definition, or vendor document, with the
  path or link."

#### The Boundaries brief

Read each function, state what must hold for every input, run each claim as a
property, triage what fails. The properties that hold are the author's to commit to
the module's test file, so the work outlives the review.

1. **List** every pure function the diff adds or changes. When the list outgrows
   the budget, take first the functions that cut, cap, count, tag or parse a date,
   and name the rest under "not run".
2. **State** the claims that hold for every input of its type, from its doc
   comment, its callers and the spec: within its cap, well-formed (`isWellFormed`),
   no empty or half-written tag, a prefix of its input, a round trip, idempotent,
   never throws. Write each claim as one `test.prop` from `@fast-check/vitest`, in
   the style of the module's test file: fast-check's default run count, no setup
   file.
3. **Generate** from the shared arbitraries in `src/test/shared/arbitraries.ts`,
   and `src/test/shared/project-arbitraries.ts` for the hashed builders; their
   comments say what each draws. Aim at every cap: `trickyTextAcross(limit)` for
   one string, and for a budget spent across fields, filler sized from the
   function's own output so the room left for each later field lands at and just
   above zero, as `titleLeaving` does. Draw only the parts that vary and build the
   filler in the test body, so a counterexample prints on one line. Use `fc`
   builtins where no shared arbitrary fits.
4. **Run** with the command sandbox off for every step: `$TMPDIR` names a
   different directory inside the sandbox, and Vitest needs it off
   (`docs/QUIRKS.md`). With the sandbox off, read only is yours to keep: read other
   commits with `git show <ref>:<path>`, and run no `checkout`, `switch`, `stash`,
   `add`, `commit`, `merge`, `reset` or `worktree`.

   ```bash
   C=$(git rev-parse --show-toplevel); N="$C/node_modules"
   D=$(mktemp -d "$TMPDIR/boundaries.XXXXXX"); echo "$D"
   mkdir -p "$D/node_modules/@fast-check"
   for p in vitest fast-check @fast-check/vitest; do ln -s "$N/$p" "$D/node_modules/$p"; done
   ```

   Write `$D/<module>.test.ts`, importing the module and the arbitraries by
   absolute path under `$C`: `#/` resolves only for a file inside a checkout, and
   the module's own `#/` imports still do. Then run:

   ```bash
   ulimit -n 8192; "$N/.bin/vitest" run --root "$D"
   ```

   With `--root "$D"` Vitest loads no config and collects only `$D`, so the
   checkout's integration files stay out; that is why a bare `vitest` is right here
   while step 5 uses `npm test`. Shell variables end with each call, so carry the
   absolute paths.

   A checkout older than #840 lacks the pieces. Without
   `src/test/shared/arbitraries.ts`, copy it from `main` and import `./arbitraries`;
   it imports only `@fast-check/vitest`, so it runs at any commit:

   ```bash
   git show origin/main:src/test/shared/arbitraries.ts > "$D/arbitraries.ts"
   ```

   `project-arbitraries.ts` imports through `#/` and cannot be copied, so build
   project inputs inline. Without `$N/@fast-check/vitest`, set `N` to a
   `node_modules` that has it, such as the `main` checkout's in
   `git worktree list`, and run that copy's `vitest`: the runner and
   `@fast-check/vitest` must load the same Vitest. If no checkout has it, report
   the step as not run.
5. **Triage** every red property: a **bug** when the counterexample breaks the doc
   comment, a caller or the spec; an **overreach** when the property claimed more
   than the function promises. Replay it with its seed and path first
   (`docs/QUIRKS.md`, "A failing property prints a seed and a path").
6. **Report** per property: the function, the claim, then pass, or the shrunk
   counterexample with its seed, path and triage. Then the "not run" names and
   `$D`. After the report, one fenced block per destination test file (the
   module's existing one, or where a new one would go), headed by its path,
   holding the properties that passed and the bugs, which pass once the fix lands.
   Import as that file does, through `#/`. Leave the overreaches out.

### 5. Mutate the guards (only with `mutate`)

Guard mutation runs tests against changed code, so it happens in a scratch
worktree and never in the checkout the user is working in. Both `git worktree add`
and Vitest need the command sandbox off; the Vitest section of `docs/QUIRKS.md`
says why.

1. `git worktree add --detach "$TMPDIR/mutate-<sha>" HEAD`, then symlink
   `node_modules` from the checkout. Run `npm test -- <a test file>` once, unchanged,
   to prove the worktree works before trusting a result from it. Always `npm test`,
   never bare `vitest`: the script carries the excludes that keep the integration
   suite out of the run (`docs/QUIRKS.md`, "TRUNCATE in tests wipes dev data").
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
entry names. Close `## Boundaries` with its property blocks whole: they are what
the author commits. Keep the sections separate and their order fixed. End with one line
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
