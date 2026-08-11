# One writer for the project transition: design

Date: 2026-08-11

Second candidate from the architecture review of the inventory and projects hot
spots. `performTransitionAs` and `forceTransitionAs` share fifty-six lines that
are byte-identical, comments included, and three ordering rules that exist only
as prose a caller has to read and obey.

The governing principle:

> **An ordering rule that lives in a comment is a rule the next caller can
> break without noticing. Put it where it cannot be skipped.**

---

## What is actually duplicated

`src/server/_internal/projects.ts:219-288` and `:364-434`. The identical region
runs from `assertChangesRequestedHasComment` through `return { id, status:
target };`: perform `:233-288` against force `:379-434`, fifty-six lines with
zero differences. It contains the transaction (status update, history row,
notifications), the embedding refresh, and the email dispatch, plus both of the
comments explaining why the last two sit outside the transaction.

Only the gates differ:

| | `performTransitionAs` `:227-232` | `forceTransitionAs` `:372-378` |
| --- | --- | --- |
| Order | load, then authorize | authorize, then load |
| Who may act | staff, or the proposer | staff only |
| Which target | `assertTransitionAllowed(from, to, role)` | any, except the one it is already in |

That ordering difference is observable and is preserved deliberately. A
non-staff caller naming a nonexistent id gets "Project not found" from perform
and "Forbidden" from force. Force arguably has it right, since it does not
confirm the row exists to someone who may not read it, but unifying them is an
information-disclosure change with its own reasoning and does not belong inside
a refactor.

## The force path is unverified, which is the real risk

The whole premise of the extraction is that the two bodies are equivalent.
Nothing currently checks that. Across the integration suite `forceTransitionAs`
appears four times: one `rejects.toThrow(/Forbidden/)` (`:248`), one email case
(`:559`), and twice as setup for unrelated tests. **No test asserts that the
force path writes a history row, writes a notification, or refreshes the
embedding.**

So the duplicated body is duplicated unverified body on one side, and "did the
two really match" is a review question rather than a checked one. This design
turns it into a checked one before touching the code.

## The three ordering rules, and which are enforced

- **Notifications go inside the transaction.** Already structural:
  `recordStatusChangeNotifications` (`src/server/_internal/notify.ts:22-46`)
  takes a `Tx` as its first parameter, so it cannot be called outside one.
- **The embedding refresh goes strictly after commit.** Enforced by nothing.
  `refreshProjectEmbedding` takes no `tx`, uses the module `db`, re-reads the
  row, and returns `"skipped"` unless the status is already `published`
  (`project-embeddings.ts:42-53`). **Calling it inside the transaction does not
  error. It silently does nothing.** That is the least obvious hazard on this
  path and the reason the rule exists.
- **The email goes strictly after commit**, so a failed send cannot undo an
  approval. `notifyTransitionByEmail` swallows its own errors, so the failure
  mode here is mild.

## Design

One private function in `src/server/_internal/projects.ts`, beside its two
callers:

```ts
async function commitTransition(
  actorId: string,
  project: typeof projects.$inferSelect,
  target: Status,
  comment: string | null,
  opts?: TransitionOptions
): Promise<{ id: string; status: Status }>;
```

It owns everything after the gate: the transaction, then the embedding, then
the email, then the return value. Each public function keeps only its gate and
ends with

```ts
return commitTransition(viewer.id, project, target, comment ?? null, opts);
```

### The decisions behind that, and why

- **Everything post-gate goes behind the seam, not just the transaction.** If
  the caller still sequenced the embedding and the email, it would still have to
  know they come after commit, and the duplicated comment would stay duplicated.
  The point is that the caller learns one call rather than a three-step order.

- **It takes the loaded row, not the id.** Both gates already call
  `loadProjectOr404` because both need the row to authorize. Passing the id
  would add a second read and a race window, and `notifyTransitionByEmail` needs
  four of the row's fields anyway.

- **It takes `actorId: string`, not the viewer.** The shared body uses the
  viewer for exactly two things, `changedBy` on the history row and the actor
  for notification suppression, and both are `viewer.id`. The role matters only
  in the gates. Narrowing the parameter is what makes "this function does not
  decide who may act" true by construction rather than by convention.

- **`assertChangesRequestedHasComment` moves inside.** It is a rule about
  whether the transition is well formed, not about who may perform it, and it is
  byte-identical in both callers. The gates keep what genuinely differs.

- **`comment` is normalized to `string | null` at the seam.** The public
  functions take `comment?: string` and the shared region does `comment ?? null`
  twice. Normalizing once at the boundary removes both.

- **It returns `{ id, status }`.** A `void` version would leave two callers
  building the same object from the same inputs, which is the duplication being
  removed.

- **No `externalTx` parameter.** Inventory's `transitionItem` has one because
  four callers invoke it from inside their own transaction; no project caller
  does, and one adapter is a hypothetical seam. It would also actively conflict
  with the design: `externalTx` is exactly what forces `transitionItem` to have
  zero post-commit work, since it can return with the caller's transaction still
  open. This path needs post-commit work.

- **Private, in `projects.ts`, not a new `project-transitions.ts`.** The
  symmetry with `inventory-transitions.ts` is real but the sizes are not
  comparable: that file is 726 lines serving four callers across three files,
  this is roughly fifty lines serving two callers in the same file.

## Tests

**Characterization first, in a commit before the refactor.** Add the assertions
the force path has never had: that it writes the status and a
`project_status_history` row, that it records a notification for the proposer,
and that publishing through it refreshes the embedding. Written against the
current code, they are what proves the extraction preserved behaviour. Written
afterwards, they prove only that the new code agrees with itself.

**If one of them fails, stop.** That would mean the two bodies were never
equivalent, which is a finding with its own commit and its own reasoning, not
something to fold into a refactor. Do not encode the current behaviour as
correct just because it is current.

No new tests for the ordering rules. Post-commit isolation is already covered by
"does not roll back the transition when the email fails"
(`projects.integration.test.ts:536`) and "still publishes when embedding fails"
(`project-embeddings.integration.test.ts:151`), and the notification rule is
enforced by the `Tx` parameter type.

## Constraints

- **No behavior change.** Same writes, same order, same errors, including the
  two gates' differing load-versus-authorize order.
- **No wire-format change**, no migration, no new dependency.
- **The nine `createServerFn` endpoints and both `*ForCurrentUser` wrappers are
  untouched.** Eight endpoints reach `performTransitionAs` and one reaches
  `forceTransitionAs`; none of them changes.
- **Stage files by name. Never commit to `main`.** Branch
  `refactor/project-transition-writer`.

## Deliberately not in scope

- **Unifying the two gates' load-versus-authorize order.** Force not confirming
  a row's existence to a non-staff caller is probably the better behaviour, but
  changing perform to match is an information-disclosure decision that deserves
  to be argued on its own rather than smuggled in under a refactor.

- **`softDeleteProjectAs` and `restoreProjectAs`.** Both write `projects` rows
  and send notifications, and neither is a status transition: they write
  `deletedAt` and no history row. They stay outside this rule, which is why the
  documented invariant below is scoped to the history table rather than to
  "project status writes".

- **Giving `refreshProjectEmbedding` a loud failure when called mid-transaction.**
  Worth doing, and it would convert the silent `"skipped"` into an error a test
  could catch. It changes a shared helper that `updateProjectAs` also calls, so
  it is its own change.

- **The remaining review candidates**, including `projectDetailView`, the
  duplicated form adapters, and the six copies of debounced search.

## Documentation

A `QUIRKS.md` entry in the Projects section, claiming only what the check
proves: `commitTransition` is the sole writer of `project_status_history`,
verifiable with

```bash
grep -rn 'insert(projectStatusHistory)' src --include='*.ts' | grep -v __tests__
```

which returns two hits today and one after. It must say what the claim does
**not** cover: soft delete and restore write `projects` rows without being
transitions, and `update(projects)` has six legitimate non-status writers, so
the wider claim "one writer of project status" would be false the moment anyone
checked it.

The entry also records the three ordering rules and the fact that a mid-
transaction `refreshProjectEmbedding` fails silently rather than loudly.

## What this buys

- **Ordering becomes implementation, not prose.** One place sequences the
  transaction, the embedding and the email.
- **Locality**: a new side effect on the transition path is added once.
- **The force path gains its first real coverage**, and afterwards both paths
  share a body that the perform tests already exercise heavily.
- **A third transition would cost a gate**, not fifty-six lines.
- **The duplicated comment stops being able to drift** from the code it
  describes on one side but not the other.
