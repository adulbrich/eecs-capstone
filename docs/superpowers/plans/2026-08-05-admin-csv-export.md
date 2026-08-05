# Admin CSV Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let staff export any `/admin` table to a CSV file containing every row matching the current filters and every meaningful field of each record.

**Architecture:** A pure `toCsv` serializer in `src/lib/csv.ts`, a client-only `ExportCsvButton` that owns the Blob/download dance, and a new `actions` slot on `AdminDataTable` so the button lands in the same place on all six tables. Three of the six tables already hold every field in the browser and serialize their loader data directly. The other three (projects, users, mentors) gain a server export function that reuses its listing's own `WHERE` builder and its listing's own gate.

**Tech Stack:** TypeScript, TanStack Start server functions, Drizzle ORM, Vitest, React 19.

Spec: [`docs/superpowers/specs/2026-08-05-admin-export-inventory-categories-holds-design.md`](../specs/2026-08-05-admin-export-inventory-categories-holds-design.md) §1.

## Global Constraints

- Export exists only on `/admin/*` pages. No export surface anywhere else.
- Each export function carries **exactly the gate its own listing carries**. Staff (`admin` + `instructor`) for projects and mentors; **`assertAdmin`, admin only**, for users. A server function is a public HTTP endpoint; the route's `beforeLoad` redirect is not a security boundary.
- Rows follow the current filters. Columns are the full record. Column visibility never affects the file.
- Export functions take **no** `limit`/`offset` and reuse their listing's `ORDER BY`.
- Never hand-copy a listing's `WHERE` conditions into an export function. Extract the builder and call it from both.
- Run `npm run check` before every commit (project rule in `.claude/CLAUDE.md`).
- Prose in comments and docs uses no emdashes.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/lib/csv.ts` (create) | Pure CSV serialization. No DOM, no React. |
| `src/lib/__tests__/csv.test.ts` (create) | Unit tests for the above. |
| `src/components/export-csv-button.tsx` (create) | Browser download, pending/error state, a11y announcements. |
| `src/components/admin-data-table.tsx` (modify) | New `actions?: ReactNode` slot. |
| `src/server/_internal/projects-queries.ts` (modify) | Extract `buildAdminProjectListConditions`; add `exportAdminProjectsAs`. |
| `src/server/projects-queries.ts` (modify) | `exportAdminProjects` server fn wrapper. |
| `src/server/_internal/users.ts` (modify) | Extract `buildUserConditions` and `buildMentorConditions`; add `exportUsersImpl` and `exportMentorsAs`. |
| `src/server/users.ts` (modify) | `exportUsers` and `exportMentors` server fn wrappers. |
| `src/server/__tests__/admin-exports.integration.test.ts` (create) | Filter parity and per-function gate tests. |
| Six route files under `src/routes/_authed/admin/` (modify) | `EXPORT_COLUMNS` constant + `actions` prop. |

Export column lists live in their route files beside the existing `COLUMNS` constant. The table and its export are one concern; a shared module would need each route's `Row` type and would invert the dependency.

---

### Task 1: The CSV serializer

**Files:**
- Create: `src/lib/csv.ts`
- Test: `src/lib/__tests__/csv.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `export interface CsvColumn<T> { header: string; value: (row: T) => unknown }` and `export function toCsv<T>(columns: CsvColumn<T>[], rows: T[]): string`. Every later task in this plan and both sibling plans depend on these exact names.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/__tests__/csv.test.ts`. No `@vitest-environment jsdom` directive: this module is pure and must not need a DOM.

```ts
import { describe, expect, it } from "vitest";
import { type CsvColumn, toCsv } from "#/lib/csv";

interface Row {
  name: string;
  count: number | null;
  active: boolean;
  when: Date | null;
  tags: string[];
}

const COLUMNS: CsvColumn<Row>[] = [
  { header: "Name", value: (r) => r.name },
  { header: "Count", value: (r) => r.count },
  { header: "Active", value: (r) => r.active },
  { header: "When", value: (r) => r.when },
  { header: "Tags", value: (r) => r.tags },
];

function row(overrides: Partial<Row> = {}): Row {
  return {
    name: "Widget",
    count: 3,
    active: true,
    when: new Date("2026-08-05T12:00:00.000Z"),
    tags: ["a", "b"],
    ...overrides,
  };
}

describe("toCsv", () => {
  it("writes a header row from the column headers", () => {
    expect(toCsv(COLUMNS, []).split("\r\n")[0]).toBe(
      "Name,Count,Active,When,Tags"
    );
  });

  it("yields a header-only file for an empty row set", () => {
    expect(toCsv(COLUMNS, [])).toBe("Name,Count,Active,When,Tags");
  });

  it("terminates rows with CRLF per RFC 4180", () => {
    const csv = toCsv(COLUMNS, [row(), row()]);
    expect(csv.split("\r\n")).toHaveLength(3);
  });

  it("renders dates as ISO 8601 and nulls as empty", () => {
    const csv = toCsv(COLUMNS, [row({ count: null, when: null })]);
    expect(csv.split("\r\n")[1]).toBe("Widget,,true,,a; b");
  });

  it("joins arrays with a semicolon and a space", () => {
    const csv = toCsv(COLUMNS, [row({ tags: ["x", "y", "z"] })]);
    expect(csv.split("\r\n")[1]).toContain("x; y; z");
  });

  it("quotes values containing a comma", () => {
    const csv = toCsv(COLUMNS, [row({ name: "Bolt, hex" })]);
    expect(csv.split("\r\n")[1]).toMatch(/^"Bolt, hex",/);
  });

  it("doubles inner quotes and wraps the value", () => {
    const csv = toCsv(COLUMNS, [row({ name: 'The "Big" One' })]);
    expect(csv.split("\r\n")[1]).toMatch(/^"The ""Big"" One",/);
  });

  it("quotes values containing a newline", () => {
    const csv = toCsv(COLUMNS, [row({ name: "line one\nline two" })]);
    expect(csv).toContain('"line one\nline two"');
  });

  it.each(["=", "+", "-", "@", "\t", "\r"])(
    "prefixes a formula-injection lead character (%j) with an apostrophe",
    (lead) => {
      const csv = toCsv([{ header: "Name", value: (r: Row) => r.name }], [
        row({ name: `${lead}HYPERLINK("http://evil")` }),
      ]);
      expect(csv.split("\r\n")[1]).toContain(`'${lead}HYPERLINK`);
    }
  );

  it("puts the guard apostrophe inside the quotes when both apply", () => {
    const csv = toCsv([{ header: "Name", value: (r: Row) => r.name }], [
      row({ name: "=SUM(A1,A2)" }),
    ]);
    expect(csv.split("\r\n")[1]).toBe(`"'=SUM(A1,A2)"`);
  });

  it("leaves a safe value untouched", () => {
    const csv = toCsv([{ header: "Name", value: (r: Row) => r.name }], [
      row({ name: "Widget" }),
    ]);
    expect(csv.split("\r\n")[1]).toBe("Widget");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `ulimit -n 8192 && npx vitest run src/lib/__tests__/csv.test.ts`
Expected: FAIL, `Failed to resolve import "#/lib/csv"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/csv.ts`:

```ts
/**
 * A single CSV column. `header` is the text in the first row; `value` pulls
 * the cell out of a record and may return anything, including a Date, an
 * array, or null. Serialization is this module's job, not the caller's.
 */
export interface CsvColumn<T> {
  header: string;
  value: (row: T) => unknown;
}

// Hoisted rather than built per cell: these run once per value in a file
// that may hold hundreds of rows times twenty columns.
const NEEDS_QUOTING = /["\r\n,]/;

/**
 * Leading characters a spreadsheet treats as the start of a formula. An item
 * name is user input, so without this guard an export of attacker-influenced
 * data executes when an admin opens it in Excel or Sheets.
 */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

function serialize(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map(serialize).join("; ");
  }
  return String(value);
}

function escapeCell(value: unknown): string {
  const text = serialize(value);
  // The guard goes on before the quoting, so the apostrophe ends up inside
  // the quotes where the spreadsheet will see it.
  const guarded = FORMULA_LEAD.test(text) ? `'${text}` : text;
  if (!NEEDS_QUOTING.test(guarded)) {
    return guarded;
  }
  return `"${guarded.replaceAll('"', '""')}"`;
}

/**
 * Serializes rows to RFC 4180 CSV text.
 *
 * Deliberately emits no UTF-8 BOM. The BOM is a consumer concern (Excel needs
 * it to avoid reading the file in the system codepage), not a property of the
 * CSV, and including it here would make every test assert against an
 * invisible character. `ExportCsvButton` prepends it at download time.
 */
export function toCsv<T>(columns: CsvColumn<T>[], rows: T[]): string {
  const header = columns.map((column) => escapeCell(column.header)).join(",");
  const body = rows.map((row) =>
    columns.map((column) => escapeCell(column.value(row))).join(",")
  );
  return [header, ...body].join("\r\n");
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `ulimit -n 8192 && npx vitest run src/lib/__tests__/csv.test.ts`
Expected: PASS, all cases green.

- [ ] **Step 5: Lint and commit**

```bash
npm run check
git add src/lib/csv.ts src/lib/__tests__/csv.test.ts
git commit -m "feat(export): add an RFC 4180 CSV serializer

Guards against spreadsheet formula injection: a cell whose first
character is = + - @ tab or CR is prefixed with an apostrophe, because
item names, project titles and user names are all user input."
```

---

### Task 2: The export button, the table slot, and the first working export

**Files:**
- Create: `src/components/export-csv-button.tsx`
- Modify: `src/components/admin-data-table.tsx` (the control group around the Columns dropdown, near line 270)
- Modify: `src/routes/_authed/admin/categories/index.tsx`

**Interfaces:**
- Consumes: `toCsv`, `CsvColumn` from Task 1.
- Produces: `<ExportCsvButton filename={string} load={() => Promise<string>} />` and `AdminDataTableProps.actions?: ReactNode`. Tasks 3 through 6 use both.

`/admin/categories` goes first because `listCategories` already returns the complete row, so this task proves the whole client path with no server work.

- [ ] **Step 1: Write the button**

Create `src/components/export-csv-button.tsx`:

```tsx
import { Download } from "lucide-react";
import { useState } from "react";
import { Button } from "#/components/ui/button";

interface Props {
  /** Base filename, no extension. The current date is appended. */
  filename: string;
  /** Produces the CSV text. Async so it can call a server function. */
  load: () => Promise<string>;
}

/**
 * UTF-8 byte order mark. Without it Excel reads the file in the system
 * codepage and renders accented names as mojibake.
 */
const BOM = "\uFEFF";

export function ExportCsvButton({ filename, load }: Props) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  async function runExport() {
    setPending(true);
    setError(null);
    setAnnouncement("");
    try {
      const csv = await load();
      const blob = new Blob([BOM + csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${filename}-${new Date().toISOString().slice(0, 10)}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
      setAnnouncement(`${filename} exported.`);
    } catch (err) {
      // Rendered inline rather than thrown: a failed export must not blank
      // the table it sits above.
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {/*
        Default size, not sm: this sits beside the Columns button and the
        page's filter controls, which are all h-9.
      */}
      <Button
        aria-busy={pending}
        disabled={pending}
        onClick={runExport}
        variant="outline"
      >
        <Download aria-hidden className="size-4" />
        {pending ? "Exporting…" : "Export CSV"}
      </Button>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      {error && <p className="text-destructive text-sm">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Add the slot to AdminDataTable**

In `src/components/admin-data-table.tsx`, add to `AdminDataTableProps<T>`, keeping the interface's alphabetical key order:

```ts
  /**
   * Controls rendered in the right-hand group, before the Columns menu.
   * A slot rather than an `onExport` callback: the export needs per-route
   * column definitions and filter state, and threading those through here
   * would make the table know about exports.
   */
  actions?: ReactNode;
```

Destructure `actions` in the parameter list (alphabetically first, before `caption`). Then wrap the existing `<DropdownMenu modal={false}>` block so the two controls share a row. Replace:

```tsx
        <DropdownMenu modal={false}>
```

with:

```tsx
        <div className="flex items-end gap-3">
          {actions}
          <DropdownMenu modal={false}>
```

and close the new `div` after that dropdown's `</DropdownMenu>`.

- [ ] **Step 3: Wire /admin/categories**

In `src/routes/_authed/admin/categories/index.tsx`, add the imports:

```tsx
import { ExportCsvButton } from "#/components/export-csv-button";
import { type CsvColumn, toCsv } from "#/lib/csv";
```

Add below the existing `COLUMNS` constant:

```tsx
// Every field of the record, independent of which columns are visible.
const EXPORT_COLUMNS: CsvColumn<Row>[] = [
  { header: "ID", value: (row) => row.id },
  { header: "Name", value: (row) => row.name },
  { header: "Type", value: (row) => row.type },
  { header: "Created", value: (row) => row.createdAt },
];
```

Add the prop to the `<AdminDataTable>` call, keeping props alphabetical:

```tsx
        actions={
          <ExportCsvButton
            filename="categories"
            load={() => Promise.resolve(toCsv(EXPORT_COLUMNS, rows))}
          />
        }
```

- [ ] **Step 4: Verify in the running app**

Run: `npm run dev`
Sign in as an admin, open `/admin/categories`, click Export CSV.
Expected: a file named `categories-<today>.csv` downloads with four columns and one row per category. Hide the Type column and export again: the file still has all four columns.

- [ ] **Step 5: Lint and commit**

```bash
npm run check
git add src/components/export-csv-button.tsx src/components/admin-data-table.tsx src/routes/_authed/admin/categories/index.tsx
git commit -m "feat(export): add the CSV export button and wire /admin/categories

AdminDataTable gains an actions slot beside the Columns menu so the
button lands in the same place on every admin table."
```

---

### Task 3: The two remaining direct-serialization tables

**Files:**
- Modify: `src/routes/_authed/admin/programs/index.tsx`
- Modify: `src/routes/_authed/admin/inventory/index.tsx`

**Interfaces:**
- Consumes: `ExportCsvButton`, `toCsv`, `CsvColumn`, and `AdminDataTableProps.actions` from Task 2.
- Produces: nothing new.

Both loaders already return every field. `listProgramsImpl` is a bare `db.select().from(programs)`, and `listAdminInventoryAs` returns `fullForStaff` plus the resolved holder name and email, with no `limit`/`offset`. Neither needs a server function.

- [ ] **Step 1: Add the programs export**

`listProgramsImpl` is `db.select().from(programs)`, so the row carries all six columns of the `programs` table (`src/db/schema.ts:40-51`).

In `src/routes/_authed/admin/programs/index.tsx`, add the same two imports as Task 2, then below `COLUMNS`:

```tsx
const EXPORT_COLUMNS: CsvColumn<Row>[] = [
  { header: "ID", value: (row) => row.id },
  { header: "Course ID", value: (row) => row.courseId },
  { header: "Course name", value: (row) => row.courseName },
  { header: "Description", value: (row) => row.description },
  { header: "Created", value: (row) => row.createdAt },
  { header: "Updated", value: (row) => row.updatedAt },
];
```

Add to the `<AdminDataTable>` call:

```tsx
        actions={
          <ExportCsvButton
            filename="programs"
            load={() => Promise.resolve(toCsv(EXPORT_COLUMNS, rows))}
          />
        }
```

- [ ] **Step 2: Add the inventory export**

In `src/routes/_authed/admin/inventory/index.tsx`, same imports, then:

```tsx
const EXPORT_COLUMNS: CsvColumn<Row>[] = [
  { header: "ID", value: (row) => row.id },
  { header: "Name", value: (row) => row.name },
  { header: "Description", value: (row) => row.description },
  { header: "Category", value: (row) => row.category },
  { header: "Status", value: (row) => row.status },
  { header: "Serial", value: (row) => row.serial },
  { header: "Label", value: (row) => row.label },
  { header: "Location", value: (row) => row.location },
  { header: "Staff notes", value: (row) => row.notes },
  { header: "Image URL", value: (row) => row.imageUrl },
  { header: "Holder name", value: (row) => row.currentHolderName },
  { header: "Holder email", value: (row) => row.currentHolderEmail },
  { header: "Holder label", value: (row) => row.currentHolderLabel },
  { header: "Pick up by", value: (row) => row.pickupBy },
  { header: "Due", value: (row) => row.dueAt },
  { header: "Created", value: (row) => row.createdAt },
  { header: "Updated", value: (row) => row.updatedAt },
];
```

Add the matching `actions` prop with `filename="inventory"`.

This covers everything `fullForStaff` returns plus the two holder fields the route resolves. The only item column omitted is `searchVector`, a machine artifact.

Note for whoever runs the sibling inventory-categories plan: when `category` becomes a foreign key, the `Category` line above changes to read the joined name. Nothing else in this file moves.

- [ ] **Step 3: Verify in the running app**

Run: `npm run dev`
Export from `/admin/programs` and `/admin/inventory`. Then set a status filter on inventory and export again.
Expected: the second file contains only rows matching the filter, and both files carry every column listed above regardless of the Columns menu.

- [ ] **Step 4: Lint and commit**

```bash
npm run check
git add src/routes/_authed/admin/programs/index.tsx src/routes/_authed/admin/inventory/index.tsx
git commit -m "feat(export): wire CSV export on /admin/programs and /admin/inventory

Both loaders already return the complete record, so neither needs a
server export function."
```

---

### Task 4: The projects export

**Files:**
- Modify: `src/server/_internal/projects-queries.ts` (`listAdminProjectsAs`, near lines 113-183)
- Modify: `src/server/projects-queries.ts`
- Modify: `src/routes/_authed/admin/projects/index.tsx`
- Test: `src/server/__tests__/admin-exports.integration.test.ts` (create)

**Interfaces:**
- Consumes: `ExportCsvButton`, `toCsv`, `CsvColumn`.
- Produces: `exportAdminProjectsAs(viewer: Viewer, data: AdminProjectsFilter)` returning `{ rows }`; `exportAdminProjectsImpl(data)`; the `exportAdminProjects` server fn. Task 6 follows the same shape.

`listAdminProjectsAs` maintains **two** condition lists. `scope` (status, soft-delete, program) feeds the proposer dropdown and deliberately excludes both `q` and the proposer filter. `listConditions` (`scope` plus proposer plus `q`) selects the rows. **The export takes `listConditions`.**

- [ ] **Step 1: Write the failing integration test**

Create `src/server/__tests__/admin-exports.integration.test.ts`:

```ts
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "#/db";
import { user } from "#/db/schema";
import { auth } from "#/lib/auth";
import {
  exportAdminProjectsAs,
  listAdminProjectsAs,
} from "#/server/_internal/projects-queries";
import { createProjectAs } from "#/server/_internal/projects";

async function makeUser(email: string, role: "user" | "instructor" | "admin") {
  await auth.api.signUpEmail({
    body: { email, password: "Password1!", name: email },
  });
  await db
    .update(user)
    .set({ emailVerified: true, ...(role === "user" ? {} : { role }) })
    .where(eq(user.email, email));
  const [u] = await db.select().from(user).where(eq(user.email, email));
  return { id: u.id, role: u.role };
}

function baseProject(title: string) {
  return {
    title,
    description: null,
    problemStatement: "The stated problem",
    objectives: null,
    minQualifications: null,
    prefQualifications: null,
    url: "",
    contactEmail: "",
    contactName: null,
    imageUrl: "",
    licenseRestrictions: null,
    programId: null,
    notes: "Staff only",
  };
}

const ALL_PROJECTS = {
  includeSoftDeleted: false,
  program: null,
  proposer: null,
  q: "",
  status: "all" as const,
};

describe("admin project export", () => {
  it("returns the same rows the listing returns for the same filter", async () => {
    const admin = await makeUser(`a-${Date.now()}@x.com`, "admin");
    await createProjectAs(admin, baseProject("Alpha rover"));
    await createProjectAs(admin, baseProject("Beta sensor"));

    const filter = { ...ALL_PROJECTS, q: "Alpha" };
    const listed = await listAdminProjectsAs(admin, filter);
    const exported = await exportAdminProjectsAs(admin, filter);

    expect(exported.rows.map((r) => r.id).sort()).toEqual(
      listed.rows.map((r) => r.id).sort()
    );
    expect(exported.rows).toHaveLength(1);
  });

  it("carries fields the listing projection omits", async () => {
    const admin = await makeUser(`b-${Date.now()}@x.com`, "admin");
    await createProjectAs(admin, baseProject("Gamma probe"));

    const { rows } = await exportAdminProjectsAs(admin, {
      ...ALL_PROJECTS,
      q: "Gamma",
    });

    expect(rows[0].problemStatement).toBe("The stated problem");
    expect(rows[0].notes).toBe("Staff only");
  });

  it("allows instructors and rejects students", async () => {
    const instructor = await makeUser(`i-${Date.now()}@x.com`, "instructor");
    const student = await makeUser(`s-${Date.now()}@x.com`, "user");

    await expect(
      exportAdminProjectsAs(instructor, ALL_PROJECTS)
    ).resolves.toBeDefined();
    await expect(exportAdminProjectsAs(student, ALL_PROJECTS)).rejects.toThrow(
      "Forbidden"
    );
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `ulimit -n 8192 && npx vitest run --config vitest.integration.config.ts src/server/__tests__/admin-exports.integration.test.ts`
Expected: FAIL, `exportAdminProjectsAs` is not exported.

If instead every test fails on a missing column, run `npm run db:migrate` first: integration tests read the schema as it exists.

- [ ] **Step 3: Extract the condition builder**

In `src/server/_internal/projects-queries.ts`, lift the two condition lists out of `listAdminProjectsAs` into module-level functions above it, moving the existing comments with them:

```ts
/**
 * The scope the proposer dropdown is built from: status, program and the
 * soft-delete switch, but NOT the search text or the proposer choice itself.
 * Excluding the proposer keeps the option you picked from being the only one
 * left; excluding `q` keeps typing in the search box from emptying the
 * dropdown underneath you.
 */
function buildAdminProjectScope(data: AdminProjectsFilter): SQL[] {
  const scope: SQL[] = [];
  if (data.status !== "all") {
    scope.push(eq(projects.status, data.status as ProjectStatus));
  }
  if (!data.includeSoftDeleted) {
    scope.push(isNull(projects.deletedAt));
  }
  if (data.program) {
    scope.push(eq(projects.programId, data.program));
  }
  return scope;
}

/**
 * The conditions that select the listing's rows: the scope, plus the proposer
 * filter, plus the search text. The CSV export calls this too, so the file can
 * never disagree with the table about which rows match.
 */
function buildAdminProjectListConditions(data: AdminProjectsFilter): SQL[] {
  const listConditions: SQL[] = [...buildAdminProjectScope(data)];
  if (data.proposer) {
    listConditions.push(eq(projects.proposerId, data.proposer));
  }
  const trimmed = data.q.trim();
  if (trimmed) {
    // Same tsvector-plus-title-ILIKE shape as the public listing, so a
    // partial word still matches what staff hunting for a half-remembered
    // title actually type. Extended with contact and proposer fields, since
    // staff also search by who is involved, not just the text.
    const like = `%${trimmed}%`;
    const match = or(
      sql`${projects.searchVector} @@ websearch_to_tsquery('english', ${trimmed})`,
      ilike(projects.title, like),
      ilike(projects.contactName, like),
      ilike(projects.contactEmail, like),
      ilike(user.name, like),
      ilike(user.email, like)
    );
    if (match) {
      listConditions.push(match);
    }
  }
  return listConditions;
}
```

Rewrite `listAdminProjectsAs` to call both: `const scope = buildAdminProjectScope(data);` for the proposer subquery and `const listConditions = buildAdminProjectListConditions(data);` for the row query. Its behavior must not change.

- [ ] **Step 4: Add the export function**

Append to the same module, after `listAdminProjectsImpl`:

```ts
/**
 * The staff CSV export. Same conditions and same order as the listing, no
 * pagination, and a projection widened to every meaningful column.
 *
 * `notes` is included even though it is staff-only, because this function is
 * staff-gated and an export that silently dropped the staff notes would be
 * the more surprising behavior. The gate is what makes that safe.
 */
export async function exportAdminProjectsAs(
  viewer: Viewer,
  data: AdminProjectsFilter
) {
  if (!isStaff(viewer)) {
    throw new Error("Forbidden");
  }
  const conditions = buildAdminProjectListConditions(data);
  const rows = await db
    .select({
      ...adminProjectSummarySelect,
      problemStatement: projects.problemStatement,
      objectives: projects.objectives,
      minQualifications: projects.minQualifications,
      prefQualifications: projects.prefQualifications,
      url: projects.url,
      licenseRestrictions: projects.licenseRestrictions,
      notes: projects.notes,
      archivedAt: projects.archivedAt,
      programManagerId: projects.programManagerId,
      // Correlated rather than joined: a join would multiply project rows by
      // their category count and need a GROUP BY over the whole projection.
      categories: sql<string | null>`(
        SELECT string_agg(c.name, '; ' ORDER BY c.type, c.name)
        FROM project_categories pc
        JOIN categories c ON c.id = pc.category_id
        WHERE pc.project_id = ${projects.id}
      )`,
    })
    .from(projects)
    .leftJoin(programs, eq(projects.programId, programs.id))
    .leftJoin(user, eq(projects.proposerId, user.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(projects.updatedAt));
  return { rows };
}

export async function exportAdminProjectsImpl(data: AdminProjectsFilter) {
  return exportAdminProjectsAs(await getViewer(), data);
}
```

`embedding`, `embeddingSourceHash`, `embeddingUpdatedAt` and `searchVector` are excluded on purpose: they are machine artifacts, and a 1024-dimension vector in a spreadsheet cell is noise.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `ulimit -n 8192 && npx vitest run --config vitest.integration.config.ts src/server/__tests__/admin-exports.integration.test.ts`
Expected: PASS, three tests.

Then confirm nothing regressed in the listing:
Run: `ulimit -n 8192 && npx vitest run --config vitest.integration.config.ts src/server/__tests__/admin-projects-filter.integration.test.ts`
Expected: PASS.

- [ ] **Step 6: Add the server fn wrapper**

In `src/server/projects-queries.ts`, beside `listAdminProjects`:

```ts
export const exportAdminProjects = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => adminListSchema.parse(data ?? {}))
  .handler(async ({ data }) => {
    const { exportAdminProjectsImpl } = await import(
      "./_internal/projects-queries"
    );
    return exportAdminProjectsImpl(data);
  });
```

- [ ] **Step 7: Wire the route**

In `src/routes/_authed/admin/projects/index.tsx`, import `ExportCsvButton`, `toCsv`, `CsvColumn`, and `exportAdminProjects`. Add:

```tsx
type ExportRow = Awaited<ReturnType<typeof exportAdminProjects>>["rows"][number];

const EXPORT_COLUMNS: CsvColumn<ExportRow>[] = [
  { header: "ID", value: (row) => row.id },
  { header: "Title", value: (row) => row.title },
  { header: "Status", value: (row) => row.status },
  { header: "Description", value: (row) => row.description },
  { header: "Problem statement", value: (row) => row.problemStatement },
  { header: "Objectives", value: (row) => row.objectives },
  { header: "Min qualifications", value: (row) => row.minQualifications },
  { header: "Pref qualifications", value: (row) => row.prefQualifications },
  { header: "URL", value: (row) => row.url },
  { header: "License restrictions", value: (row) => row.licenseRestrictions },
  { header: "Staff notes", value: (row) => row.notes },
  { header: "Categories", value: (row) => row.categories },
  { header: "Contact name", value: (row) => row.contactName },
  { header: "Contact email", value: (row) => row.contactEmail },
  { header: "Proposer name", value: (row) => row.proposerName },
  { header: "Proposer email", value: (row) => row.proposerEmail },
  { header: "Program course ID", value: (row) => row.programCourseId },
  { header: "Program course name", value: (row) => row.programCourseName },
  { header: "Teams supported", value: (row) => row.teamsSupported },
  { header: "Created", value: (row) => row.createdAt },
  { header: "Published", value: (row) => row.publishedAt },
  { header: "Archived", value: (row) => row.archivedAt },
  { header: "Soft deleted", value: (row) => row.deletedAt },
  { header: "Updated", value: (row) => row.updatedAt },
];
```

Inside the component, pass the **current filter values from `search`**, so the file matches the table:

```tsx
        actions={
          <ExportCsvButton
            filename="projects"
            load={async () => {
              const { rows: exportRows } = await exportAdminProjects({
                data: {
                  includeSoftDeleted: search.includeSoftDeleted,
                  program: search.program,
                  proposer: search.proposer,
                  q: search.q,
                  status: search.status,
                },
              });
              return toCsv(EXPORT_COLUMNS, exportRows);
            }}
          />
        }
```

Those five fields are exactly the route's `loaderDeps`. Do not add `sort`, `dir` or `cols`: they are client state and the server does not read them.

- [ ] **Step 8: Verify in the running app**

Run: `npm run dev`
On `/admin/projects`, filter to status `published`, then export.
Expected: the file holds only published projects and includes the Problem statement, Staff notes and Categories columns, none of which the table displays.

- [ ] **Step 9: Lint and commit**

```bash
npm run check
git add src/server/_internal/projects-queries.ts src/server/projects-queries.ts src/routes/_authed/admin/projects/index.tsx src/server/__tests__/admin-exports.integration.test.ts
git commit -m "feat(export): export /admin/projects with every project field

Extracts the listing's row-selecting conditions so the export and the
table can never disagree about which rows match. Note the module keeps
two condition lists; the export takes listConditions, not the scope the
proposer dropdown is built from."
```

---

### Task 5: The users export

**Files:**
- Modify: `src/server/_internal/users.ts` (`listUsersImpl`, near lines 104-155)
- Modify: `src/server/users.ts`
- Modify: `src/routes/_authed/admin/users/index.tsx`
- Test: `src/server/__tests__/admin-exports.integration.test.ts` (extend)

**Interfaces:**
- Consumes: `ExportCsvButton`, `toCsv`, `CsvColumn`, `ListUsersInput`.
- Produces: `exportUsersImpl(data)` (ungated query), `exportUsersAs(viewer, data)` (gate + query, the test seam), `exportUsersForCurrentUser(data)`, and the `exportUsers` server fn.

Three functions rather than two, because `users.integration.test.ts` only ever exercises the ungated `…Impl` and the `*As` helpers: it has no pattern for driving a `…ForCurrentUser`, which needs a request session. Splitting the gate into an `exportUsersAs` seam is what makes the instructor-rejection test writable at all, and it matches the `*As(viewer, …)` convention the README describes.

**This module uses a different convention from Task 4.** It has no `*As(viewer, …)` variant for the users listing: it pairs an ungated `…Impl(data)` with a `…ForCurrentUser(data)` wrapper that calls `requireUser()` then `assertAdmin`. Follow that, and **gate with `assertAdmin`, not `assertStaff`**. `/admin/users` requires `role === "admin"` exactly, unlike every other admin route. An instructor must not be able to export the user table through an endpoint guarding a page they cannot open.

- [ ] **Step 1: Write the failing tests**

Append to `src/server/__tests__/admin-exports.integration.test.ts`, adding these imports at the top of the file:

```ts
import {
  exportUsersAs,
  exportUsersImpl,
  listUsersImpl,
} from "#/server/_internal/users";
```

```ts
const ALL_USERS = {
  q: "",
  role: null,
  includeBanned: true,
  page: 1,
  pageSize: 20,
};

describe("admin user export", () => {
  it("returns every match rather than one page", async () => {
    const stamp = Date.now();
    for (let i = 0; i < 25; i++) {
      await makeUser(`bulk-${stamp}-${i}@x.com`, "user");
    }
    const filter = { ...ALL_USERS, q: `bulk-${stamp}-` };

    const listed = await listUsersImpl({ ...filter, pageSize: 10 });
    const exported = await exportUsersImpl(filter);

    expect(listed.rows).toHaveLength(10);
    expect(listed.total).toBe(25);
    expect(exported.rows).toHaveLength(25);
  });

  it("carries fields the listing projection omits", async () => {
    const stamp = Date.now();
    await makeUser(`fields-${stamp}@x.com`, "user");
    const { rows } = await exportUsersImpl({
      ...ALL_USERS,
      q: `fields-${stamp}@x.com`,
    });
    expect(rows[0].emailVerified).toBe(true);
    expect(rows[0].updatedAt).toBeInstanceOf(Date);
  });
});
```

And the gate test, which is the regression test for the mismatch this whole plan guards against:

```ts
it("rejects an instructor as well as a student", async () => {
  const stamp = Date.now();
  const admin = await makeUser(`ga-${stamp}@x.com`, "admin");
  const instructor = await makeUser(`gi-${stamp}@x.com`, "instructor");
  const student = await makeUser(`gs-${stamp}@x.com`, "user");

  await expect(exportUsersAs(admin, ALL_USERS)).resolves.toBeDefined();
  await expect(exportUsersAs(instructor, ALL_USERS)).rejects.toThrow();
  await expect(exportUsersAs(student, ALL_USERS)).rejects.toThrow();
});
```

An instructor is staff everywhere else in the app, so this is the one export where "staff" is the wrong answer.

- [ ] **Step 2: Run to verify it fails**

Run: `ulimit -n 8192 && npx vitest run --config vitest.integration.config.ts src/server/__tests__/admin-exports.integration.test.ts`
Expected: FAIL, `exportUsersImpl` is not exported.

- [ ] **Step 3: Extract the condition builder**

In `src/server/_internal/users.ts`, lift the conditions out of `listUsersImpl`:

```ts
function buildUserConditions(data: ListUsersInput): SQL[] {
  const conditions: SQL[] = [];
  if (data.q) {
    const q = or(
      ilike(user.email, `%${data.q}%`),
      ilike(user.name, `%${data.q}%`)
    );
    if (q) {
      conditions.push(q);
    }
  }
  if (data.role) {
    conditions.push(eq(user.role, data.role));
  }
  if (!data.includeBanned) {
    const notBanned = or(eq(user.banned, false), isNull(user.banned));
    if (notBanned) {
      conditions.push(notBanned);
    }
  }
  return conditions;
}
```

Rewrite `listUsersImpl` to call it. Behavior must not change.

- [ ] **Step 4: Add the export functions**

```ts
/**
 * The admin CSV export. Same conditions and order as the listing, no
 * pagination, and every user column except authentication material: nothing
 * from `account` or `session` is joined.
 */
export async function exportUsersImpl(data: ListUsersInput) {
  const conditions = buildUserConditions(data);
  const rows = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      image: user.image,
      role: user.role,
      banned: user.banned,
      banReason: user.banReason,
      banExpires: user.banExpires,
      affiliation: user.affiliation,
      linkedin: user.linkedin,
      wantsToMentor: user.wantsToMentor,
      mentorTeamCount: user.mentorTeamCount,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    })
    .from(user)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(userOrderBy(data.sort, data.dir));
  return { rows };
}

/**
 * Gated with assertAdmin, not assertStaff. /admin/users requires
 * `role === "admin"` exactly, unlike every other admin route, and a server
 * function is a public endpoint rather than a page the router can redirect.
 *
 * Split out from the wrapper below so integration tests can exercise the gate
 * with a plain viewer, the way they do for every other *As helper.
 */
export async function exportUsersAs(viewer: AuthUser, data: ListUsersInput) {
  assertAdmin(viewer);
  return exportUsersImpl(data);
}

export async function exportUsersForCurrentUser(data: ListUsersInput) {
  const viewer = await requireUser();
  return exportUsersAs(viewer, data);
}
```

That is every column on the `user` table (`src/db/auth-schema.ts:12-39`). Nothing from `account`, `session` or `verification` is joined: those hold authentication material.

- [ ] **Step 5: Run to verify it passes**

Run: `ulimit -n 8192 && npx vitest run --config vitest.integration.config.ts src/server/__tests__/admin-exports.integration.test.ts`
Expected: PASS.

Then: `ulimit -n 8192 && npx vitest run --config vitest.integration.config.ts src/server/__tests__/admin-users-sort.integration.test.ts`
Expected: PASS, confirming the extraction did not change the listing.

- [ ] **Step 6: Add the wrapper and wire the route**

In `src/server/users.ts`:

```ts
export const exportUsers = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) =>
    // page and pageSize carry the schema's defaults and are ignored:
    // exportUsersImpl reads neither. Reusing listUsersSchema rather than a
    // trimmed copy keeps the filter and sort rules in one place.
    listUsersSchema.parse(data ?? {})
  )
  .handler(async ({ data }) => {
    const { exportUsersForCurrentUser } = await import("./_internal/users");
    return exportUsersForCurrentUser(data);
  });
```

`listUsersSchema` already defaults `page` to 1 and `pageSize` to 20, so a caller that omits both parses cleanly.

In `src/routes/_authed/admin/users/index.tsx`:

```tsx
type ExportRow = Awaited<ReturnType<typeof exportUsers>>["rows"][number];

const EXPORT_COLUMNS: CsvColumn<ExportRow>[] = [
  { header: "ID", value: (row) => row.id },
  { header: "Name", value: (row) => row.name },
  { header: "Email", value: (row) => row.email },
  { header: "Email verified", value: (row) => row.emailVerified },
  { header: "Role", value: (row) => row.role },
  { header: "Banned", value: (row) => row.banned },
  { header: "Ban reason", value: (row) => row.banReason },
  { header: "Ban expires", value: (row) => row.banExpires },
  { header: "Wants to mentor", value: (row) => row.wantsToMentor },
  { header: "Mentor team count", value: (row) => row.mentorTeamCount },
  { header: "Affiliation", value: (row) => row.affiliation },
  { header: "Created", value: (row) => row.createdAt },
  { header: "Updated", value: (row) => row.updatedAt },
];
```

Pass `actions` with `filename="users"`, sending the route's filter and sort params (`q`, `role`, `includeBanned`, `sort`, `dir`) but **not** `page`. This route is the one table where sort is a loader dep, so the export must carry it to match what the table shows.

- [ ] **Step 7: Verify in the running app**

Run: `npm run dev`
As an admin on `/admin/users`, page to 2, then export.
Expected: the file contains every matching user, not the 25 on screen. Then sign in as an instructor: `/admin/users` redirects to `/admin` and there is no way to reach the export.

- [ ] **Step 8: Lint and commit**

```bash
npm run check
git add src/server/_internal/users.ts src/server/users.ts src/routes/_authed/admin/users/index.tsx src/server/__tests__/admin-exports.integration.test.ts
git commit -m "feat(export): export all matching users, not the current page

Gated with assertAdmin rather than assertStaff: /admin/users requires
role === admin exactly, and a server function is a public endpoint, not
a page the router can redirect."
```

---

### Task 6: The mentors export

**Files:**
- Modify: `src/server/_internal/users.ts` (`listMentorsAs`, near lines 266-298)
- Modify: `src/server/users.ts`
- Modify: `src/routes/_authed/admin/mentors/index.tsx`
- Test: `src/server/__tests__/admin-exports.integration.test.ts` (extend)

**Interfaces:**
- Consumes: `ExportCsvButton`, `toCsv`, `CsvColumn`.
- Produces: `exportMentorsAs(viewer, data)`, `exportMentorsForCurrentUser(data)`, and the `exportMentors` server fn.

`listMentorsAs` looks complete but selects only `id`, `name`, `email`, `affiliation`, `mentorTeamCount`. It is a summary, so mentors needs a server export function. Unlike `listUsersImpl` in the same module, this one **does** take a viewer and **does** use `assertStaff`, so mirror it.

- [ ] **Step 1: Write the failing test**

Append to `src/server/__tests__/admin-exports.integration.test.ts`:

```ts
describe("admin mentor export", () => {
  it("carries fields the listing projection omits", async () => {
    const stamp = Date.now();
    const admin = await makeUser(`m-admin-${stamp}@x.com`, "admin");
    const mentor = await makeUser(`m-${stamp}@x.com`, "user");
    await db
      .update(user)
      .set({ wantsToMentor: true, affiliation: "OSU" })
      .where(eq(user.id, mentor.id));

    const { rows } = await exportMentorsAs(admin, { q: `m-${stamp}@x.com` });

    expect(rows).toHaveLength(1);
    expect(rows[0].affiliation).toBe("OSU");
    expect(rows[0].createdAt).toBeInstanceOf(Date);
    expect(rows[0].role).toBeDefined();
  });

  it("allows instructors and rejects students", async () => {
    const stamp = Date.now();
    const instructor = await makeUser(`mi-${stamp}@x.com`, "instructor");
    const student = await makeUser(`ms-${stamp}@x.com`, "user");

    await expect(exportMentorsAs(instructor, { q: "" })).resolves.toBeDefined();
    await expect(exportMentorsAs(student, { q: "" })).rejects.toThrow(
      "Forbidden"
    );
  });
});
```

Add `exportMentorsAs` to the `#/server/_internal/users` import at the top of the file.

- [ ] **Step 2: Run to verify it fails**

Run: `ulimit -n 8192 && npx vitest run --config vitest.integration.config.ts src/server/__tests__/admin-exports.integration.test.ts`
Expected: FAIL, `exportMentorsAs` is not exported.

- [ ] **Step 3: Extract and implement**

In `src/server/_internal/users.ts`, lift the conditions out of `listMentorsAs`:

```ts
function buildMentorConditions(data: { q: string }): SQL[] {
  const conditions: SQL[] = [eq(user.wantsToMentor, true)];
  const trimmed = data.q.trim();
  if (trimmed) {
    // The `user` table carries no tsvector, so this is substring matching.
    // Adequate for a list of a few dozen people.
    const like = `%${trimmed}%`;
    const match = or(
      ilike(user.name, like),
      ilike(user.email, like),
      ilike(user.affiliation, like)
    );
    if (match) {
      conditions.push(match);
    }
  }
  return conditions;
}
```

Rewrite `listMentorsAs` to call it, then add:

```ts
/**
 * The staff CSV export. Widens the five-column listing with role,
 * wantsToMentor and createdAt.
 *
 * `wantsToMentor` is constant true across the whole result set by
 * construction. It is included anyway so a spreadsheet that gets filtered and
 * re-sorted still says what it is a list of.
 */
export async function exportMentorsAs(
  viewer: AuthUser,
  data: { q: string } = { q: "" }
) {
  assertStaff(viewer);
  const rows = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      affiliation: user.affiliation,
      role: user.role,
      wantsToMentor: user.wantsToMentor,
      mentorTeamCount: user.mentorTeamCount,
      createdAt: user.createdAt,
    })
    .from(user)
    .where(and(...buildMentorConditions(data)))
    .orderBy(user.name);
  return { rows };
}

export async function exportMentorsForCurrentUser(data: { q: string }) {
  const viewer = await requireUser();
  return exportMentorsAs(viewer, data);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `ulimit -n 8192 && npx vitest run --config vitest.integration.config.ts src/server/__tests__/admin-exports.integration.test.ts`
Expected: PASS, all suites in the file.

Then: `ulimit -n 8192 && npx vitest run --config vitest.integration.config.ts src/server/__tests__/mentors.integration.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the wrapper and wire the route**

In `src/server/users.ts`, beside `listMentors`:

```ts
export const exportMentors = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => listMentorsSchema.parse(data ?? {}))
  .handler(async ({ data }) => {
    const { exportMentorsForCurrentUser } = await import("./_internal/users");
    return exportMentorsForCurrentUser(data);
  });
```

`listMentorsSchema` is declared at `src/server/users.ts:83` and is `z.object({ q: z.string().default("") })`. Reuse it rather than declaring a second one.

In `src/routes/_authed/admin/mentors/index.tsx`:

```tsx
type ExportRow = Awaited<ReturnType<typeof exportMentors>>["rows"][number];

const EXPORT_COLUMNS: CsvColumn<ExportRow>[] = [
  { header: "ID", value: (row) => row.id },
  { header: "Name", value: (row) => row.name },
  { header: "Email", value: (row) => row.email },
  { header: "Affiliation", value: (row) => row.affiliation },
  { header: "Role", value: (row) => row.role },
  { header: "Wants to mentor", value: (row) => row.wantsToMentor },
  { header: "Mentor team count", value: (row) => row.mentorTeamCount },
  { header: "Created", value: (row) => row.createdAt },
];
```

Pass `actions` with `filename="mentors"`, sending `{ q: search.q }`, which is the route's only `loaderDep`.

- [ ] **Step 6: Full verification**

```bash
npm run check
npm run typecheck
ulimit -n 8192 && npm run test
ulimit -n 8192 && npm run test:integration
```

Expected: all pass. Then `npm run dev` and export from all six admin tables in turn, confirming each downloads a file whose row count matches the table and whose columns are unaffected by the Columns menu.

- [ ] **Step 7: Commit**

```bash
git add src/server/_internal/users.ts src/server/users.ts src/routes/_authed/admin/mentors/index.tsx src/server/__tests__/admin-exports.integration.test.ts
git commit -m "feat(export): export /admin/mentors with role and created date

listMentorsAs selects only five columns, so unlike inventory and
programs this table does need a server export function."
```

---

## Done when

- All six admin tables have a working Export CSV button.
- `npm run check`, `npm run typecheck`, `npm run test` and `npm run test:integration` all pass.
- An instructor is rejected by the users export and accepted by the projects and mentors exports.
- Update `README.md`: remove "Ability to export admin tables to CSV (current selection)" from the Roadmap list.
