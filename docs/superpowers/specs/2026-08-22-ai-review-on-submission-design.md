# AI review on the submission page, and the rate limit it requires: design

Date: 2026-08-22
Status: Approved design, ready for implementation planning

## Summary

Wire "Improve with AI" into the project submission page (`/projects/new`), where
no project row exists yet. Today the feature is reachable only from the edit page,
so a first-time proposer gets no help until after they have committed a draft,
which is the opposite of when they need it.

`reviewProject` currently authorizes by loading the project and calling
`canEditProject`. With no row to load, that gate has nothing to check. This design
makes `projectId` optional and authorizes a projectless review on the session
alone: unsaved text the proposer just typed belongs to nobody else, so ownership
is the wrong question to ask about it.

Ownership was also acting as an incidental brake on abuse, because you had to own
a project to spend money. Removing it makes the `ai_review_usage` limiter named in
the 2026-05-29 design a prerequisite of this change rather than a follow-up to it.
Both are specified here and the plan sequences the limiter first.

## Goals

- A proposer can improve their proposal before saving anything.
- Every review, with or without a project, is bounded per user per window.
- The spend of a review is recorded well enough to answer what a reasoning-effort
  change costs, which is currently unanswerable.
- The existing authorization for reviews that do name a project is unchanged.

## Non-goals

- Persisting suggestions or review history. Reviews remain synchronous and are
  lost on navigation, as the 2026-05-29 design intended.
- Asynchronous or streaming reviews.
- Per-role limits or exemptions.
- Pruning old `ai_review_usage` rows. Volume is bounded by the limiter itself;
  revisit if it ever stops being.
- Locally persisting the in-progress form. That is issue #56 and needs its own
  spec.

## Decisions

### 1. One server function, with an optional `projectId`

`reviewInputSchema.projectId` becomes optional. `reviewProjectAs` branches on its
presence:

- **With an id**: load the project, `canEditProject`, unchanged. A stranger is
  still rejected, a missing project is still an error.
- **Without one**: no lookup. The verified session is the whole gate.

Not two functions. The repo convention is one server function per workflow
action, and "review this text" is one action whose subject is optional. Two
entry points would double the surface that has to enforce the limiter.

### 2. The input caps are the real defense, and they already exist

A projectless review lets any verified user post arbitrary text. `reviewInputSchema`
already caps every field (200 title, 5000 description, 5000 problem statement,
5000 objectives, 2000 and 2000 qualifications, 1000 license), which bounds one
call at roughly 21k characters. That existing cap is what makes opening this up
safe. It must not be loosened as part of this work.

### 3. `ai_review_usage` does double duty

The table is the limiter's counter and the usage log in one. Storing token counts
alongside the timestamp turns "should reasoning effort be higher" from an argument
into a query.

```ts
export const aiReviewUsage = pgTable("ai_review_usage", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .references(() => user.id, { onDelete: "cascade" })
    .notNull(),
  projectId: uuid("project_id").references(() => projects.id, {
    onDelete: "set null",
  }),
  model: text("model").notNull(),
  reasoningEffort: text("reasoning_effort").notNull(),
  inputTokens: integer("input_tokens"),
  reasoningTokens: integer("reasoning_tokens"),
  outputTokens: integer("output_tokens"),
  reviewedFieldCount: integer("reviewed_field_count"),
  outcome: text("outcome").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
```

`project_id` is nullable because projectless reviews are the point of this change.

**FK rules**, per the convention that they are decided in the schema and never
recomputed at runtime:

- `user_id` is `CASCADE`. This is metering scoped to an account, not authorship.
  `RESTRICT` would block deleting a user over a rate-limit counter.
- `project_id` is `SET NULL`. Deleting a project should not erase the record that
  money was spent.

Index on `(user_id, created_at)`, which is the only shape the limiter queries.

`outcome` is one of `ok`, `truncated`, or `failed`. It is what distinguishes a
reasoning-effort bump that is working from one that is quietly eating the output
budget, which is the failure mode that made `xhigh` a bad first move.

### 4. Limits: 10 per hour, 40 per day, no exemptions

Read from `AI_REVIEW_LIMIT_PER_HOUR` and `AI_REVIEW_LIMIT_PER_DAY`, defaulting to
those values. Generous enough that no honest proposer meets them; the job is
bounding a runaway, not budgeting.

No role exemption. An admin in a loop spends the same money as anyone else.

### 5. Every attempt that reaches Bedrock is counted

The check runs before the call; the row is written after it, with the outcome that
actually occurred. A truncated response has already been paid for in full, so
counting only successes would let a user spend without limit by repeating a call
that fails.

The recording is conditional on a call having been made, not on the handler having
been entered. `runProjectReview` already short-circuits an entirely empty form
without touching Bedrock, and that path spends nothing and writes no row, so it
must not sit inside a blanket `finally`. The same holds for a call the limiter
itself rejected. In practice that means wrapping the invoke, not the function
body, and treating "no usage block returned" as "nothing to record".

Two concurrent requests can both pass the check and overshoot by one. That is
bounded by concurrency and not worth a lock; the limiter exists to stop a loop,
not to be exact.

### 6. The limiter lives in `reviewProjectAs`

Not in the `ForCurrentUser` wrapper. The `*As` seam is what the integration suite
crosses, and a limiter the tests cannot reach is a limiter nobody will notice
breaking.

### 7. The review button is disabled until there is something to review

`runProjectReview` already returns an empty result without calling Bedrock when
every field is blank. On the edit page that is unreachable in practice; on a fresh
submission form it is the default state, so clicking Review on an empty form
currently produces "No improvements suggested", which reads as a bug rather than
as an instruction. Disable the button until at least one reviewable field has
content.

## Architecture and data flow

```
project-form.tsx  handleReview
  |  sends the live form values; projectId only when the form has one
  v
reviewProject (server fn)          projectId optional in the schema
  v
reviewProjectForCurrentUser        requireUser()
  v
reviewProjectAs(viewer, input)
  |  1. if input.projectId: load, canEditProject, else throw
  |  2. assertReviewWithinLimit(viewer.id)      <- throws before spending
  |  3. runProjectReview(fields)                 <- returns early if all blank
  |  4. recordReviewUsage(...) if a call happened <- outcome + tokens
  v
mantleResponses -> bedrock-mantle
```

Steps 2 and 4 are the only new ones. Step 1 keeps its current behaviour whenever
an id is present.

## Components

**`src/server/_internal/ai-review-usage.ts`** (new). Two functions and nothing
else:

- `assertReviewWithinLimit(userId)`: counts rows in both windows in a single
  query and throws a user-facing error naming the window that was hit.
- `recordReviewUsage(row)`: one insert. Never throws into the caller; a metering
  failure must not turn a successful review into an error the user sees.

Keeping these out of `project-review.ts` means the limiter can be tested without
constructing a project, and read without reading the review flow.

**`src/server/_internal/project-review-core.ts`**. `runProjectReview` returns the
`usage` block from the Responses API alongside the suggestions so the caller can
record it. The client-facing `ReviewResult` is unchanged; token counts are server
business.

**`src/routes/_authed/projects/new.tsx`**. Passes `enableAiReview`.

**`src/components/project-form.tsx`**. `handleReview` drops its `!projectId` early
return and sends the id only when present. The Review button gains a disabled
condition on empty content.

## Error handling

The limiter throws a message the proposer can act on: it names the window and when
it resets, rather than "Forbidden". This surfaces through the existing
`reviewError` path in the form, which already renders a server error inline, so no
new UI is needed.

Metering failures are swallowed and logged, never surfaced. Losing a usage row
degrades the limiter slightly; failing the review degrades the product.

## Tests

**Integration** (`project-review.integration.test.ts`), through `reviewProjectAs`:

- A projectless review succeeds for any verified user.
- A review naming a project still rejects a user who cannot edit it.
- The call after the hourly limit throws, and does so before the injected
  Bedrock fake is called. Asserting the fake was not reached is the test that
  the limit saves money rather than merely reporting an error.
- A failed review still writes a usage row and still counts.

**Unit** (`ai-review-usage.test.ts`): window boundaries, rollover, and that the
daily limit binds even when the hourly one has room.

**Component** (`project-form-ai-review.test.tsx`): the submission page renders the
review block; the button is disabled on an empty form and enabled once a field has
content.

## Constraints

- The limiter must be database-backed. ECS runs more than one task, so an
  in-process counter enforces nothing.
- The migration is `drizzle-kit generate`, not a hand-written SQL file.
- `reviewProjectAs` keeps its signature shape so existing callers and tests do
  not move.

## Documentation

- `docs/QUIRKS.md`, Amazon Bedrock section: the limiter and what counts toward it.
- `.env.example` and `infra/`: the two limit variables, threaded the way the other
  `BEDROCK_*` variables already are.

## Future work

- Persisted, asynchronous reviews, still the seam the 2026-05-29 design left.
- A staff view of `ai_review_usage` if spend ever needs watching rather than
  bounding.
- Pruning, if the table outgrows its purpose.
