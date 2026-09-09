# AdminDataTable Grouping Mode Implementation Plan

> **For agentic workers:** Implement inline, task by task, test first within each step, with the code review loop at the end. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `AdminDataTable` an optional `group` prop that renders one `tbody` per group with a `th scope="rowgroup"` header, derived from the sort rather than stored, with no route changed.

**Architecture:** One new prop on the shared component. Grouped-ness is `sort` equals `defaultSort`. Groups are formed from the sorted row model, so a client-sorted page groups what the reader sees. The CSS under both breakpoints stops assuming a single `tbody`. `useAdminTable` and `table-state.ts` are untouched.

**Tech Stack:** React, TanStack Table, Tailwind v4 plus `src/styles.css`, Vitest with jsdom and Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-09-custom-requests-and-inventory-ux-design.md`, section "The grouping mode on AdminDataTable". Issue #282. First of four; #283, #284 and #80 build on it.

## Global Constraints

- **Prose contains no emdashes and no emojis.** Covers code comments, commit messages, docs and string literals. `scripts/check-prose.mjs` refuses the two characters on every edit.
- **A table with no `group` prop renders byte-identically to today.** The flat path's JSX is not touched; the grouped path is a sibling branch.
- **`useAdminTable`, `use-admin-table.ts` and `table-state.ts` are unchanged.** Nothing new enters the URL.
- **`defineAdminColumns` and every existing call site are untouched.** No route changes.
- **Test commands:** `ulimit -n 8192; CI=true npm test`, on the `.nvmrc` Node (`~/.nvm/versions/node/v24.16.0/bin` first on PATH), with the sandbox off.
- **Before every commit:** `npm run check` and `npm run typecheck` in full.
- **Stage files by name. Never commit to `main`.** Branch `feat/admin-table-grouping`, off `origin/main` at `481e773`.
- **Commit messages:** Conventional Commits, lowercase imperative, area in parens, `Co-Authored-By` trailer kept, no session link.

## Seams under test

| Seam | Kind |
| --- | --- |
| Grouped-ness derived from `sort` versus `defaultSort` | unit, jsdom |
| One `tbody` per group, `th scope="rowgroup"`, header colspan against hidden columns | unit, jsdom |
| Groups formed from the sorted model, not the input | unit, jsdom |
| `highlightedRowId` inside a group | unit, jsdom |
| Flat path with no `group` renders one `tbody` and no `th` in it | unit, jsdom |
| Mobile card gap across a group boundary and the strip header; desktop bottom rule | browser preview, by eye, both widths |

## File Structure

| File | Responsibility |
| --- | --- |
| `src/components/admin-data-table.tsx` | the `group` prop, `AdminTableGroup<T>` type, the `grouped` derivation, the grouped render branch, a `renderRow` helper shared by both branches |
| `src/styles.css` | the admin-table rules under both breakpoints, made safe for several `tbody`s, plus the group header row |
| `src/test/admin-data-table.test.tsx` | the unit tests above |
| `docs/UI-CONVENTIONS.md`, "Admin tables" | the prop, that grouped-ness derives from the sort, the `header(rows)` denormalization constraint |

---

### Task 1: The `group` prop and the grouped render path

**Files:**
- Modify: `src/components/admin-data-table.tsx:191-258` (props), `:422` (rows), `:589-643` (body)
- Test: `src/test/admin-data-table.test.tsx`

**Interfaces:**
- Produces:

```ts
export interface AdminTableGroup<T> {
  /** Rows with the same key render in one group, in sorted-model order. */
  key: (row: T) => string;
  /** The group header. Receives the group's rows and nothing else. */
  header: (rows: T[]) => ReactNode;
  /** Optional controls on the right of the header. */
  actions?: (rows: T[]) => ReactNode;
}
// AdminDataTableProps<T> gains: group?: AdminTableGroup<T>
```

- Markup contract later PRs rely on: a group is `<tbody data-group="<key>">`; its first row is `<tr data-group-header><th scope="rowgroup" colSpan={visibleColumnCount}>`; data rows are unchanged (`data-highlighted`, `data-label`, `data-card-header` as today).

- [ ] **Step 1: Write the failing tests**

Append to `src/test/admin-data-table.test.tsx`, inside the existing `describe("AdminDataTable")`:

```tsx
describe("group", () => {
  interface GroupedRow {
    batch: string;
    id: string;
    name: string;
  }
  const GROUPED: GroupedRow[] = [
    { batch: "B", id: "1", name: "delta" },
    { batch: "A", id: "2", name: "alpha" },
    { batch: "B", id: "3", name: "beta" },
    { batch: "A", id: "4", name: "gamma" },
  ];
  const GROUPED_COLUMNS: AdminColumn<GroupedRow>[] = [
    {
      accessorFn: (row) => row.name,
      cell: (ctx) => ctx.row.original.name,
      enableHiding: false,
      header: "Name",
      id: "name",
    },
    {
      accessorFn: (row) => row.batch,
      cell: (ctx) => ctx.row.original.batch,
      header: "Batch",
      id: "batch",
    },
  ];
  const GROUPED_SORT = { desc: false, id: "name" } as const;
  const group = {
    actions: (rows: GroupedRow[]) => (
      <button type="button">Approve {rows.length}</button>
    ),
    header: (rows: GroupedRow[]) => `Batch ${rows[0].batch}`,
    key: (row: GroupedRow) => row.batch,
  };

  function renderGrouped(
    overrides: Partial<AdminDataTableProps<GroupedRow>> = {}
  ) {
    return render(
      <AdminDataTable
        caption="Grouped"
        columns={GROUPED_COLUMNS}
        data={GROUPED}
        defaultSort={GROUPED_SORT}
        emptyMessage="Nothing here."
        getRowId={(row) => row.id}
        group={group}
        hidden={[]}
        onHiddenChange={vi.fn()}
        onSortChange={vi.fn()}
        sort={GROUPED_SORT}
        storageKey="grouped"
        {...overrides}
      />
    );
  }

  it("renders one tbody per group under the default sort, headed by a rowgroup th", () => {
    const { container } = renderGrouped();
    const bodies = [...container.querySelectorAll("tbody")];
    expect(bodies.map((b) => b.getAttribute("data-group"))).toEqual([
      "A",
      "B",
    ]);
    for (const body of bodies) {
      const th = body.querySelector("tr:first-child th");
      expect(th?.getAttribute("scope")).toBe("rowgroup");
    }
    expect(bodies[0].textContent).toContain("Batch A");
    expect(bodies[0].textContent).toContain("Approve 2");
  });

  it("forms groups from the sorted model, so a group sits where its first row lands", () => {
    // Input order puts a B row first. Sorted by name ascending, "alpha" (A)
    // comes first, so A is the first group and B's rows are beta then delta.
    const { container } = renderGrouped();
    const names = [...container.querySelectorAll("tbody")].map((body) =>
      [...body.querySelectorAll("td:first-child")].map((td) => td.textContent)
    );
    expect(names).toEqual([
      ["alpha", "gamma"],
      ["beta", "delta"],
    ]);
  });

  it("spans the header across the visible columns only", () => {
    const { container, rerender } = renderGrouped();
    expect(
      container.querySelector("th[scope=rowgroup]")?.getAttribute("colspan")
    ).toBe("2");
    rerender(
      <AdminDataTable
        caption="Grouped"
        columns={GROUPED_COLUMNS}
        data={GROUPED}
        defaultSort={GROUPED_SORT}
        emptyMessage="Nothing here."
        getRowId={(row) => row.id}
        group={group}
        hidden={["batch"]}
        onHiddenChange={vi.fn()}
        onSortChange={vi.fn()}
        sort={GROUPED_SORT}
        storageKey="grouped"
      />
    );
    expect(
      container.querySelector("th[scope=rowgroup]")?.getAttribute("colspan")
    ).toBe("1");
  });

  it("renders flat rows and no headers once the sort leaves the default", () => {
    const { container } = renderGrouped({
      sort: { desc: false, id: "batch" },
    });
    expect(container.querySelectorAll("tbody")).toHaveLength(1);
    expect(container.querySelector("th[scope=rowgroup]")).toBeNull();
    expect(container.querySelector("[data-group-header]")).toBeNull();
  });

  it("treats a direction change alone as leaving the default", () => {
    const { container } = renderGrouped({
      sort: { desc: true, id: "name" },
    });
    expect(container.querySelectorAll("tbody")).toHaveLength(1);
  });

  it("still highlights a data row inside a group", () => {
    const { container } = renderGrouped({ highlightedRowId: "3" });
    const highlighted = container.querySelector("[data-highlighted]");
    expect(highlighted?.textContent).toContain("beta");
    expect(highlighted?.closest("tbody")?.getAttribute("data-group")).toBe(
      "B"
    );
  });

  it("renders the no-match row in one plain tbody when a filter empties the table", () => {
    const { container } = renderGrouped({ data: [], filtered: true });
    expect(container.querySelectorAll("tbody")).toHaveLength(1);
    expect(container.querySelector("th[scope=rowgroup]")).toBeNull();
    expect(screen.getByText("Nothing matches these filters.")).not.toBeNull();
  });
});

it("renders one tbody and no rowgroup header without a group prop", () => {
  // The flat path is the one every other admin table takes, and this pins
  // that the grouped branch is a sibling of it rather than a wrapper around
  // it.
  const { container } = renderTable({ hidden: [] });
  expect(container.querySelectorAll("tbody")).toHaveLength(1);
  expect(container.querySelector("tbody th")).toBeNull();
  expect(container.querySelector("[data-group]")).toBeNull();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `ulimit -n 8192; CI=true npx vitest run src/test/admin-data-table.test.tsx`
Expected: the `group` describe fails (`group` is not a known prop, one `tbody`, no `th[scope=rowgroup]`); the flat-path test passes already.

- [ ] **Step 3: Implement the prop and the grouped branch**

In `src/components/admin-data-table.tsx`:

Add after `AdminColumnExtras`:

```ts
/**
 * Rows that arrived together, rendered together.
 *
 * Grouping is derived from the sort and never stored: rows render grouped
 * while the table's `sort` equals its `defaultSort`, and flat the moment the
 * reader sorts by anything else. The two genuinely conflict, since a group
 * stops being contiguous once rows are ordered by another column, so sorting
 * is the escape hatch rather than a mode a reader can get stuck in. Nothing
 * enters the URL and `useAdminTable` gains no state.
 *
 * Groups are formed from the sorted row model, not the input array: on a
 * page that sorts client-side, a group sits where its first row lands. A page
 * that needs a fixed group order returns its rows in that order and makes
 * nothing sortable, which leaves the sorted model equal to the input.
 *
 * `header` receives the group's rows and nothing else, so whatever names the
 * group has to be denormalized onto every row in it. Both consuming pages
 * already do this: the request queue carries the requester on every line.
 *
 * One level only. The mode groups; it does not nest, collapse or sort within
 * a group.
 */
export interface AdminTableGroup<T> {
  actions?: (rows: T[]) => ReactNode;
  header: (rows: T[]) => ReactNode;
  key: (row: T) => string;
}
```

Add to `AdminDataTableProps<T>` after `getRowId`:

```ts
  /**
   * Render rows in groups under the default sort. See `AdminTableGroup`.
   * Absent means today's flat table exactly.
   */
  group?: AdminTableGroup<T>;
```

Destructure `group` in the component. After `const rows = table.getRowModel().rows;` add:

```ts
  // Grouped only while the sort is the page default. Compared by value, so a
  // direction flip on the default column also drops grouping: descending by
  // date is not the order the groups were formed in.
  const grouped =
    !!group && sort.id === defaultSort.id && sort.desc === defaultSort.desc;
  const groups = useMemo(() => {
    if (!grouped) {
      return [];
    }
    // Insertion order: a group is placed where its first row lands in the
    // sorted model, and every later row with the same key joins it there.
    const byKey = new Map<string, Row<T>[]>();
    for (const row of rows) {
      const key = group.key(row.original);
      const bucket = byKey.get(key);
      if (bucket) {
        bucket.push(row);
      } else {
        byKey.set(key, [row]);
      }
    }
    return [...byKey.entries()].map(([key, groupRows]) => ({
      key,
      rows: groupRows,
    }));
  }, [group, grouped, rows]);
  const visibleColumnCount = table.getVisibleLeafColumns().length;
```

Import `type Row` from `@tanstack/react-table`. Extract the existing row JSX (the `rows.map` body, lines 605-641) into a function inside the component:

```tsx
  const renderRow = (row: Row<T>) => {
    const isHighlighted = !!highlightedRowId && row.id === highlightedRowId;
    return (
      <TableRow
        // The documented highlight token, not a colour of its own.
        className={isHighlighted ? "bg-[var(--brand-primary-tint)]" : undefined}
        data-highlighted={isHighlighted ? "" : undefined}
        key={row.id}
        ref={isHighlighted ? highlighted : undefined}
      >
        {row.getVisibleCells().map((cell) => {
          // A card-header cell carries no data-label on purpose: the mobile
          // field name is drawn from that attribute, and this cell is the
          // card's title rather than one of its fields.
          const isCardHeader = cardHeaderIds.has(cell.column.id);
          return (
            <TableCell
              data-card-header={isCardHeader ? "" : undefined}
              data-label={
                isCardHeader ? undefined : (labels.get(cell.column.id) ?? "")
              }
              key={cell.id}
            >
              {flexRender(cell.column.columnDef.cell, cell.getContext())}
            </TableCell>
          );
        })}
      </TableRow>
    );
  };
```

Replace the `<TableBody>` block with:

```tsx
          {grouped && groups.length > 0 ? (
            groups.map(({ key, rows: groupRows }) => (
              <TableBody data-group={key} key={key}>
                {/*
                  A bare tr and th rather than TableRow and TableHead: the
                  shared classes (hover tint, h-10, border-b) are for data
                  rows and column headers, and a group header is neither.
                  `src/styles.css` styles it through data-group-header.
                */}
                <tr data-group-header="">
                  <th colSpan={visibleColumnCount} scope="rowgroup">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        {group.header(groupRows.map((row) => row.original))}
                      </div>
                      {group.actions && (
                        <div className="flex shrink-0 items-center gap-2">
                          {group.actions(
                            groupRows.map((row) => row.original)
                          )}
                        </div>
                      )}
                    </div>
                  </th>
                </tr>
                {groupRows.map(renderRow)}
              </TableBody>
            ))
          ) : (
            <TableBody>
              {rows.length === 0 && (
                <TableRow>
                  {/* unchanged no-match row */}
                  <TableCell
                    className="justify-center py-8 text-center text-muted-foreground text-sm"
                    colSpan={visibleColumnCount}
                  >
                    {noMatchMessage}
                  </TableCell>
                </TableRow>
              )}
              {rows.map(renderRow)}
            </TableBody>
          )}
```

The `group.header` and `group.actions` calls need `group` narrowed: `grouped` implies `group`, but TypeScript cannot see that through a boolean. Keep the narrowing explicit: compute `groups` only when `group` is defined and render `group && grouped && groups.length > 0 ? ... : ...`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `ulimit -n 8192; CI=true npx vitest run src/test/admin-data-table.test.tsx`
Expected: PASS, every existing case included.

- [ ] **Step 5: Check and typecheck, then commit**

Run: `npm run check && npm run typecheck`

```bash
git add src/components/admin-data-table.tsx src/test/admin-data-table.test.tsx
git commit -m "feat(admin-table): group rows under the default sort"
```

---

### Task 2: CSS under both breakpoints

**Files:**
- Modify: `src/styles.css:439-503`

**Interfaces:**
- Consumes: `tbody[data-group]`, `tr[data-group-header] > th` from Task 1.

- [ ] **Step 1: Write the mobile rules**

Under `@media (max-width: 767px)`, after `.admin-table tbody { ... }`:

```css
  /* One tbody per group when the table is grouped. The gap above is inside
     each tbody, so two adjacent tbodies would otherwise butt together. */
  .admin-table tbody + tbody {
    margin-top: 0.5rem;
  }
```

After `.admin-table tbody tr { ... }`:

```css
  /* A group header is a strip above its cards, not a card of its own: no
     border, no radius, no surface. The th carries its own padding because
     none of the td rules below reach it. */
  .admin-table tbody tr[data-group-header] {
    border: none;
    border-radius: 0;
    background: transparent;
  }
  .admin-table tbody tr[data-group-header] th {
    display: block;
    padding: 0.25rem 0.25rem 0.5rem;
    text-align: left;
  }
```

- [ ] **Step 2: Write the desktop rules**

Replace the `@media (min-width: 768px)` block:

```css
/* The table proper, at md and up. The container supplies the surface, the
   border and the radius (see `admin-data-table.tsx`); the last row of the
   last tbody drops its rule so the body meets that rounded edge cleanly
   instead of drawing a line across it. `tbody:last-child`, not `tbody`: a
   grouped table has one tbody per group, and dropping the rule at the end
   of every group would leave each group's last row bare against the next
   group's header. */
@media (min-width: 768px) {
  .admin-table tbody:last-child tr:last-child td {
    border-bottom: none;
  }
  /* The group header is a th, so the td padding never reaches it. */
  .admin-table tbody tr[data-group-header] th {
    padding: 0.5rem;
    border-bottom: 1px solid var(--border);
    background: var(--secondary);
    font-weight: 500;
    text-align: left;
  }
}
```

- [ ] **Step 3: Verify in the browser at both widths**

There is no route using the mode yet, so verify with a scratch route or by temporarily passing `group` on `/admin/inventory/requests` keyed by `requestId` in the working tree, without staging it. Start the dev server through `preview_start` (write `.claude/launch.json` with the sandbox off, delete it before staging, per memory). Check at desktop and at the mobile preset: cards keep their spacing across a group boundary, the header is a strip, the desktop bottom rule is dropped once. Escalate to `.admin-table { display: flex; flex-direction: column; gap: 0.5rem }` only if the margin between tbodies does not render. Revert the scratch edit.

- [ ] **Step 4: Check, typecheck, test, commit**

Run: `npm run check && npm run typecheck && ulimit -n 8192; CI=true npm test`

```bash
git add src/styles.css
git commit -m "style(admin-table): keep the card gap and the bottom rule right across several tbodies"
```

---

### Task 3: Document the prop

**Files:**
- Modify: `docs/UI-CONVENTIONS.md`, "Admin tables", after the `cardHeader` paragraph (around line 355)

- [ ] **Step 1: Write the section**

```markdown
### Grouping rows that arrived together

`group` renders one `tbody` per group with a `th scope="rowgroup"` header across
every visible column, so a screen reader announces the group before its rows.
Absent means the flat table every other admin route renders.

```tsx
<AdminDataTable
  group={{
    key: (row) => row.requestId,
    header: (rows) => <RequestHeader row={rows[0]} count={rows.length} />,
    actions: (rows) => <ApproveAll rows={rows} />,
  }}
  {...tableProps}
/>
```

Grouped-ness is derived from the sort, never stored: rows are grouped while the
table's sort equals its `defaultSort` and flat the moment the reader sorts by
anything else. Nothing enters the URL. Grouping and sorting genuinely conflict,
because a group stops being contiguous once rows are ordered by another column,
so sorting is the escape hatch rather than a mode a reader can get stuck in. A
page that needs a fixed group order returns its rows in that order and declares
every column `enableSorting: false`; it still passes a `defaultSort`, which is
inert there.

Groups are formed from the sorted row model, so a page that sorts client-side
groups what the reader sees. `header(rows)` receives the group's rows and nothing
else, which means whatever identifies the group is denormalized onto every row in
it. `getRowId` and `highlightedRowId` keep addressing data rows, so a deep link
still lands inside a group. On mobile the header renders as a strip above its
cards rather than a card of its own. One level only: no nesting, collapsing or
sorting within a group. CSV export is per-route and unaffected.
```

- [ ] **Step 2: Prose check and commit**

Run: `npm run check:prose`

```bash
git add docs/UI-CONVENTIONS.md
git commit -m "docs(ui): document the admin table grouping mode"
```

---

### Task 4: Review loop and pull request

- [ ] **Step 1: Push and open the PR against `main`**

```bash
git push -u origin feat/admin-table-grouping
gh pr create --base main --title "feat(admin-table): add a grouping mode derived from the sort" --body-file <body>
```

Body follows `.github/pull_request_template.md`: `Closes #282`, bullets, ran-locally lines (`check`, `typecheck`, `test`; no stack suite, no route changed), review loop count, docs line.

- [ ] **Step 2: Run `mattpocock-skills:code-review`** against `main..feat/admin-table-grouping`, address findings, rerun until a pass raises nothing unanswered. Record the pass count in the PR body.

- [ ] **Step 3: Wait for CI green.** `gh pr checks --watch`.

## Self-review

- Spec coverage: prop shape, derived grouping, markup, both CSS breakpoints, header padding, CSV note, `getRowId`/`highlightedRowId`, sorted-model grouping, empty groups (cannot exist: groups come from rows), one level only, docs. All in Tasks 1 to 3.
- Placeholder scan: none.
- Type consistency: `AdminTableGroup<T>`, `group`, `data-group`, `data-group-header` used identically across tasks.
