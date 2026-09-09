# Custom requests, and the grouped tables that hold them

Date: 2026-09-09
Status: Design approved in chat. Four issues, four branches, in the order under
"Landing plan".
Issue: #80, plus three siblings created with this spec.
Screens: reviewed against a screen book of every surface and scenario. That artifact
is private and deliberately not linked from here or from the issues; the normative
record is this file, and "The three lifecycles" below is the normative version of its
state diagrams.

## Summary

A signed-in user can ask for equipment the department does not hold. The ask is a
**custom request**: one envelope carrying one **custom line** per thing, each with a
name, a reason, a quantity and an optional link. Staff answer it in the same queue
they answer borrow lists in, and when the thing arrives they link the real items to
the line and reserve them to whoever asked.

Holding both kinds in one queue is what forces the second half of this work. A queue
of lines with no sense of which request they arrived in is already hard to read;
adding a second line kind to it makes that worse. So `AdminDataTable` gains a
grouping mode, `/admin/inventory/requests` groups by request, and `/my/items` drops
its three tabs for one grouped table with a derived filter.

## Vocabulary

Three additions to `CONTEXT.md`, and one rule about a word not to reuse.

**Custom request**: an ask for equipment the inventory does not hold. One envelope
with an optional note, holding one custom line per thing asked for. Visible to its
requester and to staff, never to anyone else.
_Avoid_: wishlist, purchase order, acquisition, suggestion.

**Custom line**: one thing within one custom request, with its own status, staff
reply, and the items it eventually produced. Staff decide lines, not requests, the
same way they do for a borrow list.
_Avoid_: wanted item, custom item, wish.

**Custom line status**: exactly one of `pending`, `sourcing`, `fulfilled`,
`rejected`, `cancelled`.

- **Pending**: awaiting a staff decision.
- **Sourcing**: staff accepted it and are getting it. Nothing physical exists yet.
- **Fulfilled**: the thing now exists and is linked to the line. Terminal.
- **Rejected**: refused by staff, with a reason the requester sees.
- **Cancelled**: withdrawn by the requester.

_Avoid_: approved (see below), ordered, on order, delivered, done.

**`approved` is not available to a custom line.** Approving a request line hands over
a physical thing: the item becomes reserved to that person with a pickup deadline. A
custom line has no item, so the same word would name a promise on one screen and a
reservation on the next, in a queue that shows both. `sourcing` exists to keep that
distinction visible.

**`fulfilled` needs the glossary amended, not ignored.** `CONTEXT.md` lists it today
under Line status as a word to avoid, beside `done` and `complete`, because on a
request line it would be a loose synonym for `returned`. That entry stays true and
gains a parenthesis: avoid `fulfilled` **for a request line**, because it is the
custom line's own status. Leaving the glossary contradicting itself would break its
one-definition-per-term rule, so the amendment is part of PR 4 rather than a
follow-up.

## The three lifecycles

These are normative as of the date above. `docs/QUIRKS.md` gets the same three tables
under its Inventory section, next to the pointer at `inventory-workflow.ts`.

Two copies is deliberate and the precedence is one way: **QUIRKS is the living copy
and wins wherever the two disagree**, per the rule in `AGENTS.md` that it is the
ground truth for how this codebase behaves. This file is the dated record of what was
decided and why, and it is not maintained against later change. Neither duplicates
`CONTEXT.md`, which defines what each status means and does not say which transitions
are legal.

### Request line, unchanged

| From | To | Who | What else happens |
| --- | --- | --- | --- |
| (new) | `pending` | requester, by submitting a borrow list | item goes to `requested`, held by the requester |
| `pending` | `approved` | staff | item goes to `reserved`, pickup deadline set |
| `pending` | `rejected` | staff, reason required | item released, usually to `available` |
| `pending` | `cancelled` | requester | item released |
| `approved` | `returned` | staff, on a release from `checked_out` | item released |
| `approved` | `cancelled` | requester, or staff releasing without a return | item released; refused once the item is `checked_out` |

Two live states, three endings. `returned` is the line's own ending, not the item's
status copied onto it: an item returned from one student is reserved to the next
within the hour, so a line that stayed `approved` forever would read the same whether
the loan was outstanding or finished last term. `RequestLineOutcome` in
`src/lib/inventory-workflow.ts` already encodes this, as the subset
`cancelled | rejected | returned`, excluding the two live states by name.

`returned` is kept rather than renamed to `completed`. In a lending domain it is the
word people use, and `completed` is vaguer rather than clearer.

### Custom line, new

| From | To | Who | What else happens |
| --- | --- | --- | --- |
| (new) | `pending` | requester, by submitting the form | nothing else; no item exists |
| `pending` | `sourcing` | staff | notification, no item, no dates |
| `pending` | `fulfilled` | staff, linking items we already own | see below |
| `sourcing` | `fulfilled` | staff, linking items that arrived | see below |
| `pending` or `sourcing` | `rejected` | staff, reason required | notification carrying the reason |
| `pending` or `sourcing` | `cancelled` | requester | nothing else |

Same five slots as a request line: undecided, decided yes and still live, succeeded,
refused, withdrawn. Only the success word differs, because the two kinds succeed at
different things. A borrow succeeds when the thing comes back; an acquisition
succeeds when the thing exists. **A custom line therefore has no `returned` state and
needs none**: it never lends anything. Borrowing the item we bought is a normal
request line, with a `returned` of its own.

One divergence from the request line, deliberate: **a custom line can be rejected
from `sourcing`**, where a request line can only be rejected while `pending`. An
order falls through, and the alternative is a line stuck sourcing with no way out but
a lie.

Fulfilling writes the join rows, reserves each linked item to the requester with a
pickup deadline **unless staff untick that box, which is ticked by default**, and
sends one notification. It runs in a single transaction, locking items in ascending
id order, and fails whole if any linked item is not `available`, naming the item.

**The reservation goes through `transitionItem`, never a direct write.** ADR-0004
makes it the only writer of `inventory_item_status_history` and the only thing that
syncs the `current_holder_*` columns with the status, and records what an earlier
exemption cost: two new hold columns that only two of four writers learned about.
Fulfill is a fifth caller of it, passing the requester as the holder, not a fifth
writer beside it.

### Item, unchanged

| From | To | Who |
| --- | --- | --- |
| `available` | `requested` | requester, via `submitCartAs` under `self_request`; this is the only path to `requested` |
| `available` | `reserved` or `checked_out` | staff, with no request line at all |
| `requested` | `reserved` | staff, approving the line |
| `requested` | `checked_out` | staff, checking out directly for a teammate |
| `reserved` | `checked_out` | staff, on collection |
| any of `requested`, `reserved`, `checked_out` | `available`, `maintenance` or `retired` | staff; this is a release |
| `available` | `maintenance` and back | staff |
| any | `retired` | staff; the archive, and the only removal for an item with request history |

A release closes whatever line the item was held for: `returned` off a `checked_out`,
`cancelled` otherwise, unless the caller names a different outcome. `reserved` and
`checked_out` each require a holder, a person or a label, never both and never
neither, and `checked_out` additionally requires a due date. `available`,
`maintenance` and `retired` forbid a holder and both dates outright.

The item lifecycle is why the two line vocabularies cannot be derived from it. It
says where a physical thing is right now, and it keeps moving. A line records how one
episode ended.

## Data model

The envelope is reused. `inventory_requests` stays the one envelope table for both
kinds, so the group key on both grouped tables is one shape rather than a union the
header renderer has to branch on. **An envelope holds one kind of line, never both**,
which the standalone form guarantees and which is what makes a group action clean: on
a borrow list it takes one pickup date for every line, on a custom request it takes
nothing.

The cost, recorded so nobody is surprised: an `inventory_requests` row no longer
implies an `inventory_request_items` row exists. Every query joining the two is
checked as part of the fourth PR.

```
inventory_custom_lines
  id            uuid pk
  request_id    uuid -> inventory_requests, cascade, not null
  name          text not null
  reason        text not null
  quantity      integer not null, >= 1
  link          text
  status        inventory_custom_line_status not null default 'pending'
  staff_reply   text
  decided_by    text -> user, set null
  decided_at    timestamptz
  closed_at     timestamptz
  created_at    timestamptz not null default now()

inventory_custom_line_items
  custom_line_id uuid -> inventory_custom_lines, cascade
  item_id        uuid -> inventory_items, restrict
  primary key (custom_line_id, item_id)
```

`item_id` is `RESTRICT`, matching `inventory_request_items.item_id` and ADR-0006: an
item that fulfilled a request can be retired but not hard-deleted, because the
fulfillment record is the point.

`INVENTORY_CUSTOM_LINE_STATUSES` goes in `src/lib/vocabularies.ts` as an `as const`
tuple with a `pgEnum` behind it. It has to be that file: `vocabulary-scan` discovers
what to look for by parsing `vocabularies.ts` and taking every exported `as const`
array of string literals, so a tuple that lands there is scanned from the moment it
exists, and a tuple placed anywhere else is scanned by nothing and passes silently
(ADR-0016). The scan runs in `npm test`, not at build.

### Fields and who sees them

| Field | Visible to | Editable by |
| --- | --- | --- |
| `name`, `reason`, `quantity`, `link` | requester, staff | nobody after submit |
| `status` | requester, staff | staff, plus the requester for `cancelled` |
| `staff_reply` | requester, staff | staff |
| `decided_by`, `decided_at` | staff | staff, on every staff action; untouched by a requester cancel |
| `closed_at` | staff | written by whichever transition closes the line, staff or requester |
| `inventory_custom_line_items` rows | requester, staff | staff |
| envelope `note` | requester, staff | requester at submit, nobody after |

Nothing here is public. A signed-out visitor, and a signed-in user who is not the
requester, sees no custom request at all.

**Nothing is editable after submit**, by anyone. A requester who got it wrong cancels
the line and files another; there is no `updateCustomLineAs`, which is why the five
wrappers below do not list one. Staff answer a request, they do not rewrite it.

**One requester-visible reply column, not two.** An item line carries both
`review_comment` and `closed_reason`, and a rejection writes the same text into each,
but only `closed_reason` reaches the student: `myRequestLineView` in
`src/lib/inventory-visibility.ts` omits `review_comment` deliberately, and
`docs/QUIRKS.md` records shipping it to students as the leak that projection exists to
stop. Giving a custom line a `review_comment` that the requester *can* read would be
the same name meaning two different things across one queue, which is the exact hazard
this spec uses to reject `approved`.

So the custom line has a single `staff_reply`, requester-visible. `decided_by` and
`decided_at` are the staff-only metadata beside it, named for what they are rather
than borrowed from a table whose columns mean something else. What each transition
writes:

| Transition | `staff_reply` | `decided_by`, `decided_at` | `closed_at` |
| --- | --- | --- | --- |
| `sourcing` | the note, optional | the staff member, now | unset |
| `fulfilled` | the note, optional | the staff member, now | now |
| `rejected` | the reason, **required** | the staff member, now | now |
| `cancelled` | untouched | untouched | now |

**`staff_reply` is the latest reply, not a log.** Fulfilling after sourcing
overwrites the sourcing note, and that is accepted rather than solved: each staff
action already sends the requester a notification carrying its text, so the sequence
survives in the bell even though the column keeps only the last one. Extending
`inventory_item_status_history` to cover custom lines is the fix if it ever bites,
and it is not in this version.

`cancelled` is the requester's own transition, so it writes `closed_at` without
touching the two decision columns: nobody decided anything, the requester withdrew.

## The grouping mode on AdminDataTable

One optional prop. Absent means today's render path exactly, which is what keeps
every other admin table out of this change's blast radius.

```ts
group?: {
  key: (row: T) => string
  header: (rows: T[]) => ReactNode
  actions?: (rows: T[]) => ReactNode
}
```

**Grouping is derived from sort, not stored.** Rows render grouped when the current
sort equals `defaultSort`, and flat otherwise. `useAdminTableState` gains no state,
nothing new enters the URL, and there is no mode a user can get stuck in. Sorting by
any other column is the escape hatch: grouping and sorting genuinely conflict, since
a group stops being contiguous the moment rows are ordered by status.

- **Markup**: one `<tbody>` per group, its first row a
  `<th scope="rowgroup" colspan={visibleColumnCount}>`, so a screen reader announces
  the group before its rows. The accessibility suite scans both pages that use this.
- **Mobile**: `src/styles.css` already renders each row as a card. A group header
  becomes a full-width strip above its cards, not a card of its own.
- **CSV export is not this component's business.** Export is per-route: a page builds
  its own button from `defineCsvColumns` in `src/lib/csv.ts` over its own rows, and
  `AdminDataTable` holds no export code. So grouping cannot corrupt an export, and
  neither page in this spec has one to corrupt: `/admin/inventory/requests` and
  `/my/items` both ship without CSV today and gain none here.
- **`getRowId` and `highlightedRowId`** keep addressing data rows, so the deep link
  from the admin overview still highlights one line.
- **Group order** follows the first row of each group under the default sort, so a
  page that needs a fixed group order supplies one as its default sort. `/my/items`
  does exactly that: a hidden `groupRank` accessor is its `defaultSort`, which is
  what puts the borrow list first, then requests newest first, then staff-assigned
  holds. Without it, groups would order by whatever the first sorted row happened to
  be.
- **`header(rows)` receives rows and nothing else**, so whatever identifies a group
  is denormalized onto every row in it. Both pages already do this: the queue has a
  requester column, and `/my/items` carries the submitted date. This is a constraint
  on the callers, and PR 1 freezes it.
- **Empty groups** do not render, so filtering to pending shows only requests that
  still have a pending line.
- **One level only.** The mode groups; it does not nest. Where `/my/items` shows a
  fulfilled custom line with the items it produced underneath, those items are
  ordinary rows of the same group, indented by the page's own cell renderer. The
  grouping mode never sees the relationship, which is why multi-level grouping stays
  out of scope in PR 1.

`defineAdminColumns` and every existing call site are untouched.

## The two pages

### `/admin/inventory/requests`

One table, grouped by envelope, rows discriminated by `kind: "item" | "custom"`. The
group header carries the requester, the submitted date, the envelope note, a count,
and a `Custom` badge on a custom envelope.

Group actions: **Approve all** on a borrow list, opening one dialog that takes a
single pickup date and applies it to every pending line in the group.
**Start sourcing all** on a custom request, which takes no input.

Row actions branch on kind. An item line keeps Approve and Reject. A custom line gets
Start sourcing, Fulfill and Reject, and never the word Approve.

`kind` is switched on at four sites here: the row actions, the group action, the badge
and the filter's status set. That is one discriminant re-tested four times, so it
lands as **one map keyed by `kind`** holding those four things, and each site reads
the map rather than re-deriving the branch. A third kind, if one ever arrives, is then
a new entry rather than four edits in four places.

The status filter offers the union of both vocabularies: `pending`, `approved`,
`sourcing`, `fulfilled`, `rejected`, `cancelled`, `returned`. A status only one kind
has filters to that kind, which needs no special case. Staged like the `/my/items`
filter: **PR 2 ships it over the request line vocabulary alone**, and PR 4 adds
`sourcing` and `fulfilled` once the enum holding them exists.

Batch approve is a new `approveRequestLinesAs` wrapping the existing single-line
path, which stays. It is all or nothing: every pending line in the group takes the
one pickup date, or none does. It iterates lines in **ascending line id order**;
`approveRequestItemAs` locks line then item, and `docs/QUIRKS.md` records that
inverting that order deadlocks against `lockAttachableRequestLine`, so a fixed
iteration order is what stops two concurrent batches on overlapping items deadlocking
each other. This is a different lock order from the fulfill path below, which locks
**items** in ascending id order; the two are recorded separately because they are two
rules, not one.

### `/my/items`

Tabs go away. One grouped table with three kinds of group:

- **Not submitted yet**: the borrow list, Submit on the group header, Remove per row.
- **One group per submitted request**, item or custom, headed with the date and note.
- **Assigned to you by staff**: holds with no request behind them.

A hold created by fulfillment does not land in the third group. The join table says
which custom line produced it, so it nests under that line inside the custom
request's group.

`?tab=cart|active|history` is replaced by `?filter=open|closed|all`, defaulting to
open. The filter is **derived**, not a raw status, because a borrow-list row has no
line status and a hold carries an item status.

PR 3 implements it over the statuses that exist then: **open** means unsubmitted,
pending, approved, or currently held; **closed** means rejected, cancelled or
returned. PR 4 extends the derivation with the two custom statuses, `sourcing` into
open and `fulfilled` into closed. PR 3 must not name a status the enum does not yet
have.

**A nested item row keeps its parent line visible.** A fulfilled custom line is
closed while the item it reserved is open, so under the default filter the item would
otherwise appear with nothing above it saying which request produced it. The rule is
that a row shown by the filter also shows the line row it hangs from, as context,
whether or not that line matches.

Every column on this page is declared `enableHiding: false` and
`enableSorting: false`, so the shared table renders no column picker for a student
and the grouped view can never be sorted out from under itself. There is no CSV
export to suppress: a page only has one if it builds one.
That matters here in a way it does not on the queue: the borrow list's Submit button
lives on a group header, and a sort would take the headers, and Submit with them.

`listMyItemsAs` returns groups rather than three flat arrays. The `docs/QUIRKS.md`
rule holds: a request row still carries `itemName` and `itemStatus` flat rather than
an item view, so nothing holds two different `pickupBy` under one name. The
integration suite's exact-key-set assertions are updated, not dropped.

**Links to rewrite.** No redirect shim; the parameter is replaced everywhere.

| File | What |
| --- | --- |
| `src/lib/inventory-notifications.ts` | four `?tab=` links |
| `src/components/borrow-list-button.tsx` | `search={{ tab: "cart" }}` |
| `src/components/user-menu.tsx` | `search={{ tab: "active" }}` |
| `src/components/my-items-attention.tsx` | the attention link |
| `src/lib/__tests__/inventory-notifications.test.ts` | asserted link |
| `src/server/__tests__/inventory.integration.test.ts` | asserted link |
| `src/test/my-items-attention.test.tsx` | asserted link |
| `src/test/e2e/inventory.e2e.test.ts`, `inventory-requests.e2e.test.ts`, `inventory-overdue.e2e.test.ts` | `goto` calls |

## Entry points and server surface

The form is a new route, `/inventory/request` under `_authed`: one card per line
(name, reason, quantity, link), add and remove lines, one optional envelope note.
Reached two ways, both on the page where someone discovers the gap:

- a button beside `BorrowListButton` on `/inventory`, hidden when signed out, the
  same rule both siblings follow;
- the `EmptyState` when a search returns nothing, carrying the query into the first
  line's name.

**Fulfill links items, it never creates one.** `/inventory/new` owns the image upload,
the categories and the four staff-only fields, each with its own visibility line;
reproducing that in a dialog would mean two item forms drifting apart. The custom
line carries a Create item from this line action that opens the normal item form
prefilled from the request and returns to the queue. This is also the "we already
have one" path: staff skip `sourcing` entirely and fulfill from `pending` by linking
the item on the shelf.

Endpoints go in a new `src/server/inventory-custom.ts` rather than growing
`src/server/inventory.ts`, and internals in
`src/server/_internal/inventory-custom.ts`. That follows the split #104 already
carried out on the internals, which are seven `inventory-*.ts` files today; a new
subsystem arrives as its own file rather than as the eighth reason to open somebody
else's. (#104 is closed, and it was about `_internal/inventory.ts`, not the endpoint
file. It is precedent here, not an open complaint.)

One named wrapper per action over an `*As` seam: `submitCustomRequestAs`,
`startSourcingCustomLineAs`, `rejectCustomLineAs`, `fulfillCustomLineAs`,
`cancelCustomLineAs`. Note the spelling: the repo writes fulfillment with two `l`s.

Each of the five endpoints needs its line in `src/server/__tests__/access-contract.ts`
(ADR-0003). There is no global middleware, so an endpoint with no declared level is a
test failure, and the file's own docblock records the three months during which two
endpoints returned every admin's name, email and role to anonymous callers.

The rules stay pure and client-safe, beside the five modules already in `src/lib`: a
new `inventory-custom-workflow.ts` says which transition a custom line may make and
who may make it, unit tested with no docker. Who gets told extends
`inventory-notifications.ts` rather than forking it; who sees what extends
`inventory-visibility.ts` with a requester projection and a staff projection, so
`decided_by` and `decided_at` cannot leak the way whole table objects once shipped
`serial` and `reviewComment` to students.

**Notifications**: three cases, all in-app, none by email. Sourcing ("we are getting
this"), fulfilled (naming the items, and the pickup deadline when they were
reserved), rejected (carrying the reason). One notification per fulfill, not one per
item. Staff get nothing on submit, because the admin overview tile is already the
signal; that tile's count now includes pending custom lines.

## Landing plan

Four issues, four branches, in order. Each is green and reviewable alone.

1. **The grouping mode** on `AdminDataTable`, with unit tests. No page touched.
2. **The admin queue grouped**, with Approve all over item lines.
3. **`/my/items` restructured**, `tab` retired, every link rewritten.
4. **Custom requests end to end**: schema, vocabulary, rules module, server, form,
   queue rows, fulfill dialog, notifications, plus the docs below.

## Docs, and which PR writes each

Split by PR, because three of these describe work that lands before the fourth. The
two lock orders are separate entries on purpose: they are different rules.

**PR 1, the grouping mode**

- `docs/UI-CONVENTIONS.md`, admin tables: the `group` prop, that grouped-ness is
  derived from the sort rather than stored, and the `header(rows)` constraint that
  group identity is denormalized onto every row.

**PR 2, the staff queue**

- `docs/QUIRKS.md`, Inventory: the batch approve lock order, **lines** in ascending
  id order, and why (line-then-item, against `lockAttachableRequestLine`).

**PR 3, `/my/items`**

- `docs/QUIRKS.md`, Inventory: that `/my/items` disables sorting so its grouped view
  cannot be sorted away from under the Submit button on the borrow list header.
- `docs/UI-CONVENTIONS.md`, the page-width paragraph: it says `my/items.tsx` holds
  "an attention region, a borrow-list card and two tab panels of tables", which stops
  being true in this PR.

**PR 4, custom requests**

- `CONTEXT.md`: custom request, custom line, custom line status, with their avoid
  lists, in the Inventory section. Also amend the existing Line status avoid entry,
  which currently lists `fulfilled` unqualified, to say "for a request line".
- `src/server/__tests__/access-contract.ts`: one line per new endpoint, five in all.
  Not documentation, but it fails the same way a missing doc should and is easiest to
  forget here.
- `docs/QUIRKS.md`, Inventory: the three lifecycle tables from this spec, beside the
  existing pointer at the five pure modules; that an `inventory_requests` row no
  longer implies an item line exists; and the fulfill lock order, **items** in
  ascending id order, which is not the same rule as PR 2's.
- ADR: custom requests reuse the request envelope, and an envelope holds one kind of
  line.
- ADR: `sourcing` rather than `approved`, and why a custom line has no `returned`.
- `PRD.md`: the feature, under Inventory.

## Open questions, carried rather than closed

1. **What the flat view's Request column links to.** There is no single request page
   today. Plain text for now.
2. **Partial fulfillment of one line.** Two asked for, one arrived, has no state of
   its own; staff say it in the reply and leave the line sourcing.
3. **Quantity against reality.** Quantity is what the requester asked for, never a
   promise, and never stock counting: an item is one physical thing.
