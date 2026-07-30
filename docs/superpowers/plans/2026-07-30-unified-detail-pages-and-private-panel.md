# Unified Item Detail Page + Project Private Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the two inventory item detail pages into one public route with a staff-only panel (matching how projects work), move every item-scoped inventory route under `/inventory`, and group the project page's proposer-and-staff sections into one bordered panel.

**Architecture:** One new server function, `getInventoryItemDetailAs(viewer, {id})`, returns `{ item, history, viewerIsStaff }` so a public loader can render a staff branch without ever calling the staff-asserting history function. Two new presentational components, `StaffInventoryPanel` and `ProjectPrivatePanel`, carry the audience-gated content. No visibility rule changes anywhere: `stripForPublic`, `fullForStaff`, `stripPrivateFields` and `filterCommentsForViewer` are untouched, and integration assertions prove it.

**Tech Stack:** TanStack Start (React SSR), TanStack Router (file-based routes), Drizzle ORM on PostgreSQL, shadcn/ui + Radix, Zod, Vitest, Playwright + axe.

Source spec: `docs/superpowers/specs/2026-07-30-unified-detail-pages-and-private-panel-design.md`

## Global Constraints

- **No visibility rule changes.** This is presentational regrouping. Do not edit `stripForPublic`, `fullForStaff`, `stripPrivateFields`, `filterCommentsForViewer`, or `assertStaff`. If a task seems to need one, stop and ask.
- **No redirects, aliases, or compatibility shims.** The app has no production deployment. Delete moved routes outright; a stale `to="..."` becomes a typecheck error because TanStack Router types route paths, which is the desired failure mode.
- Route split rule: **item-scoped surfaces live under `/inventory`** (`/inventory/new`, `/inventory/$itemId`, `/inventory/$itemId/edit`); **cross-item management stays under `/admin`** (`/admin/inventory`, `/admin/inventory/requests`).
- Both moved routes (`new`, `edit`) keep their own `beforeLoad` staff check. The `_authed` layout guarantees only a signed-in user, not a staff one.
- Private notes wording comes from `src/lib/private-notes.ts` (`PRIVATE_NOTES_LABEL`, `PRIVATE_NOTES_INVENTORY_HINT`, `PRIVATE_NOTES_PROJECT_HINT`). Never retype the strings.
- The private panel uses a **neutral** `border-border` container; the brand tint (`border-(--brand-primary-tint)`) stays reserved for staff-only panels, so a staff viewer can tell the two apart.
- Run `npm run check` and `npm run typecheck` before every commit; both must be clean. `npm run format` fixes most `check` failures.
- Unit tests: `npm run test`. Component tests live in `src/test/<name>.test.tsx` with `// @vitest-environment jsdom` on line 1. `@testing-library/jest-dom` is NOT installed, so use plain Vitest matchers (`expect(x).toBeTruthy()`, not `.toBeInTheDocument()`).
- Integration tests: `npm run test:integration`, needs `docker compose up -d`. **They TRUNCATE the dev database**, wiping seed data; re-seed afterwards with `npm run db:seed:dev`. Run them with the sandbox disabled and `ulimit -n 8192`.
- Accessibility tests: `npm run test:accessibility` (Playwright + axe, needs a live server and browsers). If it cannot run in your environment, say so explicitly rather than reporting it as passing.

---

## File Structure

**Created:**
- `src/components/staff-inventory-panel.tsx`: the staff-only half of the inventory item page (staff fields, private notes, Edit link, lifecycle panel).
- `src/components/project-private-panel.tsx`: the proposer-and-staff half of the project page (private notes, status history, comments).
- `src/routes/_authed/inventory/new.tsx`: moved from `_authed/admin/inventory/new.tsx`.
- `src/routes/_authed/inventory/$itemId/edit.tsx`: moved from `_authed/admin/inventory/$itemId_.edit.tsx`.

**Modified:**
- `src/server/_internal/inventory.ts`: add `getInventoryItemDetailAs` + `getInventoryItemDetailForCurrentUser`; remove `getItemHistoryForCurrentUser`.
- `src/server/inventory.ts`: add `getInventoryItemDetail` server fn; remove `getItemHistory` server fn.
- `src/routes/inventory/$itemId.tsx`: becomes the single item detail page.
- `src/routes/_authed/admin/inventory/index.tsx`: three link targets.
- `src/routes/projects/$projectId.tsx`: three inline sections replaced by one panel.
- `src/server/__tests__/inventory.integration.test.ts`: detail-function coverage.
- `src/test/a11y/admin.a11y.test.ts`, `src/test/a11y/public.a11y.test.ts`: repointed URLs.
- `PRD.md`: §12 and §16.

**Deleted:**
- `src/routes/_authed/admin/inventory/$itemId.tsx`
- `src/routes/_authed/admin/inventory/$itemId_.edit.tsx`
- `src/routes/_authed/admin/inventory/new.tsx`

`src/routeTree.gen.ts` is regenerated automatically by the router plugin on `npm run dev` or `npm run build`. Never hand-edit it.

---

## Task 1: Combined item detail server function

**Files:**
- Modify: `src/server/_internal/inventory.ts` (near `getInventoryItemAs`, ~line 166, and `getItemHistoryAs`, ~line 976)
- Modify: `src/server/inventory.ts` (near `getInventoryItem`, ~line 56, and `getItemHistory`, ~line 210)
- Test: `src/server/__tests__/inventory.integration.test.ts` (append to the `listInventoryAs privacy` describe block)

**Interfaces:**
- Consumes: existing `getInventoryItemAs(viewer, {id})`, `getItemHistoryAs(viewer, {itemId})`, `isStaff(viewer)`, `readSession()` — all already in `src/server/_internal/inventory.ts`.
- Produces: `getInventoryItemDetailAs(viewer, { id: string })` returning `{ item, history, viewerIsStaff: boolean } | null`, and the `getInventoryItemDetail` server fn wrapping it. Tasks 2 and 3 consume both.

**Why this exists:** the public route cannot call `getItemHistory`. `getItemHistoryAs` opens with `assertStaff(viewer)` (`src/server/_internal/inventory.ts:980`) and `getItemHistoryForCurrentUser` wraps `requireUser()`, so an anonymous loader would throw rather than degrade to an empty timeline.

- [ ] **Step 1: Write the failing integration tests**

Append inside the existing `describe("listInventoryAs privacy", ...)` block in `src/server/__tests__/inventory.integration.test.ts`:

```ts
  it("gives an anonymous viewer no history and no staff fields", async () => {
    const admin = await makeUser(`dtl-a-${Date.now()}@x.com`, "admin");
    const item = await makeItem({ notes: "Locker B4, code 1180." });
    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "maintenance",
    });

    const view = await getInventoryItemDetailAs(null, { id: item.id });
    expect(view).not.toBeNull();
    expect(view?.viewerIsStaff).toBe(false);
    expect(view?.history).toEqual([]);
    expect("notes" in (view?.item as object)).toBe(false);
    expect(JSON.stringify(view)).not.toContain("1180");
  });

  it("gives a signed-in non-staff user no history and no staff fields", async () => {
    const admin = await makeUser(`dtl-a2-${Date.now()}@x.com`, "admin");
    const student = await makeUser(`dtl-s2-${Date.now()}@x.com`, "user");
    const item = await makeItem({ notes: "Locker B4, code 1180." });
    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "maintenance",
    });

    const view = await getInventoryItemDetailAs(student, { id: item.id });
    expect(view?.viewerIsStaff).toBe(false);
    expect(view?.history).toEqual([]);
    expect("serial" in (view?.item as object)).toBe(false);
    expect("location" in (view?.item as object)).toBe(false);
  });

  it("gives staff the history and the staff fields", async () => {
    const admin = await makeUser(`dtl-a3-${Date.now()}@x.com`, "admin");
    const item = await makeItem({ notes: "Locker B4, code 1180." });
    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "maintenance",
    });

    const view = await getInventoryItemDetailAs(admin, { id: item.id });
    expect(view?.viewerIsStaff).toBe(true);
    expect(view?.history.length).toBeGreaterThan(0);
    expect((view?.item as unknown as { notes: string }).notes).toBe(
      "Locker B4, code 1180."
    );
  });

  it("returns null for a retired item viewed by a non-staff user", async () => {
    const admin = await makeUser(`dtl-a4-${Date.now()}@x.com`, "admin");
    const student = await makeUser(`dtl-s4-${Date.now()}@x.com`, "user");
    const item = await makeItem();
    await transitionItem(admin, { itemId: item.id, nextStatus: "retired" });

    expect(await getInventoryItemDetailAs(student, { id: item.id })).toBeNull();
    expect(await getInventoryItemDetailAs(null, { id: item.id })).toBeNull();
    expect(
      (await getInventoryItemDetailAs(admin, { id: item.id }))?.item.status
    ).toBe("retired");
  });

  it("returns null for an item that does not exist", async () => {
    const admin = await makeUser(`dtl-a5-${Date.now()}@x.com`, "admin");
    const missing = "00000000-0000-0000-0000-0000000000ff";
    expect(await getInventoryItemDetailAs(admin, { id: missing })).toBeNull();
  });
```

Add `getInventoryItemDetailAs` to the existing import block from `#/server/_internal/inventory` at the top of that file (keep the list alphabetical: it goes immediately after `getInventoryItemAs`).

- [ ] **Step 2: Run the tests to verify they fail**

```bash
docker compose up -d
ulimit -n 8192
npm run test:integration -- -t "detail"
```

Expected: FAIL with `getInventoryItemDetailAs is not a function` (or a TypeScript resolution error). If instead every test errors with `password authentication failed`, the docker Postgres is not reachable — see the "Port conflicts" section of the README.

- [ ] **Step 3: Implement the internal function**

In `src/server/_internal/inventory.ts`, immediately after `getInventoryItemForCurrentUser` (~line 236):

```ts
/**
 * One call for the item detail page, so a public loader can render a staff
 * branch without touching `getItemHistoryAs`, which opens with `assertStaff`
 * and would throw for an anonymous viewer rather than degrade.
 *
 * `viewerIsStaff` is returned explicitly rather than inferred by the caller
 * from the presence of `notes` / `serial`: sniffing the payload shape would
 * silently invert the gate the day a field is added to the public shape.
 */
export async function getInventoryItemDetailAs(
  viewer: Viewer,
  data: { id: string }
) {
  const item = await getInventoryItemAs(viewer, data);
  if (!item) {
    return null;
  }
  const staff = isStaff(viewer);
  return {
    item,
    history: staff ? await getItemHistoryAs(viewer, { itemId: data.id }) : [],
    viewerIsStaff: staff,
  };
}

export async function getInventoryItemDetailForCurrentUser(data: {
  id: string;
}) {
  const session = await readSession();
  return getInventoryItemDetailAs(session?.user ?? null, data);
}
```

`getInventoryItemDetailAs` must be declared **after** `getItemHistoryAs` in the file, or hoisting rules will bite: `getItemHistoryAs` is a function declaration so it hoists, but keep the order readable anyway by placing the new pair at the end of the file, after `getItemHistoryForCurrentUser`.

- [ ] **Step 4: Add the server function**

In `src/server/inventory.ts`, immediately after the `getInventoryItem` export (~line 63):

```ts
export const getInventoryItemDetail = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => idOnlySchema.parse(d))
  .handler(async ({ data }) => {
    const { getInventoryItemDetailForCurrentUser } = await import(
      "./_internal/inventory"
    );
    return getInventoryItemDetailForCurrentUser(data);
  });
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
ulimit -n 8192
npm run test:integration -- -t "detail"
```

Expected: 5 passing.

- [ ] **Step 6: Verify and commit**

```bash
npm run typecheck && npm run check
git add src/server/_internal/inventory.ts src/server/inventory.ts src/server/__tests__/inventory.integration.test.ts
git commit -m "feat(inventory): add a combined item detail query for one shared page"
```

Do **not** delete `getItemHistory` yet — its caller still exists until Task 2. Removing it now breaks the build.

---

## Task 2: Merge the item detail page

**Files:**
- Create: `src/components/staff-inventory-panel.tsx`
- Modify: `src/routes/inventory/$itemId.tsx` (whole file)
- Modify: `src/routes/_authed/admin/inventory/index.tsx:203` (row link)
- Modify: `src/test/a11y/admin.a11y.test.ts:36-39`
- Delete: `src/routes/_authed/admin/inventory/$itemId.tsx`
- Modify: `src/server/inventory.ts` (remove `getItemHistory`), `src/server/_internal/inventory.ts` (remove `getItemHistoryForCurrentUser`)

**Interfaces:**
- Consumes: `getInventoryItemDetail` from Task 1; existing `InventoryLifecyclePanel` (props: `{ history: HistoryRow[]; holderName?: string | null; item: { id, name, status, currentHolderId, currentHolderName?, currentHolderEmail?, currentHolderLabel, currentRequestItemId } }`) and its exported `HistoryRow` type.
- Produces: `<StaffInventoryPanel item={StaffPanelItem} history={HistoryRow[]} />`. No later task consumes it.

- [ ] **Step 1: Create the staff panel component**

Create `src/components/staff-inventory-panel.tsx`:

```tsx
import { Link } from "@tanstack/react-router";
import {
  type HistoryRow,
  InventoryLifecyclePanel,
} from "./inventory-lifecycle-panel";
import { Button } from "./ui/button";
import {
  PRIVATE_NOTES_INVENTORY_HINT,
  PRIVATE_NOTES_LABEL,
} from "#/lib/private-notes";

export interface StaffPanelItem {
  currentHolderEmail?: string | null;
  currentHolderId?: string | null;
  currentHolderLabel?: string | null;
  currentHolderName?: string | null;
  currentRequestItemId?: string | null;
  id: string;
  label?: string | null;
  location?: string | null;
  name: string;
  notes?: string | null;
  serial?: string | null;
  status: string;
}

/**
 * The staff half of the item detail page. Rendering the Edit link from inside
 * here makes it staff-only by construction, with no second visibility flag to
 * keep in sync. Unlike a project, an item has no owner, so staff are the only
 * audience for it.
 */
export function StaffInventoryPanel({
  item,
  history,
}: {
  history: HistoryRow[];
  item: StaffPanelItem;
}) {
  return (
    <div className="mt-8 rounded-lg border-(--brand-primary-tint) border-2 bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="island-kicker">Staff panel</p>
        <Button asChild size="sm" variant="outline">
          <Link params={{ itemId: item.id }} to="/inventory/$itemId/edit">
            Edit
          </Link>
        </Button>
      </div>

      <dl className="grid grid-cols-3 gap-2 text-sm">
        <dt className="text-muted-foreground">Location</dt>
        <dd className="col-span-2">{item.location ?? "-"}</dd>
        <dt className="text-muted-foreground">Serial</dt>
        <dd className="col-span-2">{item.serial ?? "-"}</dd>
        <dt className="text-muted-foreground">Label</dt>
        <dd className="col-span-2">{item.label ?? "-"}</dd>
      </dl>

      {item.notes && (
        <section className="mt-4 border-border border-t pt-4">
          <h3 className="font-medium text-sm">{PRIVATE_NOTES_LABEL}</h3>
          <p className="mt-1 whitespace-pre-wrap text-sm">{item.notes}</p>
          <p className="mt-1 text-muted-foreground text-xs">
            {PRIVATE_NOTES_INVENTORY_HINT}
          </p>
        </section>
      )}

      <div className="mt-4 border-border border-t pt-4">
        <InventoryLifecyclePanel
          history={history}
          item={{
            id: item.id,
            name: item.name,
            status: item.status,
            currentHolderId: item.currentHolderId ?? null,
            currentHolderName: item.currentHolderName ?? null,
            currentHolderEmail: item.currentHolderEmail ?? null,
            currentHolderLabel: item.currentHolderLabel ?? null,
            currentRequestItemId: item.currentRequestItemId ?? null,
          }}
        />
      </div>
    </div>
  );
}
```

The `Link to="/inventory/$itemId/edit"` will not typecheck until Task 3 creates that route. That is expected and is exactly the dangling-link failure mode the spec wants; Step 6 below defers the typecheck gate to Task 3.

- [ ] **Step 2: Rewrite the item detail route**

Replace `src/routes/inventory/$itemId.tsx` entirely:

```tsx
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { InventoryStatusBadge } from "#/components/inventory-status-badge";
import type { HistoryRow } from "#/components/inventory-lifecycle-panel";
import {
  StaffInventoryPanel,
  type StaffPanelItem,
} from "#/components/staff-inventory-panel";
import { Button } from "#/components/ui/button";
import { authClient } from "#/lib/auth-client";
import { pageTitle } from "#/lib/page-title";
import { getPublicUrl } from "#/lib/storage";
import { addToCart, getInventoryItemDetail } from "#/server/inventory";

export const Route = createFileRoute("/inventory/$itemId")({
  head: () => ({ meta: [{ title: pageTitle("Inventory Item") }] }),
  loader: async ({ params }) => {
    const detail = await getInventoryItemDetail({
      data: { id: params.itemId },
    });
    if (!detail) {
      throw notFound();
    }
    return detail;
  },
  component: ItemDetail,
});

function ItemDetail() {
  const { item, history, viewerIsStaff } = Route.useLoaderData();
  const qc = useQueryClient();
  const { data: session } = authClient.useSession();
  const img = getPublicUrl(item.imageUrl);
  const canAdd = item.status === "available" && !!session?.user;

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 md:p-8">
      <div className="grid gap-6 md:grid-cols-[1fr_1fr]">
        <div className="overflow-hidden rounded-lg bg-(--surface-sunken)">
          {img ? (
            <img alt="" className="h-full w-full object-cover" src={img} />
          ) : (
            <div className="aspect-square" />
          )}
        </div>
        <div>
          <h1 className="font-semibold text-2xl">{item.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <InventoryStatusBadge
              showRetired={viewerIsStaff}
              status={
                item.status as
                  | "available"
                  | "requested"
                  | "reserved"
                  | "checked_out"
                  | "maintenance"
                  | "retired"
              }
            />
            {item.category && (
              <span className="rounded bg-secondary px-2 py-0.5 text-muted-foreground text-xs">
                {item.category}
              </span>
            )}
          </div>
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
              <p className="text-muted-foreground text-sm">
                {(() => {
                  if (!session?.user) {
                    return "Sign in to request items.";
                  }
                  if (item.status === "available") {
                    return null;
                  }
                  return "This item is not available right now.";
                })()}
              </p>
            )}
          </div>
        </div>
      </div>

      {viewerIsStaff && (
        <StaffInventoryPanel
          history={history as unknown as HistoryRow[]}
          item={item as unknown as StaffPanelItem}
        />
      )}
    </div>
  );
}
```

Three deliberate changes from the old public page, beyond adding the panel:

1. The empty-image case renders `<div className="aspect-square" />` (the admin page's behavior) instead of nothing, so the two-column grid does not collapse. This is the divergence the spec called out.
2. `showRetired={viewerIsStaff}`: only staff can load a retired item at all (`getInventoryItemAs` returns `null` for everyone else), so the badge should say so for them.
3. A `head`/`pageTitle` is added, which the old public page lacked.

The two `as unknown as` casts follow the existing convention in this codebase for loader data whose type is a staff/public union; the old admin route did the same.

- [ ] **Step 3: Delete the admin detail route and the now-dead history function**

```bash
git rm src/routes/_authed/admin/inventory/$itemId.tsx
```

In `src/server/inventory.ts`, delete the whole `getItemHistory` export (~lines 210-217) and the now-unused `itemHistorySchema` if nothing else references it (grep first: `grep -n itemHistorySchema src/server/inventory.ts`).

In `src/server/_internal/inventory.ts`, delete `getItemHistoryForCurrentUser` (~lines 1003-1006). **Keep `getItemHistoryAs`** — Task 1's function and the integration tests both call it.

- [ ] **Step 4: Repoint the admin table row link**

In `src/routes/_authed/admin/inventory/index.tsx`, the row-name `<Link>` (~line 203):

```tsx
                  <Link
                    className="hover:underline"
                    params={{ itemId: row.id }}
                    to="/inventory/$itemId"
                  >
                    {row.name}
                  </Link>
```

- [ ] **Step 5: Repoint the a11y test**

In `src/test/a11y/admin.a11y.test.ts`, replace the `admin inventory item detail` test:

```ts
test("inventory item detail (staff)", async ({ page }) => {
  await page.goto(`/inventory/${itemId}`);
  await checkA11y(page);
});
```

It keeps the admin `storageState` from the top of that file, so it scans the page **with** the staff panel rendered.

Then strengthen the anonymous counterpart in `src/test/a11y/public.a11y.test.ts`, so one page serving two audiences is asserted from both sides:

```ts
test("inventory item detail", async ({ page }) => {
  await page.goto(`/inventory/${itemId}`);
  // One page now serves both audiences, so prove the staff half is absent
  // for an anonymous viewer rather than trusting the conditional.
  await expect(page.getByText("Staff panel")).toHaveCount(0);
  await checkA11y(page);
});
```

Add `expect` to the `@playwright/test` import at the top of that file (currently `import { test } from "@playwright/test";`).

- [ ] **Step 6: Verify what can be verified yet**

```bash
npm run test
```

Expected: all existing unit tests still pass (none reference these routes).

`npm run typecheck` will still fail on `to="/inventory/$itemId/edit"` until Task 3 creates that route. Confirm the **only** typecheck errors are about that path:

```bash
npm run typecheck 2>&1 | grep -v "inventory/\$itemId/edit"
```

Expected: no other errors. Do not commit yet; Task 3 completes this change set.

---

## Task 3: Move the edit route to `/inventory/$itemId/edit`

**Files:**
- Create: `src/routes/_authed/inventory/$itemId/edit.tsx`
- Delete: `src/routes/_authed/admin/inventory/$itemId_.edit.tsx`
- Modify: `src/routes/_authed/admin/inventory/index.tsx:228` (edit link)
- Modify: `src/test/a11y/admin.a11y.test.ts:41-44`

**Interfaces:**
- Consumes: existing `InventoryForm` (props `initial`, `itemId`, `onSaved(itemId)`, `submitLabel`), `getInventoryItem`, `getSession`.
- Produces: the route path `/inventory/$itemId/edit`, which Task 2's `StaffInventoryPanel` links to.

**Why no trailing underscore:** the old filename was `$itemId_.edit.tsx` because it sat beside `admin/inventory/$itemId.tsx`, which TanStack treated as its parent layout; that parent has no `<Outlet />`, so the form silently never rendered (the bug recorded in the 2026-07-23 spec addendum). In the new location the detail route lives in the public tree (`routes/inventory/$itemId.tsx`) and the edit route in the pathless `_authed` tree, so there is no parent to escape. This mirrors projects exactly: `routes/projects/$projectId.tsx` + `routes/_authed/projects/$projectId/edit.tsx`.

- [ ] **Step 1: Create the moved route**

Create `src/routes/_authed/inventory/$itemId/edit.tsx`:

```tsx
import {
  createFileRoute,
  notFound,
  redirect,
  useNavigate,
} from "@tanstack/react-router";
import { InventoryForm } from "#/components/inventory-form";
import { getSession } from "#/lib/auth-guards";
import { pageTitle } from "#/lib/page-title";
import { getInventoryItem } from "#/server/inventory";

interface StaffItem {
  category: string | null;
  description: string | null;
  id: string;
  imageUrl: string | null;
  label?: string | null;
  location: string | null;
  name: string;
  notes?: string | null;
  serial?: string | null;
}

export const Route = createFileRoute("/_authed/inventory/$itemId/edit")({
  head: () => ({ meta: [{ title: pageTitle("Edit Inventory Item") }] }),
  // `_authed` guarantees a signed-in user, not a staff one, and this URL is
  // now guessable from the public detail page. Defence in depth over
  // `updateInventoryItemAs`, which asserts staff on its own.
  beforeLoad: async () => {
    const session = await getSession();
    if (!session?.user) {
      throw redirect({ to: "/sign-in" });
    }
    if (!["admin", "instructor"].includes(session.user.role ?? "")) {
      throw redirect({ to: "/" });
    }
  },
  loader: async ({ params }) => {
    const item = await getInventoryItem({ data: { id: params.itemId } });
    if (!item) {
      throw notFound();
    }
    return item;
  },
  component: EditInventoryItem,
});

function EditInventoryItem() {
  const navigate = useNavigate();
  const loaded = Route.useLoaderData() as unknown as StaffItem;
  return (
    <div className="mx-auto max-w-2xl px-4 py-6 md:p-8">
      <h1 className="font-semibold text-2xl">Edit inventory item</h1>
      <div className="mt-6">
        <InventoryForm
          initial={{
            name: loaded.name,
            description: loaded.description ?? "",
            category: loaded.category ?? "",
            serial: loaded.serial ?? "",
            label: loaded.label ?? "",
            location: loaded.location ?? "",
            notes: loaded.notes ?? "",
            imageUrl: loaded.imageUrl ?? "",
          }}
          itemId={loaded.id}
          onSaved={(itemId) =>
            navigate({ to: "/inventory/$itemId", params: { itemId } })
          }
          submitLabel="Save"
        />
      </div>
    </div>
  );
}
```

The breadcrumb is dropped: it walked `Admin > Inventory > item > Edit`, a path this route no longer sits under.

- [ ] **Step 2: Delete the old route**

```bash
git rm "src/routes/_authed/admin/inventory/\$itemId_.edit.tsx"
```

The filename contains `$`, so it must be quoted or escaped in a shell.

- [ ] **Step 3: Repoint the admin table edit link**

In `src/routes/_authed/admin/inventory/index.tsx` (~line 228):

```tsx
                <Link
                  className="hover:underline"
                  params={{ itemId: row.id }}
                  to="/inventory/$itemId/edit"
                >
                  Edit
                </Link>
```

- [ ] **Step 4: Repoint the a11y test**

In `src/test/a11y/admin.a11y.test.ts`, replace the `admin inventory item edit` test:

```ts
test("inventory item edit (staff)", async ({ page }) => {
  await page.goto(`/inventory/${itemId}/edit`);
  await checkA11y(page);
});
```

- [ ] **Step 5: Regenerate the route tree and verify**

```bash
npm run build
npm run typecheck && npm run check && npm run test
```

The build regenerates `src/routeTree.gen.ts`. Expected: typecheck clean (the dangling `/inventory/$itemId/edit` from Task 2 now resolves), check clean, all unit tests pass.

If typecheck still reports an unknown route path, the route tree did not regenerate — run `npm run dev` briefly and stop it, then retry.

- [ ] **Step 6: Commit Tasks 2 and 3 together**

```bash
git add -A
git commit -m "refactor(inventory): one item detail page, edit route under /inventory

Merges the admin item detail page into the public route with a staff-only
panel, matching how projects work. The Edit link lives inside that panel,
so it is staff-only by construction; an item has no owner, so unlike a
project there is no other audience.

Deletes the admin detail route rather than redirecting: the app has no
production deployment, and TanStack's typed route paths turn any stale
link into a build error. getItemHistory's only caller went with it."
```

---

## Task 4: Move the create route to `/inventory/new`

**Files:**
- Create: `src/routes/_authed/inventory/new.tsx`
- Delete: `src/routes/_authed/admin/inventory/new.tsx`
- Modify: `src/routes/_authed/admin/inventory/index.tsx:131` ("+ New item" link)
- Modify: `src/test/a11y/admin.a11y.test.ts:31-34`

**Interfaces:**
- Consumes: existing `InventoryForm` (`onSaved`, `submitLabel`), `getSession`.
- Produces: the route path `/inventory/new`.

**Routing hazard:** `/inventory/new` now sits beside `/inventory/$itemId`, so `new` must not be parsed as an item id — that would send staff to a not-found page instead of the create form. TanStack ranks static segments above dynamic ones, and `/projects/new` beside `/projects/$projectId` already relies on this in the codebase. Step 4 verifies it rather than assuming it.

- [ ] **Step 1: Create the moved route**

Create `src/routes/_authed/inventory/new.tsx`:

```tsx
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { InventoryForm } from "#/components/inventory-form";
import { getSession } from "#/lib/auth-guards";
import { pageTitle } from "#/lib/page-title";

export const Route = createFileRoute("/_authed/inventory/new")({
  head: () => ({ meta: [{ title: pageTitle("New Inventory Item") }] }),
  // Same reasoning as the edit route: `_authed` only guarantees signed-in.
  // `createInventoryItemAs` asserts staff independently.
  beforeLoad: async () => {
    const session = await getSession();
    if (!session?.user) {
      throw redirect({ to: "/sign-in" });
    }
    if (!["admin", "instructor"].includes(session.user.role ?? "")) {
      throw redirect({ to: "/" });
    }
  },
  component: NewInventoryItem,
});

function NewInventoryItem() {
  const navigate = useNavigate();
  return (
    <div className="mx-auto max-w-2xl px-4 py-6 md:p-8">
      <h1 className="font-semibold text-2xl">New inventory item</h1>
      <div className="mt-6">
        <InventoryForm
          onSaved={(itemId) =>
            navigate({ to: "/inventory/$itemId", params: { itemId } })
          }
          submitLabel="Create item"
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Delete the old route and repoint the link**

```bash
git rm src/routes/_authed/admin/inventory/new.tsx
```

In `src/routes/_authed/admin/inventory/index.tsx` (~line 131):

```tsx
            <Link to="/inventory/new">+ New item</Link>
```

- [ ] **Step 3: Repoint the a11y test**

In `src/test/a11y/admin.a11y.test.ts`, replace the `admin inventory new` test:

```ts
test("inventory new (staff)", async ({ page }) => {
  await page.goto("/inventory/new");
  await checkA11y(page);
});
```

- [ ] **Step 4: Verify the static route wins over the dynamic one**

```bash
npm run build
npm run typecheck && npm run check
npm run dev
```

With the dev server running, sign in as an admin and open `http://localhost:3000/inventory/new`. Expected: the **create form**, not a not-found page and not the detail page trying to load an item with id `new`. Stop the dev server when confirmed.

If it renders the detail page instead, the route ranking is not what this plan assumed — stop and report rather than working around it.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(inventory): move the create route to /inventory/new

Completes the split: every item-scoped surface lives under /inventory,
and /admin/inventory keeps only the cross-item views. Same arrangement
projects already have."
```

---

## Task 5: Project private panel

**Files:**
- Create: `src/components/project-private-panel.tsx`
- Modify: `src/routes/projects/$projectId.tsx` (remove `PrivateNotesSection` and the two private `<section>` blocks; render the panel)

**Interfaces:**
- Consumes: existing `StatusTimeline` (props `{ rows: HistoryRow[] }` where `HistoryRow` is `{ changedBy, comment, createdAt, id, newStatus, oldStatus }`), `CommentThread` (props `{ comments, onChanged, projectId, viewerIsStaff }`), `SectionHeading`.
- Produces: `<ProjectPrivatePanel notes history projectId comments viewerIsStaff onCommentsChanged />`. No later task consumes it.

- [ ] **Step 1: Create the panel component**

Create `src/components/project-private-panel.tsx`:

```tsx
import { PRIVATE_NOTES_LABEL } from "#/lib/private-notes";
import { CommentThread } from "./comment-thread";
import { SectionHeading } from "./section-heading";
import { StatusTimeline } from "./status-timeline";

type Comment = Parameters<typeof CommentThread>[0]["comments"][number];
type HistoryRow = Parameters<typeof StatusTimeline>[0]["rows"][number];

/**
 * Everything on the project page that the proposer and staff share and the
 * public never sees, in one bordered region with a single audience statement,
 * so the boundary is structural rather than something each section has to
 * re-explain.
 *
 * Deliberately NOT brand-tinted like the staff panel: a staff viewer renders
 * both, stacked, and identical borders would read as one region and defeat the
 * separation. Neutral border here, brand tint reserved for staff-only.
 */
export function ProjectPrivatePanel({
  comments,
  history,
  notes,
  onCommentsChanged,
  projectId,
  viewerIsStaff,
}: {
  comments: Comment[];
  history: HistoryRow[];
  notes: string | null;
  onCommentsChanged: () => void;
  projectId: string;
  viewerIsStaff: boolean;
}) {
  return (
    <div className="mt-8 rounded-lg border border-border bg-(--surface-sunken) p-4">
      <SectionHeading>Private</SectionHeading>
      <p className="mt-1 text-muted-foreground text-sm">
        Only visible to you and program staff. Never shown publicly.
      </p>

      {notes && (
        <section className="mt-5 border-border border-t pt-4">
          <h3 className="font-medium text-sm">{PRIVATE_NOTES_LABEL}</h3>
          <p className="mt-1 whitespace-pre-wrap text-sm">{notes}</p>
        </section>
      )}

      <section className="mt-5 border-border border-t pt-4">
        <h3 className="font-medium text-sm">Status history</h3>
        <div className="mt-2">
          <StatusTimeline rows={history} />
        </div>
      </section>

      <section className="mt-5 border-border border-t pt-4">
        <h3 className="font-medium text-sm">Comments</h3>
        <div className="mt-2">
          <CommentThread
            comments={comments}
            onChanged={onCommentsChanged}
            projectId={projectId}
            viewerIsStaff={viewerIsStaff}
          />
        </div>
      </section>
    </div>
  );
}
```

`SectionHeading` renders an `<h2>`, so the three `<h3>`s below it form a valid heading order. `PRIVATE_NOTES_PROJECT_HINT` is deliberately **not** used here: the panel's own audience line supersedes it, and rendering both would say the same thing twice. The constant stays in use on the project form, where the field appears without this panel around it.

- [ ] **Step 2: Wire it into the project route**

In `src/routes/projects/$projectId.tsx`:

1. Delete the whole `PrivateNotesSection` function.
2. Delete the `PRIVATE_NOTES_LABEL` / `PRIVATE_NOTES_PROJECT_HINT` import (now unused on this page).
3. Replace this block:

```tsx
      <PrivateNotesSection
        notes={(project.notes as string | null) ?? null}
        visible={viewerIsStaff || viewerIsOwner}
      />

      {(viewerIsStaff || viewerIsOwner) && (
        <section className="mt-8">
          <SectionHeading>Status history</SectionHeading>
          <div className="mt-3">
            <StatusTimeline rows={history} />
          </div>
        </section>
      )}

      {(viewerIsOwner || viewerIsStaff) && (
        <section className="mt-8">
          <SectionHeading>Comments</SectionHeading>
          <div className="mt-3">
            <CommentThread
              comments={comments}
              onChanged={() => {
                void refreshComments();
                void router.invalidate();
              }}
              projectId={project.id as string}
              viewerIsStaff={viewerIsStaff}
            />
          </div>
        </section>
      )}
```

with:

```tsx
      {(viewerIsStaff || viewerIsOwner) && (
        <ProjectPrivatePanel
          comments={comments}
          history={history}
          notes={(project.notes as string | null) ?? null}
          onCommentsChanged={() => {
            void refreshComments();
            void router.invalidate();
          }}
          projectId={project.id as string}
          viewerIsStaff={viewerIsStaff}
        />
      )}
```

4. Add `import { ProjectPrivatePanel } from "#/components/project-private-panel";`
5. Remove the now-unused `CommentThread` and `StatusTimeline` imports. **Keep** the `type Comment = Parameters<typeof CommentThread>[0]["comments"][number];` alias only if it is still referenced by the `useState<Comment[]>` call — it is, so change that alias to derive from the panel instead:

```tsx
type Comment = Parameters<typeof ProjectPrivatePanel>[0]["comments"][number];
```

and drop the `CommentThread` import.

- [ ] **Step 3: Verify**

```bash
npm run typecheck && npm run check && npm run test
```

Expected: all clean. The `comment-thread` unit tests still pass — they render `CommentThread` directly and are unaffected by where it is mounted.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(projects): group private notes, history, and comments into one panel

Gives the page three explicit visibility tiers: public fields, then a
proposer-and-staff panel, then the staff-only panel. The three sections
drop their individual audience lines in favour of one statement on the
panel. Neutral border so it does not read as part of the brand-tinted
staff panel below it."
```

---

## Task 6: Documentation and full verification

**Files:**
- Modify: `PRD.md` (§5 Project Comments & Review, §12 Inventory Management)

- [ ] **Step 1: Update the PRD inventory section**

In `PRD.md` §12, replace the bullet reading `- ✅ Staff add, edit, and delete inventory items.` with:

```markdown
- ✅ Staff add, edit, and delete inventory items. Every item-scoped surface
  lives under `/inventory` (`/inventory/new`, `/inventory/$itemId`,
  `/inventory/$itemId/edit`), with staff-only routes guarded individually;
  `/admin/inventory` keeps only the cross-item management table and the
  request queue. This mirrors how projects are laid out.
- ✅ One item detail page for everyone: public viewers see image, name,
  status, category, description and Add to cart; staff additionally render a
  staff panel with serial, label, location, private notes, the Edit link and
  the lifecycle controls.
```

In §5 (Project Comments & Review), append:

```markdown
- ✅ Private notes, status history, and comments render inside one bordered
  "Private" panel on the project page, visible to the proposer and staff, with
  a single audience statement instead of per-section explanations.
```

- [ ] **Step 2: Run the full verification suite**

```bash
npm run typecheck
npm run check
npm run test
```

All three must be clean.

```bash
docker compose up -d
ulimit -n 8192
npm run test:integration
npm run db:seed:dev
```

Integration tests must pass. They TRUNCATE the dev database, hence the re-seed.

```bash
npm run test:accessibility
```

This needs a live server and Playwright browsers. If it cannot run in this environment, **say so explicitly** in the final report rather than omitting it — it is the only check covering the heading-order change in Task 5 and the route moves in Tasks 3 and 4.

- [ ] **Step 3: Manual smoke check**

```bash
npm run dev
```

Confirm, signed in as an admin:
1. `/inventory` → click an item → detail page shows the staff panel below the public block.
2. The staff panel's Edit button opens `/inventory/$itemId/edit`; saving returns to the detail page.
3. `/inventory/new` renders the create form; creating an item lands on its detail page.
4. `/admin/inventory` → the row name and Edit links both land under `/inventory`.
5. Sign out. The same item detail page shows no staff panel and no private notes.
6. `/projects/<id>` as the proposer → the Private panel groups notes, history and comments, and is visually distinct from the staff panel.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "docs: record the unified inventory routes and the project private panel"
```

---

## Self-Review Notes

Checked against the spec:

- **Spec coverage.** Every spec section maps to a task: combined server function → Task 1; merged detail page, deleted admin route, dead `getItemHistory` → Task 2; edit route move → Task 3; create route move → Task 4; project private panel → Task 5; PRD and full verification → Task 6.
- **Deliberately deferred typecheck.** Task 2 leaves the tree in a non-compiling state (it links to a route Task 3 creates) and Task 2's commit is folded into Task 3. This is called out in both tasks. If you are executing tasks in isolation, run 2 and 3 together.
- **`getItemHistoryAs` survives.** Only the server fn and the `ForCurrentUser` wrapper are deleted. Task 1's function and the integration tests call `getItemHistoryAs` directly.
- **Not covered by automated tests:** the route moves themselves. Vitest never boots the router, so Task 4 Step 4 and Task 6 Step 3 are manual, and the a11y suite is the only automated coverage of the new URLs.
- **Placeholder scan:** clean. Every code step carries the literal code to write; no "add error handling", no "similar to Task N", no TBDs.
- **Type consistency:** `getInventoryItemDetailAs` / `getInventoryItemDetail` (Task 1) are the names Tasks 2 uses. `StaffPanelItem` and `HistoryRow` are used identically in the component and the route cast. Task 5 derives `Comment` and `HistoryRow` via `Parameters<typeof …>` because neither underlying interface is exported, which is the same trick the current project route already uses.
