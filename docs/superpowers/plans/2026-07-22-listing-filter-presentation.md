# Listing and Filter Presentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the list-view thumbnail a fixed 3:2 crop, replace three divergent boolean filter controls with one shared switch, and add a program filter to the admin projects page as a URL search param.

**Architecture:** Three independent slices of presentation work in the projects listings. The thumbnail fix is a single component edit that three routes inherit. The boolean filters converge on a new `FilterSwitch` component adopted at three call sites. The program filter threads a new search param through the existing route → server function → query chain, mirroring the identical filter that already exists on the public listing.

**Tech Stack:** TanStack Start (React SSR), TanStack Router file-based routes, Drizzle ORM on PostgreSQL, shadcn/ui + Radix, Tailwind CSS v4, Vitest + Testing Library.

Source spec: `docs/superpowers/specs/2026-07-22-listing-filter-presentation-design.md`

## Global Constraints

- Every filter's state lives in URL search params so links are shareable. No component-local filter state.
- Run `npm run check` (Ultracite/Biome) before every commit and fix all findings.
- Component tests live in `src/test/<name>.test.tsx` and require the `// @vitest-environment jsdom` pragma on line 1.
- Component tests must mock `@tanstack/react-router` when the component under test imports `Link`, following `src/test/project-card.test.tsx`.
- `@testing-library/jest-dom` is NOT installed. Use plain Vitest matchers (`toBeTruthy`, `toContain`, `toBe`), never `toBeInTheDocument`.
- Integration tests (`*.integration.test.ts`) need `docker compose up -d` and run with `npm run test:integration`. They TRUNCATE the dev database.
- Card view keeps `aspect-[16/9]`. Do not change `project-card.tsx` or the upload crop in `project-image-uploader.tsx`.
- The program filter is a convenience filter only. Do not add per-role defaults or access restrictions.

---

## File Structure

**Created:**

- `src/components/filter-switch.tsx`: the single boolean-filter control used by every filter bar.
- `src/test/filter-switch.test.tsx`: unit tests for the above.
- `src/test/project-row.test.tsx`: unit tests for the row thumbnail.
- `src/server/__tests__/admin-projects-filter.integration.test.ts`: integration tests for the program filter.

**Modified:**

- `src/components/project-row.tsx`: fixed-ratio thumbnail.
- `src/components/projects-filter-bar.tsx:152-160`: adopt `FilterSwitch`.
- `src/routes/_authed/admin/users/index.tsx:145-159`: adopt `FilterSwitch`.
- `src/routes/_authed/admin/projects/index.tsx`: adopt `FilterSwitch`, add program filter.
- `src/server/projects-queries.ts:18-21`: `adminListSchema` gains `program`.
- `src/server/_internal/projects-queries.ts:68-90`: program condition plus an `As` test seam.

---

## Task 1: Fixed-ratio list thumbnail

**Files:**

- Modify: `src/components/project-row.tsx:12-24`
- Test: `src/test/project-row.test.tsx` (create)

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces: no new exports. `ProjectRow` keeps its existing signature `({ project }: { project: ProjectSummary })`.

**Context:** `ProjectRow` currently wraps the image in `<div className="relative w-32 shrink-0 self-stretch">` and positions the image absolutely, so the thumbnail's height is the row's height and its aspect ratio changes with description length. `ImageOrFallback` applies its `className` to the `img` in the image branch and merges it via `cn` in the fallback branch, so a single class string covers both.

- [ ] **Step 1: Write the failing test**

Create `src/test/project-row.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import type * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    ...rest
  }: { children: React.ReactNode } & Record<string, unknown>) => (
    <a {...rest}>{children}</a>
  ),
}));

import { ProjectRow } from "#/components/project-row";
import type { ProjectSummary } from "#/components/project-card";

afterEach(cleanup);

const base: ProjectSummary = {
  id: "00000000-0000-0000-0000-000000000001",
  title: "Rover Telemetry",
  description: "Short description.",
  status: "published",
  imageUrl: null,
  contactName: "Jane Doe",
  programCourseId: "CS 461",
  programCourseName: "Capstone",
  updatedAt: "2026-07-01T00:00:00.000Z",
};

describe("ProjectRow thumbnail", () => {
  it("renders the image at a fixed 3:2 ratio", () => {
    const { container } = render(
      <ProjectRow project={{ ...base, imageUrl: "projects/a/b.webp" }} />
    );
    const img = container.querySelector("img");
    expect(img).toBeTruthy();
    expect(img?.className).toContain("aspect-[3/2]");
    expect(img?.className).not.toContain("absolute");
  });

  it("renders the fallback at the same fixed ratio", () => {
    const { container } = render(<ProjectRow project={base} />);
    expect(container.querySelector("img")).toBeNull();
    const fallback = container.querySelector('[class*="aspect-"]');
    expect(fallback?.className).toContain("aspect-[3/2]");
  });

  it("does not stretch the thumbnail to the row height", () => {
    const { container } = render(
      <ProjectRow project={{ ...base, imageUrl: "projects/a/b.webp" }} />
    );
    expect(container.querySelector(".self-stretch")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/test/project-row.test.tsx`
Expected: FAIL. The first test fails on `expect(img?.className).toContain("aspect-[3/2]")` because the current class string is `absolute inset-0 h-full w-full object-cover`.

- [ ] **Step 3: Replace the stretched wrapper with a fixed-ratio image**

In `src/components/project-row.tsx`, replace the `Link` opening tag, the image wrapper, and the text column's padding.

Replace this:

```tsx
    <Link
      className="flex items-stretch gap-3 overflow-hidden rounded-lg border border-border bg-card transition-colors hover:border-primary"
      params={{ projectId: project.id }}
      to="/projects/$projectId"
    >
      <div className="relative w-32 shrink-0 self-stretch">
        <ImageOrFallback
          className="absolute inset-0 h-full w-full object-cover"
          src={src}
        />
      </div>
      <div className="min-w-0 flex-1 py-3 pr-3">
```

with this:

```tsx
    <Link
      className="flex items-center gap-3 overflow-hidden rounded-lg border border-border bg-card p-3 transition-colors hover:border-primary"
      params={{ projectId: project.id }}
      to="/projects/$projectId"
    >
      <ImageOrFallback
        className="aspect-[3/2] w-28 shrink-0 rounded-md object-cover sm:w-40"
        src={src}
      />
      <div className="min-w-0 flex-1">
```

The `p-3` on the `Link` replaces the text column's `py-3 pr-3`. It is required: a vertically centered thumbnail no longer meets the card's edges, so without padding it would sit flush against the border on one side and float on the others.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/test/project-row.test.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 5: Verify no other component relied on the old markup**

Run: `npx vitest run src/test`
Expected: PASS. `project-card.test.tsx` must be unaffected; the card view is untouched.

- [ ] **Step 6: Lint**

Run: `npm run check`
Expected: no findings. Fix any before committing.

- [ ] **Step 7: Commit**

```bash
git add src/components/project-row.tsx src/test/project-row.test.tsx
git commit -m "fix: give the list-view thumbnail a fixed 3:2 aspect ratio"
```

---

## Task 2: The `FilterSwitch` component

**Files:**

- Create: `src/components/filter-switch.tsx`
- Test: `src/test/filter-switch.test.tsx` (create)

**Interfaces:**

- Consumes: `Switch` from `#/components/ui/switch`, `Label` from `#/components/ui/label`.
- Produces:

  ```ts
  export function FilterSwitch(props: {
    checked: boolean;
    id: string;
    label: string;
    onCheckedChange: (checked: boolean) => void;
  }): JSX.Element
  ```

  Tasks 3 and 5 import this exact signature.

**Context:** The existing call sites nest `<Checkbox>` inside `<Label>` and rely on implicit labelling. Radix's `Switch` renders a `button`, and a `button` inside a `label` is **not** implicitly labelled, so this component requires an explicit `id` plus `htmlFor`. Getting this wrong ships an unlabelled control that screen readers announce as "switch" with no name.

The `h-9` wrapper is what performs the alignment. It matches the 36px height of `SelectTrigger` and `Input`, so when the parent cell uses `items-end` the switch lines up with the control beside it rather than with the label above it.

- [ ] **Step 1: Write the failing test**

Create `src/test/filter-switch.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FilterSwitch } from "#/components/filter-switch";

afterEach(cleanup);

describe("FilterSwitch", () => {
  it("exposes an accessible name taken from its label", () => {
    render(
      <FilterSwitch
        checked={false}
        id="archived-only"
        label="Show only archived projects"
        onCheckedChange={() => {
          // no-op
        }}
      />
    );
    const control = screen.getByRole("switch", {
      name: "Show only archived projects",
    });
    expect(control).toBeTruthy();
  });

  it("reports its checked state", () => {
    render(
      <FilterSwitch
        checked
        id="archived-only"
        label="Show only archived projects"
        onCheckedChange={() => {
          // no-op
        }}
      />
    );
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe(
      "true"
    );
  });

  it("calls onCheckedChange with the next value when toggled", () => {
    const onCheckedChange = vi.fn();
    render(
      <FilterSwitch
        checked={false}
        id="archived-only"
        label="Show only archived projects"
        onCheckedChange={onCheckedChange}
      />
    );
    screen.getByRole("switch").click();
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it("aligns to the control row height, not the label row", () => {
    const { container } = render(
      <FilterSwitch
        checked={false}
        id="archived-only"
        label="Show only archived projects"
        onCheckedChange={() => {
          // no-op
        }}
      />
    );
    expect(container.firstElementChild?.className).toContain("h-9");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/test/filter-switch.test.tsx`
Expected: FAIL with a resolution error for `#/components/filter-switch`, because the file does not exist yet.

- [ ] **Step 3: Write the component**

Create `src/components/filter-switch.tsx`:

```tsx
import { Label } from "./ui/label";
import { Switch } from "./ui/switch";

interface Props {
  checked: boolean;
  id: string;
  label: string;
  onCheckedChange: (checked: boolean) => void;
}

/**
 * A boolean filter control for filter bars and admin toolbars.
 *
 * The `h-9` wrapper matches the height of `Input` and `SelectTrigger`, so a
 * parent using `items-end` aligns this switch with the control beside it
 * rather than with that control's label.
 *
 * `id` and `htmlFor` are required, not optional: Radix renders the switch as a
 * `button`, and a `button` nested in a `label` is not implicitly labelled.
 */
export function FilterSwitch({ checked, id, label, onCheckedChange }: Props) {
  return (
    <div className="flex h-9 items-center gap-2">
      <Switch checked={checked} id={id} onCheckedChange={onCheckedChange} />
      <Label className="font-normal" htmlFor={id}>
        {label}
      </Label>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/test/filter-switch.test.tsx`
Expected: PASS, 4 tests.

- [ ] **Step 5: Lint**

Run: `npm run check`
Expected: no findings.

- [ ] **Step 6: Commit**

```bash
git add src/components/filter-switch.tsx src/test/filter-switch.test.tsx
git commit -m "feat: add FilterSwitch, a shared boolean filter control"
```

---

## Task 3: Adopt `FilterSwitch` at all three call sites

**Files:**

- Modify: `src/components/projects-filter-bar.tsx:152-160`
- Modify: `src/routes/_authed/admin/users/index.tsx:145-159`
- Modify: `src/routes/_authed/admin/projects/index.tsx:76-87`

**Interfaces:**

- Consumes: `FilterSwitch` from Task 2, exact signature `{ checked, id, label, onCheckedChange }`.
- Produces: nothing new. The admin projects `softDeleteToggle` variable keeps its name and its position in the JSX.

**Context:** Three places express the same idea three ways today. The public bar and admin users use `Checkbox` nested in `Label`; admin projects uses a bare `Link` styled as muted text, which does not read as a control at all. All three become the same component. Every filter stays a URL search param.

- [ ] **Step 1: Convert the public filter bar**

In `src/components/projects-filter-bar.tsx`, replace this block:

```tsx
<div className="flex items-end">
  <Label className="font-normal">
    <Checkbox
      checked={archivedOnly}
      onCheckedChange={(checked) => setArchivedOnly(checked === true)}
    />
    Show only archived projects
  </Label>
</div>;
```

with this:

```tsx
<div className="flex items-end">
  <FilterSwitch
    checked={archivedOnly}
    id="filter-archived-only"
    label="Show only archived projects"
    onCheckedChange={setArchivedOnly}
  />
</div>;
```

The outer `flex items-end` stays. That is what aligns the switch's `h-9` box with the `SelectTrigger` in the sibling grid cell.

Add the import alongside the existing component imports:

```tsx
import { FilterSwitch } from "./filter-switch";
```

Do **not** remove the `Checkbox` import: it is still used by the category filter list further down the same file.

- [ ] **Step 2: Convert the admin users toolbar**

In `src/routes/_authed/admin/users/index.tsx`, replace this block:

```tsx
<Label className="font-normal">
  <Checkbox
    checked={includeBanned}
    onCheckedChange={(checked) =>
      void navigate({
        search: (prev) => ({
          ...prev,
          includeBanned: checked === true,
          page: 1,
        }),
      })
    }
  />
  Include banned
</Label>;
```

with this:

```tsx
<FilterSwitch
  checked={includeBanned}
  id="user-include-banned"
  label="Include banned"
  onCheckedChange={(checked) =>
    void navigate({
      search: (prev) => ({ ...prev, includeBanned: checked, page: 1 }),
    })
  }
/>;
```

Note the simplification: `onCheckedChange` already hands you a `boolean`, so the `checked === true` narrowing that `Checkbox` needed (its callback can also emit `"indeterminate"`) is gone.

Add the import:

```tsx
import { FilterSwitch } from "#/components/filter-switch";
```

Then remove the now-unused `Checkbox` import from this file if nothing else in it uses `Checkbox`. Run `npm run check` to confirm; Biome reports unused imports.

- [ ] **Step 3: Convert the admin projects soft-delete toggle**

In `src/routes/_authed/admin/projects/index.tsx`, replace this:

```tsx
const softDeleteToggle = (
  <Link
    className="text-muted-foreground text-xs hover:text-foreground"
    search={{
      status,
      includeSoftDeleted: !includeSoftDeleted,
    }}
    to="/admin/projects"
  >
    {includeSoftDeleted ? "Hide soft-deleted" : "Show soft-deleted"}
  </Link>
);
```

with this:

```tsx
const softDeleteToggle = (
  <FilterSwitch
    checked={includeSoftDeleted}
    id="admin-include-soft-deleted"
    label="Show soft-deleted"
    onCheckedChange={(checked) =>
      void navigate({
        to: "/admin/projects",
        search: (prev) => ({ ...prev, includeSoftDeleted: checked }),
      })
    }
  />
);
```

Two behavioural notes. The label is now static ("Show soft-deleted") because the switch's own state communicates on/off; the old link had to describe its action instead. And the `search` callback now spreads `prev`, where the old `Link` listed params explicitly, so the toggle will not clobber the program filter added in Task 5.

The desktop wrapper `<div className="mb-2">{softDeleteToggle}</div>` should lose its `mb-2`, since the switch is now the same height as the controls it sits beside. Change it to `<div>{softDeleteToggle}</div>`.

Add the import:

```tsx
import { FilterSwitch } from "#/components/filter-switch";
```

`Link` is still imported and used for the breadcrumb and the status tabs, so leave that import alone.

- [ ] **Step 4: Run the full unit suite**

Run: `npm run test`
Expected: PASS. No existing test asserts on the old checkbox markup; if one does, update it to query `getByRole("switch")`.

- [ ] **Step 5: Lint**

Run: `npm run check`
Expected: no findings, including no unused-import warnings.

- [ ] **Step 6: Manual verification**

Run `npm run dev`, then check:

- `/projects`: the archived switch sits on the same horizontal centre line as the Program select.
- `/admin/users`: the banned switch aligns with the search input and role select.
- `/admin/projects`: the soft-delete switch reads as a control, toggles, and updates the URL.
- Each switch is reachable by Tab, toggles with Space, and announces its label.

- [ ] **Step 7: Commit**

```bash
git add src/components/projects-filter-bar.tsx src/routes/_authed/admin/users/index.tsx src/routes/_authed/admin/projects/index.tsx
git commit -m "refactor: use FilterSwitch for archived, banned, and soft-deleted filters"
```

---

## Task 4: Program filter, server side

**Files:**

- Modify: `src/server/projects-queries.ts:18-21`
- Modify: `src/server/_internal/projects-queries.ts:68-90`
- Test: `src/server/__tests__/admin-projects-filter.integration.test.ts` (create)

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces:

  ```ts
  // src/server/_internal/projects-queries.ts
  export async function listAdminProjectsAs(
    viewer: { id: string; role: string | null } | null,
    data: { status: StatusFilter; includeSoftDeleted: boolean; program: string | null }
  ): Promise<{ rows: ProjectSummaryRow[] }>
  ```

  Task 5 relies on `listAdminProjects` accepting `program: string | null` in its input.

**Context:** `searchProjectsImpl:18-20` already does exactly this filter for the public listing:

```ts
if (data.programId) {
  conditions.push(eq(projects.programId, data.programId));
}
```

The admin query mirrors it. `listAdminProjectsImpl` already `leftJoin`s `programs`, so the label is available and the join does not change.

This task also extracts a `listAdminProjectsAs(viewer, data)` seam. The README states the convention: "The companion `*As(viewer, ...)` helpers next to each `createServerFn` let integration tests exercise business logic directly, without the HTTP layer." Query functions do not have these yet, and `listAdminProjectsImpl` calls a module-private `getViewer()` that reads the request session, which cannot be driven from an integration test. Extracting the seam is what makes this task testable at all.

- [ ] **Step 1: Write the failing test**

Create `src/server/__tests__/admin-projects-filter.integration.test.ts`:

```ts
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "#/db";
import { programs, user } from "#/db/schema";
import { auth } from "#/lib/auth";
import {
  createProjectAs,
  performTransitionAs,
} from "#/server/_internal/projects";
import { listAdminProjectsAs } from "#/server/_internal/projects-queries";

async function makeAdmin(email: string) {
  await auth.api.signUpEmail({
    body: { email, password: "Password1!", name: email },
  });
  await db
    .update(user)
    .set({ emailVerified: true, role: "admin" })
    .where(eq(user.email, email));
  const [u] = await db.select().from(user).where(eq(user.email, email));
  return { id: u.id, role: u.role };
}

async function makeProgram(courseId: string) {
  const [row] = await db
    .insert(programs)
    .values({ courseId, courseName: "Capstone" })
    .returning();
  return row.id;
}

function baseProject(title: string, programId: string | null) {
  return {
    title,
    description: null,
    problemStatement: null,
    objectives: null,
    minQualifications: null,
    prefQualifications: null,
    url: "",
    contactEmail: "",
    contactName: null,
    imageUrl: "",
    licenseRestrictions: null,
    programId,
    notes: null,
  };
}

describe("admin projects program filter", () => {
  it("returns only projects in the selected program", async () => {
    const admin = await makeAdmin(`a-${Date.now()}@x.com`);
    const cs461 = await makeProgram("CS 461");
    const ece441 = await makeProgram("ECE 441");

    await createProjectAs(admin, baseProject("In CS 461", cs461));
    await createProjectAs(admin, baseProject("In ECE 441", ece441));

    const { rows } = await listAdminProjectsAs(admin, {
      status: "all",
      includeSoftDeleted: false,
      program: cs461,
    });

    expect(rows.map((r) => r.title)).toEqual(["In CS 461"]);
  });

  it("includes projects with no program when no program is selected", async () => {
    const admin = await makeAdmin(`b-${Date.now()}@x.com`);
    const cs461 = await makeProgram("CS 461");

    await createProjectAs(admin, baseProject("In CS 461", cs461));
    await createProjectAs(admin, baseProject("No program", null));

    const { rows } = await listAdminProjectsAs(admin, {
      status: "all",
      includeSoftDeleted: false,
      program: null,
    });

    expect(rows.map((r) => r.title).sort()).toEqual([
      "In CS 461",
      "No program",
    ]);
  });

  it("composes the program filter with the status filter", async () => {
    const admin = await makeAdmin(`c-${Date.now()}@x.com`);
    const cs461 = await makeProgram("CS 461");

    const draft = await createProjectAs(admin, baseProject("Draft", cs461));
    const live = await createProjectAs(admin, baseProject("Live", cs461));
    await performTransitionAs(admin, live.id, "submitted");
    await performTransitionAs(admin, live.id, "approved");
    await performTransitionAs(admin, live.id, "published");

    const { rows } = await listAdminProjectsAs(admin, {
      status: "published",
      includeSoftDeleted: false,
      program: cs461,
    });

    expect(rows.map((r) => r.title)).toEqual(["Live"]);
    expect(rows.map((r) => r.id)).not.toContain(draft.id);
  });

  it("still refuses non-staff viewers", async () => {
    await auth.api.signUpEmail({
      body: { email: "plain@x.com", password: "Password1!", name: "plain" },
    });
    const [u] = await db
      .select()
      .from(user)
      .where(eq(user.email, "plain@x.com"));

    await expect(
      listAdminProjectsAs(
        { id: u.id, role: u.role },
        { status: "all", includeSoftDeleted: false, program: null }
      )
    ).rejects.toThrow("Forbidden");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `docker compose up -d && npx vitest run --config vitest.integration.config.ts src/server/__tests__/admin-projects-filter.integration.test.ts`
Expected: FAIL. `listAdminProjectsAs` is not exported from `src/server/_internal/projects-queries`.

- [ ] **Step 3: Split the impl into an `As` seam and add the program condition**

In `src/server/_internal/projects-queries.ts`, replace the whole `listAdminProjectsImpl` function:

```ts
export async function listAdminProjectsImpl(data: {
  status: StatusFilter;
  includeSoftDeleted: boolean;
}) {
  const viewer = await getViewer();
  if (!isStaff(viewer)) {
    throw new Error("Forbidden");
  }
  const conditions: SQL[] = [];
  if (data.status !== "all") {
    conditions.push(eq(projects.status, data.status as ProjectStatus));
  }
  if (!data.includeSoftDeleted) {
    conditions.push(isNull(projects.deletedAt));
  }
  const rows = await db
    .select(projectSummarySelect)
    .from(projects)
    .leftJoin(programs, eq(projects.programId, programs.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(projects.updatedAt));
  return { rows };
}
```

with this:

```ts
type AdminProjectsFilter = {
  status: StatusFilter;
  includeSoftDeleted: boolean;
  program: string | null;
};

/**
 * Test seam. Integration tests call this directly with a viewer instead of
 * going through the request session, matching the `*As(viewer, ...)`
 * convention used by the mutation helpers.
 */
export async function listAdminProjectsAs(
  viewer: Viewer,
  data: AdminProjectsFilter
) {
  if (!isStaff(viewer)) {
    throw new Error("Forbidden");
  }
  const conditions: SQL[] = [];
  if (data.status !== "all") {
    conditions.push(eq(projects.status, data.status as ProjectStatus));
  }
  if (!data.includeSoftDeleted) {
    conditions.push(isNull(projects.deletedAt));
  }
  if (data.program) {
    conditions.push(eq(projects.programId, data.program));
  }
  const rows = await db
    .select(projectSummarySelect)
    .from(projects)
    .leftJoin(programs, eq(projects.programId, programs.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(projects.updatedAt));
  return { rows };
}

export async function listAdminProjectsImpl(data: AdminProjectsFilter) {
  return listAdminProjectsAs(await getViewer(), data);
}
```

The `program` condition is guarded by truthiness, exactly like `searchProjectsImpl`, so a `null` program applies no condition and projects with no program stay visible under "All programs".

- [ ] **Step 4: Widen the input schema**

In `src/server/projects-queries.ts`, replace:

```ts
const adminListSchema = z.object({
  status: z.enum(STATUS_FILTER_VALUES).default("all"),
  includeSoftDeleted: z.boolean().default(false),
});
```

with:

```ts
const adminListSchema = z.object({
  status: z.enum(STATUS_FILTER_VALUES).default("all"),
  includeSoftDeleted: z.boolean().default(false),
  program: z.string().uuid().nullable().default(null),
});
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run --config vitest.integration.config.ts src/server/__tests__/admin-projects-filter.integration.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Run the rest of the integration suite**

Run: `npm run test:integration`
Expected: PASS. `listAdminProjectsImpl` now requires `program` in its argument; the Zod default supplies it for every caller going through the server function, but TypeScript will flag any direct caller. Run `npm run typecheck` and fix any.

- [ ] **Step 7: Lint and typecheck**

Run: `npm run check && npm run typecheck`
Expected: no findings.

- [ ] **Step 8: Commit**

```bash
git add src/server/projects-queries.ts src/server/_internal/projects-queries.ts src/server/__tests__/admin-projects-filter.integration.test.ts
git commit -m "feat: filter admin projects by program"
```

---

## Task 5: Program filter, route and UI

**Files:**

- Modify: `src/routes/_authed/admin/projects/index.tsx`

**Interfaces:**

- Consumes: `listAdminProjects` accepting `program: string | null` (Task 4); `FilterSwitch` (Task 2); `listPrograms` from `#/server/programs`, which returns `{ rows: { id: string; courseId: string; courseName: string }[] }`.
- Produces: nothing consumed by later tasks. This is the last task in the plan.

**Context:** The route's `searchSchema` currently validates only `status` and `includeSoftDeleted`. The public filter bar at `projects-filter-bar.tsx:134-151` is the pattern to copy for the `Select`, including its `_all_` sentinel: Radix `SelectItem` rejects an empty-string value, so "All programs" needs a non-empty sentinel that maps to `null`.

- [ ] **Step 1: Add the search param and thread it to the loader**

In `src/routes/_authed/admin/projects/index.tsx`, replace:

```tsx
const searchSchema = z.object({
  status: z.enum(STATUSES).default("all"),
  includeSoftDeleted: z.boolean().default(false),
});
```

with:

```tsx
const searchSchema = z.object({
  status: z.enum(STATUSES).default("all"),
  includeSoftDeleted: z.boolean().default(false),
  program: z.string().uuid().nullable().default(null),
});
```

Then replace the `loaderDeps` and `loader`:

```tsx
  loaderDeps: ({ search }) => ({
    status: search.status,
    includeSoftDeleted: search.includeSoftDeleted,
  }),
  loader: async ({ deps }) =>
    await listAdminProjects({
      data: {
        status: deps.status,
        includeSoftDeleted: deps.includeSoftDeleted,
      },
    }),
```

with:

```tsx
  loaderDeps: ({ search }) => ({
    status: search.status,
    includeSoftDeleted: search.includeSoftDeleted,
    program: search.program,
  }),
  loader: async ({ deps }) =>
    await listAdminProjects({
      data: {
        status: deps.status,
        includeSoftDeleted: deps.includeSoftDeleted,
        program: deps.program,
      },
    }),
```

- [ ] **Step 2: Load the program list in the component**

Add the imports:

```tsx
import { useEffect, useState } from "react";
import { listPrograms } from "#/server/programs";
```

Inside `function AdminProjects()`, after the existing `useNavigate` call, add:

```tsx
const { program } = Route.useSearch();
const [allPrograms, setAllPrograms] = useState<
  { courseId: string; courseName: string; id: string }[]
>([]);

useEffect(() => {
  void (async () => {
    try {
      const { rows: progs } = await listPrograms();
      setAllPrograms(progs);
    } catch {
      // Filter degrades to "All programs" if the list cannot be loaded.
    }
  })();
}, []);
```

Add `program` to the existing destructure instead of a second `Route.useSearch()` call if one already destructures `status` and `includeSoftDeleted`; the existing line is:

```tsx
const { status, includeSoftDeleted } = Route.useSearch();
```

so change it to:

```tsx
const { status, includeSoftDeleted, program } = Route.useSearch();
```

and do not add a separate `const { program } = Route.useSearch();`.

- [ ] **Step 3: Build the program select**

Still inside `AdminProjects`, next to the existing `softDeleteToggle` definition, add:

```tsx
const programFilter = (
  <Select
    onValueChange={(v) =>
      void navigate({
        to: "/admin/projects",
        search: (prev) => ({ ...prev, program: v === "_all_" ? null : v }),
      })
    }
    value={program ?? "_all_"}
  >
    <SelectTrigger className="w-56" id="admin-filter-program">
      <SelectValue placeholder="All programs" />
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="_all_">All programs</SelectItem>
      {allPrograms.map((p) => (
        <SelectItem key={p.id} value={p.id}>
          {p.courseId} {p.courseName}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
);
```

`_all_` is a sentinel, not a value that reaches the server: it maps to `null` before navigation. An empty string cannot be used because Radix rejects it as a `SelectItem` value.

- [ ] **Step 4: Place it at both breakpoints**

In the mobile block, replace:

```tsx
        {softDeleteToggle}
      </div>
```

with:

```tsx
        {programFilter}
        {softDeleteToggle}
      </div>
```

In the desktop block, replace:

```tsx
<div>{softDeleteToggle}</div>;
```

(which Task 3 left after removing `mb-2`) with:

```tsx
<div className="flex items-end gap-3">
  {programFilter}
  {softDeleteToggle}
</div>;
```

The `items-end` here is what aligns the switch's `h-9` box with the select's trigger.

- [ ] **Step 5: Typecheck and lint**

Run: `npm run typecheck && npm run check`
Expected: no findings.

- [ ] **Step 6: Manual verification**

Run `npm run dev` and sign in as an admin, then confirm:

- Selecting a program on `/admin/projects` narrows the list and writes `?program=<uuid>` to the URL.
- Reloading that URL preserves the selection.
- Changing the status tab keeps the program selection, and toggling soft-deleted keeps both.
- "All programs" clears the param and shows projects that have no program.
- At a narrow viewport the program select stacks under the status select.

- [ ] **Step 7: Run the full suite**

Run: `npm run test && npm run test:integration`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/routes/_authed/admin/projects/index.tsx
git commit -m "feat: add a program filter to the admin projects page"
```

---

## Self-Review

**Spec coverage:**

| Spec section                                                       | Task                         |
| ------------------------------------------------------------------ | ---------------------------- |
| Item 1: list-view thumbnail, fixed 3:2, centered                   | Task 1                       |
| Items 2 and 3: `FilterSwitch` component                            | Task 2                       |
| Items 2 and 3: three call sites converted                          | Task 3                       |
| Item 4: server chain (`adminListSchema`, `listAdminProjectsImpl`)  | Task 4                       |
| Item 4: route `searchSchema`, `loaderDeps`, UI at both breakpoints | Task 5                       |
| Accessibility: explicit `id`/`htmlFor` on the switch               | Task 2, Steps 1 and 3        |
| Testing: `ProjectRow` aspect class, both branches                  | Task 1, Step 1               |
| Testing: `FilterSwitch` accessible name and toggle                 | Task 2, Step 1               |
| Testing: program filter composition and staff gate                 | Task 4, Step 1               |
| Manual smoke checklist                                             | Task 3 Step 6, Task 5 Step 6 |

The spec's Playwright axe checks are covered by the existing `npm run test:accessibility` suite, which runs against these pages unchanged; Task 3's manual step calls out the keyboard and labelling checks explicitly.

**Type consistency:** `FilterSwitch` is defined in Task 2 with `{ checked, id, label, onCheckedChange }` and consumed with exactly those four props in Task 3 (three call sites) and Task 5. `listAdminProjectsAs(viewer, data)` is defined in Task 4 and consumed only by its test and by `listAdminProjectsImpl` in the same file. `AdminProjectsFilter` carries `program: string | null` in Task 4 and the route supplies `program: deps.program` typed `string | null` in Task 5. `Viewer` is the existing module-local type in `projects-queries.ts`.

**Placeholder scan:** none. Every step shows the code it changes, and every command has an expected result.
