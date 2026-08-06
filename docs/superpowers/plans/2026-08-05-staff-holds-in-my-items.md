# Staff-Assigned Holds in My Items Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An item staff reserved or checked out to someone, with no request line behind it, appears in that person's `/my/items` Active tab and fires an overdue notification like any other hold.

**Architecture:** Read-side only. No schema change. `listMyItemsAs` gains a fourth query over `inventory_items` where the viewer is the holder and `current_request_item_id IS NULL`, merged into `active` as a discriminated union sorted by deadline. The overdue notification scan gains a matching pass over held items.

**Tech Stack:** TypeScript, Drizzle ORM, PostgreSQL, TanStack Start, React 19, Vitest.

Spec: [`docs/superpowers/specs/2026-08-05-admin-export-inventory-categories-holds-design.md`](../specs/2026-08-05-admin-export-inventory-categories-holds-design.md) §3.

## Global Constraints

- **No schema change.** `inventory_items` already carries the hold denormalized. The write side was built for this; only the read side assumes request lines are the only source of truth.
- The email-match arm requires `emailVerified` **and** `currentHolderId IS NULL`. Both conditions are security controls, not conveniences.
- The overdue scan requires `currentHolderId IS NOT NULL`, which is deliberately narrower than the read path.
- Holds never get a Cancel button. Releasing a hold is a staff action.
- Run `npm run check` before every commit.
- Prose in comments and docs uses no emdashes.

---

## Background the implementer needs

`inventory_items` carries the current hold in `currentHolderId`, `currentHolderEmail`, `currentHolderLabel`, `currentPickupBy`, `currentDueAt`, `currentRequestItemId`. The schema comment at `src/db/schema.ts:331` says why: "A hold does not need a request line (staff can reserve or check out an item that was never carted), so the current hold's dates live here."

The write side honors that. `resolveHolderId` (`src/server/_internal/inventory-transitions.ts:104`) resolves a hold email to an account, so a hold assigned to an address that matches an account behaves exactly like one assigned through the user picker.

`listMyItemsAs` (`src/server/_internal/inventory.ts:959`) builds all three tabs from `inventory_request_items`. An item with no request line cannot appear there, whoever holds it. That is the entire bug.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/server/_internal/inventory.ts` (modify) | The hold query, the merged `active` union, the overdue pass. |
| `src/routes/_authed/my/items.tsx` (modify) | Render both entry kinds in the Active tab. |
| `src/server/__tests__/inventory.integration.test.ts` (extend) | Visibility, isolation, and dedupe tests. |

---

### Task 1: Surface holds in `listMyItemsAs`

**Files:**
- Modify: `src/server/_internal/inventory.ts:959-1022`
- Test: `src/server/__tests__/inventory.integration.test.ts` (extend)

**Interfaces:**
- Consumes: nothing.
- Produces: `listMyItemsAs` returns `{ cart, active, history }` where `active` is `ActiveEntry[]`:

```ts
export type ActiveEntry =
  | { kind: "request"; line: InventoryRequestItem; item: InventoryItem; request: InventoryRequest }
  | { kind: "hold"; item: InventoryItem };
```

Task 2 renders this exact union. `cart` and `history` are unchanged.

- [ ] **Step 1: Write the failing tests**

Append to `src/server/__tests__/inventory.integration.test.ts`, matching the file's existing helper style for creating users, items, and transitions. Read the top of that file first and reuse its helpers rather than writing new ones.

```ts
describe("staff-assigned holds in my items", () => {
  it("shows a hold that has no request line", async () => {
    const stamp = Date.now();
    const admin = await makeUser(`h-admin-${stamp}@x.com`, "admin");
    const holder = await makeUser(`h-holder-${stamp}@x.com`, "user");
    const { id: itemId } = await createInventoryItemAs(admin, baseItem("Scope"));

    await transitionItemAs(admin, {
      itemId,
      nextStatus: "checked_out",
      holderId: holder.id,
      dueAt: new Date("2026-09-01T00:00:00.000Z"),
    });

    const { active } = await listMyItemsAs(holder);

    expect(active).toHaveLength(1);
    expect(active[0].kind).toBe("hold");
    expect(active[0].item.id).toBe(itemId);
  });

  it("does not leak another user's hold", async () => {
    const stamp = Date.now();
    const admin = await makeUser(`h2-admin-${stamp}@x.com`, "admin");
    const holder = await makeUser(`h2-holder-${stamp}@x.com`, "user");
    const other = await makeUser(`h2-other-${stamp}@x.com`, "user");
    const { id: itemId } = await createInventoryItemAs(admin, baseItem("Meter"));

    await transitionItemAs(admin, {
      itemId,
      nextStatus: "reserved",
      holderId: holder.id,
    });

    const { active } = await listMyItemsAs(other);
    expect(active).toHaveLength(0);
  });

  it("does not duplicate an item that also has a request line", async () => {
    const stamp = Date.now();
    const admin = await makeUser(`h3-admin-${stamp}@x.com`, "admin");
    const requester = await makeUser(`h3-req-${stamp}@x.com`, "user");
    const { id: itemId } = await createInventoryItemAs(admin, baseItem("Iron"));

    await addToCartAs(requester, { itemId });
    await submitCartAs(requester, { note: null });
    const { active } = await listMyItemsAs(requester);

    expect(active).toHaveLength(1);
    expect(active[0].kind).toBe("request");
  });

  it("matches an unlinked hold by verified email", async () => {
    const stamp = Date.now();
    const admin = await makeUser(`h4-admin-${stamp}@x.com`, "admin");
    const { id: itemId } = await createInventoryItemAs(admin, baseItem("Drill"));

    // Assign to an address with no account yet, so resolveHolderId finds
    // nothing and current_holder_id stays null.
    await transitionItemAs(admin, {
      itemId,
      nextStatus: "checked_out",
      holderEmail: `walkin-${stamp}@x.com`,
    });

    const walkIn = await makeUser(`walkin-${stamp}@x.com`, "user");
    const { active } = await listMyItemsAs(walkIn);

    expect(active).toHaveLength(1);
    expect(active[0].kind).toBe("hold");
  });

  it("does not match by email when the address is unverified", async () => {
    const stamp = Date.now();
    const admin = await makeUser(`h5-admin-${stamp}@x.com`, "admin");
    const { id: itemId } = await createInventoryItemAs(admin, baseItem("Saw"));

    await transitionItemAs(admin, {
      itemId,
      nextStatus: "checked_out",
      holderEmail: `unverified-${stamp}@x.com`,
    });

    const impostor = await makeUser(`unverified-${stamp}@x.com`, "user");
    await db
      .update(user)
      .set({ emailVerified: false })
      .where(eq(user.id, impostor.id));

    const { active } = await listMyItemsAs(impostor);
    expect(active).toHaveLength(0);
  });
});
```

The last test is the important one. Without the `emailVerified` condition, anyone could claim someone else's hold by editing their own email address.

- [ ] **Step 2: Run to verify they fail**

Run: `ulimit -n 8192 && npx vitest run --config vitest.integration.config.ts src/server/__tests__/inventory.integration.test.ts`
Expected: the three hold-visibility tests FAIL (`active` is empty); the duplicate test PASSES already.

If every test fails on a missing column, run `npm run db:migrate` first.

- [ ] **Step 3: Add the hold query and merge**

In `src/server/_internal/inventory.ts`, add above `listMyItemsAs`:

```ts
/**
 * An entry in the Active tab. Holds have no request line by definition, so
 * this is a union rather than a line with optional fields.
 */
export type ActiveEntry =
  | {
      kind: "request";
      line: typeof inventoryRequestItems.$inferSelect;
      item: typeof inventoryItems.$inferSelect;
      request: typeof inventoryRequests.$inferSelect;
    }
  | { kind: "hold"; item: typeof inventoryItems.$inferSelect };

function deadlineOf(entry: ActiveEntry): Date | null {
  if (entry.kind === "hold") {
    return entry.item.currentDueAt ?? entry.item.currentPickupBy;
  }
  return entry.line.dueAt ?? entry.line.pickupBy;
}

/**
 * Soonest deadline first, entries without one last, then by item name so the
 * order is stable. "What is due soonest" is the question this tab answers.
 */
function byDeadline(a: ActiveEntry, b: ActiveEntry): number {
  const left = deadlineOf(a);
  const right = deadlineOf(b);
  if (left && right) {
    return left.getTime() - right.getTime() || a.item.name.localeCompare(b.item.name);
  }
  if (left) {
    return -1;
  }
  if (right) {
    return 1;
  }
  return a.item.name.localeCompare(b.item.name);
}
```

Inside `listMyItemsAs`, before the `Promise.all`, resolve the viewer's verified address:

```ts
  // Only a verified address may claim a hold: otherwise anyone could take
  // someone else's item by editing their own email in the profile form.
  const [account] = await db
    .select({ email: user.email, verified: user.emailVerified })
    .from(user)
    .where(eq(user.id, viewer.id));
  const verifiedEmail = account?.verified ? account.email : null;
```

Add a fourth query to the `Promise.all`:

```ts
    db
      .select({ item: inventoryItems })
      .from(inventoryItems)
      .where(
        and(
          // Disjoint from the request-line query above: an item held through
          // a request line is already in `active` and must not appear twice.
          isNull(inventoryItems.currentRequestItemId),
          inArray(inventoryItems.status, ["reserved", "checked_out"]),
          or(
            eq(inventoryItems.currentHolderId, viewer.id),
            verifiedEmail
              ? and(
                  // Never override an explicit account assignment.
                  isNull(inventoryItems.currentHolderId),
                  eq(inventoryItems.currentHolderEmail, verifiedEmail)
                )
              : undefined
          )
        )
      ),
```

Destructure it as `holds` and build the merged result:

```ts
  const active: ActiveEntry[] = [
    ...activeLines.map(
      (row): ActiveEntry => ({ kind: "request", ...row })
    ),
    ...holds.map((row): ActiveEntry => ({ kind: "hold", item: row.item })),
  ].sort(byDeadline);

  return { cart, active, history };
```

Rename the existing second `Promise.all` element to `activeLines`. `history` is unchanged.

`reserved` and `checked_out` only: `requested` implies a request line by definition, and `maintenance`, `retired` and `available` are not holds.

- [ ] **Step 4: Run to verify they pass**

Run: `ulimit -n 8192 && npx vitest run --config vitest.integration.config.ts src/server/__tests__/inventory.integration.test.ts`
Expected: PASS, including the pre-existing tests in the file.

- [ ] **Step 5: Commit**

```bash
npm run check
git add src/server/_internal/inventory.ts src/server/__tests__/inventory.integration.test.ts
git commit -m "fix(inventory): show staff-assigned holds in listMyItemsAs

The write side has always supported holds with no request line; only the
read side still assumed request lines were the only source of truth.

Unlinked holds match on the holder's verified email only, and only when
current_holder_id is null, so an unverified address cannot claim
someone else's item."
```

---

### Task 2: Render both entry kinds

**Files:**
- Modify: `src/routes/_authed/my/items.tsx:134-180`

**Interfaces:**
- Consumes: `ActiveEntry` from Task 1.
- Produces: nothing.

Typecheck fails at the start of this task, because the Active tab destructures `{ line, item }` from what is now a union. That failure is the checklist.

- [ ] **Step 1: Confirm the failure**

Run: `npm run typecheck`
Expected: FAIL in `src/routes/_authed/my/items.tsx`, `Property 'line' does not exist on type 'ActiveEntry'`.

- [ ] **Step 2: Branch on `kind`**

Replace the body of the `tab === "active"` block's `.map` with a branch. A hold renders its dates from the item's own `current*` columns and has no Cancel button: `cancelRequestItem` needs a `requestItemId` that does not exist, and releasing a hold is a staff action.

```tsx
          {data.active.map((entry) => {
            if (entry.kind === "hold") {
              return (
                <div
                  className="flex items-center justify-between rounded-md border border-border bg-card p-3"
                  key={entry.item.id}
                >
                  <div>
                    <p className="font-medium">{entry.item.name}</p>
                    <InventoryStatusBadge
                      status={entry.item.status as "available"}
                    />
                    {entry.item.currentPickupBy && (
                      <p className="text-muted-foreground text-xs">
                        Pick up by{" "}
                        <LocalTime dateOnly value={entry.item.currentPickupBy} />
                      </p>
                    )}
                    {entry.item.currentDueAt && (
                      <p className="text-muted-foreground text-xs">
                        Due <LocalTime dateOnly value={entry.item.currentDueAt} />
                      </p>
                    )}
                    <p className="text-muted-foreground text-xs">
                      Assigned by staff
                    </p>
                  </div>
                </div>
              );
            }

            const { line, item } = entry;
            const canCancel =
              (line.status === "pending" || line.status === "approved") &&
              item.status !== "checked_out";
            return (
              <div
                className="flex items-center justify-between rounded-md border border-border bg-card p-3"
                key={line.id}
              >
                <div>
                  <p className="font-medium">{item.name}</p>
                  <InventoryStatusBadge status={item.status as "available"} />
                  {line.pickupBy && (
                    <p className="text-muted-foreground text-xs">
                      Pick up by <LocalTime dateOnly value={line.pickupBy} />
                    </p>
                  )}
                  {line.dueAt && (
                    <p className="text-muted-foreground text-xs">
                      Due <LocalTime dateOnly value={line.dueAt} />
                    </p>
                  )}
                </div>
                {canCancel && (
                  <Button
                    onClick={async () => {
                      await cancelRequestItem({
                        data: { requestItemId: line.id, note: null },
                      });
                      await refresh();
                    }}
                    size="sm"
                    variant="outline"
                  >
                    Cancel
                  </Button>
                )}
              </div>
            );
          })}
```

Keys stay unique across the two kinds because a hold entry has no request line and its item cannot also appear as a request line, which Task 1's disjointness test asserts.

- [ ] **Step 3: Update the empty-state copy**

The tab is no longer only requests. Replace:

```tsx
            <p className="text-muted-foreground">No active requests.</p>
```

with:

```tsx
            <EmptyState>Nothing active.</EmptyState>
```

`EmptyState` is already imported in this file and is what the Cart and History tabs use; the Active tab was the odd one out.

- [ ] **Step 4: Verify in the running app**

Run: `npm run dev`
- As an admin, check an item out to a second account's address on `/admin/inventory`.
- Sign in as that account and open `/my/items`: the item is in Active, marked "Assigned by staff", with its due date and no Cancel button.
- Cart-request a different item as the same user: both appear, sorted with the sooner deadline first, and only the request has Cancel.

- [ ] **Step 5: Commit**

```bash
npm run check
npm run typecheck
git add src/routes/_authed/my/items.tsx
git commit -m "feat(inventory): render staff-assigned holds in the Active tab

Holds carry no Cancel button: releasing one is a staff action, and
cancelRequestItem needs a request line that does not exist."
```

---

### Task 3: Overdue notifications for holds

**Files:**
- Modify: `src/server/_internal/inventory.ts:1285-1348`
- Test: `src/server/__tests__/inventory.integration.test.ts` (extend)

**Interfaces:**
- Consumes: nothing from Tasks 1 and 2; independent but same root cause.
- Produces: nothing.

`recordOverdueNotificationsAs` scans `inventory_request_items` with `status = 'approved'`, so a staff hold never fires an overdue notice. Fixing display without this would leave an item visibly overdue in the UI that silently never notifies.

**The hold scan requires `currentHolderId IS NOT NULL`**, which is narrower than Task 1's read path. `notifications.userId` is a foreign key to an account, and an email-matched hold has no account id on the row. Resolving the email back to an account here would reintroduce, on a write path, exactly the impersonation risk the read path guards against.

- [ ] **Step 1: Write the failing test**

```ts
describe("overdue notifications for staff holds", () => {
  it("notifies the holder of an overdue hold with no request line", async () => {
    const stamp = Date.now();
    const admin = await makeUser(`o-admin-${stamp}@x.com`, "admin");
    const holder = await makeUser(`o-holder-${stamp}@x.com`, "user");
    const { id: itemId } = await createInventoryItemAs(admin, baseItem("Lathe"));

    await transitionItemAs(admin, {
      itemId,
      nextStatus: "checked_out",
      holderId: holder.id,
      dueAt: new Date("2020-01-01T00:00:00.000Z"),
    });

    await recordOverdueNotificationsAs(holder, { ownerId: holder.id });

    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, holder.id));

    expect(
      rows.filter((r) => r.type === "inventory_checkout_overdue")
    ).toHaveLength(1);
  });

  it("does not notify twice when run again", async () => {
    const stamp = Date.now();
    const admin = await makeUser(`o2-admin-${stamp}@x.com`, "admin");
    const holder = await makeUser(`o2-holder-${stamp}@x.com`, "user");
    const { id: itemId } = await createInventoryItemAs(admin, baseItem("Press"));

    await transitionItemAs(admin, {
      itemId,
      nextStatus: "checked_out",
      holderId: holder.id,
      dueAt: new Date("2020-01-01T00:00:00.000Z"),
    });

    await recordOverdueNotificationsAs(holder, { ownerId: holder.id });
    await recordOverdueNotificationsAs(holder, { ownerId: holder.id });

    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, holder.id));

    expect(
      rows.filter((r) => r.type === "inventory_checkout_overdue")
    ).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `ulimit -n 8192 && npx vitest run --config vitest.integration.config.ts src/server/__tests__/inventory.integration.test.ts`
Expected: FAIL, zero notifications recorded.

- [ ] **Step 3: Add the hold pass**

In `recordOverdueNotificationsAs`, after the existing request-line scan builds its `values` array, add a second query and fold its results into the same array:

```ts
  // Staff holds have no request line, so the scan above cannot see them.
  // Restricted to holds with a resolved account: notifications.userId is a
  // foreign key, and an email-matched hold has no id to attribute a message
  // to. Resolving the address here would reintroduce, on a write path, the
  // impersonation risk the read path in listMyItemsAs guards against.
  const holdConditions = [
    isNull(inventoryItems.currentRequestItemId),
    isNotNull(inventoryItems.currentHolderId),
    inArray(inventoryItems.status, ["reserved", "checked_out"]),
  ];
  if (opts.ownerId) {
    holdConditions.push(eq(inventoryItems.currentHolderId, opts.ownerId));
  }
  const heldRows = await db
    .select({
      itemId: inventoryItems.id,
      itemName: inventoryItems.name,
      status: inventoryItems.status,
      pickupBy: inventoryItems.currentPickupBy,
      dueAt: inventoryItems.currentDueAt,
      holderId: inventoryItems.currentHolderId,
    })
    .from(inventoryItems)
    .where(and(...holdConditions));

  for (const r of heldRows) {
    if (!r.holderId) {
      continue;
    }
    const { pickupOverdue, checkoutOverdue } = deriveDeadlineFlags(r);
    if (pickupOverdue) {
      values.push({
        userId: r.holderId,
        type: "inventory_pickup_overdue",
        title: `Pickup window passed: ${r.itemName}`,
        message: "Your reserved item is past its pickup window.",
        link: `/inventory/${r.itemId}`,
      });
    }
    if (checkoutOverdue) {
      values.push({
        userId: r.holderId,
        type: "inventory_checkout_overdue",
        title: `Overdue: ${r.itemName}`,
        message: "Your checked-out item is past its due date.",
        link: `/inventory/${r.itemId}`,
      });
    }
  }
```

`deriveDeadlineFlags` takes `{ status, pickupBy, dueAt }` structurally, so it works unchanged here.

**The existing dedupe needs no change.** `onConflictDoNothing` targets `(userId, type, link)` where `link` is `/inventory/${itemId}`, keying on the **item** rather than the request line. Hold-derived notifications collapse into the same key space automatically.

Add `isNotNull` to the `drizzle-orm` import if it is not already there.

- [ ] **Step 4: Run to verify it passes**

Run: `ulimit -n 8192 && npx vitest run --config vitest.integration.config.ts src/server/__tests__/inventory.integration.test.ts`
Expected: PASS, the whole file.

- [ ] **Step 5: Full verification**

```bash
npm run check
npm run typecheck
ulimit -n 8192 && npm run test
ulimit -n 8192 && npm run test:integration
```

Expected: all pass.

Then `npm run dev`: as an admin, check an item out to a second account with a due date in the past. Sign in as that account, open `/my/items`, and confirm the notification bell shows an overdue notice and reloading the page does not add a second one.

- [ ] **Step 6: Commit**

```bash
git add src/server/_internal/inventory.ts src/server/__tests__/inventory.integration.test.ts
git commit -m "fix(inventory): fire overdue notifications for staff holds

Same root cause as the display bug: the scan only read request lines.

Restricted to holds with a resolved account id, since notifications.userId
is a foreign key. An email-matched hold therefore shows in /my/items but
does not notify until staff link it to an account."
```

---

## Done when

- A staff-assigned hold appears in the holder's Active tab with its dates and no Cancel button.
- An item with both a hold and a request line appears exactly once.
- An unverified address cannot claim a hold.
- An overdue hold notifies once, not on every page load.
- `npm run check`, `npm run typecheck`, `npm run test` and `npm run test:integration` all pass.
- Update `README.md`: remove the "Show staff-assigned holds in the holder's `/my/items`" roadmap entry.
- Consider a `docs/QUIRKS.md` note on the deliberate asymmetry: the read path matches an unlinked hold by verified email, the notification path does not.
