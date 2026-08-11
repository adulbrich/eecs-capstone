# Inventory deadlines as a module, and overdue made visible: design

Date: 2026-08-11

Fourth candidate from the architecture review of
`src/server/_internal/inventory.ts`. The review described it as "a write hidden
inside a read". That is real, but checking the premise turned up something
bigger.

The governing principle:

> **A failure nobody can observe is not handled, it is hidden. And a rule the
> docs promise but the UI never performs is a bug, not a doc problem.**

---

## Current behavior

### The docs promise badges the app does not render

`docs/QUIRKS.md` states: "The 'past pickup window' / 'overdue' badges are
computed at query time."

There are no badges. `/my/items` renders `Pick up by <date>` and `Due <date>`
in muted grey whether or not the date has passed, in both the hold branch and
the request branch. A student whose item is two weeks overdue sees a page
identical to one who is on time.

`deriveDeadlineFlags` has exactly **one** consumer, `recordOverdueNotificationsAs`,
in the same file, and is exported for nobody. So the review's "extract pure
functions for testability" framing mostly evaporates: the function is already
extracted, it simply has no second caller and no test.

The user-visible consequence is the gap worth closing. The notification path
already decides an item is overdue and says so by bell and email; the page the
student then opens shows no sign of it.

### The failure is silent

```ts
try {
  await recordOverdueNotificationsAs(viewer, { ownerId: viewer.id });
} catch {
  // swallow; degraded notification recording must not 500 the page.
}
```

No log, no counter, nothing. The intent is right: `QUIRKS.md` is explicit that
there is no cron and notifications are deliberately lazy, so a read is
genuinely the trigger and a notification failure must not break the page. What
is wrong is that if this starts failing, every overdue notification silently
stops and nobody finds out.

### The deadline pair is read from different fields in each branch

An Active tab entry is a union, and the deadline pair lives in different
columns per arm:

| Entry | status | pickupBy | dueAt | recency |
| --- | --- | --- | --- | --- |
| hold | `item.status` | `item.currentPickupBy` | `item.currentDueAt` | `item.updatedAt` |
| request | `item.status` | `line.pickupBy` | `line.dueAt` | `line.createdAt` |

`deadlineOf` and `recencyOf` already normalize this for the server-side sort.
The badge work would need the same normalization on the client, which is where
a second copy would appear.

---

## Design

### `src/lib/inventory-deadlines.ts`

Pure, client-safe, unit tested, in the same shape as `hold.ts`,
`viewer.ts` and `inventory-visibility.ts`.

- `overdueFlags(pair, now)` returns `{ pickupOverdue, checkoutOverdue }`.
  **`now` is a parameter** defaulting to `Date.now()`. `deriveDeadlineFlags`
  reading the clock internally is what makes boundary cases awkward to test,
  and the boundaries are the whole content of this rule.
- `deadlinePairOf(entry)` is the one place that knows which arm stores the
  pair where. Both the sort and the badge read it.
- `compareByDeadline(a, b)` moves across with the ordering rule it implements:
  soonest deadline first, entries without one last, newest first on a tie.
  It is untested pure logic today and depends on the same normalizer.

The status used for both flags is the **item's**, not the request line's: an
approved line sits on an item that is either `reserved` (pre-pickup) or
`checked_out` (post-pickup), and that distinction is what decides which
deadline applies.

### Overdue becomes visible

`/my/items` gains a badge beside `InventoryStatusBadge`, which is where a
reader already looks for the item's state.

Two labels, because they mean different things to the student:

| Case | Label | Colour |
| --- | --- | --- |
| `reserved` past `pickupBy` | `Pickup overdue` | `--status-warning` |
| `checked_out` past `dueAt` | `Overdue` | `text-destructive` |

"Collect this" and "bring this back" are different asks, and a late return is
the more serious of the two. The dates already on the row stay as they are.

This gives `overdueFlags` its second consumer, which is what makes the module
a shared rule rather than a relocated helper.

### The swallow reports

The write stays inside the read. Moving it to the route would relocate the
same coupling into a less-tested layer, and the laziness is a deliberate
design decision, not an accident.

What changes is that the `catch` records the failure instead of discarding it,
so a notification path that stops working is discoverable rather than silent.

## Constraints

- **`/my/items` returns the same data.** The badge is derived on the client
  from fields already on the payload; no server shape changes.
- **Notification behavior does not change.** The same rows, the same dedupe,
  the same idempotency. The integration suite covers this and must pass with
  no edits.
- **The read still cannot fail because of the write.**
- **No migration.**

## Deliberately not in scope

- **A scheduler.** `QUIRKS.md` records the no-cron decision, and this change
  depends on it rather than revisiting it.
- **Overdue treatment anywhere but `/my/items`.** The admin table has its own
  columns and its own questions; adding it there is a separate decision.
- **Candidate 5**, the 57 `ForCurrentUser` wrappers.

## What this buys

- **A bug students actually hit** goes away: the app now shows what the
  notification already told them.
- **Locality.** One place knows which arm of the union stores the deadline
  pair, instead of the server sort and the client badge each knowing.
- **The interface becomes the test surface.** The overdue boundaries and the
  ordering rule become unit testable in `npm test`, with an injectable clock
  and no docker.
- **An invisible failure becomes visible.**
