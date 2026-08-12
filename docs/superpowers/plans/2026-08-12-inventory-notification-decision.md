# Inventory Notification Decision and Seed Flows Implementation Plan

> **For agentic workers:** Implement inline, phase by phase, with a code review gate at the end of each phase. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the ninety-three pure lines of `maybeNotify` into a client-safe module so recipient and content rules can be tested without docker, do the same for the overdue mapping, then make the dev seed produce the nine states none of this is currently reachable from.

**Architecture:** `src/lib/inventory-notifications.ts` joins `hold.ts`, `inventory-deadlines.ts` and `inventory-visibility.ts` as a pure rule module with structural input types. `notificationFor` returns one row or null; `overdueNotifications` returns many. The transaction keeps only the insert. The seed stops writing item status directly and drives the real `*As` helpers instead, which is what gives it history rows, deadlines and notifications for free.

**Spec:** `docs/superpowers/specs/2026-08-12-inventory-notification-decision-design.md`

## Global Constraints

- **Prose contains no emdashes and no emojis.** Covers code comments, commit messages, and docs.
- **No behaviour change in Phases 1 to 3.** Same recipients, titles, messages, links, and the same order of guards. The rejection branch must stay above the recipient guard; the comment at `inventory-transitions.ts:617-624` explains why and moves with the code.
- **No migration, no wire-format change, no new dependency.**
- **`notify.ts` and the three project notification sites are untouched.**
- **Test commands:** `ulimit -n 8192; CI=true npm test` and `npm run test:integration` (docker Postgres). Vitest needs the sandbox off in this environment.
- **Before every commit:** `npm run check` and `npm run typecheck` in full.
- **Stage files by name. Never commit to `main`.** Branch `refactor/inventory-notification-decision` already exists and carries the spec commit.
- **Merge with a merge commit, not a squash.**

## File Structure

| File | Responsibility |
| --- | --- |
| `src/lib/inventory-notifications.ts` | new; `NotificationRow`, `notificationFor`, `overdueNotifications` |
| `src/lib/__tests__/inventory-notifications.test.ts` | new; one case per branch, plus the dedupe |
| `src/server/_internal/inventory-transitions.ts` | `maybeNotify` deleted, its caller does decision-plus-insert |
| `src/server/_internal/inventory.ts` | overdue mapping delegated |
| `scripts/seed-dev.ts` | lifecycle driven through the real helpers |
| `docs/QUIRKS.md` | records the module and the seed's new contract |

---

## Phase 1: the module

Additive. Nothing calls it yet, so the unit tests are the only proof.

- [ ] **Step 1: write the failing tests** at `src/lib/__tests__/inventory-notifications.test.ts`. One per branch of `notificationFor`, plus the dedupe. Build the fixtures with small helpers so each case is one line.

```ts
import { describe, expect, it } from "vitest";
import {
  notificationFor,
  overdueNotifications,
} from "../inventory-notifications";

const item = {
  currentHolderId: null as string | null,
  currentRequestItemId: null as string | null,
  id: "i-1",
  name: "Oculus Quest 3",
  status: "reserved" as const,
};

describe("notificationFor", () => {
  it("sends a denial to the requester, not to whoever holds the item", () => {
    // The subtlest rule in the domain: staff can take a still-pending item
    // straight to checked_out for a teammate, so the holder and the person
    // owed the denial are two different people.
    const row = notificationFor(
      { ...item, currentHolderId: "u-teammate" },
      { nextStatus: "available", comment: "Out of scope this term" },
      "u-teammate",
      { outcome: "rejected", requesterId: "u-requester" }
    );
    expect(row?.userId).toBe("u-requester");
    expect(row?.type).toBe("inventory_request_rejected");
    expect(row?.message).toBe("Out of scope this term");
  });

  it("answers the denial before asking who holds the item", () => {
    // A label hold resolves to nobody, and the guard below would have
    // swallowed the denial owed to the person who asked.
    const row = notificationFor(
      { ...item, currentHolderId: null },
      { nextStatus: "available" },
      null,
      { outcome: "rejected", requesterId: "u-requester" }
    );
    expect(row?.userId).toBe("u-requester");
  });

  it("says nothing for a rejection with no resolved requester", () => {
    expect(
      notificationFor(item, { nextStatus: "available" }, null, {
        outcome: "rejected",
        requesterId: null,
      })
    ).toBeNull();
  });

  it("says nothing when a requester cancels their own line", () => {
    expect(
      notificationFor(
        item,
        { nextStatus: "available", authority: "self_cancel" },
        "u-holder",
        null
      )
    ).toBeNull();
  });

  it("says nothing when there is nobody to tell", () => {
    expect(
      notificationFor(item, { nextStatus: "reserved" }, null, null)
    ).toBeNull();
  });

  it("names the pickup date on a reservation, and omits it when absent", () => {
    const withDate = notificationFor(
      item,
      { nextStatus: "reserved", pickupBy: new Date("2026-09-01") },
      "u-holder",
      null
    );
    expect(withDate?.type).toBe("inventory_request_approved");
    expect(withDate?.title).toContain("Pick up by");

    const without = notificationFor(
      item,
      { nextStatus: "reserved" },
      "u-holder",
      null
    );
    expect(without?.title).not.toContain("Pick up by");
  });

  it("announces a checkout with its due date", () => {
    const row = notificationFor(
      item,
      { nextStatus: "checked_out", dueAt: new Date("2026-09-01") },
      "u-holder",
      null
    );
    expect(row?.type).toBe("inventory_item_checked_out");
  });

  it("thanks a returner but closes a request otherwise", () => {
    const held = { ...item, currentHolderId: "u-holder", status: "checked_out" as const };
    const returned = notificationFor(
      held,
      { nextStatus: "available" },
      null,
      null
    );
    expect(returned?.type).toBe("inventory_item_returned");
    expect(returned?.link).toBe("/inventory/i-1");

    const closed = notificationFor(
      { ...held, status: "reserved" as const },
      { nextStatus: "retired" },
      null,
      null
    );
    expect(closed?.type).toBe("inventory_request_closed");
  });

  it("says nothing when a release was not from a hold", () => {
    expect(
      notificationFor(
        item,
        { nextStatus: "available", requestItemId: "line-1" },
        "u-holder",
        null
      )
    ).toBeNull();
  });
});

describe("overdueNotifications", () => {
  const NOW = new Date("2026-08-12T00:00:00Z").getTime();
  const past = new Date("2026-08-01T00:00:00Z");

  it("collapses the same person appearing in both scans", () => {
    // The request scan and the hold scan deliberately overlap, because a
    // teammate can collect an item someone else requested. When they are the
    // same person the row comes back twice.
    const rows = overdueNotifications(
      [
        { dueAt: past, itemId: "i-1", itemName: "Pi", pickupBy: null, status: "checked_out", userId: "u-1" },
        { dueAt: past, itemId: "i-1", itemName: "Pi", pickupBy: null, status: "checked_out", userId: "u-1" },
      ],
      NOW
    );
    expect(rows).toHaveLength(1);
  });

  it("keeps two different people for the same item", () => {
    const rows = overdueNotifications(
      [
        { dueAt: past, itemId: "i-1", itemName: "Pi", pickupBy: null, status: "checked_out", userId: "u-1" },
        { dueAt: past, itemId: "i-1", itemName: "Pi", pickupBy: null, status: "checked_out", userId: "u-2" },
      ],
      NOW
    );
    expect(rows).toHaveLength(2);
  });

  it("emits nothing for a deadline that has not passed", () => {
    expect(
      overdueNotifications(
        [{ dueAt: new Date("2026-12-01"), itemId: "i-1", itemName: "Pi", pickupBy: null, status: "checked_out", userId: "u-1" }],
        NOW
      )
    ).toEqual([]);
  });
});
```

- [ ] **Step 2: run and confirm failure.** `ulimit -n 8192; CI=true npx vitest run src/lib/__tests__/inventory-notifications.test.ts`. Expected: not a function.

- [ ] **Step 3: build the module** at `src/lib/inventory-notifications.ts`. Move the bodies from `inventory-transitions.ts:604-715` and `inventory.ts:1627-1662` **verbatim**, changing only `await tx.insert(...).values({...})` into `return {...}` and `push({...})` into `rows.push({...})`. Carry every comment across; they are the reason the guards are ordered the way they are. Import `ItemStatus` from `./inventory-visibility` and `overdueFlags` from `./inventory-deadlines`, both already client-safe. Declare `formatDate` locally, moved from `inventory-transitions.ts:717`.

Structural input types, stating what the function actually reads:

```ts
export interface TransitionSubject {
  currentHolderId: string | null;
  currentRequestItemId: string | null;
  id: string;
  name: string;
  status: ItemStatus;
}

export interface TransitionNotice {
  authority?: string | null;
  comment?: string | null;
  dueAt?: Date | null;
  nextStatus: ItemStatus;
  pickupBy?: Date | null;
  requestItemId?: string | null;
}

export interface ClosedLineOutcome {
  outcome: string;
  requesterId: string | null;
}

export interface OverdueCandidate {
  dueAt: Date | null;
  itemId: string;
  itemName: string;
  pickupBy: Date | null;
  status: string;
  userId: string;
}
```

- [ ] **Step 4: run the tests.** Expected: PASS. Then `npm run check`, `npm run typecheck`, `ulimit -n 8192; CI=true npm test`.

- [ ] **Step 5: commit.**

```bash
git add src/lib/inventory-notifications.ts src/lib/__tests__/inventory-notifications.test.ts
git commit -m "feat(inventory): give the notification decision a module"
```

---

## Phase 2: route the transition through it

- [ ] **Step 1: delete `maybeNotify`** (`:604-715`) and `formatDate` (`:717` onward, if nothing else in the file uses it; check first with a grep).

- [ ] **Step 2: replace the call at `:493`.**

```ts
  const row = notificationFor(current, input, holdAccountId(hold), closed);
  if (row) {
    await tx.insert(notifications).values(row);
  }
```

Import `notificationFor` from `#/lib/inventory-notifications`. `current` already carries the five fields `TransitionSubject` needs, and `input` satisfies `TransitionNotice` structurally.

- [ ] **Step 3: gate.** `npm run check`, `npm run typecheck`, `ulimit -n 8192; CI=true npm test`, then `npm run test:integration`. **All twelve notification integration tests must pass unchanged.** They are the proof this phase changed nothing; if one fails, the move was not verbatim.

- [ ] **Step 4: commit.**

```bash
git add src/server/_internal/inventory-transitions.ts
git commit -m "refactor(inventory): decide the notification, then insert it"
```

---

## Phase 3: route the overdue scan through it

- [ ] **Step 1: replace the pure region** in `recordOverdueNotificationsAs` (`inventory.ts:1627-1662`) with a call:

```ts
  const values = overdueNotifications(candidates);
```

Delete the local `OverdueCandidate` interface (`:1551-1558`) and import the module's, or keep the local one if the query's inferred shape needs it and let the module's type accept it structurally. Delete the `seen`/`push` closure and the `overdueFlags` loop; the module owns both now. `candidates` is already built and null-filtered above, and the `onConflictDoNothing` insert below is unchanged.

- [ ] **Step 2: gate.** Same as Phase 2, plus specifically the overdue tests at `inventory.integration.test.ts:1528`, `:2287-2396`, `:2434`, `:2451`.

- [ ] **Step 3: commit.**

```bash
git add src/server/_internal/inventory.ts
git commit -m "refactor(inventory): read the overdue rows through the module"
```

---

## Phase 4: seed the flows

Lands last so it runs through the refactored path.

- [ ] **Step 1: add a lifecycle section** to `scripts/seed-dev.ts`, after the items are created. Import the helpers from `../src/server/_internal/inventory` and `../src/server/_internal/inventory-transitions`. They all take an explicit viewer, which is what the `*As` convention is for, so no request context is needed.

Build a synthetic admin viewer from the seeded admin: `{ id: u.admin.id, role: "admin" }`.

- [ ] **Step 2: stop writing hold state directly.** The three items currently seeded with `status: "checked_out"` / `"reserved"` plus `currentHolderId` (`Meta Quest 3`, `RealSense D435i`, `Logitech BRIO`) become plain `available` rows. Their held state is produced by the lifecycle below. This is the point of the change: the seed was a second writer and disagreed with `transitionItem` about history and dates.

- [ ] **Step 3: produce the nine states.** Dates relative to `Date.now()`.

| Case | How |
| --- | --- |
| Overdue checkout | `transitionItem(admin, { itemId, nextStatus: "checked_out", holderId: student.id, dueAt: daysFromNow(-9) })` |
| Overdue pickup | `transitionItem(admin, { itemId, nextStatus: "reserved", holderId: student.id, pickupBy: daysFromNow(-3) })` |
| Healthy hold | same as the first, `dueAt: daysFromNow(10)` |
| Pending request | `addToCartAs(sam, ...)` then `submitCartAs(sam, { note })`, leave the line alone |
| Approved request | cart, submit, then `approveRequestItemAs(admin, { requestItemId, pickupBy: daysFromNow(5) })` |
| Requester is not the holder | Sam requests and it is approved, then `transitionItem(admin, { nextStatus: "checked_out", requestItemId, holderEmail: jordan.email, dueAt: daysFromNow(7) })` |
| History: returned | checkout, then `transitionItem(admin, { nextStatus: "available" })` |
| History: rejected | cart, submit, then `rejectRequestItemAs(admin, { requestItemId, reviewComment: "Reserved for the senior design cohort this term." })` |
| History: cancelled | cart, submit, then `cancelRequestItemAs(jordan, { requestItemId, note: null })` |

Read each request line id back from `inventory_request_items` by `itemId` after submitting, the way the integration tests do.

- [ ] **Step 4: make it idempotent.** Match the script's existing shape: before seeding the lifecycle, check whether any `inventory_requests` row exists for the seeded students, and skip the whole section if so, reporting a count like the other sections do. Re-running must not stack a second set of requests.

- [ ] **Step 5: print the hint.** End the seed with a line naming what to open:

```
inventory flows: 9 seeded. Sign in as user@example.com (password) and open
/my/items to see the overdue badges; the bell fills on that first read,
because the overdue scan is lazy and there is no cron.
```

- [ ] **Step 6: run it twice.** `npm run db:seed:dev` from a truncated database, then again. The second run must report the section skipped and must not create a second set. Then open the app and check `/my/items` as `user@example.com`: two overdue badges, one healthy hold, request entries, a populated History tab, and the bell filling on that first load.

- [ ] **Step 7: gate and commit.** `npm run check`, `npm run typecheck`. Note that `scripts/` is not Biome-checked per `QUIRKS.md`, so lint will not cover this file; read it once for the prose rules yourself.

```bash
git add scripts/seed-dev.ts
git commit -m "feat(seed): produce the inventory flows through the real write path"
```

---

## Phase 5: docs, verify, PR

- [ ] **Step 1: `QUIRKS.md`.** In the Inventory section:
  - `src/lib/inventory-notifications.ts` owns who receives an inventory notification and what it says. `notificationFor` returns one row or null; `overdueNotifications` returns many and owns the dedupe. The transaction only inserts.
  - The rejection branch is answered before the recipient guard, and why: a label hold resolves to nobody and would swallow the denial owed to the requester.
  - Inventory does **not** suppress the actor the way `notify.ts` does; it keys suppression on `authority === "self_cancel"`, and the comment explains that staff assigning a hold to their own address is also actor-equals-recipient but does want the notice.
  - New recipient and content cases belong in the unit tests, not the integration suite.
  - The seed now drives `transitionItem` and the `*As` helpers rather than writing status and holder columns directly, so it is no longer a second writer. Anything added to the seed that changes item state must go through the same path.
- [ ] **Step 2: commit.** `git add docs/QUIRKS.md && git commit -m "docs(quirks): record the notification module and the seed's write path"`
- [ ] **Step 3: full verification.** `npm run check`, `npm run typecheck`, `ulimit -n 8192; CI=true npm test`, `npm run build`, `npm run test:integration`, then `npm run db:seed:dev` and `npm run test:accessibility`.
- [ ] **Step 4:** Push, open the PR, wait for `verify` and `integration`.

## Risks

| Risk | Mitigation |
| --- | --- |
| The move is not verbatim and a message or recipient changes | Phase 2 Step 3: all twelve notification integration tests must pass with no edits. That is the whole check |
| The guard order gets reshuffled during the move | The rejection-first comment moves with the code and the unit test "answers the denial before asking who holds the item" pins it |
| The seed's lifecycle leaves items in a state later seed sections assume | Phase 4 Step 2 removes the direct hold writes, so there is one source of truth. Run the seed twice (Step 6) |
| Seeding through app helpers is slow | Nine transitions on a local database. If it is noticeably slower, say so in the PR rather than reverting to direct writes |
| `scripts/` is not linted, so prose rules slip | Phase 4 Step 7 says to read it. Check for emdashes by hand |
