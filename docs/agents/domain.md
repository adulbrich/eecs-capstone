# Domain docs

How the engineering skills consume this repo's domain documentation when exploring
the codebase. Single context: one `CONTEXT.md` at the repo root and `docs/adr/` for
decisions.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root: the glossary. Projects, inventory, people and
  roles, each term with the words to avoid.
- **`docs/adr/`**: one paragraph per decision that is hard to reverse, surprising
  without context, and the result of a real trade-off. Read the ones that touch the
  area you are about to work in.

Neither exists yet. Until they do, the vocabulary and the decisions live in
`docs/QUIRKS.md` under the Inventory, Projects and Project conventions headings, and
in `PRD.md`. Proceed with those; do not flag the absence. `/domain-modeling` (reached
through `/grill-with-docs`) creates both lazily as terms and decisions are resolved,
and the issue that moves the existing material over is the plan for that.

## Use the glossary's vocabulary

When your output names a domain concept (an issue title, a test name, a refactor
proposal), use the term the glossary defines, not a synonym it avoids. Two that
already bit: the borrow list is not a cart (#197), and a project closes to
applicants rather than being archived (#200).

If the concept you need is not in the glossary, either you are inventing language
the project does not use (reconsider) or there is a real gap (note it for
`/domain-modeling`).

## Flag ADR conflicts

If your output contradicts a recorded decision, say so rather than silently
overriding it:

> Contradicts ADR-0002 (one named wrapper per action), but worth reopening because...

Until `docs/adr/` exists, the decisions to check against are the ones QUIRKS marks as
considered and rejected, such as collapsing the `*ForCurrentUser` wrappers into one
adapter.
