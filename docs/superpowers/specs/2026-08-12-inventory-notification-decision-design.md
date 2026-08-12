# Free the inventory notification decision, and seed the flows that show it: design

Date: 2026-08-12

Fifth candidate from the architecture review of the inventory and projects hot
spots, plus a dev-experience change that came out of it: the seed script cannot
currently produce any of the states this code decides about.

The governing principle:

> **A rule you can only reach through a transaction is a rule you test at the
> price of a transaction.**

---

## Ninety-three lines of decision behind five lines of IO

`maybeNotify` (`src/server/_internal/inventory-transitions.ts:604-715`) chooses
a recipient and composes a message, then writes it. Counting the body, **five
lines touch IO** (`:627`, `:666`, `:676`, `:692`, `:700`) and roughly ninety-three
are pure: the release-from-hold derivation, the recipient fallback, the
`self_cancel` suppression, and a five-arm switch over the target status.

The subtlest rule in the domain lives in there. `QUIRKS.md` records it: a
denial goes to the **requester**, read off the closed line, not to whoever holds
the item, because staff can take a still-pending item straight to `checked_out`
for a teammate. The code answers it first, above the recipient guard, with an
eight-line comment explaining that a label hold answers "nobody" and would
otherwise swallow the denial.

None of that can be exercised without Postgres. There is **no unit test anywhere**
covering notification content or recipient choice. In the integration suite the
cheapest recipient assertion costs eleven lines of arrange; the
requester-is-not-the-holder case costs twenty-four.

The overdue path has the same shape. `recordOverdueNotificationsAs`
(`inventory.ts:1627-1662`) is pure given its candidate list, including the JS
dedupe on `${userId}|${type}|${link}` that exists because the two scans
deliberately overlap.

## Design

One pure module, `src/lib/inventory-notifications.ts`, beside `hold.ts`,
`inventory-deadlines.ts` and `inventory-visibility.ts`, which are pure and
client-safe for the same reason.

```ts
export interface NotificationRow {
  link: string;
  message: string;
  title: string;
  type: string;
  userId: string;
}

export function notificationFor(
  prev: TransitionSubject,
  input: TransitionNotice,
  holderId: string | null,
  closed: ClosedLine | null
): NotificationRow | null;

export function overdueNotifications(
  candidates: OverdueCandidate[],
  now?: number
): NotificationRow[];
```

`maybeNotify` disappears. Its caller at `:493` becomes:

```ts
const row = notificationFor(current, input, holdAccountId(hold), closed);
if (row) {
  await tx.insert(notifications).values(row);
}
```

### The decisions behind that, and why

- **One row or null, not an array.** Every branch inserts at most one row
  today. An array would be speculative, and multi-row already has a home in
  `overdueNotifications`.

- **`maybeNotify` is inlined rather than kept.** Once it is a decision plus an
  insert, a named function for those three lines earns nothing.

- **Structural input types, not `TransitionInput`.** The function reads six
  fields of `TransitionInput` and five of the item row. Declaring exactly those
  states the real requirement and keeps the module client-safe, which is the
  same reasoning `inventory-deadlines.ts` already carries in a comment:
  importing the server's type would drag Drizzle row types across.

- **The overdue mapping comes too.** Same kind of decision about the same
  domain, and a module named for inventory notifications holding one function is
  thin. The dedupe is the part worth testing cheaply.

- **`NotificationRow` is a type, not a builder.** All nine insert sites in the
  app hand-build the same five keys and nothing shares a shape. A builder over
  an object literal is a pass-through; the type is the deliverable. It stays
  inventory-scoped, and `notify.ts` could adopt it later.

- **Not derived from `typeof notifications.$inferInsert`.** That carries `id`,
  `read` and `createdAt` as optional and would pull Drizzle into a client-safe
  module.

- **`notify.ts` is not touched.** Its three project sites suppress the actor;
  inventory deliberately does not, and keys its suppression on `authority`
  instead. Widening one module to own both is a different argument.

## Tests

- **Unit**, in `npm test` with no docker, one case per branch: a rejection goes
  to the requester and not the holder; a rejection with no requester id returns
  null; `self_cancel` returns null; `reserved` with and without `pickupBy`;
  `checked_out`; the returned-versus-closed split; release-from-hold false
  returns null; no recipient returns null. Plus the dedupe: two candidates
  differing only by scan collapse to one row, and two genuinely different users
  do not.
- **All twelve integration tests stay.** They are the only proof a row reaches
  Postgres, and pruning them is a per-test judgement about what each one
  actually proves, which does not belong inside a no-behaviour-change refactor.
  Recorded instead: new recipient and content cases belong in the unit tests.
- Honest cost: this pass **adds** a cheap layer rather than trading an expensive
  one away.

## The seed cannot show any of this

`scripts/seed-dev.ts` writes `status` and `currentHolderId` straight into
`inventory_items` with Drizzle. It creates **no deadlines, no request lines and
no notifications**. So `/my/items` shows holds that can never be overdue, the
History tab is always empty, and the bell never fills. None of the behaviour
this module decides is reachable by hand.

That is also a second writer: `QUIRKS.md` says `transitionItem` is the only
thing that writes status history and syncs holder columns with status, and the
seed disagrees with it quietly, which is exactly why the seeded holds have no
history and no dates.

### Design

Catalog data (users, programs, categories, items) keeps writing rows directly.
The **lifecycle** goes through the real helpers with a synthetic admin viewer:
`addToCartAs`, `submitCartAs`, `approveRequestItemAs`, `rejectRequestItemAs`,
`cancelRequestItemAs`, `transitionItem`. They all take an explicit viewer
already, which is what the `*As` convention exists for.

Nine states, using the three student accounts the seed already has:

| Case | Who | State |
| --- | --- | --- |
| Overdue checkout | `user@example.com` | `checked_out`, due 9 days ago |
| Overdue pickup | `user@example.com` | `reserved`, pickup 3 days ago |
| Healthy hold | Jordan | `checked_out`, due in 10 days, no badge |
| Pending request | Sam | line `pending`, sitting in the staff queue |
| Approved request | Sam | line `approved`, item `reserved`, future pickup |
| Requester is not the holder | Sam requests, Jordan collects | both see it, one as a request and one as a hold |
| History: returned | `user@example.com` | closed line |
| History: rejected | Sam | closed with a denial comment |
| History: cancelled | Jordan | self-cancelled |

**Dates are relative to seed time.** Overdue is derived against `Date.now()`, so
fixed calendar dates would drift into being four hundred days overdue, which
reads as broken data rather than a deliberate case.

**Notifications are produced, not seeded.** Transition notices come out of
`transitionItem` while seeding. Overdue notices appear when you first open
`/my/items`, because the scan is lazy by design and there is no cron. Seeding
them by hand would mean copying five-key row shapes into the seed, which is the
duplication this candidate exists to remove. The seed prints a closing line
saying to sign in as `user@example.com` and open `/my/items`.

**Idempotency matches what the script already does**: find, skip, report a
count. Re-running must not stack a second set of requests.

## Constraints

- **No behaviour change in the refactor.** Same recipients, same titles, same
  messages, same links, same order of guards. The rejection branch stays above
  the recipient guard.
- **No migration, no wire-format change, no new dependency.**
- **`notify.ts` and the three project notification sites are untouched.**
- **The seed commit lands last**, so it runs through the refactored path.
- **Stage files by name. Never commit to `main`.** Branch
  `refactor/inventory-notification-decision`.

## Deliberately not in scope

- **Widening `notify.ts` to own both domains.** Different rule: projects
  suppress the actor, inventory keys suppression on `authority` and explicitly
  rejects the general actor-equals-recipient rule in a comment.
- **Pruning the integration tests.** Argued above; it is a follow-up.
- **A shared `NotificationRow` across projects and inventory.** The type lands
  inventory-scoped; adopting it in `notify.ts` is a separate, easy change once
  someone wants it.
- **Seeding through the app for catalog data too.** `createInventoryItemAs`
  would be the consistent extreme, but items are static reference data with no
  state machine, and the current direct writes are not in conflict with
  anything.

## What this buys

- **The domain's subtlest rule becomes testable in a line.** Requester versus
  holder currently costs twenty-four lines of arrange and docker.
- **Locality**: one module owns what an inventory notification says and who
  receives it, instead of the knowledge sitting inside a transaction.
- **The dedupe gets a test** that does not need three accounts and a full
  lifecycle.
- **The seed stops being a second writer** and starts producing history rows,
  deadlines, request lines and notifications by construction.
- **Nine flows become reachable by hand**, including one that is impossible to
  see in the app today.
