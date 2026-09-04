# Domain docs

How the engineering skills consume this repo's domain documentation when exploring
the codebase. Single context: one `CONTEXT.md` at the repo root and `docs/adr/` for
decisions.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root: the glossary. Projects, inventory, people and
  roles, each term with the words to avoid. It is a glossary and nothing else; no
  implementation detail lives there.
- **`docs/adr/`**: one paragraph per decision that is hard to reverse, surprising
  without context, and the result of a real trade-off. Numbered `NNNN-slug.md`. Read
  the ones that touch the area you are about to work in.

`docs/QUIRKS.md` is the third file: the gotchas. Where a QUIRKS section used to argue
a decision it now points at the ADR in one line, so a decision has one home.

## Use the glossary's vocabulary

When your output names a domain concept (an issue title, a test name, a refactor
proposal), use the term the glossary defines, not a synonym it avoids. Two that
already bit: the borrow list is not a cart (#197), and a project closes to
applicants rather than being archived (#200).

If the concept you need is not in the glossary, either you are inventing language
the project does not use (reconsider) or there is a real gap (note it for
`/domain-modeling`, which adds the term as it is resolved).

## Flag ADR conflicts

If your output contradicts a recorded decision, say so rather than silently
overriding it:

> Contradicts ADR-0002 (one named wrapper per action), but worth reopening because...

## Adding to them

A term is resolved in `CONTEXT.md` the moment it is settled, with an `_Avoid_` line
naming the synonyms the codebase retired. A decision gets the next number in
`docs/adr/` only when all three tests hold; `AGENTS.md` says where everything else
goes.
