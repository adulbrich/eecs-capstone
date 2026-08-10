# Transition as sole writer, and Hold as a module: design

Date: 2026-08-10

Two related deepenings in the inventory subsystem, from an architecture review
of the repository's hottest file (`src/server/_internal/inventory.ts`, 1849
lines, 50 exports, 22 touches in the last 200 commits, zero unit tests).

Part A makes `transitionItem` the sole writer of item status that
`docs/QUIRKS.md` already claims it is. Part B gives the hold identity rules one
module instead of six copies.

The governing principle, which every decision below follows from:

> **An invariant enforced by convention is not enforced. Put it behind an
> interface that callers cannot go around.**

---

## Current behavior

### Part A: four writers, three of them undocumented

`docs/QUIRKS.md` states that `transitionItem` "is the only place that writes
`inventory_item_status_history` rows and the only place that syncs
`current_holder_*` columns with the item status." A grep for
`.update(inventoryItems)` paired with `insert(inventoryItemStatusHistory)`
finds four production writers:

| Writer | Location | Why it bypasses |
| --- | --- | --- |
| `transitionItem` | `inventory-transitions.ts:216` | the documented chokepoint |
| `submitCartAs` | `inventory.ts:865` | runs as the student; `transitionItem` asserts staff |
| `rejectRequestItemAs` | `inventory.ts:1036` | custom notification, custom line status |
| `cancelRequestItemAs` | `inventory.ts:1119` | runs as the requester; emits no notification |

Two further sites write `inventoryItems` but touch attribute columns only
(`updateInventoryItemAs:607`, `uploadInventoryImageAs:1697`). They are not
writers in this sense and are out of scope.

**This has already cost a fix.** Commit `4c22016 fix(inventory): clear the
walk-in name and program on reject and cancel` is exactly the drift the
duplication predicts: two new hold columns were added, two of the four writers
learned about them, and two did not. The nine-column reset is currently
hand-written three times.

### Part B: one rule, six copies

`docs/QUIRKS.md` states the domain rule once: a hold is on a person (an
address, with or without a matching account) or on a thing (a label), never
both and never neither. Six places re-derive some part of it:

| Location | What it decides |
| --- | --- |
| `inventory-transitions.ts:186` `resolveHolder` | a supplied address beats a supplied id |
| `inventory-transitions.ts:248` | a resolved account beats a typed name and program |
| `inventory.ts:144` `holderEmailOf` / `holderNameOf` | a joined account beats the stored columns |
| `inventory.ts:179` `storedHolderIdentity` | stored columns, unreconciled |
| `inventory-lifecycle-panel.tsx:100` `holderFields` | which fields the payload may carry |
| `inventory-lifecycle-panel.tsx:159` `formatHolderDisplay` | name, then address, then label, rendered rich |
| `admin/inventory/index.tsx:161` | name, then address, then label, rendered plain |

The last two share a precedence order but not a format: the panel renders
`Name (address) · Program` and the admin table renders a bare
`name ?? address ?? label`. They are two renderings of one rule, not one rule
written twice, so the module owns the order and exposes both formats rather
than collapsing them into one. No module owns "who is holding this item."

### Three facts that shape the design

1. **`transitionItem` has about 90 call sites in
   `src/server/__tests__/inventory.integration.test.ts`** (2716 lines). That
   suite is the only executable specification of inventory lifecycle behavior
   that exists.
2. **No functional end-to-end coverage exists, and neither suite runs in CI.**
   `test:accessibility` is an accessibility and admin-table suite; its
   inventory tests load pages and run axe, and none of them walk a lifecycle.
   CI runs `check`, `typecheck`, `npm test`, `build`, `check:compression`, and
   `npm test` excludes both `*.integration.test.ts` and `*.a11y.test.ts`.
3. **`transitionInventoryItem` has no staff guard of its own.**
   `src/server/inventory.ts:275` calls `requireUser()` and nothing else. The
   `assertStaff` inside `transitionItem` is the only thing preventing any
   signed-in user from reserving, checking out, or retiring any item.

Fact 2 is why this design is **additive only**: the safety net is thin and
opt-in, and rewriting it in the same change as the code it verifies would
remove the net while working under it. Fact 3 is why the staff gate stays
inside `transitionItem` rather than moving out to call sites.

---

## Part A: make `transitionItem` the sole writer

### Authority: default-deny, with named exceptions

`transitionItem` keeps `assertStaff(viewer)` as its default. `TransitionInput`
gains one optional field naming the non-staff authority the caller has already
verified:

- `"self_cancel"`, for a requester closing their own line
- `"self_request"`, for a student submitting their own cart

Any other value, and the absence of the field, means staff. `transitionItem`
accepts only these two named authorities and still rejects everything else.

Two properties follow. Every one of the ~90 existing call sites omits the
field, gets `assertStaff`, and behaves identically, including the
`transitionItem throws Forbidden for a non-staff viewer` test at line 1462. And
each bypass becomes self-documenting at its call site rather than implicit in
the absence of a check.

The alternative considered and rejected was moving authorization out to the
four call sites. It contradicts the principle this whole change serves, and
given fact 3 it would silently open `transitionInventoryItem` to any signed-in
user unless the `requireRole(["admin", "instructor"])` swap were remembered at
the same time.

### The request-line outcome is passed, not derived

`closeRequestItemOnRelease` today picks `returned` when the item was checked
out and `cancelled` otherwise. Reject needs a third outcome, `rejected`, plus
`reviewComment`, `reviewedBy` and `reviewedAt`.

The outcome cannot be derived. Rejecting a pending line and releasing a
reserved item both end at `available` with a comment, and only the caller knows
which one it is. `TransitionInput` therefore gains an optional line-outcome
field; absent, the existing derivation applies unchanged.

### Notifications stay inside, and cancel's silence is derived

`maybeNotify` grows one arm for the reject outcome, emitting
`inventory_request_rejected` with the review comment as the message.
`notifications.type` is `text()`, not a Postgres enum, so this costs no
migration.

Cancel emits nothing today. That silence is not arbitrary: the requester is
both actor and recipient, so a notification would tell someone what they just
did. `maybeNotify` can already see both ids, so the rule becomes "never notify
a recipient who is the actor" and applies generally rather than as a
cancel-shaped exception.

### `submitCartAs` shares the helper, not the interface

Routing `submitCartAs` through the exported `transitionItem` would mean N
transitions inside one transaction, each re-locking a row it already holds and
re-reading an item it just read. Instead its inline write is replaced by a call
to the same private in-transaction helper `transitionItem` uses, which already
receives an open `Tx`. The exported interface keeps one writer for the outside
world, and the implementation is shared rather than copied.

---

## Part B: Hold as a module

### Location: pure, in `src/lib`

The rules are needed on the client (the lifecycle dialog and the admin table),
on the server write path, and on the server read paths. Only the account lookup
needs the database.

`src/lib/hold.ts` holds the pure rules and is importable by both tiers,
mirroring `src/lib/project-visibility.ts`, which is the precedent this repo
already trusts: pure, client-safe, unit tested, and the single place a new
private column must be registered. `QUIRKS.md` marks `src/lib/*.ts` as exactly
this. The account lookup stays in `inventory-transitions.ts` and feeds its
result in.

This is also the only arrangement that gets these rules into `npm test`. Today
every one of them is reachable only through docker Postgres.

### Shape: a discriminated union

A hold is currently five loose nullable columns in which most combinations are
illegal. It becomes a union of three cases: held by a person (an address, an
optional resolved account id, and, only when no account resolved, a name and
program), held by a thing (a label), or not held.

This is the deepening. "Not both and not neither" stops being a runtime check
in `validateInvariants` and becomes unrepresentable.

### The constructor is the one parse point

`transitionSchema` stays loose, accepting the four nullable fields it accepts
today. The Hold constructor is the single place that turns loose fields into a
union, and the single place that throws on an illegal combination.
`validateInvariants`'s `reserved` and `checked_out` arm is deleted as
redundant once every path goes through the constructor.

Tightening the wire schema into a Zod discriminated union was considered and
rejected: it is a wire-format change, out of bounds under the additive
constraint, and would require the lifecycle dialog to change what it posts.

### The wire shape keeps its flat columns

`InventoryItemStaff` keeps `currentHolderId`, `currentHolderEmail`,
`currentHolderLabel`, `currentHolderName` and `currentHolderProgram` as five
flat fields. `src/routes/_authed/admin/inventory/index.tsx:297-319` binds those
names as CSV export keys by string, so changing the shape would change the
headers of downloaded files for no architectural gain. The union is internal;
read paths use the Hold module to compute the flat columns they already return.

What does change is that both renderings of the precedence order
(`formatHolderDisplay` and the admin table's Holder column) derive from the
Hold union instead of re-deriving the order from raw columns. The module
exposes a short format and a detailed format so neither call site changes what
it puts on screen.

### The client keeps normalizing, and the server stops trusting it

`holderFields` calls the shared constructor instead of hand-rolling the rule,
and the server re-normalizes independently. The dialog still cannot compose an
illegal payload, which is the property its docblock argues for, and the server
is sound on its own rather than by agreement with a client.

### The two account lookups stay, and get documented

`HolderField` asks `lookupUserByEmail` on a 250ms debounce to decide whether to
show the Name and Program inputs. `resolveHolder` asks the same question again
inside the transaction. They can disagree if an account is created in between.

This is correct as it stands and is not being fixed. They answer the same
question for different purposes, and the disagreement window already resolves
safely, because the server drops a typed name whenever it resolves an account.
It is a fact a caller must know, so it belongs in the Hold module's interface
documentation.

---

## Constraints

- **Additive only.** No existing `transitionItem` call site changes. No
  integration test is rewritten. New fields on `TransitionInput` are optional
  and default to today's behavior.
- **No wire-format change.** `transitionSchema` and `InventoryItemStaff` keep
  their current shapes.
- **No migration.** No column is added, dropped, or renamed.
- **No back-compat shims.** Per `AGENTS.md`, the duplicated writes are deleted
  rather than deprecated.

## Deliberately not in scope

- **`updateInventoryItemAs` and `uploadInventoryImageAs`**, which write
  attribute columns only.
- **Candidates 3, 4 and 5 from the review**: inventory read visibility as a
  module, the overdue derivation, and the 57 `ForCurrentUser` wrappers.
- **Getting the integration suite into CI.** Worth doing, and a prerequisite
  if the interface is ever opened up beyond additive changes, but a separate
  change that should land green on its own.

## What this buys

- **Locality.** The next hold column is added in one implementation instead of
  three, and the precedence rule changes in one module instead of six.
- **Leverage.** One transition interface behind four callers; one Hold
  interface behind seven call sites across three tiers.
- **The interface becomes the test surface.** The precedence rules and the
  legal-combination rules become unit testable in `npm test`, with no docker
  Postgres. Today neither is reachable without it.
