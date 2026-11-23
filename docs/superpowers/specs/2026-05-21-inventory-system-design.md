# Spec 7: Inventory System

**Date:** 2026-05-21
**Status:** Draft (pending user review)
**Author:** Alexander Ulbrich (with Claude)
**Supersedes:** N/A (replaces the skeleton `inventoryItems` + `inventoryRequests` tables present in `src/db/schema.ts`)
**Builds on:** [Spec 1: Auth Foundation](2026-05-15-auth-foundation-design.md), [Spec 2: Project Domain](2026-05-16-project-domain-design.md), [Spec 3: Discovery + Project Taxonomy](2026-05-17-discovery-and-taxonomy-design.md), [Spec 5: Media + Revised Listing](2026-05-18-media-and-revised-listing-design.md), [Spec 6: Design System](2026-05-20-design-system-design.md)
**Next spec:** Not yet planned.

## 1. Purpose

Build a lab inventory system that lives alongside projects in the existing TanStack Start app. Students browse available items, add them to a cart, and submit a single batched request. Instructors and admins (treated equivalently for inventory operations) manage the catalog (CRUD on items), review batched requests with per-line approve/reject decisions, move physical inventory through reservation → checkout → return, and take items in and out of service. Every state change is logged. The existing notifications system tells students about decisions and deadlines. The look and feel mirrors the projects listing: card grid on mobile, optional row/card view toggle on desktop, the same filter-bar shape, the same `AdminTable` and `data-label` mobile pattern in admin views.

The navigation is reorganized at the same time: top nav becomes `Projects | Inventory | Admin (staff)`, and the user-scoped pages (`My projects`, `My bookmarks`, `My items`) move into a new dropdown menu attached to the avatar.

## 2. Goals

1. **Catalog CRUD** (staff). Add, edit, and (with confirmation) hard-delete inventory items at `/admin/inventory`. Fields: `name`, `description`, `image_url`, `serial`, `category`, `location`, `notes` (internal), plus system-managed `status`, `current_holder_id`, `current_holder_label`, `current_request_item_id`. Retire is the soft-delete path; hard delete is allowed only when the item is in `available` or `retired` state and is gated by a confirmation modal that lists dependent record counts.
2. **Browse listing** at `/inventory`. Default shows `available`. Optional status filter chips for `available | requested | reserved | checked_out | maintenance`. `retired` items never appear here, even for staff (admins manage retired items via the admin catalog). Text search across name + description + category (Postgres tsvector, mirroring projects). Category filter chip. Mobile-first card grid; row/card view toggle on desktop using the existing `ViewToggle` and the same `?view=card|row` URL param shape as projects.
3. **Item detail** at `/inventory/$itemId`. Shows current status, location, category, description, image, and an "Add to cart" action when `available` and the viewer is signed in. The student-facing detail page does **not** show holder identity. A "Past pickup window" or "Overdue" badge appears next to the status badge when applicable.
4. **Cart** (per-user, server-persisted) as a dedicated `inventory_cart_items` table. Cart icon in the header shows the count. Submitting the cart creates one `inventory_request` (batch) and N `inventory_request_items` (lines), and each item transitions `available → requested` in a single transaction. Adding a non-`available` item is blocked server-side; if an item is no longer `available` at submit time, that line is skipped with a friendly message and the rest of the batch proceeds.
5. **My Items** at `/my/items`. Tabs for `Cart`, `Active` (lines in `pending` or `approved` status), `History` (lines in `rejected`, `cancelled`, `returned`). Each entry shows item, line status, the item's current state, deadline (if any), and the rejection reason (if any). `Cancel` button visible on the user's own lines while the item is still in `requested` or `reserved` state.
6. **Admin request queue** at `/admin/inventory/requests`. Default filter "Pending decisions." Each row is one line item from a batch, grouped by batch. Per-line approve / reject. Approve sets `pickup_by` (default: now + 7 days) and moves the item to `reserved`. Reject requires a reason and returns the item to `available`. Bulk approve / reject within a single batch via checkboxes.
7. **Admin item lifecycle**. From an admin item view: a status stepper with the recommended next action prominent (Approve → Reserved, Check out → Checked out, Return → Available), and a `Change status to...` override that allows any transition. The "recommended" flow is a UI suggestion; the underlying transition function does not enforce ordering. Checkout opens a dialog that lets the admin assign to a registered user **or** to a free-form text label (e.g., `"Course demo"`, `"Prof. Smith visiting"`), and sets `due_at`. Manual reassignment is allowed.
8. **Lazy `pickup_by` and `due_at` display, no scheduler.** Deadlines are informational. When `pickup_by` is in the past and the item is still `reserved`, both the student and staff see a "Past pickup window" badge. When `due_at` is in the past and the item is `checked_out`, both see an "Overdue" badge. Staff manually decide whether to return the item, check out late, or take any other action. There is no cron job; no automatic state change ever happens because of a deadline passing.
9. **Notifications** through the existing `notifications` table. Events enumerated in §9.
10. **Audit logs.** `inventory_item_status_history` for every status transition (with actor + comment + linked request item + holder snapshot). `inventory_item_edit_log` for catalog field edits (mirrors `project_edit_log`).
11. **Navigation refactor.** Top nav: `Projects | Inventory | Admin (staff)`. New `UserMenu` dropdown (built on shadcn `DropdownMenu`) attached to the avatar with `My projects`, `My bookmarks`, `My items`, `Profile`, `Sign out`. Mobile drawer mirrors this structure. New `CartButton` mounts next to `NotificationBell` for signed-in users.
12. **Privacy enforced server-side.** Student-facing reads never return holder fields, internal notes, or status-history actor identity. Staff reads return everything. Role gates apply at both the server-fn wrapper and the `_internal/` impl (defense in depth, per the user-admin spec convention).
13. **No regressions.** Existing unit + integration tests still green. New integration tests cover the full request lifecycle, cart edge cases, cancel paths, hard-delete guards, ad-hoc holder labels, and the privacy stripping rule.

## 3. Non-goals (deferred)

- **Quantity-bearing consumables.** Each row is one physical unit. A bag of resistors is one inventory item the admin treats as a single returnable unit. If consumables become real, add a `tracking` column and a `quantity_remaining` field later.
- **Wait-list / queueing.** A student cannot "get in line" for a checked-out item. They see the status and revisit.
- **Future-dated reservations.** "Reserve this for next Tuesday." Useful for some labs but introduces calendar UI and conflict detection that we do not need yet.
- **Per-unit bundles / kits.** Treat a kit as one item; do not model contained sub-items.
- **Late fees / fines.** Out of scope.
- **CSV import / barcode scanning.** Adds value but not requested.
- **Student-to-student transfer.** Returns go through staff.
- **Auto-expiry of stale reservations.** Deadlines are informational only; staff decide what to do.
- **Email notifications.** This spec uses the in-app `notifications` table only. Email is a separate spec.
- **Admin-action audit log (parallel to project edits).** The two new history tables cover inventory; a unified admin-action log is a follow-up.

## 4. Architecture

### 4.1 Server modules

Same client-safe wrapper + server-only `_internal/` impl pattern as prior specs.

| Path                                            | Responsibility                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/server/inventory.ts`                       | `createServerFn` wrappers for catalog + browse + cart + requests + holds. Zod schemas for input validation. Each handler does one dynamic import and forwards to the impl with `(viewer, input)`.                                                                                                                                                                                                                                                                                                                                                |
| `src/server/_internal/inventory.ts`             | Catalog reads/writes, browse query (with privacy stripping based on viewer role), cart ops, request submission, cancel. Exposes `*As(viewer, ...)` for tests and `*ForCurrentUser(...)` for the wrappers.                                                                                                                                                                                                                                                                                                                                        |
| `src/server/_internal/inventory-transitions.ts` | The status-transition primitive. Single function `transitionItem(viewer, itemId, nextStatus, { requestItemId?, holderId?, holderLabel?, comment?, pickupBy?, dueAt? })` that runs in a `db.transaction`, updates `inventory_items`, writes one `inventory_item_status_history` row, syncs `current_holder_id` / `current_holder_label` / `current_request_item_id`, and (when applicable) updates the linked `inventory_request_items` row. **Every** mutation that touches item status goes through this function. No ad-hoc updates elsewhere. |

The recommended-lifecycle UI calls `transitionItem` with the obvious next state; the "Change status to..." override calls the same function with any state. The function itself enforces the role gate and the data invariants (e.g., `due_at` only allowed on a `checked_out` transition), not the suggested order.

### 4.2 Client modules

| Path                                                  | Responsibility                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/routes/inventory/index.tsx`                      | Public-but-prefer-signed-in browse listing. Card grid (mobile-first) + row/card `ViewToggle` (desktop). Reuses `category-chip`, the filter-bar pattern from `projects-filter-bar`, and the `?view=card\|row` URL param shape. Status filter chips. Search input (300ms debounce, tsvector match). `Add to cart` button visible only on `available` items and only when signed in. |
| `src/routes/inventory/$itemId.tsx`                    | Item detail. Image, name, description, category, location, status badge. `Add to cart` action on `available`. No holder identity. "Past pickup window" / "Overdue" badge if applicable.                                                                                                                                                                                           |
| `src/routes/_authed/my/items.tsx`                     | "My Items" page. Three tabs: Cart, Active, History. Cart tab lists addable items with a `Submit request` action that opens a confirm dialog with an optional note textarea and then calls `submitCart`. Active tab lists current request lines with status, deadlines, and a cancel button (when allowed). History tab lists terminal lines.                                      |
| `src/routes/_authed/admin/inventory/index.tsx`        | Admin catalog list. Reuses `AdminTable` with `data-label` mobile cards. Columns: thumb + name, status, holder, location, category, edit-link. "+ New item" button.                                                                                                                                                                                                                |
| `src/routes/_authed/admin/inventory/new.tsx`          | New-item form.                                                                                                                                                                                                                                                                                                                                                                    |
| `src/routes/_authed/admin/inventory/$itemId.tsx`      | Admin item detail + lifecycle controls. Status stepper with recommended next-action button + status override dropdown. Checkout dialog (user picker or text label, due-date picker). Holder block. Status history list. Hard-delete button (with confirmation modal) visible only when status ∈ `available                                                                        | retired`. |
| `src/routes/_authed/admin/inventory/$itemId.edit.tsx` | Edit-item form.                                                                                                                                                                                                                                                                                                                                                                   |
| `src/routes/_authed/admin/inventory/requests.tsx`     | Request queue. Tabs: Pending, All. Grouped by batch with batch header (user + submitted-at + optional note) and per-line rows. Per-line approve / reject (reason required on reject) + bulk-within-batch checkboxes.                                                                                                                                                              |

### 4.3 New components

| Path                                           | Responsibility                                                                                                                                                       |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/components/inventory-card.tsx`            | Browse-grid card. Image, name, status badge, category chip, location. Add-to-cart button when applicable. Past-pickup / overdue badge when applicable.               |
| `src/components/inventory-row.tsx`             | Row-view list item, sibling to `project-row`.                                                                                                                        |
| `src/components/inventory-status-badge.tsx`    | Six-state colored badge using existing status-color tokens.                                                                                                          |
| `src/components/inventory-filter-bar.tsx`      | Mirrors `projects-filter-bar` shape: search input, status chips, category select, view toggle.                                                                       |
| `src/components/inventory-form.tsx`            | Shared form for new + edit, mirrors `project-form`. Includes `InventoryImageUploader` wrapping the existing `ImageUploader`.                                         |
| `src/components/inventory-image-uploader.tsx`  | Thin wrapper around `image-uploader.tsx`, like `project-image-uploader.tsx`.                                                                                         |
| `src/components/inventory-lifecycle-panel.tsx` | Admin item-detail control. Recommended action button, status override `<Select>`, checkout dialog (user picker or text label, due-date picker), status history list. |
| `src/components/cart-button.tsx`               | Header element. Cart icon + count badge. Mounted in `site-header.tsx` next to `NotificationBell` for signed-in users.                                                |
| `src/components/user-menu.tsx`                 | New dropdown that replaces the inline `My Projects` / `Bookmarks` links. Uses `shadcn` `DropdownMenu` (added with `npm dlx shadcn@latest add dropdown-menu`).        |
| `src/components/admin-request-queue-row.tsx`   | One line in the request queue with approve / reject actions and a reason textarea.                                                                                   |

### 4.4 Existing files changed

- `src/components/site-header.tsx`: add `Inventory` desktop nav link, swap inline `My Projects` / `Bookmarks` for the new `UserMenu`, add `CartButton`. Mobile drawer mirrors the new structure (top nav block + signed-in user block with the `My *` links).
- `src/routes/_authed/admin/index.tsx`: add an `Inventory` card linking to `/admin/inventory`.
- `src/db/schema.ts`: extend `inventoryItems`, drop the existing `inventoryRequests` shape, add new tables (see §5).
- `docs/QUIRKS.md`: note the "lazy `pickup_by` / `due_at` display" behavior (no scheduler), the "hard delete requires the item to be `available` or `retired`" rule, and the deferred FK from `inventory_items.current_request_item_id` to `inventory_request_items`.

### 4.5 Why these boundaries

- **Single `transitionItem` chokepoint.** Every status change going through one function makes the recommended-vs-override distinction a UI-only concern, keeps the history insert + holder-sync atomic, and is the only place that needs to know about role gates and the `current_holder_*` columns.
- **Two server modules (`inventory.ts` + `inventory-transitions.ts`).** Splits "reads + simple writes" from "lifecycle transitions." The first is mostly query-heavy; the second is mostly transactional. Same boundary the project domain uses for status changes.
- **Privacy stripping at the impl layer, not the wrapper.** Tests must be able to assert "what does a non-staff viewer see," so the `*As(viewer, ...)` helper applies the privacy rule itself. The wrapper just calls the impl with the current viewer.
- **`UserMenu` and `CartButton` as independent components**, not baked into `SiteHeader`, so the same items render identically in the mobile Sheet (composed differently).
- **Separate `inventory_cart_items` table** rather than a `pre_submit` value in the request-item status enum, so the request queue is never polluted by drafts and the on-submit transition is a clean batch operation.

## 5. Data model

### 5.1 New / changed enums

```ts
export const inventoryItemStatusEnum = pgEnum("inventory_item_status", [
  "available",
  "requested",
  "reserved",
  "checked_out",
  "maintenance",
  "retired",
]);

// REPLACES the existing inventory_request_status enum
export const inventoryRequestItemStatusEnum = pgEnum(
  "inventory_request_item_status",
  [
    "pending",
    "approved", // line is active; the item carries the in-flight state
    "rejected", // terminal: admin denied while pending
    "cancelled", // terminal: closed before fulfillment (student cancelled OR admin released)
    "returned", // terminal: closed after fulfillment (item came back from checkout)
  ]
);
```

### 5.2 `inventory_items` (extended)

Drops: `quantity`, `reorder_threshold` (each row is one unit; not a goal). Adds: lifecycle + privacy columns.

```ts
export const inventoryItems = pgTable(
  "inventory_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    category: text("category"), // free text in v1; picker shows distinct values
    serial: text("serial"), // optional; soft-unique via app-level guard, not SQL UNIQUE
    location: text("location"),
    notes: text("notes"), // admin-only; stripped from student-facing reads
    imageUrl: text("image_url"),

    status: inventoryItemStatusEnum("status").notNull().default("available"),
    currentHolderId: text("current_holder_id").references(() => user.id, {
      onDelete: "set null",
    }),
    currentHolderLabel: text("current_holder_label"),
    currentRequestItemId: uuid("current_request_item_id"), // deferred FK; see §5.8

    searchVector: tsvector("search_vector")
      .notNull()
      .generatedAlwaysAs(
        sql`setweight(to_tsvector('english', coalesce(name, '')), 'A') || setweight(to_tsvector('english', coalesce(description, '')), 'B') || setweight(to_tsvector('english', coalesce(category, '')), 'C')`
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
    // GIN index on searchVector added in migration SQL (not expressible in Drizzle DSL)
  ]
);
```

**Invariants** (enforced by `transitionItem`, not by DB constraints):

- `status ∈ { available, maintenance, retired }` ⇒ `currentHolderId IS NULL AND currentHolderLabel IS NULL AND currentRequestItemId IS NULL`.
- `status = requested` ⇒ `currentRequestItemId IS NOT NULL AND currentHolderId IS NOT NULL AND currentHolderLabel IS NULL`. (Requests always come from a real user.)
- `status ∈ { reserved, checked_out }` ⇒ `currentRequestItemId IS NOT NULL` and exactly one of `currentHolderId` / `currentHolderLabel` is non-null. (Admin can reassign to an ad-hoc label at checkout.)

### 5.3 `inventory_requests`

```ts
export const inventoryRequests = pgTable(
  "inventory_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .references(() => user.id, { onDelete: "restrict" })
      .notNull(),
    note: text("note"), // optional, student-supplied free-text on submit
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("inventory_requests_user_created_idx").on(t.userId, t.createdAt),
  ]
);
```

### 5.4 `inventory_request_items`

```ts
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
    reviewComment: text("review_comment"), // required when status === 'rejected'

    pickupBy: timestamp("pickup_by", { withTimezone: true }), // set on approve
    dueAt: timestamp("due_at", { withTimezone: true }), // set on checkout

    closedAt: timestamp("closed_at", { withTimezone: true }), // set on terminal transition
    closedBy: text("closed_by").references(() => user.id, {
      onDelete: "set null",
    }),
    closedReason: text("closed_reason"), // e.g., "Past pickup window", student-supplied cancel note

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
  ]
);
```

### 5.5 `inventory_cart_items`

A pre-submission staging area, one row per (user, item) pair.

```ts
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
  (t) => [primaryKey({ columns: [t.userId, t.itemId] })]
);
```

### 5.6 `inventory_item_status_history`

```ts
export const inventoryItemStatusHistory = pgTable(
  "inventory_item_status_history",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    itemId: uuid("item_id")
      .references(() => inventoryItems.id, { onDelete: "cascade" })
      .notNull(),
    oldStatus: inventoryItemStatusEnum("old_status"),
    newStatus: inventoryItemStatusEnum("new_status").notNull(),
    changedBy: text("changed_by").references(() => user.id, {
      onDelete: "set null",
    }),
    comment: text("comment"),

    // Snapshot of the in-flight context at the moment of the transition
    requestItemId: uuid("request_item_id").references(
      () => inventoryRequestItems.id,
      {
        onDelete: "set null",
      }
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
  ]
);
```

### 5.7 `inventory_item_edit_log`

```ts
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
  (t) => [index("inventory_item_edit_log_item_idx").on(t.itemId, t.createdAt)]
);
```

### 5.8 Deferred FK for `inventory_items.current_request_item_id`

`inventory_items` references `inventory_request_items` and vice-versa, so the FK on `inventory_items.current_request_item_id` is added in a follow-up migration step after both tables exist, with `ON DELETE SET NULL`. The column is declared without `.references()` in `schema.ts`; the FK is emitted as a raw SQL `ALTER TABLE` in the migration.

### 5.9 Migration plan

The existing `inventoryItems` and `inventoryRequests` tables are skeletons with no production data on this capstone project (verified by reading recent commits and the seed scripts).

1. **Drop the existing `inventory_request_status` enum and the existing `inventory_requests` table.**
2. **Create the two new enums** (`inventory_item_status`, `inventory_request_item_status`).
3. **Alter `inventory_items`**: drop `quantity` + `reorder_threshold`; add `serial`, `location`, `notes`, `status` (default `'available'`), `current_holder_id`, `current_holder_label`, `current_request_item_id`, `search_vector`.
4. **Create** `inventory_requests`, `inventory_request_items`, `inventory_cart_items`, `inventory_item_status_history`, `inventory_item_edit_log`.
5. **Add deferred FK** on `inventory_items.current_request_item_id` → `inventory_request_items(id) ON DELETE SET NULL`.
6. **Add GIN index** on `inventory_items.search_vector` via raw SQL.

If a dev seed is needed, add it to `scripts/seed-dev.ts` following the existing pattern.

## 6. Server function shapes

All shapes are illustrative. Real signatures live in `src/server/inventory.ts` with Zod schemas.

```ts
// Reads (privacy stripping applied at impl layer based on viewer role)
listInventoryAs(viewer, { q?, status?, category?, view?, page? }) → { items: InventoryItemPublic[] | InventoryItemStaff[], total }
getInventoryItemAs(viewer, { itemId }) → InventoryItemPublic | InventoryItemStaff | null
listMyItemsAs(viewer, { tab: 'cart' | 'active' | 'history' }) → { cart?, active?, history? }
listInventoryRequestsAs(viewer, { tab: 'pending' | 'all' }) → BatchedRequestList   // staff only

// Catalog writes (staff only)
createInventoryItemAs(viewer, input) → InventoryItemStaff
updateInventoryItemAs(viewer, { itemId, patch }) → InventoryItemStaff
hardDeleteInventoryItemAs(viewer, { itemId, confirmName }) → { ok: true }

// Cart
addToCartAs(viewer, { itemId }) → CartItemView
removeFromCartAs(viewer, { itemId }) → { ok: true }
submitCartAs(viewer, { note? }) → { requestId, submitted: ItemId[], skipped: { itemId, reason }[] }

// Request lifecycle
approveRequestItemAs(viewer, { requestItemId, pickupBy }) → InventoryRequestItemView           // staff
rejectRequestItemAs(viewer, { requestItemId, reviewComment }) → InventoryRequestItemView       // staff
cancelRequestItemAs(viewer, { requestItemId, note? }) → InventoryRequestItemView               // self only

// Item lifecycle (always goes through transitionItem)
transitionItemAs(viewer, { itemId, nextStatus, holderId?, holderLabel?, pickupBy?, dueAt?, comment? })
  → InventoryItemStaff                                                                         // staff
```

The `InventoryItemPublic` shape omits `currentHolderId`, `currentHolderLabel`, `notes`, and any status-history actor identity. The `InventoryItemStaff` shape includes everything.

## 7. UI design

### 7.1 Browse listing (`/inventory`)

- Page wrapper: `<div className="mx-auto max-w-4xl px-4 py-6 md:p-8">`.
- `InventoryFilterBar`: search input (300ms debounce, tsvector match), status chips (`Available | Requested | Reserved | Checked out | Maintenance`; `retired` never offered), category `Select`, `ViewToggle` (`?view=card|row`). URL-driven via `validateSearch`.
- Card grid `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4`. `InventoryCard` shows image, name, category chip, location (small muted text), and a single status badge. When the viewer is signed in and the item is `available`, an `Add to cart` outline button at the bottom. When `reserved` or `checked_out` and the corresponding deadline has passed, a small "Past pickup window" / "Overdue" badge appears next to the status badge.
- Row view (desktop only via toggle) uses `InventoryRow`, sibling to `project-row`.

### 7.2 Item detail (`/inventory/$itemId`)

- Hero image (or placeholder) at `max-w-2xl`.
- Name `h1`, status badge, category chip, location text.
- Description prose.
- `Add to cart` button when `available` and signed in. Disabled with helper text in any other state.
- Never shows holder identity, regardless of viewer role. (Staff view holder identity via the admin item route.)

### 7.3 Cart + submit flow

- Cart is persisted as `inventory_cart_items`. Adding a non-`available` item is blocked server-side.
- On submit, the server runs in one transaction: insert a new `inventory_requests` row, insert one `inventory_request_items` row per cart row whose item is still `available`, transition each item `available → requested`, delete the cart rows. Lines whose item is no longer `available` are skipped and removed from the cart with a friendly message.
- The cart icon in the header shows the count; clicking goes to `/my/items?tab=cart`.

### 7.4 My Items (`/my/items`)

Three tabs (URL-driven `?tab=cart|active|history`, default `cart` if non-empty else `active`).

- **Cart tab**: list of cart items joined to items. Each row: thumb, name, status, Remove. Footer: optional note textarea + `Submit request` button.
- **Active tab**: lines where the viewer is the requester and `status ∈ { pending, approved }`. Each row: item, line status, the item's current state, deadline (`pickup_by` or `due_at`), Cancel (when allowed). "Past pickup window" / "Overdue" badge if applicable.
- **History tab**: same shape, lines where `status ∈ { rejected, cancelled, returned }`. Shows rejection / cancel reason. Paginated.

### 7.5 Admin views

- **Catalog list** (`/admin/inventory`): `AdminTable` with `data-label` mobile cards. Columns: thumb + name, status badge, holder (name or label), location, category, edit-link. Filter row: text search, status, category. "+ New item" button top-right.
- **Item new / edit**: `InventoryForm` (TanStack Form + Zod). `InventoryImageUploader` uses the existing deferred-upload pattern.
- **Item admin detail** (`/admin/inventory/$itemId`):
  - `InventoryLifecyclePanel` with a recommended-action primary button (e.g., when `reserved`, button is `Check out`; when `checked_out`, button is `Return`).
  - `Change status to...` `<Select>` for override. All transitions reachable.
  - On `Check out`: dialog with `Assign to user` (radio + `<UserPicker>`) or `Assign to label` (radio + text input) + `Due date` picker. Default holder is the request's submitter when available.
  - Holder block: current holder (linked user or text label) plus assign / edit button.
  - Status history list (most recent first).
  - `Hard delete` destructive button at the bottom, only enabled when status ∈ `available | retired`. Click opens a confirmation modal listing dependent counts ("This item has N history rows. M historical request lines reference it; hard delete will fail unless they are dissociated. Type the item name to confirm."). Requires typing the item name to confirm.
- **Request queue** (`/admin/inventory/requests`): default tab "Pending decisions" shows lines with `status = pending`, grouped by `request_id`. Each batch is a card: header (user name + submitted-at + optional note), then per-line rows with item summary and per-line `Approve` / `Reject` buttons. `Approve` opens a small dialog with the default `pickup_by` (now + 7 days, editable). `Reject` opens a dialog with a required reason textarea. Bulk checkbox column at the batch level lets the admin select multiple lines and use a bulk `Approve` (one shared `pickup_by`) or `Reject` (one shared reason). "All" tab shows lines with any status, filterable.

### 7.6 Status badge palette

| Status        | Token / style                                                                  |
| ------------- | ------------------------------------------------------------------------------ |
| `available`   | `var(--status-success)` background tint, dark text                             |
| `requested`   | `var(--brand-primary-tint)` background, brand-foreground text                  |
| `reserved`    | `var(--status-warning)` background tint                                        |
| `checked_out` | neutral filled (`bg-secondary`, `text-foreground`)                             |
| `maintenance` | muted (`bg-muted`, `text-muted-foreground`)                                    |
| `retired`     | hidden from students; shown to staff as `bg-destructive/10` `text-destructive` |

`InventoryStatusBadge` is the single component that picks the right variant from status. Uses `<Badge>` from `#/components/ui/badge`.

## 8. Navigation refactor

### 8.1 Top nav (desktop)

```
[Logo]  Projects   Inventory   Admin (staff only)        [🔔]  [🛒 (3)]  [Avatar ▾]
```

`Inventory` is always visible (signed-in or not), like `Projects`. `My Projects` and `Bookmarks` move into `UserMenu`. `CartButton` mounts next to `NotificationBell` for signed-in users.

### 8.2 User menu (`UserMenu`)

Built on `shadcn`'s `DropdownMenu` (add via `npm dlx shadcn@latest add dropdown-menu`).

```
┌────────────────────────────┐
│ Alex Ulbrich               │
│ alex@oregonstate.edu       │
├────────────────────────────┤
│ My projects              → │
│ My bookmarks             → │
│ My items                 → │
├────────────────────────────┤
│ Profile                  → │
│ Sign out                   │
└────────────────────────────┘
```

### 8.3 Mobile drawer

The existing `Sheet` reorganizes into two sections separated by a divider:

- Top section: `Projects`, `Inventory`, `Admin (staff)`.
- Bottom section (signed-in): avatar + name + email link to `/profile`, then `My projects`, `My bookmarks`, `My items`, then `Sign out`.

`CartButton` and `NotificationBell` continue to live in the mobile header bar (outside the Sheet) so they remain one-tap-reachable.

## 9. Notifications

All notifications written via the existing `notifications` table. New `type` values:

| Event                                                                                      | Recipient | Type                         | Title                                        |
| ------------------------------------------------------------------------------------------ | --------- | ---------------------------- | -------------------------------------------- |
| Line approved (`pending → approved`, item → `reserved`)                                    | requester | `inventory_request_approved` | "Reserved: $itemName. Pick up by $pickupBy." |
| Line rejected                                                                              | requester | `inventory_request_rejected` | "Request denied: $itemName" (body: reason)   |
| Item checked out to requester                                                              | requester | `inventory_item_checked_out` | "Checked out: $itemName. Due $dueAt."        |
| Item returned (closes the line as `returned`)                                              | requester | `inventory_item_returned`    | "Returned: $itemName"                        |
| Line closed by staff before fulfillment                                                    | requester | `inventory_request_closed`   | "Request closed: $itemName" (body: reason)   |
| Past pickup window detected (created lazily once per item per requester after `pickup_by`) | requester | `inventory_pickup_overdue`   | "Pickup window passed: $itemName"            |
| Past due date (lazily, same rule)                                                          | requester | `inventory_checkout_overdue` | "Overdue: $itemName"                         |

Each notification's `link` deep-links into `/my/items?tab=active` or the item detail. Re-firing is suppressed by a unique lookup on `(userId, type, related_item_id)` so we do not double-send.

There is no notification on cart submit; the admin queue is the signal.

## 10. Permissions

- **Public reads** (no auth): `listInventory`, `getInventoryItem`. Returns only `status ∈ { available, requested, reserved, checked_out, maintenance }` (no `retired`). Holder fields stripped. Notes stripped. Status-history actor identity stripped.
- **Signed-in reads** (any role): cart ops, "My items" reads, own request reads.
- **Staff reads** (`instructor | admin`): admin catalog + request queue + item admin detail + status history with actor identity + holder identity.
- **Staff writes** (`instructor | admin`): create / edit item, approve / reject lines, transition items, manage holder, hard delete (when in allowed status).
- **Admin-only writes**: none specific to this spec. Treat `instructor` and `admin` as equivalent everywhere in inventory.

Every server wrapper applies its role gate; every `_internal/` impl re-applies the same gate via `assertRole(viewer, [...])` at the top.

## 11. Tests

Unit tests run with `npm test`; integration tests run with `npm run test:integration` against the local Postgres.

### 11.1 Unit tests (under `src/test/`)

1. `InventoryStatusBadge` renders the right token per status, hides `retired` for non-staff.
2. `InventoryFilterBar` round-trips URL search params; `view=row` toggles correctly.
3. `CartButton` shows count when > 0, hides badge when 0.
4. `InventoryLifecyclePanel`'s recommended-action selector picks the right next status per current state.
5. Zod schemas: reject empty `name`, reject `pickup_by` in the past on approve, require `reviewComment` on reject.

### 11.2 Integration tests (under `src/server/__tests__/`)

6. **Catalog CRUD.** Staff creates → reads → edits → reads → hard-deletes (when `available`). Non-staff hits the gate on every write.
7. **Browse privacy.** Anonymous viewer sees items including `requested | reserved | checked_out | maintenance` but never holder fields or notes. Property-level assertion on the returned shape.
8. **Retired hidden.** Anonymous + signed-in non-staff listing does not include a `retired` item. Staff `/admin/inventory` does.
9. **Cart happy path.** User adds 3 `available` items, submits with a note, then: one `inventory_requests` row, three `inventory_request_items` rows (`status = pending`), all three items moved to `requested` with `currentHolderId = user.id` and `currentRequestItemId = line.id`. Cart is empty.
10. **Cart partial-submit.** Between add and submit, item B moves to `maintenance` via staff action. Submit returns `{ submitted: [a, c], skipped: [{ itemId: b, reason: "no_longer_available" }] }`. Item B is removed from the cart; cart now empty.
11. **Cart guard.** Adding a non-`available` item via direct server call throws.
12. **Approve line.** Staff approves a pending line with `pickupBy = now + 7d`. Item → `reserved`, line → `approved`, history row inserted with the linked `requestItemId`, notification of type `inventory_request_approved` created for the requester with a link to `/my/items?tab=active`.
13. **Reject line.** Staff rejects with reason. Item → `available`, holder fields cleared. Line `status = rejected`, `closed_*` set, `reviewComment` populated. Notification `inventory_request_rejected` with reason in body.
14. **Bulk approve in batch.** Three pending lines in one batch, staff bulk-approves with a shared `pickup_by`. All three items move to `reserved` in a single transaction; if any one fails the invariant check, the whole transaction rolls back.
15. **Cancel by student.** Student cancels a `pending` line and a separate `approved`-while-reserved line. Both close as `cancelled`, items return to `available`. Cancelling a line whose item is already `checked_out` is rejected ("cannot cancel after checkout").
16. **Check out → return.** Staff checks out a reserved item to the original requester, sets `due_at`. Item → `checked_out`. Staff returns. Item → `available`, line → `returned`, `currentHolderId` and `currentRequestItemId` cleared, notification sent.
17. **Check out with ad-hoc holder.** Staff transitions an item to `reserved` with no requester (manual override), then checks out with `holderLabel = "Course demo"` and no `holderId`. Invariants hold: `currentHolderId IS NULL AND currentHolderLabel = 'Course demo'`. History captures the label.
18. **Past pickup window.** Item is `reserved` with `pickup_by < now()`. Listing returns it; a derived flag `pickupOverdue = true` appears in the response. No automatic status change. A `inventory_pickup_overdue` notification is created at most once for that `(item, requester)` pair on the first read after the deadline.
19. **Hard delete guard.** Hard delete on a `checked_out` item rejects with "must be available or retired." Hard delete on a `retired` item with no historical request lines succeeds and cascades history + edit-log rows. Hard delete on a `retired` item with at least one closed request line fails because of the `RESTRICT` FK; the error message instructs the admin to keep the item retired.
20. **Defense in depth.** Calling the `_internal/inventory.ts` impls directly with a non-staff viewer throws even though the wrapper would have caught it.
21. **Edit log.** Editing `name` and `location` writes one `inventory_item_edit_log` row with `changedFields = ['name', 'location']` and matching `oldValues` / `newValues`.

Target: existing test suite still green; this spec adds ~5 unit + ~16 integration tests.

## 12. File map (delta from main)

```
docs/superpowers/specs/2026-05-21-inventory-system-design.md   (this spec)
docs/QUIRKS.md                                                  (+ notes)

drizzle/<timestamp>_inventory_v2/                               (the migration)
src/db/schema.ts                                                (edited)

src/server/inventory.ts                                         (new wrapper)
src/server/_internal/inventory.ts                               (new impl)
src/server/_internal/inventory-transitions.ts                   (new impl)
src/server/__tests__/inventory.integration.test.ts              (new)

src/routes/inventory/index.tsx                                  (new)
src/routes/inventory/$itemId.tsx                                (new)
src/routes/_authed/my/items.tsx                                 (new)
src/routes/_authed/admin/inventory/index.tsx                    (new)
src/routes/_authed/admin/inventory/new.tsx                      (new)
src/routes/_authed/admin/inventory/$itemId.tsx                  (new)
src/routes/_authed/admin/inventory/$itemId.edit.tsx             (new)
src/routes/_authed/admin/inventory/requests.tsx                 (new)
src/routes/_authed/admin/index.tsx                              (edited; add Inventory card)

src/components/inventory-card.tsx                               (new)
src/components/inventory-row.tsx                                (new)
src/components/inventory-status-badge.tsx                       (new)
src/components/inventory-filter-bar.tsx                         (new)
src/components/inventory-form.tsx                               (new)
src/components/inventory-image-uploader.tsx                     (new)
src/components/inventory-lifecycle-panel.tsx                    (new)
src/components/admin-request-queue-row.tsx                      (new)
src/components/cart-button.tsx                                  (new)
src/components/user-menu.tsx                                    (new)
src/components/site-header.tsx                                  (edited; add Inventory link, UserMenu, CartButton; mobile drawer reorg)

src/components/ui/dropdown-menu.tsx                             (added via shadcn CLI)
src/components/ui/badge.tsx                                     (added via shadcn CLI if not present)
```

## 13. Decisions and follow-ups

Confirmed defaults from the brainstorming pass:

1. **Hard-delete cascade behavior.** `inventory_request_items.itemId` stays `ON DELETE RESTRICT`. Hard delete is effectively reserved for items that were never requested. Retire is the only path for items with a history.
2. **Default `pickup_by` duration**: 7 days from approval. Implemented as a single constant in the server module so it can be tuned later.
3. **`serial` uniqueness**: app-level guard (friendly error on duplicate insert), not a SQL `UNIQUE` constraint.
4. **Inventory tsvector weighting**: `name` A, `description` B, `category` C. Mirrors projects.
5. **Cart preview**: numeric badge only in v1; hover preview is a future enhancement.
6. **Inventory categories**: free-text in v1, no FK to `categories`. A shared admin UI is a follow-up if it becomes useful.

Follow-up specs that may come out of this work:

- **Email notifications channel** (cross-cutting, applies to projects too).
- **Inventory reporting / historical reservations view** ("who had this Arduino last term").
- **Shared category management** if inventory and project categories converge.
