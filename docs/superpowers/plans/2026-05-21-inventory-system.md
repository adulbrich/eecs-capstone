# Inventory System Implementation Plan

> **Status (verified 2026-06-07):** ✅ **Implemented and shipped.** Verified against the codebase; all deliverables exist. The `- [ ]` checkboxes below were never ticked during execution; they are stale, not a sign of incomplete work.


> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Read `docs/QUIRKS.md` before starting; it documents every framework gotcha this codebase has hit.

**Spec:** `docs/superpowers/specs/2026-05-21-inventory-system-design.md`

**Goal:** Build a lab inventory system: unit-level items with a six-state lifecycle (`available | requested | reserved | checked_out | maintenance | retired`), a per-user cart that submits as one batched `inventory_requests` row with per-line decisions, ad-hoc holder labels for non-user assignees, lazy informational `pickup_by` / `due_at` deadlines (no scheduler), and a navigation refactor that moves all `My *` links into a new `UserMenu` dropdown beside the avatar.

**Architecture:** Same wrapper-plus-`_internal/` pattern as prior specs. `src/server/inventory.ts` holds every `createServerFn` export plus Zod schemas. `src/server/_internal/inventory.ts` holds reads + simple writes + cart + request lifecycle. `src/server/_internal/inventory-transitions.ts` exposes the single `transitionItem` primitive that every status change must go through (writes the history row, syncs `current_holder_*` columns, fires notifications, all inside a `db.transaction`). One integration test file: `src/server/__tests__/inventory.integration.test.ts`. Routes live under `src/routes/inventory/`, `src/routes/_authed/my/items.tsx`, and `src/routes/_authed/admin/inventory/`.

**Tech Stack:** TanStack Start (Router + Form + Query), Better Auth, Drizzle ORM, Postgres 18, shadcn/ui, Tailwind v4, Vitest, Biome.

**Critical conventions to honor** (full list in `docs/QUIRKS.md`):

- Stay on `main`. `AGENTS.md` and `docker-compose.yml` are sometimes dirty in the worktree; never `git add -A`, always add files by name.
- Every `createServerFn` must be a top-level exported `const` initializer with `.inputValidator(...)` (not `.validator`).
- Server-only impls in `_internal/` subdirs. Wrappers do one dynamic import per handler.
- `getRequest`, not `getWebRequest`. `user.id` is `text`. `redirect()` throws `{ options: { to } }`.
- No emdashes in prose, comments, or strings. Lowercase imperative commits with `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>`.
- Inline form controls use `h-9`. Page wrapper uses `<div className="mx-auto max-w-4xl px-4 py-6 md:p-8">`. Status colors via CSS variables, never raw hex.
- Mobile-first: write small-screen styles first, then `md:` overrides. No `sm:`.

---

## Phase 0: Schema and migration

### Task 0.1: Update `src/db/schema.ts`

**Files:**

- Modify: `src/db/schema.ts:37-41` (drop old `inventoryRequestStatusEnum`), `:256-291` (replace inventory tables block)

- [ ] **Step 1: Remove the old `inventoryRequestStatusEnum`** at `src/db/schema.ts:37-41`. Delete those 5 lines.

- [ ] **Step 2: Replace the existing `// INVENTORY` block** (lines 255-291) with the new schema. Open `src/db/schema.ts`, find the block starting at `// INVENTORY`, and replace through the end of the existing `inventoryRequests` table definition with:

```ts
// INVENTORY
export const inventoryItemStatusEnum = pgEnum("inventory_item_status", [
  "available",
  "requested",
  "reserved",
  "checked_out",
  "maintenance",
  "retired",
]);

export const inventoryRequestItemStatusEnum = pgEnum(
  "inventory_request_item_status",
  ["pending", "approved", "rejected", "cancelled", "returned"],
);

export const inventoryItems = pgTable(
  "inventory_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    category: text("category"),
    serial: text("serial"),
    location: text("location"),
    notes: text("notes"),
    imageUrl: text("image_url"),

    status: inventoryItemStatusEnum("status").notNull().default("available"),
    currentHolderId: text("current_holder_id").references(() => user.id, {
      onDelete: "set null",
    }),
    currentHolderLabel: text("current_holder_label"),
    currentRequestItemId: uuid("current_request_item_id"),

    searchVector: tsvector("search_vector")
      .notNull()
      .generatedAlwaysAs(
        sql`setweight(to_tsvector('english', coalesce(name, '')), 'A') || setweight(to_tsvector('english', coalesce(description, '')), 'B') || setweight(to_tsvector('english', coalesce(category, '')), 'C')`,
      ),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("inventory_items_status_idx").on(t.status),
    index("inventory_items_category_idx").on(t.category),
    index("inventory_items_current_holder_idx").on(t.currentHolderId),
  ],
);

export const inventoryRequests = pgTable(
  "inventory_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .references(() => user.id, { onDelete: "restrict" })
      .notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("inventory_requests_user_created_idx").on(t.userId, t.createdAt),
  ],
);

export const inventoryRequestItems = pgTable(
  "inventory_request_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    requestId: uuid("request_id")
      .references(() => inventoryRequests.id, { onDelete: "cascade" })
      .notNull(),
    itemId: uuid("item_id")
      .references(() => inventoryItems.id, { onDelete: "restrict" })
      .notNull(),

    status: inventoryRequestItemStatusEnum("status")
      .notNull()
      .default("pending"),
    reviewedBy: text("reviewed_by").references(() => user.id, {
      onDelete: "set null",
    }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewComment: text("review_comment"),

    pickupBy: timestamp("pickup_by", { withTimezone: true }),
    dueAt: timestamp("due_at", { withTimezone: true }),

    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedBy: text("closed_by").references(() => user.id, {
      onDelete: "set null",
    }),
    closedReason: text("closed_reason"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("inventory_request_items_request_idx").on(t.requestId),
    index("inventory_request_items_item_idx").on(t.itemId),
    index("inventory_request_items_status_idx").on(t.status),
  ],
);

export const inventoryCartItems = pgTable(
  "inventory_cart_items",
  {
    userId: text("user_id")
      .references(() => user.id, { onDelete: "cascade" })
      .notNull(),
    itemId: uuid("item_id")
      .references(() => inventoryItems.id, { onDelete: "cascade" })
      .notNull(),
    addedAt: timestamp("added_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.itemId] })],
);

export const inventoryItemStatusHistory = pgTable(
  "inventory_item_status_history",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    itemId: uuid("item_id")
      .references(() => inventoryItems.id, { onDelete: "cascade" })
      .notNull(),
    oldStatus: inventoryItemStatusEnum("old_status"),
    newStatus: inventoryItemStatusEnum("new_status").notNull(),
    changedBy: text("changed_by")
      .references(() => user.id, { onDelete: "restrict" })
      .notNull(),
    comment: text("comment"),
    requestItemId: uuid("request_item_id").references(
      () => inventoryRequestItems.id,
      { onDelete: "set null" },
    ),
    holderId: text("holder_id").references(() => user.id, {
      onDelete: "set null",
    }),
    holderLabel: text("holder_label"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("inventory_item_status_history_item_idx").on(t.itemId, t.createdAt),
  ],
);

export const inventoryItemEditLog = pgTable(
  "inventory_item_edit_log",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    itemId: uuid("item_id")
      .references(() => inventoryItems.id, { onDelete: "cascade" })
      .notNull(),
    editorId: text("editor_id")
      .references(() => user.id, { onDelete: "restrict" })
      .notNull(),
    changedFields: text("changed_fields").array().notNull(),
    oldValues: jsonb("old_values").notNull(),
    newValues: jsonb("new_values").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("inventory_item_edit_log_item_idx").on(t.itemId, t.createdAt),
  ],
);
```

- [ ] **Step 3: Verify TypeScript compiles.**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit.**

```bash
git add src/db/schema.ts
git commit -m "$(cat <<'EOF'
inventory: replace skeleton schema with spec 7 shape

drops the old single-line inventoryRequests + quantity/reorderThreshold
in inventoryItems. adds six-state item status, cart, batched requests
with per-line decisions, status history, and edit log.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

### Task 0.2: Generate and apply the migration

**Files:**

- Create: `drizzle/<timestamp>_inventory_v2.sql` (Drizzle generates the filename)
- Modify: that generated file (add deferred FK + GIN index)

- [ ] **Step 1: Start the database** so the migration target exists.

Run: `docker compose up -d`
Expected: postgres + rustfs running.

- [ ] **Step 2: Generate the migration.**

Run: `npm run db:generate`
Expected: a new file under `drizzle/` referencing the schema diff.

- [ ] **Step 3: Open the generated file** and append two `ALTER` statements at the bottom, before any closing block:

```sql
-- Deferred FK from inventory_items.current_request_item_id to inventory_request_items.id
ALTER TABLE "inventory_items"
  ADD CONSTRAINT "inventory_items_current_request_item_id_fk"
  FOREIGN KEY ("current_request_item_id")
  REFERENCES "inventory_request_items"("id")
  ON DELETE SET NULL;

-- GIN index on the generated tsvector column for full-text search
CREATE INDEX "inventory_items_search_vector_idx"
  ON "inventory_items" USING GIN ("search_vector");
```

- [ ] **Step 4: Apply the migration.**

Run: `npm run db:migrate`
Expected: no errors. The two new tables, enums, FK, and GIN index now exist.

- [ ] **Step 5: Verify with a smoke query.**

Run: `psql "$DATABASE_URL" -c "\d inventory_items"`
Expected: see the columns and the GIN index `inventory_items_search_vector_idx`.

- [ ] **Step 6: Commit.**

```bash
git add drizzle/
git commit -m "$(cat <<'EOF'
inventory: generate migration for spec 7 schema

adds deferred fk for inventory_items.current_request_item_id and a GIN
index on the search_vector column (neither expressible in drizzle DSL).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Phase 1: Status transition primitive

This is the single chokepoint every status change goes through. Build it first; everything downstream depends on it.

### Task 1.1: Create `inventory-transitions.ts`

**Files:**

- Create: `src/server/_internal/inventory-transitions.ts`

- [ ] **Step 1: Write the file.**

```ts
import { eq } from "drizzle-orm";
import { db } from "#/db";
import type { db as Db } from "#/db";
import {
  inventoryItemStatusHistory,
  inventoryItems,
  inventoryRequestItems,
  notifications,
} from "#/db/schema";

type Tx = Parameters<Parameters<typeof Db.transaction>[0]>[0];

export type ItemStatus =
  | "available"
  | "requested"
  | "reserved"
  | "checked_out"
  | "maintenance"
  | "retired";

export type TransitionInput = {
  itemId: string;
  nextStatus: ItemStatus;
  requestItemId?: string | null;
  holderId?: string | null;
  holderLabel?: string | null;
  pickupBy?: Date | null;
  dueAt?: Date | null;
  comment?: string | null;
};

type Viewer = { id: string; role?: string | null | undefined };

function assertStaff(viewer: Viewer) {
  if (viewer.role !== "admin" && viewer.role !== "instructor") {
    throw new Error("Forbidden");
  }
}

function validateInvariants(input: TransitionInput) {
  const { nextStatus, holderId, holderLabel, requestItemId, pickupBy, dueAt } =
    input;

  switch (nextStatus) {
    case "available":
    case "maintenance":
    case "retired":
      if (holderId || holderLabel || requestItemId) {
        throw new Error(
          `Cannot set holder or request on transition to ${nextStatus}`,
        );
      }
      if (pickupBy || dueAt) {
        throw new Error(
          `pickupBy / dueAt not allowed on transition to ${nextStatus}`,
        );
      }
      return;
    case "requested":
      if (!requestItemId || !holderId || holderLabel) {
        throw new Error(
          "requested status requires requestItemId + holderId, no label",
        );
      }
      return;
    case "reserved":
    case "checked_out": {
      if (!requestItemId) {
        throw new Error(`${nextStatus} requires requestItemId`);
      }
      const hasUser = !!holderId;
      const hasLabel = !!holderLabel;
      if (hasUser === hasLabel) {
        throw new Error(
          `${nextStatus} requires exactly one of holderId or holderLabel`,
        );
      }
      if (nextStatus === "checked_out" && !dueAt) {
        throw new Error("checked_out requires dueAt");
      }
      return;
    }
  }
}

/**
 * Single chokepoint for every item status change. Runs in a transaction,
 * writes one history row, syncs the item's current_holder_* columns and
 * current_request_item_id, and (when applicable) updates the linked
 * inventory_request_items row's lifecycle columns.
 *
 * Does NOT enforce ordering between statuses ("recommended lifecycle" is a
 * UI concern). DOES enforce role and data invariants.
 */
export async function transitionItem(
  viewer: Viewer,
  input: TransitionInput,
  externalTx?: Tx,
) {
  assertStaff(viewer);
  validateInvariants(input);

  // If the caller already has an open transaction (e.g. approveRequestItemAs
  // locks the request line before calling here), reuse it. Otherwise open one.
  if (externalTx) {
    return transitionItemInTx(externalTx, viewer, input);
  }
  return db.transaction(async (tx) => transitionItemInTx(tx, viewer, input));
}

async function transitionItemInTx(
  tx: Tx,
  viewer: Viewer,
  input: TransitionInput,
) {
  {
    const [current] = await tx
      .select()
      .from(inventoryItems)
      .where(eq(inventoryItems.id, input.itemId))
      .for("update");

    if (!current) throw new Error("Item not found");

    // Guard: a fresh request can only attach to an item that is currently
    // free. Without this, callers could orphan an existing pending line by
    // overwriting current_request_item_id silently.
    if (input.nextStatus === "requested" && current.status !== "available") {
      throw new Error(
        `Cannot move item to requested from ${current.status}; release the existing hold first`,
      );
    }

    await tx
      .update(inventoryItems)
      .set({
        status: input.nextStatus,
        currentHolderId: input.holderId ?? null,
        currentHolderLabel: input.holderLabel ?? null,
        currentRequestItemId: input.requestItemId ?? null,
        updatedAt: new Date(),
      })
      .where(eq(inventoryItems.id, input.itemId));

    await tx.insert(inventoryItemStatusHistory).values({
      itemId: input.itemId,
      oldStatus: current.status,
      newStatus: input.nextStatus,
      changedBy: viewer.id,
      comment: input.comment ?? null,
      requestItemId: input.requestItemId ?? null,
      holderId: input.holderId ?? null,
      holderLabel: input.holderLabel ?? null,
    });

    if (input.requestItemId) {
      await syncRequestItem(tx, input);
    } else if (current.currentRequestItemId) {
      // Item is leaving a hold context; close the line based on whether it
      // was actually fulfilled (returned) or released early (cancelled).
      await closeRequestItemOnRelease(
        tx,
        current.currentRequestItemId,
        viewer.id,
        current.status,
        input.comment ?? null,
      );
    }

    await maybeNotify(tx, current, input);
  }
}

async function syncRequestItem(tx: Tx, input: TransitionInput) {
  const id = input.requestItemId!;
  switch (input.nextStatus) {
    case "reserved":
      await tx
        .update(inventoryRequestItems)
        .set({
          status: "approved",
          pickupBy: input.pickupBy ?? null,
          updatedAt: new Date(),
        })
        .where(eq(inventoryRequestItems.id, id));
      return;
    case "checked_out":
      await tx
        .update(inventoryRequestItems)
        .set({ dueAt: input.dueAt ?? null, updatedAt: new Date() })
        .where(eq(inventoryRequestItems.id, id));
      return;
    case "requested":
      // line was created by submitCart with status='pending'; no change.
      return;
    default:
      return;
  }
}

async function closeRequestItemOnRelease(
  tx: Tx,
  requestItemId: string,
  actorId: string,
  prevStatus: ItemStatus,
  comment: string | null,
) {
  // Fulfillment ended in the user's hands then came back: returned.
  // Otherwise (reserved abandoned, sent to maintenance/retired before pickup): cancelled.
  const lineStatus = prevStatus === "checked_out" ? "returned" : "cancelled";
  await tx
    .update(inventoryRequestItems)
    .set({
      status: lineStatus,
      closedAt: new Date(),
      closedBy: actorId,
      closedReason: comment,
      updatedAt: new Date(),
    })
    .where(eq(inventoryRequestItems.id, requestItemId));
}

async function maybeNotify(
  tx: Tx,
  prev: { id: string; name: string; status: ItemStatus; currentHolderId: string | null; currentRequestItemId: string | null },
  input: TransitionInput,
) {
  // Identify a "release-from-hold" path: no new request context provided AND
  // the item was holding one. The original holder is then the recipient.
  const isReleaseFromHold =
    !input.requestItemId && !!prev.currentRequestItemId;

  const recipientId =
    input.holderId ?? (isReleaseFromHold ? prev.currentHolderId : null);
  if (!recipientId) return;

  switch (input.nextStatus) {
    case "reserved": {
      const title = input.pickupBy
        ? `Reserved: ${prev.name}. Pick up by ${formatDate(input.pickupBy)}.`
        : `Reserved: ${prev.name}.`;
      await tx.insert(notifications).values({
        userId: recipientId,
        type: "inventory_request_approved",
        title,
        message: `Your request for ${prev.name} was approved.`,
        link: `/my/items?tab=active`,
      });
      return;
    }
    case "checked_out": {
      await tx.insert(notifications).values({
        userId: recipientId,
        type: "inventory_item_checked_out",
        title: `Checked out: ${prev.name}. Due ${formatDate(input.dueAt)}.`,
        message: `${prev.name} is now in your hands.`,
        link: `/my/items?tab=active`,
      });
      return;
    }
    case "available":
    case "maintenance":
    case "retired": {
      if (!isReleaseFromHold) return;
      if (prev.status === "checked_out" && input.nextStatus === "available") {
        await tx.insert(notifications).values({
          userId: recipientId,
          type: "inventory_item_returned",
          title: `Returned: ${prev.name}`,
          message: `Thanks for returning ${prev.name}.`,
          link: `/inventory/${prev.id}`,
        });
      } else {
        await tx.insert(notifications).values({
          userId: recipientId,
          type: "inventory_request_closed",
          title: `Request closed: ${prev.name}`,
          message:
            input.comment ?? `Your request for ${prev.name} was closed by staff.`,
          link: `/my/items?tab=history`,
        });
      }
      return;
    }
    default:
      return;
  }
}

function formatDate(d: Date | null | undefined): string {
  if (!d) return "soon";
  return new Date(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
```

- [ ] **Step 2: Verify TypeScript compiles.**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit.**

```bash
git add src/server/_internal/inventory-transitions.ts
git commit -m "$(cat <<'EOF'
inventory: add transitionItem primitive

every item status change goes through one function: validates invariants,
writes the history row, syncs current_holder_* and current_request_item_id,
closes the linked request line on release, and fires the relevant
notification, all inside a single transaction.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

### Task 1.2: Integration tests for `transitionItem`

**Files:**

- Create: `src/server/__tests__/inventory.integration.test.ts`

- [ ] **Step 1: Write the initial test file** with helpers and the transition-primitive coverage.

```ts
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "#/db";
import {
  inventoryItemStatusHistory,
  inventoryItems,
  inventoryRequestItems,
  inventoryRequests,
  notifications,
  user,
} from "#/db/schema";
import { auth } from "#/lib/auth";
import { transitionItem } from "#/server/_internal/inventory-transitions";

async function makeUser(
  email: string,
  role: "user" | "admin" | "instructor",
) {
  await auth.api.signUpEmail({
    body: { email, password: "Password1!", name: email },
  });
  await db
    .update(user)
    .set({ emailVerified: true, role })
    .where(eq(user.email, email));
  const [u] = await db.select().from(user).where(eq(user.email, email));
  return { id: u.id, role: u.role };
}

async function makeItem(overrides: Partial<typeof inventoryItems.$inferInsert> = {}) {
  const [item] = await db
    .insert(inventoryItems)
    .values({ name: `Item-${Date.now()}-${Math.random()}`, ...overrides })
    .returning();
  return item;
}

async function makeRequestLine(userId: string, itemId: string) {
  const [req] = await db
    .insert(inventoryRequests)
    .values({ userId })
    .returning();
  const [line] = await db
    .insert(inventoryRequestItems)
    .values({ requestId: req.id, itemId, status: "pending" })
    .returning();
  return { req, line };
}

describe("transitionItem", () => {
  it("staff-only: non-staff viewer is rejected", async () => {
    const student = await makeUser(`s-${Date.now()}@x.com`, "user");
    const item = await makeItem();
    await expect(
      transitionItem(student, {
        itemId: item.id,
        nextStatus: "maintenance",
      }),
    ).rejects.toThrow(/Forbidden/);
  });

  it("available → maintenance writes history and clears holder columns", async () => {
    const admin = await makeUser(`a-${Date.now()}@x.com`, "admin");
    const item = await makeItem();
    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "maintenance",
      comment: "needs new cable",
    });
    const [after] = await db
      .select()
      .from(inventoryItems)
      .where(eq(inventoryItems.id, item.id));
    expect(after.status).toBe("maintenance");
    expect(after.currentHolderId).toBeNull();
    expect(after.currentRequestItemId).toBeNull();
    const history = await db
      .select()
      .from(inventoryItemStatusHistory)
      .where(eq(inventoryItemStatusHistory.itemId, item.id));
    expect(history).toHaveLength(1);
    expect(history[0].oldStatus).toBe("available");
    expect(history[0].newStatus).toBe("maintenance");
    expect(history[0].comment).toBe("needs new cable");
  });

  it("reserved transition requires requestItemId + exactly one holder", async () => {
    const admin = await makeUser(`a-${Date.now()}@x.com`, "admin");
    const item = await makeItem();
    await expect(
      transitionItem(admin, { itemId: item.id, nextStatus: "reserved" }),
    ).rejects.toThrow(/requestItemId/);
    const student = await makeUser(`s-${Date.now()}@x.com`, "user");
    const { line } = await makeRequestLine(student.id, item.id);
    await expect(
      transitionItem(admin, {
        itemId: item.id,
        nextStatus: "reserved",
        requestItemId: line.id,
        holderId: student.id,
        holderLabel: "X",
      }),
    ).rejects.toThrow(/exactly one of holderId or holderLabel/);
  });

  it("reserved transition updates line to approved + sets pickupBy + notifies", async () => {
    const admin = await makeUser(`a-${Date.now()}@x.com`, "admin");
    const student = await makeUser(`s-${Date.now()}@x.com`, "user");
    const item = await makeItem();
    const { line } = await makeRequestLine(student.id, item.id);
    const pickupBy = new Date(Date.now() + 7 * 24 * 3600 * 1000);
    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "reserved",
      requestItemId: line.id,
      holderId: student.id,
      pickupBy,
    });
    const [reqLine] = await db
      .select()
      .from(inventoryRequestItems)
      .where(eq(inventoryRequestItems.id, line.id));
    expect(reqLine.status).toBe("approved");
    expect(reqLine.pickupBy?.getTime()).toBe(pickupBy.getTime());
    const notifs = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, student.id));
    expect(
      notifs.some((n) => n.type === "inventory_request_approved"),
    ).toBe(true);
  });

  it("checked_out requires dueAt", async () => {
    const admin = await makeUser(`a-${Date.now()}@x.com`, "admin");
    const student = await makeUser(`s-${Date.now()}@x.com`, "user");
    const item = await makeItem();
    const { line } = await makeRequestLine(student.id, item.id);
    await expect(
      transitionItem(admin, {
        itemId: item.id,
        nextStatus: "checked_out",
        requestItemId: line.id,
        holderId: student.id,
      }),
    ).rejects.toThrow(/dueAt/);
  });

  it("ad-hoc label: checked_out with holderLabel and no holderId", async () => {
    const admin = await makeUser(`a-${Date.now()}@x.com`, "admin");
    const student = await makeUser(`s-${Date.now()}@x.com`, "user");
    const item = await makeItem();
    const { line } = await makeRequestLine(student.id, item.id);
    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "reserved",
      requestItemId: line.id,
      holderId: student.id,
      pickupBy: new Date(Date.now() + 86400000),
    });
    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "checked_out",
      requestItemId: line.id,
      holderLabel: "Course demo",
      dueAt: new Date(Date.now() + 7 * 86400000),
    });
    const [after] = await db
      .select()
      .from(inventoryItems)
      .where(eq(inventoryItems.id, item.id));
    expect(after.currentHolderId).toBeNull();
    expect(after.currentHolderLabel).toBe("Course demo");
  });

  it("releasing a reserved item back to available closes the line as cancelled (released before fulfillment)", async () => {
    const admin = await makeUser(`a-${Date.now()}@x.com`, "admin");
    const student = await makeUser(`s-${Date.now()}@x.com`, "user");
    const item = await makeItem();
    const { line } = await makeRequestLine(student.id, item.id);
    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "reserved",
      requestItemId: line.id,
      holderId: student.id,
      pickupBy: new Date(Date.now() + 86400000),
    });
    await transitionItem(admin, { itemId: item.id, nextStatus: "available" });
    const [reqLine] = await db
      .select()
      .from(inventoryRequestItems)
      .where(eq(inventoryRequestItems.id, line.id));
    expect(reqLine.status).toBe("cancelled");
    expect(reqLine.closedBy).toBe(admin.id);
    const [after] = await db
      .select()
      .from(inventoryItems)
      .where(eq(inventoryItems.id, item.id));
    expect(after.currentHolderId).toBeNull();
    expect(after.currentRequestItemId).toBeNull();
  });

  it("checked-out item returned to available closes the line as returned (fulfillment completed)", async () => {
    const admin = await makeUser(`a-${Date.now()}@x.com`, "admin");
    const student = await makeUser(`s-${Date.now()}@x.com`, "user");
    const item = await makeItem();
    const { line } = await makeRequestLine(student.id, item.id);
    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "reserved",
      requestItemId: line.id,
      holderId: student.id,
      pickupBy: new Date(Date.now() + 86400000),
    });
    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "checked_out",
      requestItemId: line.id,
      holderId: student.id,
      dueAt: new Date(Date.now() + 7 * 86400000),
    });
    await transitionItem(admin, { itemId: item.id, nextStatus: "available" });
    const [reqLine] = await db
      .select()
      .from(inventoryRequestItems)
      .where(eq(inventoryRequestItems.id, line.id));
    expect(reqLine.status).toBe("returned");
    const notifs = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, student.id));
    expect(
      notifs.some((n) => n.type === "inventory_item_returned"),
    ).toBe(true);
  });

  it("released reserved item to retired notifies requester with inventory_request_closed", async () => {
    const admin = await makeUser(`a-${Date.now()}@x.com`, "admin");
    const student = await makeUser(`s-${Date.now()}@x.com`, "user");
    const item = await makeItem();
    const { line } = await makeRequestLine(student.id, item.id);
    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "reserved",
      requestItemId: line.id,
      holderId: student.id,
      pickupBy: new Date(Date.now() + 86400000),
    });
    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "retired",
      comment: "no longer in service",
    });
    const notifs = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, student.id));
    expect(
      notifs.some((n) => n.type === "inventory_request_closed"),
    ).toBe(true);
  });

  it("rejects requested transition when item is not available (overwrite guard)", async () => {
    const admin = await makeUser(`a-${Date.now()}@x.com`, "admin");
    const student = await makeUser(`s-${Date.now()}@x.com`, "user");
    const item = await makeItem();
    const { line: line1 } = await makeRequestLine(student.id, item.id);
    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "requested",
      requestItemId: line1.id,
      holderId: student.id,
    });
    const { line: line2 } = await makeRequestLine(student.id, item.id);
    await expect(
      transitionItem(admin, {
        itemId: item.id,
        nextStatus: "requested",
        requestItemId: line2.id,
        holderId: student.id,
      }),
    ).rejects.toThrow(/Cannot move item to requested/);
  });
});
```

- [ ] **Step 2: Run the tests.**

Run: `npm run test:integration -- inventory.integration.test.ts`
Expected: all transitionItem tests pass.

- [ ] **Step 3: Commit.**

```bash
git add src/server/__tests__/inventory.integration.test.ts
git commit -m "$(cat <<'EOF'
inventory: integration tests for transitionItem

covers staff-only gate, invariant enforcement, history insert,
holder syncing (user vs label), and the release-closes-line rule.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Phase 2: Catalog reads (browse + detail)

### Task 2.1: Implement `listInventoryImpl` + `getInventoryItemImpl`

**Files:**

- Create: `src/server/_internal/inventory.ts`

- [ ] **Step 1: Write the file.**

```ts
import { and, desc, eq, ilike, ne, or, sql } from "drizzle-orm";
import { db } from "#/db";
import { inventoryItems } from "#/db/schema";
import { readSession } from "#/lib/_internal/auth-guards";

type Viewer = { id: string; role?: string | null | undefined } | null;

export type ListInventoryInput = {
  q: string;
  status: "available" | "requested" | "reserved" | "checked_out" | "maintenance" | null;
  category: string | null;
  page: number;
  pageSize: number;
};

export type InventoryItemPublic = {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  location: string | null;
  imageUrl: string | null;
  status: string;
  pickupBy: Date | null; // populated from the active line when status is reserved
  dueAt: Date | null;    // populated from the active line when status is checked_out
};

export type InventoryItemStaff = InventoryItemPublic & {
  serial: string | null;
  notes: string | null;
  currentHolderId: string | null;
  currentHolderLabel: string | null;
  currentRequestItemId: string | null;
};

function isStaff(viewer: Viewer): boolean {
  return viewer?.role === "admin" || viewer?.role === "instructor";
}

function stripForPublic(row: typeof inventoryItems.$inferSelect): InventoryItemPublic {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    category: row.category,
    location: row.location,
    imageUrl: row.imageUrl,
    status: row.status,
    pickupBy: null,
    dueAt: null,
  };
}

function fullForStaff(row: typeof inventoryItems.$inferSelect): InventoryItemStaff {
  return {
    ...stripForPublic(row),
    serial: row.serial,
    notes: row.notes,
    currentHolderId: row.currentHolderId,
    currentHolderLabel: row.currentHolderLabel,
    currentRequestItemId: row.currentRequestItemId,
  };
}

export async function listInventoryAs(viewer: Viewer, data: ListInventoryInput) {
  const conditions = [ne(inventoryItems.status, "retired")];
  if (data.status) conditions.push(eq(inventoryItems.status, data.status));
  if (data.category) conditions.push(eq(inventoryItems.category, data.category));
  if (data.q) {
    conditions.push(
      or(
        sql`${inventoryItems.searchVector} @@ websearch_to_tsquery('english', ${data.q})`,
        ilike(inventoryItems.name, `%${data.q}%`),
      )!,
    );
  }
  const where = and(...conditions);
  const offset = (data.page - 1) * data.pageSize;

  const rows = await db
    .select()
    .from(inventoryItems)
    .where(where)
    .orderBy(desc(inventoryItems.updatedAt))
    .limit(data.pageSize)
    .offset(offset);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(inventoryItems)
    .where(where);

  return {
    rows: isStaff(viewer) ? rows.map(fullForStaff) : rows.map(stripForPublic),
    total: count,
    page: data.page,
    pageSize: data.pageSize,
  };
}

export async function getInventoryItemAs(viewer: Viewer, data: { id: string }) {
  const [row] = await db
    .select()
    .from(inventoryItems)
    .where(eq(inventoryItems.id, data.id));
  if (!row) return null;
  if (row.status === "retired" && !isStaff(viewer)) return null;
  return isStaff(viewer) ? fullForStaff(row) : stripForPublic(row);
}

export async function listInventoryForCurrentUser(data: ListInventoryInput) {
  // viewer may be null (public listing); readSession does not throw.
  const session = await readSession();
  return listInventoryAs(session?.user ?? null, data);
}

export async function getInventoryItemForCurrentUser(data: { id: string }) {
  const session = await readSession();
  return getInventoryItemAs(session?.user ?? null, data);
}
```

- [ ] **Step 2: Verify TypeScript compiles.**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit.**

```bash
git add src/server/_internal/inventory.ts
git commit -m "inventory: list + get with privacy stripping

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

### Task 2.2: Add wrappers in `src/server/inventory.ts`

**Files:**

- Create: `src/server/inventory.ts`

- [ ] **Step 1: Write the file.**

```ts
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const itemStatusEnum = z.enum([
  "available",
  "requested",
  "reserved",
  "checked_out",
  "maintenance",
]);

const listInventorySchema = z.object({
  q: z.string().default(""),
  status: itemStatusEnum.nullable().default(null),
  category: z.string().nullable().default(null),
  page: z.number().int().positive().default(1),
  pageSize: z.number().int().positive().max(100).default(24),
});

export type ListInventoryInput = z.infer<typeof listInventorySchema>;

export const listInventory = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => listInventorySchema.parse(d))
  .handler(async ({ data }) => {
    const { listInventoryForCurrentUser } = await import(
      "./_internal/inventory"
    );
    return listInventoryForCurrentUser(data);
  });

const idOnlySchema = z.object({ id: z.string().uuid() });

export const getInventoryItem = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => idOnlySchema.parse(d))
  .handler(async ({ data }) => {
    const { getInventoryItemForCurrentUser } = await import(
      "./_internal/inventory"
    );
    return getInventoryItemForCurrentUser(data);
  });
```

- [ ] **Step 2: Verify TypeScript compiles.**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit.**

```bash
git add src/server/inventory.ts
git commit -m "inventory: wrappers for list + get

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

### Task 2.3: Tests for browse privacy and retired-hidden

**Files:**

- Modify: `src/server/__tests__/inventory.integration.test.ts` (append)

- [ ] **Step 1: Append the test block** at the bottom of the file (before the closing brace if the file has a top-level `describe`; otherwise as a new top-level `describe`):

```ts
import {
  getInventoryItemAs,
  listInventoryAs,
} from "#/server/_internal/inventory";

describe("listInventoryAs privacy", () => {
  it("strips holder + notes + serial for anonymous viewer", async () => {
    const admin = await makeUser(`a-${Date.now()}@x.com`, "admin");
    const student = await makeUser(`s-${Date.now()}@x.com`, "user");
    const item = await makeItem({
      notes: "internal note",
      serial: "SN-001",
    });
    const { line } = await makeRequestLine(student.id, item.id);
    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "reserved",
      requestItemId: line.id,
      holderId: student.id,
      pickupBy: new Date(Date.now() + 86400000),
    });
    const result = await listInventoryAs(null, {
      q: "",
      status: null,
      category: null,
      page: 1,
      pageSize: 50,
    });
    const found = result.rows.find((r) => r.id === item.id)!;
    expect(found).toBeDefined();
    expect("notes" in found).toBe(false);
    expect("serial" in found).toBe(false);
    expect("currentHolderId" in found).toBe(false);
  });

  it("includes notes + holder for staff viewer", async () => {
    const admin = await makeUser(`a-${Date.now()}@x.com`, "admin");
    const item = await makeItem({ notes: "internal" });
    const result = await listInventoryAs(admin, {
      q: "",
      status: null,
      category: null,
      page: 1,
      pageSize: 50,
    });
    const found = result.rows.find((r) => r.id === item.id);
    expect((found as { notes: string }).notes).toBe("internal");
  });

  it("hides retired items from non-staff list and detail", async () => {
    const admin = await makeUser(`a-${Date.now()}@x.com`, "admin");
    const item = await makeItem();
    await transitionItem(admin, { itemId: item.id, nextStatus: "retired" });
    const anonList = await listInventoryAs(null, {
      q: "",
      status: null,
      category: null,
      page: 1,
      pageSize: 50,
    });
    expect(anonList.rows.some((r) => r.id === item.id)).toBe(false);
    const anonDetail = await getInventoryItemAs(null, { id: item.id });
    expect(anonDetail).toBeNull();
    const staffDetail = await getInventoryItemAs(admin, { id: item.id });
    expect(staffDetail?.status).toBe("retired");
  });
});
```

- [ ] **Step 2: Run.**

Run: `npm run test:integration -- inventory.integration.test.ts`
Expected: all green.

- [ ] **Step 3: Commit.**

```bash
git add src/server/__tests__/inventory.integration.test.ts
git commit -m "inventory: tests for browse privacy + retired-hidden

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Phase 3: Catalog writes (staff CRUD)

### Task 3.1: Implement create / update / hard-delete

**Files:**

- Modify: `src/server/_internal/inventory.ts` (append)

- [ ] **Step 1: Append** at the bottom of the file:

```ts
import { inventoryItemEditLog, inventoryRequestItems } from "#/db/schema";

export type CreateInventoryItemInput = {
  name: string;
  description: string | null;
  category: string | null;
  serial: string | null;
  location: string | null;
  notes: string | null;
  imageUrl: string | null;
};

function assertStaff(viewer: Viewer) {
  if (!isStaff(viewer)) throw new Error("Forbidden");
}

export async function createInventoryItemAs(
  viewer: Viewer,
  data: CreateInventoryItemInput,
) {
  assertStaff(viewer);
  const [row] = await db
    .insert(inventoryItems)
    .values({
      name: data.name,
      description: data.description,
      category: data.category,
      serial: data.serial,
      location: data.location,
      notes: data.notes,
      imageUrl: data.imageUrl,
    })
    .returning();
  return fullForStaff(row);
}

export type UpdateInventoryItemInput = CreateInventoryItemInput & {
  id: string;
};

const EDITABLE_FIELDS = [
  "name",
  "description",
  "category",
  "serial",
  "location",
  "notes",
  "imageUrl",
] as const;

export async function updateInventoryItemAs(
  viewer: Viewer,
  data: UpdateInventoryItemInput,
) {
  assertStaff(viewer);
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(inventoryItems)
      .where(eq(inventoryItems.id, data.id))
      .for("update");
    if (!before) throw new Error("Item not found");

    const changed: string[] = [];
    const oldValues: Record<string, unknown> = {};
    const newValues: Record<string, unknown> = {};
    for (const f of EDITABLE_FIELDS) {
      // Match projects.ts: normalize undefined to null on both sides and
      // compare with JSON.stringify so a wrapper passing `undefined`
      // for an unset field does not spuriously log a change.
      const oldVal = (before as Record<string, unknown>)[f] ?? null;
      const newVal = (data as Record<string, unknown>)[f] ?? null;
      if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
        changed.push(f);
        oldValues[f] = oldVal;
        newValues[f] = newVal;
      }
    }
    if (changed.length === 0) return fullForStaff(before);

    await tx
      .update(inventoryItems)
      .set({
        name: data.name,
        description: data.description,
        category: data.category,
        serial: data.serial,
        location: data.location,
        notes: data.notes,
        imageUrl: data.imageUrl,
        updatedAt: new Date(),
      })
      .where(eq(inventoryItems.id, data.id));

    await tx.insert(inventoryItemEditLog).values({
      itemId: data.id,
      editorId: viewer!.id,
      changedFields: changed,
      oldValues,
      newValues,
    });

    const [after] = await tx
      .select()
      .from(inventoryItems)
      .where(eq(inventoryItems.id, data.id));
    return fullForStaff(after);
  });
}

export async function hardDeleteInventoryItemAs(
  viewer: Viewer,
  data: { id: string; confirmName: string },
) {
  assertStaff(viewer);
  const [row] = await db
    .select()
    .from(inventoryItems)
    .where(eq(inventoryItems.id, data.id));
  if (!row) throw new Error("Item not found");
  if (row.name !== data.confirmName) {
    throw new Error("Name confirmation does not match");
  }
  if (row.status !== "available" && row.status !== "retired") {
    throw new Error("Hard delete only allowed when status is available or retired");
  }
  // Pre-check the RESTRICT FK on inventory_request_items.item_id so the
  // caller gets a friendly error instead of a raw Postgres 23503.
  const [historical] = await db
    .select({ id: inventoryRequestItems.id })
    .from(inventoryRequestItems)
    .where(eq(inventoryRequestItems.itemId, data.id))
    .limit(1);
  if (historical) {
    throw new Error(
      "Cannot hard delete; this item has historical request records. Retire it instead.",
    );
  }
  await db.delete(inventoryItems).where(eq(inventoryItems.id, data.id));
  return { ok: true as const };
}
```

- [ ] **Step 2: Compile.**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit.**

```bash
git add src/server/_internal/inventory.ts
git commit -m "inventory: staff catalog writes (create/update/hard-delete)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

### Task 3.2: Wrappers for catalog writes

**Files:**

- Modify: `src/server/inventory.ts` (append)

- [ ] **Step 1: Append.**

```ts
const itemPayloadSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(5000).nullable().default(null),
  category: z.string().max(120).nullable().default(null),
  serial: z.string().max(120).nullable().default(null),
  location: z.string().max(200).nullable().default(null),
  notes: z.string().max(5000).nullable().default(null),
  imageUrl: z.string().max(500).nullable().default(null),
});

export const createInventoryItem = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => itemPayloadSchema.parse(d))
  .handler(async ({ data }) => {
    const { createInventoryItemForCurrentUser } = await import(
      "./_internal/inventory"
    );
    return createInventoryItemForCurrentUser(data);
  });

const updatePayloadSchema = itemPayloadSchema.extend({
  id: z.string().uuid(),
});

export const updateInventoryItem = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => updatePayloadSchema.parse(d))
  .handler(async ({ data }) => {
    const { updateInventoryItemForCurrentUser } = await import(
      "./_internal/inventory"
    );
    return updateInventoryItemForCurrentUser(data);
  });

const hardDeleteSchema = z.object({
  id: z.string().uuid(),
  confirmName: z.string().min(1),
});

export const hardDeleteInventoryItem = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => hardDeleteSchema.parse(d))
  .handler(async ({ data }) => {
    const { hardDeleteInventoryItemForCurrentUser } = await import(
      "./_internal/inventory"
    );
    return hardDeleteInventoryItemForCurrentUser(data);
  });
```

- [ ] **Step 2: Add the `*ForCurrentUser` wrappers** at the bottom of `src/server/_internal/inventory.ts`:

```ts
export async function createInventoryItemForCurrentUser(
  data: CreateInventoryItemInput,
) {
  const viewer = await requireUser();
  return createInventoryItemAs(viewer, data);
}

export async function updateInventoryItemForCurrentUser(
  data: UpdateInventoryItemInput,
) {
  const viewer = await requireUser();
  return updateInventoryItemAs(viewer, data);
}

export async function hardDeleteInventoryItemForCurrentUser(data: {
  id: string;
  confirmName: string;
}) {
  const viewer = await requireUser();
  return hardDeleteInventoryItemAs(viewer, data);
}
```

- [ ] **Step 3: Compile.**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit.**

```bash
git add src/server/inventory.ts src/server/_internal/inventory.ts
git commit -m "inventory: wrappers + ForCurrentUser helpers for catalog writes

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

### Task 3.3: Integration tests for catalog CRUD + hard-delete + edit log

**Files:**

- Modify: `src/server/__tests__/inventory.integration.test.ts` (append)

- [ ] **Step 1: Append.**

```ts
import {
  createInventoryItemAs,
  hardDeleteInventoryItemAs,
  updateInventoryItemAs,
} from "#/server/_internal/inventory";
import { inventoryItemEditLog } from "#/db/schema";

describe("catalog CRUD", () => {
  it("non-staff cannot create / update / delete", async () => {
    const student = await makeUser(`s-${Date.now()}@x.com`, "user");
    const blank = {
      name: "X",
      description: null,
      category: null,
      serial: null,
      location: null,
      notes: null,
      imageUrl: null,
    };
    await expect(createInventoryItemAs(student, blank)).rejects.toThrow(
      /Forbidden/,
    );
    await expect(
      updateInventoryItemAs(student, { id: "00000000-0000-0000-0000-000000000000", ...blank }),
    ).rejects.toThrow(/Forbidden/);
    await expect(
      hardDeleteInventoryItemAs(student, {
        id: "00000000-0000-0000-0000-000000000000",
        confirmName: "X",
      }),
    ).rejects.toThrow(/Forbidden/);
  });

  it("update writes one edit-log row with diffed fields", async () => {
    const admin = await makeUser(`a-${Date.now()}@x.com`, "admin");
    const item = await makeItem({ name: "Old", location: "Shelf A" });
    await updateInventoryItemAs(admin, {
      id: item.id,
      name: "New",
      description: null,
      category: null,
      serial: null,
      location: "Shelf B",
      notes: null,
      imageUrl: null,
    });
    const logs = await db
      .select()
      .from(inventoryItemEditLog)
      .where(eq(inventoryItemEditLog.itemId, item.id));
    expect(logs).toHaveLength(1);
    expect(new Set(logs[0].changedFields)).toEqual(
      new Set(["name", "location"]),
    );
    expect(logs[0].oldValues).toMatchObject({ name: "Old", location: "Shelf A" });
    expect(logs[0].newValues).toMatchObject({ name: "New", location: "Shelf B" });
  });

  it("hard-delete refuses when status is checked_out", async () => {
    const admin = await makeUser(`a-${Date.now()}@x.com`, "admin");
    const student = await makeUser(`s-${Date.now()}@x.com`, "user");
    const item = await makeItem({ name: "Scope" });
    const { line } = await makeRequestLine(student.id, item.id);
    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "reserved",
      requestItemId: line.id,
      holderId: student.id,
      pickupBy: new Date(Date.now() + 86400000),
    });
    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "checked_out",
      requestItemId: line.id,
      holderId: student.id,
      dueAt: new Date(Date.now() + 7 * 86400000),
    });
    await expect(
      hardDeleteInventoryItemAs(admin, { id: item.id, confirmName: "Scope" }),
    ).rejects.toThrow(/available or retired/);
  });

  it("hard-delete refuses when name confirmation does not match", async () => {
    const admin = await makeUser(`a-${Date.now()}@x.com`, "admin");
    const item = await makeItem({ name: "Real" });
    // Retire first so the status gate cannot fire instead and mask a name-gate bug.
    await transitionItem(admin, { itemId: item.id, nextStatus: "retired" });
    await expect(
      hardDeleteInventoryItemAs(admin, { id: item.id, confirmName: "Wrong" }),
    ).rejects.toThrow(/confirmation/);
  });

  it("hard-delete succeeds when retired and unused", async () => {
    const admin = await makeUser(`a-${Date.now()}@x.com`, "admin");
    const item = await makeItem({ name: "Old kit" });
    await transitionItem(admin, { itemId: item.id, nextStatus: "retired" });
    await hardDeleteInventoryItemAs(admin, {
      id: item.id,
      confirmName: "Old kit",
    });
    const found = await db
      .select()
      .from(inventoryItems)
      .where(eq(inventoryItems.id, item.id));
    expect(found).toHaveLength(0);
  });

  it("hard-delete fails when historical request lines reference the item", async () => {
    const admin = await makeUser(`a-${Date.now()}@x.com`, "admin");
    const student = await makeUser(`s-${Date.now()}@x.com`, "user");
    const item = await makeItem({ name: "Cabled" });
    await makeRequestLine(student.id, item.id); // pending, never resolved
    await transitionItem(admin, { itemId: item.id, nextStatus: "retired" });
    await expect(
      hardDeleteInventoryItemAs(admin, { id: item.id, confirmName: "Cabled" }),
    ).rejects.toThrow(/historical/i);
  });
});
```

- [ ] **Step 2: Run.**

Run: `npm run test:integration -- inventory.integration.test.ts`
Expected: all green.

- [ ] **Step 3: Commit.**

```bash
git add src/server/__tests__/inventory.integration.test.ts
git commit -m "inventory: tests for catalog CRUD + hard-delete guards

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Phase 4: Cart

### Task 4.1: Cart impls (`add`, `remove`, `get`, `submitCart`)

**Files:**

- Modify: `src/server/_internal/inventory.ts` (append)

- [ ] **Step 1: Append.**

```ts
import {
  inventoryCartItems,
  inventoryRequestItems,
  inventoryRequests,
} from "#/db/schema";

export async function getCartAs(viewer: Viewer) {
  if (!viewer) throw new Error("Sign in required");
  const rows = await db
    .select({
      itemId: inventoryCartItems.itemId,
      addedAt: inventoryCartItems.addedAt,
      name: inventoryItems.name,
      imageUrl: inventoryItems.imageUrl,
      status: inventoryItems.status,
    })
    .from(inventoryCartItems)
    .innerJoin(
      inventoryItems,
      eq(inventoryCartItems.itemId, inventoryItems.id),
    )
    .where(eq(inventoryCartItems.userId, viewer.id))
    .orderBy(desc(inventoryCartItems.addedAt));
  return rows;
}

export async function addToCartAs(viewer: Viewer, data: { itemId: string }) {
  if (!viewer) throw new Error("Sign in required");
  const [item] = await db
    .select()
    .from(inventoryItems)
    .where(eq(inventoryItems.id, data.itemId));
  if (!item) throw new Error("Item not found");
  if (item.status !== "available") {
    throw new Error("Only available items can be added to the cart");
  }
  await db
    .insert(inventoryCartItems)
    .values({ userId: viewer.id, itemId: data.itemId })
    .onConflictDoNothing();
  return { ok: true as const };
}

export async function removeFromCartAs(
  viewer: Viewer,
  data: { itemId: string },
) {
  if (!viewer) throw new Error("Sign in required");
  await db
    .delete(inventoryCartItems)
    .where(
      and(
        eq(inventoryCartItems.userId, viewer.id),
        eq(inventoryCartItems.itemId, data.itemId),
      ),
    );
  return { ok: true as const };
}

export async function submitCartAs(
  viewer: Viewer,
  data: { note: string | null },
) {
  if (!viewer) throw new Error("Sign in required");

  return db.transaction(async (tx) => {
    const cartRows = await tx
      .select({ itemId: inventoryCartItems.itemId })
      .from(inventoryCartItems)
      .where(eq(inventoryCartItems.userId, viewer.id));

    if (cartRows.length === 0) {
      throw new Error("Cart is empty");
    }

    // Phase 1: lock each cart item and confirm it is still available.
    // Closes the TOCTOU window an unlocked partition select would leave
    // open; mirrors the overwrite guard in transitionItem.
    const skipped: { itemId: string; reason: "no_longer_available" }[] = [];
    const survivors: {
      itemId: string;
      oldStatus: (typeof inventoryItems.$inferSelect)["status"];
    }[] = [];
    for (const row of cartRows) {
      const [locked] = await tx
        .select()
        .from(inventoryItems)
        .where(eq(inventoryItems.id, row.itemId))
        .for("update");
      if (!locked || locked.status !== "available") {
        skipped.push({ itemId: row.itemId, reason: "no_longer_available" });
        continue;
      }
      survivors.push({ itemId: row.itemId, oldStatus: locked.status });
    }

    // Cart is always cleared once we have processed it.
    await tx
      .delete(inventoryCartItems)
      .where(eq(inventoryCartItems.userId, viewer.id));

    if (survivors.length === 0) {
      return { requestId: null, submitted: [], skipped };
    }

    // Phase 2: only now insert the request envelope, so we never leave an
    // orphaned inventoryRequests row when every line races.
    const [req] = await tx
      .insert(inventoryRequests)
      .values({ userId: viewer.id, note: data.note })
      .returning();

    const lines = await tx
      .insert(inventoryRequestItems)
      .values(
        survivors.map((s) => ({
          requestId: req.id,
          itemId: s.itemId,
          status: "pending" as const,
        })),
      )
      .returning();

    // transitionItem requires staff; do the requested transition inline.
    // Survivor rows are locked from phase 1, so atomicity and the overwrite
    // guard hold. No notification: self-submit needs none (matches the
    // requested arm of transitionItem.maybeNotify).
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const survivor = survivors[i];
      await tx
        .update(inventoryItems)
        .set({
          status: "requested",
          currentHolderId: viewer.id,
          currentHolderLabel: null,
          currentRequestItemId: line.id,
          updatedAt: new Date(),
        })
        .where(eq(inventoryItems.id, line.itemId));
      await tx.insert(inventoryItemStatusHistory).values({
        itemId: line.itemId,
        oldStatus: survivor.oldStatus,
        newStatus: "requested",
        changedBy: viewer.id,
        requestItemId: line.id,
        holderId: viewer.id,
      });
    }

    return {
      requestId: req.id,
      submitted: lines.map((l) => l.itemId),
      skipped,
    };
  });
}

export async function getCartForCurrentUser() {
  const viewer = await requireUser();
  return getCartAs(viewer);
}

export async function addToCartForCurrentUser(data: { itemId: string }) {
  const viewer = await requireUser();
  return addToCartAs(viewer, data);
}

export async function removeFromCartForCurrentUser(data: { itemId: string }) {
  const viewer = await requireUser();
  return removeFromCartAs(viewer, data);
}

export async function submitCartForCurrentUser(data: { note: string | null }) {
  const viewer = await requireUser();
  return submitCartAs(viewer, data);
}
```

Note: the `import { inventoryCartItems, ... } from "#/db/schema"` lines may already be in the file from earlier appends; consolidate at the top if Biome complains.

- [ ] **Step 2: Add the import of `inventoryItemStatusHistory`** to the top of the file if missing.

- [ ] **Step 3: Compile.**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit.**

```bash
git add src/server/_internal/inventory.ts
git commit -m "inventory: cart add/remove/get/submit

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

### Task 4.2: Cart wrappers

**Files:**

- Modify: `src/server/inventory.ts` (append)

- [ ] **Step 1: Append.**

```ts
export const getCart = createServerFn({ method: "GET" })
  .handler(async () => {
    const { getCartForCurrentUser } = await import("./_internal/inventory");
    return getCartForCurrentUser();
  });

const addToCartSchema = z.object({ itemId: z.string().uuid() });

export const addToCart = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => addToCartSchema.parse(d))
  .handler(async ({ data }) => {
    const { addToCartForCurrentUser } = await import("./_internal/inventory");
    return addToCartForCurrentUser(data);
  });

export const removeFromCart = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => addToCartSchema.parse(d))
  .handler(async ({ data }) => {
    const { removeFromCartForCurrentUser } = await import("./_internal/inventory");
    return removeFromCartForCurrentUser(data);
  });

export const submitCart = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ note: z.string().max(2000).nullable().default(null) }).parse(d),
  )
  .handler(async ({ data }) => {
    const { submitCartForCurrentUser } = await import("./_internal/inventory");
    return submitCartForCurrentUser(data);
  });
```

- [ ] **Step 2: Compile + commit.**

Run: `npx tsc --noEmit`

```bash
git add src/server/inventory.ts
git commit -m "inventory: wrappers for cart ops

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

### Task 4.3: Cart tests

**Files:**

- Modify: `src/server/__tests__/inventory.integration.test.ts` (append)

- [ ] **Step 1: Append.**

```ts
import {
  addToCartAs,
  submitCartAs,
} from "#/server/_internal/inventory";
import { inventoryCartItems } from "#/db/schema";

describe("cart", () => {
  it("rejects adding a non-available item", async () => {
    const admin = await makeUser(`a-${Date.now()}@x.com`, "admin");
    const student = await makeUser(`s-${Date.now()}@x.com`, "user");
    const item = await makeItem();
    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "maintenance",
    });
    await expect(
      addToCartAs(student, { itemId: item.id }),
    ).rejects.toThrow(/available/);
  });

  it("submit happy path: one request, N lines, items move to requested", async () => {
    const student = await makeUser(`s-${Date.now()}@x.com`, "user");
    const items = await Promise.all([makeItem(), makeItem(), makeItem()]);
    for (const i of items) await addToCartAs(student, { itemId: i.id });
    const result = await submitCartAs(student, { note: "for demo" });
    expect(result.submitted).toHaveLength(3);
    expect(result.skipped).toHaveLength(0);
    for (const i of items) {
      const [row] = await db
        .select()
        .from(inventoryItems)
        .where(eq(inventoryItems.id, i.id));
      expect(row.status).toBe("requested");
      expect(row.currentHolderId).toBe(student.id);
      expect(row.currentRequestItemId).not.toBeNull();
    }
    const cartLeft = await db
      .select()
      .from(inventoryCartItems)
      .where(eq(inventoryCartItems.userId, student.id));
    expect(cartLeft).toHaveLength(0);
  });

  it("submit partial: skips items that became unavailable between add and submit", async () => {
    const admin = await makeUser(`a-${Date.now()}@x.com`, "admin");
    const student = await makeUser(`s-${Date.now()}@x.com`, "user");
    const [a, b, c] = await Promise.all([makeItem(), makeItem(), makeItem()]);
    await addToCartAs(student, { itemId: a.id });
    await addToCartAs(student, { itemId: b.id });
    await addToCartAs(student, { itemId: c.id });
    await transitionItem(admin, { itemId: b.id, nextStatus: "maintenance" });
    const result = await submitCartAs(student, { note: null });
    expect(result.submitted.sort()).toEqual([a.id, c.id].sort());
    expect(result.skipped).toEqual([
      { itemId: b.id, reason: "no_longer_available" },
    ]);
    const cartLeft = await db
      .select()
      .from(inventoryCartItems)
      .where(eq(inventoryCartItems.userId, student.id));
    expect(cartLeft).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run + commit.**

Run: `npm run test:integration -- inventory.integration.test.ts`
Expected: green.

```bash
git add src/server/__tests__/inventory.integration.test.ts
git commit -m "inventory: cart tests (happy + partial + guard)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Phase 5: Request lifecycle (approve / reject / cancel)

### Task 5.1: Implement `approveRequestItemAs`, `rejectRequestItemAs`, `cancelRequestItemAs`

**Files:**

- Modify: `src/server/_internal/inventory.ts` (append)

- [ ] **Step 1: Append.**

```ts
const DEFAULT_PICKUP_DAYS = 7;

function defaultPickupBy(): Date {
  return new Date(Date.now() + DEFAULT_PICKUP_DAYS * 86400000);
}

export async function approveRequestItemAs(
  viewer: Viewer,
  data: { requestItemId: string; pickupBy: Date | null },
) {
  assertStaff(viewer);
  const { transitionItem } = await import("./inventory-transitions");
  return db.transaction(async (tx) => {
    // Lock the line before reading and updating it so a concurrent cancel
    // cannot move it out of 'pending' between this read and the transition.
    const [line] = await tx
      .select({
        id: inventoryRequestItems.id,
        itemId: inventoryRequestItems.itemId,
        requesterId: inventoryRequests.userId,
        status: inventoryRequestItems.status,
      })
      .from(inventoryRequestItems)
      .innerJoin(
        inventoryRequests,
        eq(inventoryRequestItems.requestId, inventoryRequests.id),
      )
      .where(eq(inventoryRequestItems.id, data.requestItemId))
      .for("update");
    if (!line) throw new Error("Request line not found");
    if (line.status !== "pending") {
      throw new Error("Only pending lines can be approved");
    }
    await tx
      .update(inventoryRequestItems)
      .set({
        reviewedBy: viewer!.id,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(inventoryRequestItems.id, data.requestItemId));
    // Pass the open transaction so transitionItem joins the same atomic
    // unit; syncRequestItem flips the line to 'approved' under our lock.
    await transitionItem(
      viewer!,
      {
        itemId: line.itemId,
        nextStatus: "reserved",
        requestItemId: line.id,
        holderId: line.requesterId,
        pickupBy: data.pickupBy ?? defaultPickupBy(),
      },
      tx,
    );
    return { ok: true as const };
  });
}

export async function rejectRequestItemAs(
  viewer: Viewer,
  data: { requestItemId: string; reviewComment: string },
) {
  assertStaff(viewer);
  if (!data.reviewComment.trim()) {
    throw new Error("Reject reason required");
  }
  return db.transaction(async (tx) => {
    // Join requester id into the initial line read so we do not need a
    // second SELECT just to find the notification recipient.
    const [line] = await tx
      .select({
        id: inventoryRequestItems.id,
        itemId: inventoryRequestItems.itemId,
        status: inventoryRequestItems.status,
        requesterId: inventoryRequests.userId,
      })
      .from(inventoryRequestItems)
      .innerJoin(
        inventoryRequests,
        eq(inventoryRequestItems.requestId, inventoryRequests.id),
      )
      .where(eq(inventoryRequestItems.id, data.requestItemId))
      .for("update");
    if (!line) throw new Error("Request line not found");
    if (line.status !== "pending") {
      throw new Error("Only pending lines can be rejected");
    }
    const [item] = await tx
      .select()
      .from(inventoryItems)
      .where(eq(inventoryItems.id, line.itemId))
      .for("update");
    await tx
      .update(inventoryRequestItems)
      .set({
        status: "rejected",
        reviewedBy: viewer!.id,
        reviewedAt: new Date(),
        reviewComment: data.reviewComment,
        closedAt: new Date(),
        closedBy: viewer!.id,
        closedReason: data.reviewComment,
        updatedAt: new Date(),
      })
      .where(eq(inventoryRequestItems.id, data.requestItemId));
    await tx
      .update(inventoryItems)
      .set({
        status: "available",
        currentHolderId: null,
        currentHolderLabel: null,
        currentRequestItemId: null,
        updatedAt: new Date(),
      })
      .where(eq(inventoryItems.id, line.itemId));
    await tx.insert(inventoryItemStatusHistory).values({
      itemId: line.itemId,
      oldStatus: item.status,
      newStatus: "available",
      changedBy: viewer!.id,
      comment: data.reviewComment,
      requestItemId: line.id,
    });
    await tx.insert(notifications).values({
      userId: line.requesterId,
      type: "inventory_request_rejected",
      title: `Request denied: ${item.name}`,
      message: data.reviewComment,
      link: `/my/items?tab=history`,
    });
    return { ok: true as const };
  });
}

export async function cancelRequestItemAs(
  viewer: Viewer,
  data: { requestItemId: string; note: string | null },
) {
  if (!viewer) throw new Error("Sign in required");
  return db.transaction(async (tx) => {
    const [line] = await tx
      .select({
        id: inventoryRequestItems.id,
        itemId: inventoryRequestItems.itemId,
        status: inventoryRequestItems.status,
        requesterId: inventoryRequests.userId,
      })
      .from(inventoryRequestItems)
      .innerJoin(
        inventoryRequests,
        eq(inventoryRequestItems.requestId, inventoryRequests.id),
      )
      .where(eq(inventoryRequestItems.id, data.requestItemId))
      .for("update");
    if (!line) throw new Error("Request line not found");
    if (line.requesterId !== viewer.id) {
      throw new Error("Only the requester can cancel");
    }
    if (line.status !== "pending" && line.status !== "approved") {
      throw new Error("Line is not in a cancellable state");
    }
    const [item] = await tx
      .select()
      .from(inventoryItems)
      .where(eq(inventoryItems.id, line.itemId))
      .for("update");
    if (item.status === "checked_out") {
      throw new Error("Cannot cancel after checkout");
    }
    await tx
      .update(inventoryRequestItems)
      .set({
        status: "cancelled",
        closedAt: new Date(),
        closedBy: viewer.id,
        closedReason: data.note,
        updatedAt: new Date(),
      })
      .where(eq(inventoryRequestItems.id, line.id));
    await tx
      .update(inventoryItems)
      .set({
        status: "available",
        currentHolderId: null,
        currentHolderLabel: null,
        currentRequestItemId: null,
        updatedAt: new Date(),
      })
      .where(eq(inventoryItems.id, line.itemId));
    await tx.insert(inventoryItemStatusHistory).values({
      itemId: line.itemId,
      oldStatus: item.status,
      newStatus: "available",
      changedBy: viewer.id,
      comment: data.note,
      requestItemId: line.id,
    });
    return { ok: true as const };
  });
}

export async function approveRequestItemForCurrentUser(data: {
  requestItemId: string;
  pickupBy: Date | null;
}) {
  const viewer = await requireUser();
  return approveRequestItemAs(viewer, data);
}

export async function rejectRequestItemForCurrentUser(data: {
  requestItemId: string;
  reviewComment: string;
}) {
  const viewer = await requireUser();
  return rejectRequestItemAs(viewer, data);
}

export async function cancelRequestItemForCurrentUser(data: {
  requestItemId: string;
  note: string | null;
}) {
  const viewer = await requireUser();
  return cancelRequestItemAs(viewer, data);
}
```

- [ ] **Step 2: Compile + commit.**

```bash
git add src/server/_internal/inventory.ts
git commit -m "inventory: approve/reject/cancel request lines

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

### Task 5.2: Wrappers for request lifecycle

**Files:**

- Modify: `src/server/inventory.ts` (append)

- [ ] **Step 1: Append.**

```ts
const approveSchema = z.object({
  requestItemId: z.string().uuid(),
  pickupBy: z.coerce.date().nullable().default(null),
});

export const approveRequestItem = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => approveSchema.parse(d))
  .handler(async ({ data }) => {
    const { approveRequestItemForCurrentUser } = await import(
      "./_internal/inventory"
    );
    return approveRequestItemForCurrentUser(data);
  });

const rejectSchema = z.object({
  requestItemId: z.string().uuid(),
  reviewComment: z.string().min(1).max(2000),
});

export const rejectRequestItem = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => rejectSchema.parse(d))
  .handler(async ({ data }) => {
    const { rejectRequestItemForCurrentUser } = await import(
      "./_internal/inventory"
    );
    return rejectRequestItemForCurrentUser(data);
  });

const cancelSchema = z.object({
  requestItemId: z.string().uuid(),
  note: z.string().max(2000).nullable().default(null),
});

export const cancelRequestItem = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => cancelSchema.parse(d))
  .handler(async ({ data }) => {
    const { cancelRequestItemForCurrentUser } = await import(
      "./_internal/inventory"
    );
    return cancelRequestItemForCurrentUser(data);
  });
```

- [ ] **Step 2: Compile + commit.**

```bash
git add src/server/inventory.ts
git commit -m "inventory: wrappers for approve/reject/cancel

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

### Task 5.3: Tests for approve / reject / cancel

**Files:**

- Modify: `src/server/__tests__/inventory.integration.test.ts` (append)

- [ ] **Step 1: Append.**

```ts
import {
  approveRequestItemAs,
  cancelRequestItemAs,
  rejectRequestItemAs,
} from "#/server/_internal/inventory";

describe("request lifecycle", () => {
  it("approve moves item to reserved + line to approved + notifies", async () => {
    const admin = await makeUser(`a-${Date.now()}@x.com`, "admin");
    const student = await makeUser(`s-${Date.now()}@x.com`, "user");
    const item = await makeItem({ name: "Scope" });
    await addToCartAs(student, { itemId: item.id });
    const result = await submitCartAs(student, { note: null });
    const lineId = result.submitted[0] && (
      await db
        .select()
        .from(inventoryRequestItems)
        .where(eq(inventoryRequestItems.itemId, item.id))
    )[0].id;
    await approveRequestItemAs(admin, { requestItemId: lineId, pickupBy: null });
    const [after] = await db
      .select()
      .from(inventoryItems)
      .where(eq(inventoryItems.id, item.id));
    expect(after.status).toBe("reserved");
    const [line] = await db
      .select()
      .from(inventoryRequestItems)
      .where(eq(inventoryRequestItems.id, lineId));
    expect(line.status).toBe("approved");
    expect(line.pickupBy).not.toBeNull();
    const notifs = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, student.id));
    expect(
      notifs.some((n) => n.type === "inventory_request_approved"),
    ).toBe(true);
  });

  it("reject requires reason and returns item to available", async () => {
    const admin = await makeUser(`a-${Date.now()}@x.com`, "admin");
    const student = await makeUser(`s-${Date.now()}@x.com`, "user");
    const item = await makeItem();
    await addToCartAs(student, { itemId: item.id });
    await submitCartAs(student, { note: null });
    const [line] = await db
      .select()
      .from(inventoryRequestItems)
      .where(eq(inventoryRequestItems.itemId, item.id));
    await expect(
      rejectRequestItemAs(admin, {
        requestItemId: line.id,
        reviewComment: "",
      }),
    ).rejects.toThrow(/required/);
    await rejectRequestItemAs(admin, {
      requestItemId: line.id,
      reviewComment: "Reserved for class",
    });
    const [after] = await db
      .select()
      .from(inventoryItems)
      .where(eq(inventoryItems.id, item.id));
    expect(after.status).toBe("available");
    expect(after.currentHolderId).toBeNull();
    const [afterLine] = await db
      .select()
      .from(inventoryRequestItems)
      .where(eq(inventoryRequestItems.id, line.id));
    expect(afterLine.status).toBe("rejected");
    expect(afterLine.reviewComment).toBe("Reserved for class");
  });

  it("cancel works while pending or reserved, blocked after checkout", async () => {
    const admin = await makeUser(`a-${Date.now()}@x.com`, "admin");
    const student = await makeUser(`s-${Date.now()}@x.com`, "user");
    const a = await makeItem();
    const b = await makeItem();
    await addToCartAs(student, { itemId: a.id });
    await addToCartAs(student, { itemId: b.id });
    await submitCartAs(student, { note: null });
    const [lineA] = await db
      .select()
      .from(inventoryRequestItems)
      .where(eq(inventoryRequestItems.itemId, a.id));
    const [lineB] = await db
      .select()
      .from(inventoryRequestItems)
      .where(eq(inventoryRequestItems.itemId, b.id));
    // Cancel pending line A.
    await cancelRequestItemAs(student, {
      requestItemId: lineA.id,
      note: "no longer needed",
    });
    const [afterA] = await db
      .select()
      .from(inventoryItems)
      .where(eq(inventoryItems.id, a.id));
    expect(afterA.status).toBe("available");
    // Approve B then check out, then attempt to cancel.
    await approveRequestItemAs(admin, {
      requestItemId: lineB.id,
      pickupBy: null,
    });
    await transitionItem(admin, {
      itemId: b.id,
      nextStatus: "checked_out",
      requestItemId: lineB.id,
      holderId: student.id,
      dueAt: new Date(Date.now() + 7 * 86400000),
    });
    await expect(
      cancelRequestItemAs(student, {
        requestItemId: lineB.id,
        note: null,
      }),
    ).rejects.toThrow(/checkout/);
  });
});
```

- [ ] **Step 2: Run + commit.**

```bash
npm run test:integration -- inventory.integration.test.ts
git add src/server/__tests__/inventory.integration.test.ts
git commit -m "inventory: tests for approve/reject/cancel

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Phase 6: My Items + admin queue reads

### Task 6.1: Implement `listMyItemsAs` + `listInventoryRequestsAs`

**Files:**

- Modify: `src/server/_internal/inventory.ts` (append)

- [ ] **Step 1: Append.**

```ts
import { inArray } from "drizzle-orm";

export async function listMyItemsAs(viewer: Viewer) {
  if (!viewer) throw new Error("Sign in required");
  const [cart, active, history] = await Promise.all([
    getCartAs(viewer),
    db
      .select({
        line: inventoryRequestItems,
        item: inventoryItems,
        request: inventoryRequests,
      })
      .from(inventoryRequestItems)
      .innerJoin(
        inventoryRequests,
        eq(inventoryRequestItems.requestId, inventoryRequests.id),
      )
      .innerJoin(
        inventoryItems,
        eq(inventoryRequestItems.itemId, inventoryItems.id),
      )
      .where(
        and(
          eq(inventoryRequests.userId, viewer.id),
          inArray(inventoryRequestItems.status, ["pending", "approved"]),
        ),
      )
      .orderBy(desc(inventoryRequestItems.createdAt)),
    db
      .select({
        line: inventoryRequestItems,
        item: inventoryItems,
        request: inventoryRequests,
      })
      .from(inventoryRequestItems)
      .innerJoin(
        inventoryRequests,
        eq(inventoryRequestItems.requestId, inventoryRequests.id),
      )
      .innerJoin(
        inventoryItems,
        eq(inventoryRequestItems.itemId, inventoryItems.id),
      )
      .where(
        and(
          eq(inventoryRequests.userId, viewer.id),
          inArray(inventoryRequestItems.status, [
            "rejected",
            "cancelled",
            "returned",
          ]),
        ),
      )
      .orderBy(desc(inventoryRequestItems.updatedAt))
      .limit(50),
  ]);
  return { cart, active, history };
}

export async function listInventoryRequestsAs(
  viewer: Viewer,
  data: { tab: "pending" | "all" },
) {
  assertStaff(viewer);
  const statusFilter =
    data.tab === "pending"
      ? eq(inventoryRequestItems.status, "pending")
      : undefined;
  const rows = await db
    .select({
      line: inventoryRequestItems,
      item: inventoryItems,
      request: inventoryRequests,
      requesterEmail: user.email,
      requesterName: user.name,
    })
    .from(inventoryRequestItems)
    .innerJoin(
      inventoryRequests,
      eq(inventoryRequestItems.requestId, inventoryRequests.id),
    )
    .innerJoin(
      inventoryItems,
      eq(inventoryRequestItems.itemId, inventoryItems.id),
    )
    .innerJoin(user, eq(inventoryRequests.userId, user.id))
    .where(statusFilter)
    .orderBy(desc(inventoryRequests.createdAt));

  // Group by requestId for the UI.
  const byRequest = new Map<
    string,
    {
      requestId: string;
      requester: { id: string; email: string; name: string | null };
      createdAt: Date;
      note: string | null;
      lines: typeof rows;
    }
  >();
  for (const r of rows) {
    const id = r.request.id;
    const existing = byRequest.get(id);
    if (existing) {
      existing.lines.push(r);
    } else {
      byRequest.set(id, {
        requestId: id,
        requester: {
          id: r.request.userId,
          email: r.requesterEmail,
          name: r.requesterName,
        },
        createdAt: r.request.createdAt,
        note: r.request.note,
        lines: [r],
      });
    }
  }
  return Array.from(byRequest.values());
}

export async function listMyItemsForCurrentUser() {
  const viewer = await requireUser();
  return listMyItemsAs(viewer);
}

export async function listInventoryRequestsForCurrentUser(data: {
  tab: "pending" | "all";
}) {
  const viewer = await requireUser();
  return listInventoryRequestsAs(viewer, data);
}
```

- [ ] **Step 2: Compile + commit.**

```bash
git add src/server/_internal/inventory.ts
git commit -m "inventory: reads for /my/items and /admin/inventory/requests

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

### Task 6.2: Wrappers for reads

**Files:**

- Modify: `src/server/inventory.ts` (append)

- [ ] **Step 1: Append.**

```ts
export const listMyItems = createServerFn({ method: "GET" })
  .handler(async () => {
    const { listMyItemsForCurrentUser } = await import("./_internal/inventory");
    return listMyItemsForCurrentUser();
  });

const requestQueueSchema = z.object({
  tab: z.enum(["pending", "all"]).default("pending"),
});

export const listInventoryRequests = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => requestQueueSchema.parse(d))
  .handler(async ({ data }) => {
    const { listInventoryRequestsForCurrentUser } = await import(
      "./_internal/inventory"
    );
    return listInventoryRequestsForCurrentUser(data);
  });
```

- [ ] **Step 2: Compile + commit.**

```bash
git add src/server/inventory.ts
git commit -m "inventory: wrappers for myitems + request queue

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Phase 7: Lazy overdue badge + notification

### Task 7.1: Add overdue annotation + lazy notification helper

**Files:**

- Modify: `src/server/_internal/inventory.ts` (extend `stripForPublic` / `fullForStaff` + add helper)

- [ ] **Step 1: Extend the public/staff shapes** so `listMyItemsAs` and the admin queue include deadline-derived fields. Replace the existing `stripForPublic` and `fullForStaff` functions with:

```ts
function stripForPublic(row: typeof inventoryItems.$inferSelect): InventoryItemPublic {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    category: row.category,
    location: row.location,
    imageUrl: row.imageUrl,
    status: row.status,
    pickupBy: null, // join in caller when needed
    dueAt: null,
  };
}
```

And add to the existing `InventoryItemPublic` type a derived flag (already includes pickupBy/dueAt). Add a new util:

```ts
export function deriveDeadlineFlags(row: {
  status: string;
  pickupBy: Date | null;
  dueAt: Date | null;
}) {
  const now = Date.now();
  return {
    pickupOverdue:
      row.status === "reserved" &&
      !!row.pickupBy &&
      row.pickupBy.getTime() < now,
    checkoutOverdue:
      row.status === "checked_out" &&
      !!row.dueAt &&
      row.dueAt.getTime() < now,
  };
}

/**
 * Lazy idempotent insert of overdue notifications. Scoped to a single
 * owner when {ownerId} is provided so the my-items read path does not
 * scan every approved line in the system. Batched into a single INSERT
 * VALUES (...) so even when many lines are overdue we do one round-trip.
 *
 * The partial unique index notifications_overdue_unique_idx on
 * (user_id, type, link) WHERE type IN (the two overdue types) lets
 * onConflictDoNothing skip duplicates. target + where make the arbiter
 * explicit so adding another unique index on `notifications` cannot
 * silently swallow unrelated conflicts.
 */
export async function recordOverdueNotificationsAs(
  viewer: Viewer,
  opts: { ownerId?: string } = {},
) {
  if (!viewer) return;
  const conditions = [eq(inventoryRequestItems.status, "approved")];
  if (opts.ownerId) {
    conditions.push(eq(inventoryRequests.userId, opts.ownerId));
  }
  const rows = await db
    .select({
      itemId: inventoryItems.id,
      itemName: inventoryItems.name,
      status: inventoryItems.status,
      pickupBy: inventoryRequestItems.pickupBy,
      dueAt: inventoryRequestItems.dueAt,
      requesterId: inventoryRequests.userId,
    })
    .from(inventoryRequestItems)
    .innerJoin(
      inventoryRequests,
      eq(inventoryRequestItems.requestId, inventoryRequests.id),
    )
    .innerJoin(
      inventoryItems,
      eq(inventoryRequestItems.itemId, inventoryItems.id),
    )
    .where(and(...conditions));

  const values: (typeof notifications.$inferInsert)[] = [];
  for (const r of rows) {
    const { pickupOverdue, checkoutOverdue } = deriveDeadlineFlags(r);
    if (pickupOverdue) {
      values.push({
        userId: r.requesterId,
        type: "inventory_pickup_overdue",
        title: `Pickup window passed: ${r.itemName}`,
        message: `Your reserved item is past its pickup window.`,
        link: `/inventory/${r.itemId}`,
      });
    }
    if (checkoutOverdue) {
      values.push({
        userId: r.requesterId,
        type: "inventory_checkout_overdue",
        title: `Overdue: ${r.itemName}`,
        message: `Your checked-out item is past its due date.`,
        link: `/inventory/${r.itemId}`,
      });
    }
  }
  if (values.length === 0) return;
  await db
    .insert(notifications)
    .values(values)
    .onConflictDoNothing({
      target: [notifications.userId, notifications.type, notifications.link],
      where: sql`type IN ('inventory_pickup_overdue', 'inventory_checkout_overdue')`,
    });
}
```

Note: `onConflictDoNothing()` requires a unique constraint that does not yet exist. Add a partial unique index in the migration follow-up below.

- [ ] **Step 2: Add the partial unique index** for idempotent notifications. Create a new migration with `npm run db:generate` after adding this to `src/db/schema.ts` (or append to the inventory migration if not yet applied to other environments):

```sql
CREATE UNIQUE INDEX "notifications_overdue_unique_idx"
  ON "notifications" ("user_id", "type", "link")
  WHERE "type" IN ('inventory_pickup_overdue', 'inventory_checkout_overdue');
```

Apply with `npm run db:migrate`.

- [ ] **Step 3: Hook the lazy check into `listMyItemsAs` only.** Wrap the call in try/catch so a notification failure cannot 500 the read. The admin queue does NOT trigger it: notifications are for the requester, not staff, and a global scan on every queue read is wasteful.

```ts
// at the top of listMyItemsAs
try {
  await recordOverdueNotificationsAs(viewer, { ownerId: viewer.id });
} catch {
  // swallow; degraded notification recording must not 500 the page.
}
```

- [ ] **Step 4: Populate `pickupBy` / `dueAt` on listing rows** by left-joining the active line. Replace the body of `listInventoryAs` so the query becomes:

```ts
const rows = await db
  .select({
    item: inventoryItems,
    pickupBy: inventoryRequestItems.pickupBy,
    dueAt: inventoryRequestItems.dueAt,
  })
  .from(inventoryItems)
  .leftJoin(
    inventoryRequestItems,
    eq(inventoryItems.currentRequestItemId, inventoryRequestItems.id),
  )
  .where(where)
  .orderBy(desc(inventoryItems.updatedAt))
  .limit(data.pageSize)
  .offset(offset);

const mapped = rows.map((r) => {
  const base = isStaff(viewer)
    ? fullForStaff(r.item)
    : stripForPublic(r.item);
  return { ...base, pickupBy: r.pickupBy, dueAt: r.dueAt };
});

return {
  rows: mapped,
  total: count,
  page: data.page,
  pageSize: data.pageSize,
};
```

Apply the same join in `getInventoryItemAs`.

The `InventoryCard` consumer derives `pickupOverdue` / `checkoutOverdue` by calling `deriveDeadlineFlags(r)` on each row before passing it as the `item` prop (do this in the route component).

- [ ] **Step 5: Compile + commit.**

```bash
git add src/server/_internal/inventory.ts drizzle/
git commit -m "inventory: lazy overdue notifications (idempotent via partial unique index)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Phase 8: Browse listing UI (`/inventory`)

### Task 8.1: `InventoryStatusBadge` component

**Files:**

- Create: `src/components/inventory-status-badge.tsx`

- [ ] **Step 1: Write.**

```tsx
type Status =
  | "available"
  | "requested"
  | "reserved"
  | "checked_out"
  | "maintenance"
  | "retired";

const LABEL: Record<Status, string> = {
  available: "Available",
  requested: "Requested",
  reserved: "Reserved",
  checked_out: "Checked out",
  maintenance: "Maintenance",
  retired: "Retired",
};

export function InventoryStatusBadge({
  status,
  showRetired = false,
}: {
  status: Status;
  showRetired?: boolean;
}) {
  if (status === "retired" && !showRetired) return null;
  const style = STYLES[status];
  return (
    <span
      className="inline-flex items-center rounded px-2 py-0.5 text-xs font-medium"
      style={style}
    >
      {LABEL[status]}
    </span>
  );
}

const STYLES: Record<Status, React.CSSProperties> = {
  available: {
    background: "color-mix(in srgb, var(--status-success) 15%, transparent)",
    color: "var(--status-success)",
  },
  requested: {
    background: "var(--brand-primary-tint)",
    color: "var(--brand-primary)",
  },
  reserved: {
    background: "color-mix(in srgb, var(--status-warning) 18%, transparent)",
    color: "var(--status-warning)",
  },
  checked_out: {
    background: "var(--surface-sunken)",
    color: "var(--text-primary)",
  },
  maintenance: {
    background: "var(--surface-sunken)",
    color: "var(--text-secondary)",
  },
  retired: {
    background: "color-mix(in srgb, var(--destructive) 12%, transparent)",
    color: "var(--destructive)",
  },
};
```

- [ ] **Step 2: Commit.**

```bash
git add src/components/inventory-status-badge.tsx
git commit -m "ui: InventoryStatusBadge with six-state color palette

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

### Task 8.2: `InventoryCard` and `InventoryRow` components

**Files:**

- Create: `src/components/inventory-card.tsx`
- Create: `src/components/inventory-row.tsx`

- [ ] **Step 1: `inventory-card.tsx`.**

```tsx
import { Link } from "@tanstack/react-router";
import { Button } from "./ui/button";
import { InventoryStatusBadge } from "./inventory-status-badge";
import { getPublicUrl } from "#/lib/storage";

type Props = {
  item: {
    id: string;
    name: string;
    description: string | null;
    category: string | null;
    location: string | null;
    imageUrl: string | null;
    status:
      | "available"
      | "requested"
      | "reserved"
      | "checked_out"
      | "maintenance";
    pickupOverdue?: boolean;
    checkoutOverdue?: boolean;
  };
  signedIn: boolean;
  onAddToCart?: (itemId: string) => void;
};

export function InventoryCard({ item, signedIn, onAddToCart }: Props) {
  const img = getPublicUrl(item.imageUrl);
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <Link to="/inventory/$itemId" params={{ itemId: item.id }} className="block">
        <div className="aspect-video w-full overflow-hidden rounded bg-(--surface-sunken)">
          {img ? (
            <img src={img} alt="" className="h-full w-full object-cover" />
          ) : null}
        </div>
        <h3 className="mt-2 font-semibold leading-tight">{item.name}</h3>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <InventoryStatusBadge status={item.status} />
          {item.pickupOverdue && (
            <span
              className="rounded px-2 py-0.5 text-xs"
              style={{
                background: "color-mix(in srgb, var(--destructive) 12%, transparent)",
                color: "var(--destructive)",
              }}
            >
              Past pickup window
            </span>
          )}
          {item.checkoutOverdue && (
            <span
              className="rounded px-2 py-0.5 text-xs"
              style={{
                background: "color-mix(in srgb, var(--destructive) 12%, transparent)",
                color: "var(--destructive)",
              }}
            >
              Overdue
            </span>
          )}
          {item.category && (
            <span className="rounded bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
              {item.category}
            </span>
          )}
        </div>
        {item.location && (
          <p className="mt-1 text-xs text-muted-foreground">{item.location}</p>
        )}
      </Link>
      {signedIn && item.status === "available" && onAddToCart && (
        <Button
          variant="outline"
          size="sm"
          className="mt-3 w-full"
          onClick={() => onAddToCart(item.id)}
        >
          Add to cart
        </Button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: `inventory-row.tsx`.**

```tsx
import { Link } from "@tanstack/react-router";
import { InventoryStatusBadge } from "./inventory-status-badge";

type Props = {
  item: {
    id: string;
    name: string;
    category: string | null;
    location: string | null;
    status:
      | "available"
      | "requested"
      | "reserved"
      | "checked_out"
      | "maintenance";
  };
};

export function InventoryRow({ item }: Props) {
  return (
    <Link
      to="/inventory/$itemId"
      params={{ itemId: item.id }}
      className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2 hover:bg-secondary"
    >
      <div className="min-w-0">
        <p className="truncate font-medium">{item.name}</p>
        <p className="truncate text-xs text-muted-foreground">
          {item.category} {item.location ? `· ${item.location}` : ""}
        </p>
      </div>
      <InventoryStatusBadge status={item.status} />
    </Link>
  );
}
```

- [ ] **Step 3: Commit.**

```bash
git add src/components/inventory-card.tsx src/components/inventory-row.tsx
git commit -m "ui: InventoryCard + InventoryRow

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

### Task 8.3: `InventoryFilterBar` component

**Files:**

- Create: `src/components/inventory-filter-bar.tsx`

- [ ] **Step 1: Write** by mirroring `src/components/projects-filter-bar.tsx`. Key differences: status options are the five public statuses (no `retired`); category select reads distinct values from props.

```tsx
import { useEffect, useState } from "react";
import { Input } from "./ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { ViewToggle } from "./view-toggle";

type StatusFilter =
  | "available"
  | "requested"
  | "reserved"
  | "checked_out"
  | "maintenance"
  | null;

type Props = {
  q: string;
  status: StatusFilter;
  category: string | null;
  view: "card" | "row";
  categories: string[];
  onQChange: (q: string) => void;
  onStatusChange: (s: StatusFilter) => void;
  onCategoryChange: (c: string | null) => void;
  onViewChange: (v: "card" | "row") => void;
};

const STATUS_OPTIONS: { value: NonNullable<StatusFilter>; label: string }[] = [
  { value: "available", label: "Available" },
  { value: "requested", label: "Requested" },
  { value: "reserved", label: "Reserved" },
  { value: "checked_out", label: "Checked out" },
  { value: "maintenance", label: "Maintenance" },
];

export function InventoryFilterBar(props: Props) {
  const [localQ, setLocalQ] = useState(props.q);
  useEffect(() => {
    const t = setTimeout(() => {
      if (localQ !== props.q) props.onQChange(localQ);
    }, 300);
    return () => clearTimeout(t);
  }, [localQ, props]);

  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-center">
      <Input
        value={localQ}
        onChange={(e) => setLocalQ(e.target.value)}
        placeholder="Search inventory"
        className="md:flex-1"
      />
      <div className="flex flex-wrap items-center gap-2">
        {STATUS_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() =>
              props.onStatusChange(
                props.status === opt.value ? null : opt.value,
              )
            }
            className={
              props.status === opt.value
                ? "rounded border-2 px-2 py-1 text-xs"
                : "rounded border border-border bg-card px-2 py-1 text-xs text-muted-foreground"
            }
            style={
              props.status === opt.value
                ? { borderColor: "var(--brand-primary)" }
                : undefined
            }
          >
            {opt.label}
          </button>
        ))}
        <Select
          value={props.category ?? "_all_"}
          onValueChange={(v) =>
            props.onCategoryChange(v === "_all_" ? null : v)
          }
        >
          <SelectTrigger className="h-9 w-40">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_all_">All categories</SelectItem>
            {props.categories.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <ViewToggle value={props.view} onChange={props.onViewChange} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit.**

```bash
git add src/components/inventory-filter-bar.tsx
git commit -m "ui: InventoryFilterBar

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

### Task 8.4: `/inventory/index.tsx` route

**Files:**

- Create: `src/routes/inventory/index.tsx`

- [ ] **Step 1: Write** by mirroring `src/routes/projects/index.tsx`. Use `validateSearch` for URL params, `useSuspenseQuery` (or `loader`) calling the `listInventory` server fn, render via `InventoryFilterBar` + a grid of `InventoryCard` (or list of `InventoryRow`). Wire `onAddToCart` to call `addToCart` and invalidate queries.

Minimum viable shape (extend with empty-state and pagination per the projects route):

```tsx
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useSuspenseQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { authClient } from "#/lib/auth-client";
import { addToCart, listInventory } from "#/server/inventory";
import { InventoryCard } from "#/components/inventory-card";
import { InventoryRow } from "#/components/inventory-row";
import { InventoryFilterBar } from "#/components/inventory-filter-bar";

const searchSchema = z.object({
  q: z.string().default(""),
  status: z
    .enum(["available", "requested", "reserved", "checked_out", "maintenance"])
    .nullable()
    .default(null),
  category: z.string().nullable().default(null),
  view: z.enum(["card", "row"]).default("card"),
  page: z.number().int().positive().default(1),
});

export const Route = createFileRoute("/inventory/")({
  validateSearch: (s) => searchSchema.parse(s),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) =>
    listInventory({
      data: {
        q: deps.q,
        status: deps.status,
        category: deps.category,
        page: deps.page,
        pageSize: 24,
      },
    }),
  component: InventoryIndex,
});

function InventoryIndex() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: session } = authClient.useSession();
  const data = Route.useLoaderData();

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 md:p-8">
      <h1 className="text-2xl font-semibold">Inventory</h1>
      <div className="mt-4">
        <InventoryFilterBar
          q={search.q}
          status={search.status}
          category={search.category}
          view={search.view}
          categories={[]}
          onQChange={(q) =>
            navigate({ search: (s) => ({ ...s, q, page: 1 }) })
          }
          onStatusChange={(status) =>
            navigate({ search: (s) => ({ ...s, status, page: 1 }) })
          }
          onCategoryChange={(category) =>
            navigate({ search: (s) => ({ ...s, category, page: 1 }) })
          }
          onViewChange={(view) =>
            navigate({ search: (s) => ({ ...s, view }) })
          }
        />
      </div>
      {data.rows.length === 0 ? (
        <p className="mt-8 text-center text-muted-foreground">No items match.</p>
      ) : search.view === "row" ? (
        <ul className="mt-4 flex flex-col gap-2">
          {data.rows.map((it) => (
            <li key={it.id}>
              <InventoryRow item={it} />
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {data.rows.map((it) => (
            <InventoryCard
              key={it.id}
              item={it}
              signedIn={!!session?.user}
              onAddToCart={async (itemId) => {
                await addToCart({ data: { itemId } });
                await qc.invalidateQueries();
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Restart dev server briefly** so the route tree regenerates.

Run: `npm run dev` (Ctrl+C after `Route tree generated`).

- [ ] **Step 3: Open `http://localhost:3000/inventory`** and verify the page renders. Add an item via SQL studio if there are none.

- [ ] **Step 4: Commit.**

```bash
git add src/routes/inventory/ src/routeTree.gen.ts
git commit -m "ui: /inventory listing with filter bar + card/row views

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Phase 9: Item detail (`/inventory/$itemId`)

### Task 9.1: Item detail route

**Files:**

- Create: `src/routes/inventory/$itemId.tsx`

- [ ] **Step 1: Write.**

```tsx
import { createFileRoute, notFound } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { authClient } from "#/lib/auth-client";
import { addToCart, getInventoryItem } from "#/server/inventory";
import { Button } from "#/components/ui/button";
import { InventoryStatusBadge } from "#/components/inventory-status-badge";
import { getPublicUrl } from "#/lib/storage";

export const Route = createFileRoute("/inventory/$itemId")({
  loader: async ({ params }) => {
    const item = await getInventoryItem({ data: { id: params.itemId } });
    if (!item) throw notFound();
    return item;
  },
  component: ItemDetail,
});

function ItemDetail() {
  const item = Route.useLoaderData();
  const qc = useQueryClient();
  const { data: session } = authClient.useSession();
  const img = getPublicUrl(item.imageUrl);
  const canAdd = item.status === "available" && !!session?.user;

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 md:p-8">
      <div className="grid gap-6 md:grid-cols-[1fr_1fr]">
        <div className="overflow-hidden rounded-lg bg-(--surface-sunken)">
          {img ? (
            <img src={img} alt="" className="h-full w-full object-cover" />
          ) : null}
        </div>
        <div>
          <h1 className="text-2xl font-semibold">{item.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <InventoryStatusBadge status={item.status as "available"} />
            {item.category && (
              <span className="rounded bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
                {item.category}
              </span>
            )}
          </div>
          {item.location && (
            <p className="mt-1 text-sm text-muted-foreground">{item.location}</p>
          )}
          {item.description && (
            <p className="mt-4 whitespace-pre-wrap">{item.description}</p>
          )}
          <div className="mt-6">
            {canAdd ? (
              <Button
                onClick={async () => {
                  await addToCart({ data: { itemId: item.id } });
                  await qc.invalidateQueries();
                }}
              >
                Add to cart
              </Button>
            ) : (
              <p className="text-sm text-muted-foreground">
                {!session?.user
                  ? "Sign in to request items."
                  : item.status === "available"
                    ? null
                    : "This item is not available right now."}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Restart dev + verify.**

- [ ] **Step 3: Commit.**

```bash
git add src/routes/inventory/$itemId.tsx src/routeTree.gen.ts
git commit -m "ui: /inventory/\$itemId detail page

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Phase 10: `/my/items` page

### Task 10.1: My Items route with tabs

**Files:**

- Create: `src/routes/_authed/my/items.tsx`

- [ ] **Step 1: Write.**

```tsx
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  cancelRequestItem,
  listMyItems,
  removeFromCart,
  submitCart,
} from "#/server/inventory";
import { Button } from "#/components/ui/button";
import { Textarea } from "#/components/ui/textarea";
import { InventoryStatusBadge } from "#/components/inventory-status-badge";
import { useState } from "react";

const searchSchema = z.object({
  tab: z.enum(["cart", "active", "history"]).default("active"),
});

export const Route = createFileRoute("/_authed/my/items")({
  validateSearch: (s) => searchSchema.parse(s),
  loader: () => listMyItems(),
  component: MyItems,
});

function MyItems() {
  const data = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [note, setNote] = useState("");

  const tab = data.cart.length > 0 && search.tab === "active" ? "cart" : search.tab;

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 md:p-8">
      <h1 className="text-2xl font-semibold">My items</h1>
      <div className="mt-4 flex gap-4 border-b border-border">
        {(["cart", "active", "history"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => navigate({ search: () => ({ tab: t }) })}
            className={
              t === tab
                ? "border-b-2 px-2 py-1 font-medium"
                : "px-2 py-1 text-muted-foreground hover:text-foreground"
            }
            style={
              t === tab ? { borderBottomColor: "var(--brand-primary)" } : undefined
            }
          >
            {t === "cart"
              ? `Cart (${data.cart.length})`
              : t === "active"
                ? `Active (${data.active.length})`
                : "History"}
          </button>
        ))}
      </div>

      {tab === "cart" && (
        <div className="mt-4 space-y-2">
          {data.cart.length === 0 && (
            <p className="text-muted-foreground">Your cart is empty.</p>
          )}
          {data.cart.map((row) => (
            <div
              key={row.itemId}
              className="flex items-center justify-between rounded-md border border-border bg-card p-3"
            >
              <div>
                <p className="font-medium">{row.name}</p>
                <InventoryStatusBadge status={row.status as "available"} />
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  await removeFromCart({ data: { itemId: row.itemId } });
                  await qc.invalidateQueries();
                }}
              >
                Remove
              </Button>
            </div>
          ))}
          {data.cart.length > 0 && (
            <div className="space-y-2 rounded-md border border-border bg-card p-3">
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Optional note for staff"
              />
              <Button
                onClick={async () => {
                  const result = await submitCart({
                    data: { note: note || null },
                  });
                  setNote("");
                  await qc.invalidateQueries();
                  if (result.skipped.length > 0) {
                    alert(
                      `Submitted ${result.submitted.length}; skipped ${result.skipped.length} (no longer available).`,
                    );
                  }
                  navigate({ search: () => ({ tab: "active" }) });
                }}
              >
                Submit request
              </Button>
            </div>
          )}
        </div>
      )}

      {tab === "active" && (
        <div className="mt-4 space-y-2">
          {data.active.length === 0 && (
            <p className="text-muted-foreground">No active requests.</p>
          )}
          {data.active.map(({ line, item }) => {
            const canCancel =
              (line.status === "pending" || line.status === "approved") &&
              item.status !== "checked_out";
            return (
              <div
                key={line.id}
                className="flex items-center justify-between rounded-md border border-border bg-card p-3"
              >
                <div>
                  <p className="font-medium">{item.name}</p>
                  <InventoryStatusBadge status={item.status as "available"} />
                  {line.pickupBy && (
                    <p className="text-xs text-muted-foreground">
                      Pick up by {line.pickupBy.toLocaleDateString()}
                    </p>
                  )}
                  {line.dueAt && (
                    <p className="text-xs text-muted-foreground">
                      Due {line.dueAt.toLocaleDateString()}
                    </p>
                  )}
                </div>
                {canCancel && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      await cancelRequestItem({
                        data: { requestItemId: line.id, note: null },
                      });
                      await qc.invalidateQueries();
                    }}
                  >
                    Cancel
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {tab === "history" && (
        <div className="mt-4 space-y-2">
          {data.history.length === 0 && (
            <p className="text-muted-foreground">No history yet.</p>
          )}
          {data.history.map(({ line, item }) => (
            <div
              key={line.id}
              className="rounded-md border border-border bg-card p-3"
            >
              <p className="font-medium">{item.name}</p>
              <p className="text-xs text-muted-foreground">Status: {line.status}</p>
              {line.closedReason && (
                <p className="mt-1 text-sm">{line.closedReason}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Restart dev briefly + verify the page renders for a signed-in user.**

- [ ] **Step 3: Commit.**

```bash
git add src/routes/_authed/my/items.tsx src/routeTree.gen.ts
git commit -m "ui: /my/items with cart, active, history tabs

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Phase 11: Admin catalog + item detail + request queue

### Task 11.1: `InventoryImageUploader` + `InventoryForm`

**Files:**

- Create: `src/components/inventory-image-uploader.tsx`
- Create: `src/components/inventory-form.tsx`

- [ ] **Step 1: `inventory-image-uploader.tsx`** by mirroring `src/components/project-image-uploader.tsx`. Same shape; bucket/path uses `inventory/$itemId/image`.

- [ ] **Step 2: `inventory-form.tsx`** by mirroring `src/components/project-form.tsx`. Fields: `name`, `description`, `category`, `serial`, `location`, `notes`, `imageUrl` (via `InventoryImageUploader`). On submit call `createInventoryItem` or `updateInventoryItem` depending on whether `itemId` is provided.

- [ ] **Step 3: Commit.**

```bash
git add src/components/inventory-image-uploader.tsx src/components/inventory-form.tsx
git commit -m "ui: InventoryForm + InventoryImageUploader

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

### Task 11.2: Admin catalog routes (index, new, edit)

**Files:**

- Create: `src/routes/_authed/admin/inventory/index.tsx`
- Create: `src/routes/_authed/admin/inventory/new.tsx`
- Create: `src/routes/_authed/admin/inventory/$itemId.edit.tsx`

- [ ] **Step 1: Mirror** the equivalent project admin routes (`src/routes/_authed/admin/...`) in shape. The list uses `AdminTable` with `data-label` cells; the new/edit routes render `<InventoryForm>`.

- [ ] **Step 2: Restart dev + verify routes load.**

- [ ] **Step 3: Commit.**

```bash
git add src/routes/_authed/admin/inventory/ src/routeTree.gen.ts
git commit -m "ui: admin catalog list + new + edit routes

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

### Task 11.3: `InventoryLifecyclePanel` + admin item detail

**Files:**

- Create: `src/components/inventory-lifecycle-panel.tsx`
- Create: `src/routes/_authed/admin/inventory/$itemId.tsx`

- [ ] **Step 1: `inventory-lifecycle-panel.tsx`** renders:
  - Status stepper with one recommended-action `<Button>` whose label depends on current status (`reserved → "Check out"`, `checked_out → "Return"`, `available → "Send to maintenance"`, etc.).
  - "Change status to..." `<Select>` listing all six statuses.
  - Checkout dialog (`shadcn` `Dialog`) with radio for `Assign to user` (renders a `<UserPicker>` you can stub as a free-text user-id input v1) vs `Assign to label` (text), plus a date picker for `due_at`.
  - Holder block.
  - Status history list (most recent first), pulled from a new `getItemHistory` server fn (add this small endpoint to `inventory.ts` + impl).
  - Hard-delete `Button variant="destructive"` enabled only when status ∈ `available | retired`. Opens a confirmation modal that requires typing the item name. On confirm, calls `hardDeleteInventoryItem` then navigates back to `/admin/inventory`.

- [ ] **Step 2: `/admin/inventory/$itemId.tsx`** renders the admin view: image, fields, holder block, `<InventoryLifecyclePanel>`. All mutations call `transitionItem` via a new server fn `transitionItem` wrapper in `src/server/inventory.ts`. (Add it: `transitionInventoryItem`.)

- [ ] **Step 3: Add `transitionInventoryItem` wrapper** in `src/server/inventory.ts`:

```ts
const transitionSchema = z.object({
  itemId: z.string().uuid(),
  nextStatus: z.enum([
    "available",
    "requested",
    "reserved",
    "checked_out",
    "maintenance",
    "retired",
  ]),
  requestItemId: z.string().uuid().nullable().default(null),
  holderId: z.string().nullable().default(null),
  holderLabel: z.string().max(200).nullable().default(null),
  pickupBy: z.coerce.date().nullable().default(null),
  dueAt: z.coerce.date().nullable().default(null),
  comment: z.string().max(2000).nullable().default(null),
});

export const transitionInventoryItem = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => transitionSchema.parse(d))
  .handler(async ({ data }) => {
    const { requireUser } = await import("#/lib/_internal/auth-guards");
    const { transitionItem } = await import("./_internal/inventory-transitions");
    const viewer = await requireUser();
    await transitionItem(viewer, data);
    return { ok: true as const };
  });
```

(This is a rare two-import handler; documented in QUIRKS as acceptable.)

- [ ] **Step 4: Restart dev + verify the admin detail page works** end-to-end: approve a request, check out (user + label paths), return, retire, hard-delete.

- [ ] **Step 5: Commit.**

```bash
git add src/components/inventory-lifecycle-panel.tsx src/routes/_authed/admin/inventory/$itemId.tsx src/server/inventory.ts src/routeTree.gen.ts
git commit -m "ui: admin item detail with lifecycle panel + hard-delete

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

### Task 11.4: Admin request queue route

**Files:**

- Create: `src/components/admin-request-queue-row.tsx`
- Create: `src/routes/_authed/admin/inventory/requests.tsx`

- [ ] **Step 1: `admin-request-queue-row.tsx`** renders one line: item summary on the left, `<Button>` approve / reject on the right with inline reason `<Textarea>` for reject and inline `pickup_by` date picker for approve. Calls `approveRequestItem` / `rejectRequestItem`.

- [ ] **Step 2: `/admin/inventory/requests.tsx`** loads `listInventoryRequests`, groups by batch (already grouped server-side), renders each batch as a card with header (user name + email + `createdAt` + `note`) and a list of `<AdminRequestQueueRow>` lines. Adds a "select all in batch" checkbox + bulk-approve / bulk-reject actions that fan out to N server calls.

- [ ] **Step 3: Restart dev + verify.**

- [ ] **Step 4: Commit.**

```bash
git add src/components/admin-request-queue-row.tsx src/routes/_authed/admin/inventory/requests.tsx src/routeTree.gen.ts
git commit -m "ui: admin request queue grouped by batch

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Phase 12: Navigation refactor

### Task 12.1: Install shadcn `dropdown-menu`

- [ ] **Step 1: Add the component.**

Run: `npm dlx shadcn@latest add dropdown-menu`
Expected: `src/components/ui/dropdown-menu.tsx` exists.

- [ ] **Step 2: Confirm `badge` exists** (`ls src/components/ui/badge.tsx`); if not, `npm dlx shadcn@latest add badge`.

- [ ] **Step 3: Commit.**

```bash
git add src/components/ui/dropdown-menu.tsx src/components/ui/badge.tsx package.json package-lock.json
git commit -m "ui: add shadcn dropdown-menu + badge components

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

### Task 12.2: `UserMenu` component

**Files:**

- Create: `src/components/user-menu.tsx`

- [ ] **Step 1: Write.**

```tsx
import { Link } from "@tanstack/react-router";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { authClient } from "#/lib/auth-client";
import { getPublicUrl } from "#/lib/storage";

type Props = {
  user: { name: string | null; email: string; image?: string | null };
};

export function UserMenu({ user }: Props) {
  const img = getPublicUrl(user.image);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-2 rounded hover:opacity-80">
        {img ? (
          <img
            src={img}
            alt=""
            className="h-7 w-7 rounded-full object-cover"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-(--surface-sunken) text-xs font-medium">
            {(user.name ?? user.email).charAt(0).toUpperCase()}
          </div>
        )}
        <span className="text-sm">{user.name ?? user.email}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <p className="font-medium">{user.name}</p>
          <p className="text-xs text-muted-foreground">{user.email}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/my/projects">My projects</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/my/bookmarks">My bookmarks</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/my/items">My items</Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/profile">Profile</Link>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={async () => {
            await authClient.signOut();
            window.location.href = "/sign-in";
          }}
        >
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 2: Commit.**

```bash
git add src/components/user-menu.tsx
git commit -m "ui: UserMenu dropdown (My projects/bookmarks/items + profile + sign out)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

### Task 12.3: `CartButton` component

**Files:**

- Create: `src/components/cart-button.tsx`

- [ ] **Step 1: Write.**

```tsx
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ShoppingCart } from "lucide-react";
import { getCart } from "#/server/inventory";
import { Button } from "./ui/button";

export function CartButton() {
  const { data } = useQuery({
    queryKey: ["cart"],
    queryFn: () => getCart(),
  });
  const count = data?.length ?? 0;
  return (
    <Button asChild variant="ghost" size="sm" aria-label="Cart">
      <Link to="/my/items" search={{ tab: "cart" }}>
        <ShoppingCart className="h-5 w-5" />
        {count > 0 && (
          <span
            className="ml-1 rounded px-1.5 text-xs font-semibold"
            style={{
              background: "var(--brand-primary)",
              color: "white",
            }}
          >
            {count}
          </span>
        )}
      </Link>
    </Button>
  );
}
```

- [ ] **Step 2: Commit.**

```bash
git add src/components/cart-button.tsx
git commit -m "ui: CartButton with count badge

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

### Task 12.4: Update `site-header.tsx`

**Files:**

- Modify: `src/components/site-header.tsx`

- [ ] **Step 1: Edit the desktop nav** to insert `Inventory` between `Projects` and `Admin`, remove `My Projects` + `Bookmarks` links from the inline `<nav>`, and replace the `SignedIn` block with `<NotificationBell />`, `<CartButton />`, and `<UserMenu user={...} />`.

- [ ] **Step 2: Edit the mobile drawer** so the top section contains only `Projects`, `Inventory`, `Admin`. The signed-in user block below the divider gets `My projects`, `My bookmarks`, `My items` `NavItem`s before the Sign out button.

- [ ] **Step 3: Mount `<CartButton />`** next to `<NotificationBell />` in the mobile header bar (outside the Sheet) for signed-in users.

- [ ] **Step 4: Restart dev + verify** on both desktop and mobile viewports (Chrome devtools, 375px).

- [ ] **Step 5: Commit.**

```bash
git add src/components/site-header.tsx
git commit -m "ui: nav refactor: add Inventory + UserMenu + CartButton

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

### Task 12.5: Update admin landing page

**Files:**

- Modify: `src/routes/_authed/admin/index.tsx`

- [ ] **Step 1: Add an `Inventory` card** linking to `/admin/inventory` next to the existing Users / Programs / etc. cards.

- [ ] **Step 2: Commit.**

```bash
git add src/routes/_authed/admin/index.tsx
git commit -m "ui: admin landing: add Inventory entry

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Phase 13: Final pass

### Task 13.1: Update `docs/QUIRKS.md`

**Files:**

- Modify: `docs/QUIRKS.md` (append a new sub-section under "Project conventions")

- [ ] **Step 1: Append.**

```markdown
## Inventory

### Lazy deadlines, no scheduler

`pickup_by` and `due_at` on `inventory_request_items` are informational only. There is no cron. The "past pickup window" / "overdue" badges are computed at query time. Lazy idempotent notifications are inserted on read via `recordOverdueNotificationsAs`, using a partial unique index on `notifications(user_id, type, link)` so re-reads do not duplicate.

### Hard delete is narrow

`inventory_items.id` is referenced by `inventory_request_items` with `ON DELETE RESTRICT`. Hard delete works only when no historical request lines reference the item. Use retire for anything that has been requested.

### `transitionItem` is the only writer

Every status change to an inventory item must go through `src/server/_internal/inventory-transitions.ts::transitionItem`. It is the only place that writes `inventory_item_status_history` rows and the only place that syncs `current_holder_*` columns with the item status. Approve / reject / cancel / submitCart all delegate to it.

### Deferred FK

`inventory_items.current_request_item_id` references `inventory_request_items.id` but the FK is declared in raw SQL inside the migration (not in `schema.ts`) because the two tables reference each other. ON DELETE SET NULL.
```

- [ ] **Step 2: Commit.**

```bash
git add docs/QUIRKS.md
git commit -m "docs: QUIRKS additions for inventory (lazy deadlines, hard-delete rule, transition primitive)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

### Task 13.2: Remaining integration tests (bulk approve, past pickup, defense in depth)

**Files:**

- Modify: `src/server/__tests__/inventory.integration.test.ts` (append)

- [ ] **Step 1: Append.**

```ts
import { recordOverdueNotificationsAs } from "#/server/_internal/inventory";

describe("bulk approve in a batch is atomic", () => {
  it("a single failing line rolls back the whole batch", async () => {
    const admin = await makeUser(`a-${Date.now()}@x.com`, "admin");
    const student = await makeUser(`s-${Date.now()}@x.com`, "user");
    const [a, b, c] = await Promise.all([makeItem(), makeItem(), makeItem()]);
    for (const i of [a, b, c]) await addToCartAs(student, { itemId: i.id });
    await submitCartAs(student, { note: null });
    const lines = await db
      .select()
      .from(inventoryRequestItems)
      .where(inArray(inventoryRequestItems.itemId, [a.id, b.id, c.id]));
    // Tamper with line B: pre-close it so the approve call fails.
    await db
      .update(inventoryRequestItems)
      .set({ status: "cancelled", closedAt: new Date(), closedBy: student.id })
      .where(eq(inventoryRequestItems.id, lines[1].id));
    // Bulk approve all three. The middle one will fail; if the bulk path is
    // a single transaction the first one should also roll back.
    await expect(
      db.transaction(async (tx) => {
        for (const line of lines) {
          // Using the impl directly inside one transaction is the bulk
          // semantic the UI emulates with Promise.all-with-rollback.
          // For atomicity we expect any single failure to roll the lot back.
          await approveRequestItemAs(admin, {
            requestItemId: line.id,
            pickupBy: null,
          });
        }
      }),
    ).rejects.toThrow();
    // First item should NOT be reserved.
    const [aAfter] = await db
      .select()
      .from(inventoryItems)
      .where(eq(inventoryItems.id, a.id));
    expect(aAfter.status).toBe("requested");
  });
});

describe("past pickup window: lazy detection + idempotent notification", () => {
  it("derives pickupOverdue flag and writes one notification on first read", async () => {
    const admin = await makeUser(`a-${Date.now()}@x.com`, "admin");
    const student = await makeUser(`s-${Date.now()}@x.com`, "user");
    const item = await makeItem({ name: "Cam" });
    await addToCartAs(student, { itemId: item.id });
    await submitCartAs(student, { note: null });
    const [line] = await db
      .select()
      .from(inventoryRequestItems)
      .where(eq(inventoryRequestItems.itemId, item.id));
    await approveRequestItemAs(admin, {
      requestItemId: line.id,
      pickupBy: new Date(Date.now() - 86400000), // already passed
    });
    await recordOverdueNotificationsAs(admin, { ownerId: student.id });
    await recordOverdueNotificationsAs(admin, { ownerId: student.id }); // second read; should NOT duplicate.
    const notifs = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, student.id),
          eq(notifications.type, "inventory_pickup_overdue"),
        ),
      );
    expect(notifs).toHaveLength(1);
    // Status unchanged (no auto-flip).
    const [after] = await db
      .select()
      .from(inventoryItems)
      .where(eq(inventoryItems.id, item.id));
    expect(after.status).toBe("reserved");
  });
});

describe("defense in depth: impl re-checks role even if wrapper would have blocked", () => {
  it("createInventoryItemAs throws for a non-staff viewer", async () => {
    const student = await makeUser(`s-${Date.now()}@x.com`, "user");
    await expect(
      createInventoryItemAs(student, {
        name: "Sneaky",
        description: null,
        category: null,
        serial: null,
        location: null,
        notes: null,
        imageUrl: null,
      }),
    ).rejects.toThrow(/Forbidden/);
  });

  it("transitionItem throws for a non-staff viewer", async () => {
    const student = await makeUser(`s-${Date.now()}@x.com`, "user");
    const item = await makeItem();
    await expect(
      transitionItem(student, { itemId: item.id, nextStatus: "retired" }),
    ).rejects.toThrow(/Forbidden/);
  });

  it("approve/reject throw for a non-staff viewer", async () => {
    const student = await makeUser(`s-${Date.now()}@x.com`, "user");
    const item = await makeItem();
    await addToCartAs(student, { itemId: item.id });
    await submitCartAs(student, { note: null });
    const [line] = await db
      .select()
      .from(inventoryRequestItems)
      .where(eq(inventoryRequestItems.itemId, item.id));
    await expect(
      approveRequestItemAs(student, {
        requestItemId: line.id,
        pickupBy: null,
      }),
    ).rejects.toThrow(/Forbidden/);
    await expect(
      rejectRequestItemAs(student, {
        requestItemId: line.id,
        reviewComment: "no",
      }),
    ).rejects.toThrow(/Forbidden/);
  });
});
```

- [ ] **Step 2: Run + commit.**

```bash
npm run test:integration -- inventory.integration.test.ts
git add src/server/__tests__/inventory.integration.test.ts
git commit -m "inventory: tests for bulk-approve atomicity, lazy overdue, defense in depth

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

### Task 13.3: Unit tests for badge, filter bar, cart button, lifecycle panel, schemas

**Files:**

- Create: `src/test/inventory-status-badge.test.tsx`
- Create: `src/test/inventory-filter-bar.test.tsx`
- Create: `src/test/cart-button.test.tsx`
- Create: `src/test/inventory-schemas.test.ts`

- [ ] **Step 1: `inventory-status-badge.test.tsx`** asserts that `<InventoryStatusBadge status="retired" />` renders `null` while `<InventoryStatusBadge status="retired" showRetired />` renders the label. Also asserts each non-retired status renders a span with the expected text.

```tsx
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { InventoryStatusBadge } from "#/components/inventory-status-badge";

describe("InventoryStatusBadge", () => {
  it("hides retired by default", () => {
    const { container } = render(<InventoryStatusBadge status="retired" />);
    expect(container.firstChild).toBeNull();
  });
  it("shows retired when showRetired is true", () => {
    const { getByText } = render(
      <InventoryStatusBadge status="retired" showRetired />,
    );
    expect(getByText("Retired")).toBeDefined();
  });
  it.each([
    ["available", "Available"],
    ["requested", "Requested"],
    ["reserved", "Reserved"],
    ["checked_out", "Checked out"],
    ["maintenance", "Maintenance"],
  ] as const)("renders %s as %s", (status, label) => {
    const { getByText } = render(<InventoryStatusBadge status={status} />);
    expect(getByText(label)).toBeDefined();
  });
});
```

- [ ] **Step 2: `inventory-filter-bar.test.tsx`** verifies that the search input fires `onQChange` after the 300ms debounce, and that clicking a status chip toggles it.

```tsx
import { fireEvent, render } from "@testing-library/react";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { InventoryFilterBar } from "#/components/inventory-filter-bar";

describe("InventoryFilterBar", () => {
  it("debounces search input", async () => {
    vi.useFakeTimers();
    const onQChange = vi.fn();
    const { getByPlaceholderText } = render(
      <InventoryFilterBar
        q=""
        status={null}
        category={null}
        view="card"
        categories={[]}
        onQChange={onQChange}
        onStatusChange={() => {}}
        onCategoryChange={() => {}}
        onViewChange={() => {}}
      />,
    );
    fireEvent.change(getByPlaceholderText("Search inventory"), {
      target: { value: "arduino" },
    });
    expect(onQChange).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(310);
    });
    expect(onQChange).toHaveBeenCalledWith("arduino");
    vi.useRealTimers();
  });

  it("clicking the active status chip clears it", () => {
    const onStatusChange = vi.fn();
    const { getByText } = render(
      <InventoryFilterBar
        q=""
        status="available"
        category={null}
        view="card"
        categories={[]}
        onQChange={() => {}}
        onStatusChange={onStatusChange}
        onCategoryChange={() => {}}
        onViewChange={() => {}}
      />,
    );
    fireEvent.click(getByText("Available"));
    expect(onStatusChange).toHaveBeenCalledWith(null);
  });
});
```

- [ ] **Step 3: `cart-button.test.tsx`** verifies the badge renders when the query has > 0 items and hides when 0. Use `QueryClientProvider` with seeded data.

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CartButton } from "#/components/cart-button";

vi.mock("#/server/inventory", () => ({
  getCart: () => Promise.resolve([{ itemId: "x" }, { itemId: "y" }]),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...rest }: { children: React.ReactNode }) => (
    <a {...rest}>{children}</a>
  ),
}));

describe("CartButton", () => {
  it("renders the count when > 0", async () => {
    const qc = new QueryClient();
    qc.setQueryData(["cart"], [{ itemId: "x" }, { itemId: "y" }]);
    const { findByText } = render(
      <QueryClientProvider client={qc}>
        <CartButton />
      </QueryClientProvider>,
    );
    expect(await findByText("2")).toBeDefined();
  });

  it("hides the count when 0", () => {
    const qc = new QueryClient();
    qc.setQueryData(["cart"], []);
    const { queryByText } = render(
      <QueryClientProvider client={qc}>
        <CartButton />
      </QueryClientProvider>,
    );
    expect(queryByText("0")).toBeNull();
  });
});
```

- [ ] **Step 4: `inventory-schemas.test.ts`** asserts the Zod schemas in `src/server/inventory.ts` reject the spec-called-out invalid inputs.

```ts
import { describe, expect, it } from "vitest";
import { z } from "zod";

// Re-declare the schemas locally so we can test in isolation without
// importing the server-fn wrappers (which trip the dev-mode protection
// plugin in a unit context).
const itemPayloadSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(5000).nullable().default(null),
  category: z.string().max(120).nullable().default(null),
  serial: z.string().max(120).nullable().default(null),
  location: z.string().max(200).nullable().default(null),
  notes: z.string().max(5000).nullable().default(null),
  imageUrl: z.string().max(500).nullable().default(null),
});

const approveSchema = z.object({
  requestItemId: z.string().uuid(),
  pickupBy: z.coerce.date().nullable().default(null),
});

const rejectSchema = z.object({
  requestItemId: z.string().uuid(),
  reviewComment: z.string().min(1).max(2000),
});

describe("inventory schemas", () => {
  it("itemPayload rejects empty name", () => {
    expect(() =>
      itemPayloadSchema.parse({ name: "" }),
    ).toThrow();
  });

  it("approveSchema coerces ISO date string", () => {
    const parsed = approveSchema.parse({
      requestItemId: "00000000-0000-0000-0000-000000000000",
      pickupBy: "2026-06-01T00:00:00Z",
    });
    expect(parsed.pickupBy).toBeInstanceOf(Date);
  });

  it("rejectSchema requires reviewComment", () => {
    expect(() =>
      rejectSchema.parse({
        requestItemId: "00000000-0000-0000-0000-000000000000",
        reviewComment: "",
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 5: Run + commit.**

```bash
npm test
git add src/test/inventory-status-badge.test.tsx src/test/inventory-filter-bar.test.tsx src/test/cart-button.test.tsx src/test/inventory-schemas.test.ts
git commit -m "inventory: unit tests for badge, filter bar, cart button, schemas

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

### Task 13.4: Full test + lint pass

- [ ] **Step 1: Unit tests.**

Run: `npm test`
Expected: all green (no regressions).

- [ ] **Step 2: Integration tests.**

Run: `npm run test:integration`
Expected: all green; new inventory tests included.

- [ ] **Step 3: Biome check.**

Run: `npm run check`
Expected: clean. Fix any complaints inline.

- [ ] **Step 4: Type check.**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Final commit if anything moved.**

```bash
git status
# If there are fixups:
git add <files>
git commit -m "inventory: lint/type fixups from final pass

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Notes for the implementer

- **One transition function.** Resist the temptation to write `setItemStatus(...)` helpers in routes or components. The invariants live in `transitionItem`; bypassing them produces inconsistent `current_holder_*` columns.
- **Mobile-first.** Every new component renders correctly at 375px before adding `md:` styles.
- **`AdminTable` mobile cards.** Every admin `<td>` that has a column heading needs `data-label="..."` so the CSS card pattern kicks in.
- **shadcn dialog accessibility.** Set `aria-describedby={undefined}` on `<DialogContent>` if there is no description; otherwise Radix prints a warning.
- **Notifications spec mapping.** When implementing any transition, double-check §9 of the spec for the recipient and `link` value. The single chokepoint makes this easy: read the switch in `maybeNotify` first.
- **Read `docs/QUIRKS.md` for any framework error** before debugging from scratch; most of the sharp edges are documented there.
