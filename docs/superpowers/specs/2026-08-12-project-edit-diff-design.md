# Close the field-diffing TODO, properly: design

Date: 2026-08-12

Sixth candidate from the architecture review of the inventory and projects hot
spots, and the only one that starts from a TODO the codebase wrote about
itself.

The governing principle:

> **A suppression whose stated remedy has been carried out and which is still
> there is worse than one nobody has touched.**

---

## What the TODO says, and why it is not enough

`src/server/_internal/projects.ts:125`:

```ts
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: TODO large update path, decompose field-diffing in a follow-up
export async function updateProjectAs(
```

A spike carried out exactly that instruction: the eighteen-line diff loop
(`:164-181`) came out into a helper and the suppression came off. Biome still
failed:

```
Excessive complexity of 21 detected (max: 20).
```

One over. The remaining weight is the twenty-five-line `newValues`
construction, which carries two conditionals and a ternary around an `await`, on
top of the gate, the transaction and the embedding refresh.

Extracting the values builder as well brings it under. Verified with the spike:
`check` clean, `typecheck` clean, 322 integration tests passing. The spike was
reverted; this spec is what it produced.

So doing only what the TODO says would leave the suppression in place with its
reason no longer true, and the next reader would have no way to tell whether the
decomposition had been tried.

## Design

Two extractions and a deletion.

**1. `diffProjectFields` moves to `src/lib/project-edit-diff.ts`,** with
`PROJECT_EDITABLE_FIELDS` alongside it.

```ts
export const PROJECT_EDITABLE_FIELDS = [...] as const;

export function diffProjectFields(
  existing: Record<string, unknown>,
  next: Record<string, unknown>
): {
  changedFields: string[];
  newDiff: Record<string, unknown>;
  oldDiff: Record<string, unknown>;
};
```

The constant moves because a `src/lib/` module must not import from
`_internal/`, and it belongs next to the loop that consumes it anyway. It is a
plain string array with no server dependencies. `projects.ts` imports it back.

**2. `buildProjectValues` stays private in `_internal/projects.ts`.** It awaits
`resolveProposerId`, a database read, so it is inherently server-side and gets
no unit test. Its job after this change is to be readable, not testable in
isolation.

**3. The `biome-ignore` is deleted.**

`updateProjectAs` keeps the gate, the early return, the transaction and the
embedding refresh, and reads as four steps instead of one long one.

### Why not go further

- **Not splitting `buildProjectValues` to isolate a pure core.** That would be
  extraction for its own sake. The integration suite already covers both
  branches that matter: staff writing `proposerEmail`, and a non-staff save
  leaving `notes` alone.
- **Not injecting the proposer lookup** so the builder could live in `src/lib/`
  too. One caller means a hypothetical seam, and this review has argued against
  that consistently.

## Tests

The loop encodes three rules and the interesting one is protected by a comment
rather than a test:

> A field the viewer was not allowed to write never made it into `newValues`,
> and `.set()` leaves it alone. Diffing it anyway would log a phantom "changed
> to null" edit for a value that is still in the row.

Unit tests, in `npm test` with no docker:

- **The phantom-null guard**: a field present on `existing` but absent from
  `next` produces no entry, even when its stored value is not null. This is the
  case a future edit could plausibly break.
- Equal values produce no entry, including when one side is `undefined` and the
  other `null`, which the `?? null` normalization makes equivalent.
- `changedFields` follows the declared field order rather than key insertion
  order.
- `oldDiff` and `newDiff` carry only changed keys, and carry the old and new
  values respectively.

The two integration tests that assert on the edit log
(`projects.integration.test.ts:169` and `:514`) stay unchanged. They are the
proof the extraction was faithful.

## Constraints

- **No behaviour change.** Same edit-log rows, same `changedFields`, same
  early-return-when-nothing-changed, same transaction.
- **No wire-format change, no migration, no new dependency.**
- **`PROJECT_EDITABLE_FIELDS` keeps its exact contents and order.** The order is
  observable: it decides the order of `changedFields`, which the edit log stores
  and the staff panel renders.
- **Stage files by name. Never commit to `main`.** Branch
  `refactor/project-edit-diff`.

## Deliberately not in scope

- **The other `biome-ignore` comments in the codebase.** `QUIRKS.md` records
  which Biome rules are relaxed and why; this touches one suppression because
  its comment says TODO and names the work.
- **The `AnyForm = any` escape**, noted as a separate open question during the
  form-adapter work and still open.

## What this buys

- **A TODO closes, and the suppression it justified goes with it.** Not
  relocated, deleted.
- **The subtlest rule in the update path gains a test.** The phantom-null guard
  currently has a comment and nothing else.
- **`updateProjectAs` reads as four steps**: authorize, build, diff, write.
- **A pure rule becomes testable without docker.** Today asserting on
  `changedFields` costs a Postgres round trip and a Better Auth sign-up.
