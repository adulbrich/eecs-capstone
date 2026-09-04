# Out of scope

One file per concept this project has decided not to build, so a request that
comes back is answered from the record rather than re-argued per person. `/triage`
reads this directory before it evaluates a new request, and writes a file here when
it closes an enhancement as `wontfix`; the maintainer confirms a match by hand,
because nothing here matches automatically.

An entry is a rejected concept, not a rejected issue: three issues asking for the
same thing are one file with three links. A concept that comes back with a reason
the file does not answer is a reason to reopen the decision; when it is reopened,
the file is updated or deleted, so this directory only ever says what still
stands.

## Format

One Markdown file per concept, named `kebab-case-concept.md`:

```markdown
# Concept

**Decision:** one line. What was refused.

**Reason:** the reasoning, in a paragraph. Enough that the next requester can see
whether their case is the one this file already answers.

**Prior requests:** #12, #34
```

The three bold fields are the whole contract. Add a paragraph after them only when
the decision came with a condition under which it would be revisited; a decision
whose thread says only "not now" is a deferral, not a rejection, and stays an
issue rather than becoming a file.
