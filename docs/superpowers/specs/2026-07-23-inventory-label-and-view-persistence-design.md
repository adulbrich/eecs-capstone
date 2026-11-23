# Inventory Label field + persisted card/row view: design

Date: 2026-07-23

Covers two independent changes requested together:

- **A.** Add a staff-only, display-only "Label" field to inventory items.
- **B.** Persist the card/row list view across visits, as a single shared preference for the Projects and public Inventory pages.

A separate, already-completed fix (de-nesting the admin inventory edit route so the
Edit page renders) is out of scope for this spec.

---

## Feature A: "Label" field

### Intent

A second staff-facing identifier alongside `serial`. It is **not** public and **not**
searchable, purely an additional field staff can record and read on the item detail
and edit screens.

### Data (`src/db/schema.ts`)

- Add `label: text("label")` (nullable) to `inventoryItems`, adjacent to `serial`.
- Do **not** add it to the `searchVector` generated column. The migration is therefore
  a plain additive `ALTER TABLE ... ADD COLUMN "label" text;`, generated via
  `drizzle-kit generate`. No drop/recreate of the generated column.

### Server

`src/server/inventory.ts`

- Add `label: z.string().max(120).nullable().default(null)` to `itemPayloadSchema`.
  `updatePayloadSchema` extends it, so create and update are both covered.

`src/server/_internal/inventory.ts`

- `InventoryItemStaff` type gains `label: string | null`.
- `fullForStaff` returns `label: row.label`.
- `stripForPublic` is unchanged, so the label never reaches public viewers.
- `CreateInventoryItemInput` gains `label: string | null`.
- Insert `.values` and update `.set` include `label: data.label`.
- `EDITABLE_FIELDS` gains `"label"`, so label changes are diffed and written to the
  edit audit log like every other field.

### Form + routes

- `src/components/inventory-form.tsx`: add `label: z.string().max(120).default("")` to
  `inventoryFormSchema`; add a `<Field label="Label" name="label" />` immediately after
  the Serial field; the submit payload sends `label: value.label || null`.
- `src/routes/_authed/admin/inventory/$itemId.tsx` (detail): add `label` to the local
  `StaffItem` interface and render a "Label" row in the `<dl>` near Serial.
- `src/routes/_authed/admin/inventory/$itemId_.edit.tsx` (edit): add `label` to
  `StaffItem` and seed `initial.label` from `loaded.label ?? ""`.
- `new.tsx` needs no change; it renders the form with no `initial`, so the new field
  appears automatically.

### Tests

- Server round-trip: creating and updating an item persists `label`; `fullForStaff`
  exposes it and `stripForPublic` omits it.

---

## Feature B: Shared, persisted card/row view

### Current behavior

The view mode (`"card" | "row"`) lives in the URL search param `?view=`, validated by
Zod with `.default("card")` on both `/projects` and `/inventory`. It survives refresh
within a session but resets to `card` on any fresh visit with no `?view=`. The admin
inventory list has no toggle and is unaffected.

### Approach: keep URL as source of truth, seed default from localStorage

- New SSR-safe util `src/lib/view-preference.ts`:
  - `readStoredView(): "card" | "row" | null` and `writeStoredView(v)`.
  - One shared `localStorage` key for both pages.
  - Guards: `typeof window === "undefined"` returns null; `try/catch` around storage
    access; the read validates the stored string is exactly `"card"` or `"row"`.
- `src/components/view-toggle.tsx`: `setMode` calls `writeStoredView(view)` on every
  toggle, before applying it. This centralizes persistence so both pages are covered
  without duplicated logic.
- `/projects` and `/inventory` routes: make the Zod `view` param **optional** (drop
  `.default("card")`) so "absent from URL" is detectable. Render with
  `search.view ?? "card"`.
- Shared mount hook seeds the URL from storage: when `search.view` is `undefined`, read
  the stored view; if present, `navigate({ search: s => ({ ...s, view }), replace: true })`.
  The `?view=` param stays shareable and wins when present; localStorage only supplies
  the default on a param-less visit.

### Known tradeoff

localStorage is client-only, so under SSR a stored `row` preference can render as `card`
for a single paint before the seed effect runs. Accepted as inherent to this approach.

### Tests

- Unit tests for `view-preference`: valid value round-trips, an invalid stored string
  reads as `null`, and there is no throw when `window` is undefined.

---

## Out of scope / non-goals

- No admin-inventory view toggle (it has none today).
- Label is intentionally not searchable and not public; changing either would require a
  search-vector migration and a `stripForPublic` change respectively.
- No category-management UI (inventory categories remain free text).

---

## Addendum: related fixes delivered in the same session

These were requested mid-session and share the same commit. Recorded here for a
complete design trail.

### 1. Admin inventory Edit page did not render (bug)

`$itemId.edit.tsx` used TanStack flat-file nesting, making `edit` a child of the
detail route (`$itemId.tsx`), which has no `<Outlet />`, so the form never rendered.
Fix: rename to `$itemId_.edit.tsx` (trailing underscore de-nests the child while keeping
the URL `/admin/inventory/$itemId/edit`). Route tree regenerated via the plugin.

### 6. Check-out "Assign to user" showed a raw UUID

The dialog used a free-text "User id" input prefilled with the holder UUID. Replaced
with a searchable **UserPicker** (name + email, backed by `searchUsers`), prefilled to
the item's current holder/requester. Both `getInventoryItemAs` and `listInventoryAs`
now left-join `user` on `currentHolderId` and return
`currentHolderName`/`currentHolderEmail` for staff only, so the admin list's Holder
column and the item detail's current-holder line show the name (email) instead of a raw
id.

### 7 + 8. Notifications pane: z-index bleed-through and broken on mobile

Root cause of the z-index bug: the header's `backdrop-filter: blur` creates a stacking
context that traps the hand-rolled `absolute z-50` pane beneath the page content, so the
filter bar's Select chevron and Switch punched through. Rebuilt `NotificationBell` on
shadcn `Popover` (portaled to `<body>`, escaping the header context and fixing mobile
positioning). The trigger now uses the same `Button size="sm" variant="ghost"` as the
cart so the bell and cart icons match.

### 9. Notifications pane growth

Already capped at `.limit(10)` server-side; added a `max-h-[60vh] overflow-y-auto`
scroll container so the pane never grows tall. Read items remain visible (dimmed).
