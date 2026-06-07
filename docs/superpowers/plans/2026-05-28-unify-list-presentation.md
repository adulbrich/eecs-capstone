# Unify Projects & Inventory List Presentation Implementation Plan

> **Status (verified 2026-06-07):** ✅ **Implemented and shipped, with one deliberate deviation.** The shared card/row presentation, `image-or-fallback`, `projectSummarySelect` projection, embedded add-to-cart, and inventory pagination are all in place. The plan's outer `max-w-7xl` widening (Tasks 8 & 10) was **not** adopted: the project standardized on `max-w-4xl` page wrappers per `AGENTS.md` (Mobile-First Design → Page wrapper padding). Stale `- [ ]` checkboxes below.


> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Projects and Inventory browse pages (plus the project management views) one cohesive card/row presentation, shared layout/width conventions, an image placeholder for inventory, and Projects-style pagination on Inventory.

**Architecture:** Extract a shared `ImageOrFallback`. Add a shared drizzle projection (`projectSummarySelect`) joining `programs` so every project query returns the same summary shape (title, image, status, contactName, updatedAt, program course id/name). Rework `ProjectCard`/`ProjectRow`/`InventoryCard`/`InventoryRow` to one visual spec using semantic tokens. Apply identical inlined layout classes to each route: outer `max-w-7xl`, filter/rows/pagination bounded to `max-w-4xl`, card grid up to `xl:grid-cols-4`.

**Tech Stack:** TanStack Start (React 19), Drizzle ORM, Tailwind v4, shadcn/ui, Vitest + @testing-library/react (jsdom).

---

## File Structure

- `src/components/image-or-fallback.tsx` — **new**, shared image-or-placeholder (moved out of project-card).
- `src/server/_internal/project-summary.ts` — **new**, shared `projectSummarySelect` projection.
- `src/server/_internal/search.ts` — modify `searchProjectsImpl` to use the projection + program join.
- `src/server/_internal/projects-queries.ts` — modify `listMyProjectsImpl`, `listAdminProjectsImpl`.
- `src/server/_internal/bookmarks.ts` — modify `listMyBookmarksForCurrentUser`.
- `src/components/project-card.tsx` — redesign card; owns `ProjectSummary` type + `programLabel` helper.
- `src/components/project-row.tsx` — redesign row.
- `src/components/inventory-card.tsx` — redesign card; narrow item shape; embed Add-to-cart.
- `src/components/inventory-row.tsx` — redesign row; expand props; embed Add-to-cart.
- `src/routes/projects/index.tsx` — layout widths + grid density.
- `src/routes/inventory/index.tsx` — layout widths, pagination, pageSize 20, pass row props.
- `src/routes/_authed/my/bookmarks.tsx`, `src/routes/_authed/my/projects.tsx`, `src/routes/_authed/admin/projects/index.tsx` — adopt layout.
- `src/test/project-card.test.tsx`, `src/test/inventory-card.test.tsx` — **new** component tests.

---

## Task 1: Extract shared `ImageOrFallback`

**Files:**
- Create: `src/components/image-or-fallback.tsx`
- Modify: `src/components/project-card.tsx` (remove local copy, import shared)

- [ ] **Step 1: Create the shared component**

Create `src/components/image-or-fallback.tsx`:

```tsx
import { ImageIcon } from "lucide-react";
import { cn } from "#/lib/utils.ts";

export function ImageOrFallback({
  src,
  className,
}: {
  src: string | null;
  className: string;
}) {
  if (src) {
    return <img src={src} alt="" className={className} loading="lazy" />;
  }
  return (
    <div
      className={cn(className, "flex items-center justify-center")}
      style={{
        background:
          "linear-gradient(135deg, var(--surface-sunken), var(--surface-base))",
      }}
    >
      <ImageIcon
        className="size-8 text-[var(--text-secondary)] opacity-30"
        aria-hidden
      />
    </div>
  );
}
```

- [ ] **Step 2: Remove the local copy from project-card.tsx**

In `src/components/project-card.tsx`, delete the local `ImageOrFallback`
function and its `ImageIcon`/`cn` imports (they move to the new file). Replace
the `export { ImageOrFallback };` line with an import at the top:

```tsx
import { ImageOrFallback } from "./image-or-fallback";
```

(Full project-card rewrite happens in Task 4; this step only needs the file to
keep compiling. If easier, do Step 2 as part of Task 4 — but `project-row.tsx`
imports `ImageOrFallback` from `./project-card`, so update that import in Task 5.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -E "image-or-fallback|project-card|project-row" || echo OK`
Expected: `OK` (no errors in these files).

- [ ] **Step 4: Commit**

```bash
git add src/components/image-or-fallback.tsx src/components/project-card.tsx
git commit -m "refactor(ui): extract shared ImageOrFallback component"
```

---

## Task 2: Shared project summary projection + search query

**Files:**
- Create: `src/server/_internal/project-summary.ts`
- Modify: `src/server/_internal/search.ts`

- [ ] **Step 1: Create the shared projection**

Create `src/server/_internal/project-summary.ts`:

```ts
import { programs, projects } from "#/db/schema";

/**
 * Column projection shared by every query that feeds the project
 * card/row components. Join `programs` via leftJoin before using it so
 * the program columns resolve (null for projects without a program).
 */
export const projectSummarySelect = {
  id: projects.id,
  title: projects.title,
  description: projects.description,
  status: projects.status,
  imageUrl: projects.imageUrl,
  contactName: projects.contactName,
  updatedAt: projects.updatedAt,
  programCourseId: programs.courseId,
  programCourseName: programs.courseName,
};
```

- [ ] **Step 2: Update `searchProjectsImpl`**

In `src/server/_internal/search.ts`, add the import and switch the `rows`
query to the projection with a program join. Replace:

```ts
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "#/db";
import { projectCategories, projects } from "#/db/schema";
import type { SearchProjectsInput } from "../search";
```

with:

```ts
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "#/db";
import { programs, projectCategories, projects } from "#/db/schema";
import type { SearchProjectsInput } from "../search";
import { projectSummarySelect } from "./project-summary";
```

Then replace the `const rows = await db ...` block:

```ts
  const offset = (data.page - 1) * data.pageSize;
  const rows = await db
    .select()
    .from(projects)
    .where(and(...conditions))
    .orderBy(orderBy)
    .limit(data.pageSize)
    .offset(offset);
```

with:

```ts
  const offset = (data.page - 1) * data.pageSize;
  const rows = await db
    .select(projectSummarySelect)
    .from(projects)
    .leftJoin(programs, eq(projects.programId, programs.id))
    .where(and(...conditions))
    .orderBy(orderBy)
    .limit(data.pageSize)
    .offset(offset);
```

(The `count` query is unchanged.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -E "search.ts|project-summary" || echo OK`
Expected: `OK`.

- [ ] **Step 4: Commit**

```bash
git add src/server/_internal/project-summary.ts src/server/_internal/search.ts
git commit -m "feat(projects): add shared project summary projection with program join"
```

---

## Task 3: Apply projection to the other three project queries

**Files:**
- Modify: `src/server/_internal/projects-queries.ts` (`listMyProjectsImpl`, `listAdminProjectsImpl`)
- Modify: `src/server/_internal/bookmarks.ts` (`listMyBookmarksForCurrentUser`)

- [ ] **Step 1: Update `projects-queries.ts` imports**

In `src/server/_internal/projects-queries.ts`, add `programs` to the schema
import and import the projection. Change:

```ts
import {
  projectComments,
  projectEditLog,
  projectStatusHistory,
  projects,
} from "#/db/schema";
```

to:

```ts
import {
  programs,
  projectComments,
  projectEditLog,
  projectStatusHistory,
  projects,
} from "#/db/schema";
```

and add after the visibility imports:

```ts
import { projectSummarySelect } from "./project-summary";
```

- [ ] **Step 2: Update `listMyProjectsImpl`**

Replace its query block:

```ts
  const rows = await db
    .select()
    .from(projects)
    .where(and(...conditions))
    .orderBy(desc(projects.updatedAt));
  return { rows };
```

with:

```ts
  const rows = await db
    .select(projectSummarySelect)
    .from(projects)
    .leftJoin(programs, eq(projects.programId, programs.id))
    .where(and(...conditions))
    .orderBy(desc(projects.updatedAt));
  return { rows };
```

- [ ] **Step 3: Update `listAdminProjectsImpl`**

Replace its query block:

```ts
  const rows = await db
    .select()
    .from(projects)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(projects.updatedAt));
  return { rows };
```

with:

```ts
  const rows = await db
    .select(projectSummarySelect)
    .from(projects)
    .leftJoin(programs, eq(projects.programId, programs.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(projects.updatedAt));
  return { rows };
```

- [ ] **Step 4: Update `listMyBookmarksForCurrentUser`**

In `src/server/_internal/bookmarks.ts`, add `programs` to the schema import,
import the projection, and widen the projection to include the program join +
bookmark timestamp. Replace the select block:

```ts
  const rows = await db
    .select({
      id: projects.id,
      title: projects.title,
      description: projects.description,
      status: projects.status,
      publishedAt: projects.publishedAt,
      proposerId: projects.proposerId,
      bookmarkedAt: projectBookmarks.createdAt,
    })
    .from(projectBookmarks)
    .innerJoin(projects, eq(projectBookmarks.projectId, projects.id))
    .where(
      and(eq(projectBookmarks.userId, viewer.id), isNull(projects.deletedAt)),
    )
    .orderBy(desc(projectBookmarks.createdAt));
  return { rows };
```

with:

```ts
  const rows = await db
    .select({
      ...projectSummarySelect,
      bookmarkedAt: projectBookmarks.createdAt,
    })
    .from(projectBookmarks)
    .innerJoin(projects, eq(projectBookmarks.projectId, projects.id))
    .leftJoin(programs, eq(projects.programId, programs.id))
    .where(
      and(eq(projectBookmarks.userId, viewer.id), isNull(projects.deletedAt)),
    )
    .orderBy(desc(projectBookmarks.createdAt));
  return { rows };
```

Add the imports at the top of the file (alongside existing schema import):
`programs` from `#/db/schema`, and `import { projectSummarySelect } from "./project-summary";`.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -E "projects-queries|bookmarks" || echo OK`
Expected: `OK`. If any consumer referenced a now-dropped field (e.g. a route
using `p.proposerId` from these rows), the error names the file — fix that
usage to rely only on `ProjectSummary` fields, or add the field to the route's
own needs separately.

- [ ] **Step 6: Commit**

```bash
git add src/server/_internal/projects-queries.ts src/server/_internal/bookmarks.ts
git commit -m "feat(projects): return shared summary shape from my/admin/bookmark queries"
```

---

## Task 4: Redesign `ProjectCard` (+ type, helper, test)

**Files:**
- Modify: `src/components/project-card.tsx`
- Test: `src/test/project-card.test.tsx` (new)

- [ ] **Step 1: Write the failing test**

Create `src/test/project-card.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ProjectCard, type ProjectSummary } from "#/components/project-card";

afterEach(cleanup);

const base: ProjectSummary = {
  id: "00000000-0000-0000-0000-000000000001",
  title: "Smart Greenhouse",
  description: "A long description that should be clamped to three lines.",
  status: "published",
  imageUrl: null,
  contactName: "Jane Doe",
  updatedAt: "2026-05-28T00:00:00.000Z",
  programCourseId: "CS-462",
  programCourseName: "Capstone",
};

describe("ProjectCard", () => {
  it("hides the status badge when published", () => {
    const { queryByText } = render(<ProjectCard project={base} />);
    expect(queryByText("published")).toBeNull();
  });

  it("shows the status badge for archived projects", () => {
    const { getByText } = render(
      <ProjectCard project={{ ...base, status: "archived" }} />,
    );
    expect(getByText("archived")).toBeTruthy();
  });

  it("renders program, contact, and updated meta", () => {
    const { getByText } = render(<ProjectCard project={base} />);
    expect(getByText("CS-462 Capstone · Jane Doe")).toBeTruthy();
    expect(getByText(/^Updated /)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/test/project-card.test.tsx`
Expected: FAIL (current card renders `publishedAt`, no program/contact meta, always-on badge).

- [ ] **Step 3: Rewrite `project-card.tsx`**

Replace the entire file with:

```tsx
import { Link } from "@tanstack/react-router";
import { getPublicUrl } from "#/lib/storage";
import { ImageOrFallback } from "./image-or-fallback";
import { StatusBadge } from "./status-badge";

type ProjectSummary = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  imageUrl?: string | null;
  contactName?: string | null;
  updatedAt?: Date | string | null;
  programCourseId?: string | null;
  programCourseName?: string | null;
};

function programLabel(project: ProjectSummary): string | null {
  const parts = [project.programCourseId, project.programCourseName].filter(
    Boolean,
  ) as string[];
  return parts.length > 0 ? parts.join(" ") : null;
}

function ProjectMeta({ project }: { project: ProjectSummary }) {
  const meta = [programLabel(project), project.contactName].filter(
    Boolean,
  ) as string[];
  return (
    <div className="mt-2">
      {meta.length > 0 && (
        <p className="text-xs text-muted-foreground">{meta.join(" · ")}</p>
      )}
      {project.updatedAt && (
        <p className="mt-0.5 text-xs text-muted-foreground">
          Updated {new Date(project.updatedAt).toLocaleDateString()}
        </p>
      )}
    </div>
  );
}

export function ProjectCard({ project }: { project: ProjectSummary }) {
  const src = getPublicUrl(project.imageUrl);
  return (
    <Link
      to="/projects/$projectId"
      params={{ projectId: project.id }}
      className="flex flex-col overflow-hidden rounded-lg border border-border bg-card transition-colors hover:border-primary"
    >
      <ImageOrFallback src={src} className="aspect-[16/9] w-full object-cover" />
      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-semibold leading-tight">{project.title}</h3>
          {project.status !== "published" && (
            <StatusBadge status={project.status} />
          )}
        </div>
        {project.description && (
          <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">
            {project.description}
          </p>
        )}
        <ProjectMeta project={project} />
      </div>
    </Link>
  );
}

export { programLabel, ProjectMeta };
export type { ProjectSummary };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/test/project-card.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/project-card.tsx src/test/project-card.test.tsx
git commit -m "feat(projects): redesign ProjectCard with image, meta, archived-only badge"
```

---

## Task 5: Redesign `ProjectRow`

**Files:**
- Modify: `src/components/project-row.tsx`

- [ ] **Step 1: Rewrite `project-row.tsx`**

Replace the entire file with:

```tsx
import { Link } from "@tanstack/react-router";
import { getPublicUrl } from "#/lib/storage";
import { ImageOrFallback } from "./image-or-fallback";
import { programLabel, type ProjectSummary } from "./project-card";
import { StatusBadge } from "./status-badge";

export function ProjectRow({ project }: { project: ProjectSummary }) {
  const src = getPublicUrl(project.imageUrl);
  const meta = [programLabel(project), project.contactName].filter(
    Boolean,
  ) as string[];
  return (
    <Link
      to="/projects/$projectId"
      params={{ projectId: project.id }}
      className="flex items-stretch gap-3 overflow-hidden rounded-lg border border-border bg-card transition-colors hover:border-primary"
    >
      <ImageOrFallback
        src={src}
        className="h-24 w-32 shrink-0 object-cover"
      />
      <div className="min-w-0 flex-1 py-3 pr-3">
        <div className="flex items-start justify-between gap-3">
          <h3 className="truncate text-sm font-semibold">{project.title}</h3>
          {project.status !== "published" && (
            <StatusBadge status={project.status} />
          )}
        </div>
        {project.description && (
          <p className="mt-1 line-clamp-3 text-sm text-muted-foreground">
            {project.description}
          </p>
        )}
        {meta.length > 0 && (
          <p className="mt-1 text-xs text-muted-foreground">
            {meta.join(" · ")}
          </p>
        )}
        {project.updatedAt && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            Updated {new Date(project.updatedAt).toLocaleDateString()}
          </p>
        )}
      </div>
    </Link>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep "project-row" || echo OK`
Expected: `OK`.

- [ ] **Step 3: Commit**

```bash
git add src/components/project-row.tsx
git commit -m "feat(projects): redesign ProjectRow with thumbnail and shared meta"
```

---

## Task 6: Redesign `InventoryCard` (+ test)

**Files:**
- Modify: `src/components/inventory-card.tsx`
- Test: `src/test/inventory-card.test.tsx` (new)

- [ ] **Step 1: Write the failing test**

Create `src/test/inventory-card.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InventoryCard } from "#/components/inventory-card";

afterEach(cleanup);

const item = {
  id: "00000000-0000-0000-0000-000000000001",
  name: "Arduino Uno",
  description: "Microcontroller board for prototyping.",
  imageUrl: null,
  status: "available" as const,
};

describe("InventoryCard", () => {
  it("renders name, description, and status", () => {
    const { getByText } = render(
      <InventoryCard item={item} signedIn={false} />,
    );
    expect(getByText("Arduino Uno")).toBeTruthy();
    expect(getByText("Microcontroller board for prototyping.")).toBeTruthy();
    expect(getByText("Available")).toBeTruthy();
  });

  it("shows Add to cart only when signed in and available", () => {
    const onAddToCart = vi.fn();
    const { getByText, queryByText, rerender } = render(
      <InventoryCard item={item} signedIn onAddToCart={onAddToCart} />,
    );
    expect(getByText("Add to cart")).toBeTruthy();
    rerender(
      <InventoryCard
        item={{ ...item, status: "reserved" }}
        signedIn
        onAddToCart={onAddToCart}
      />,
    );
    expect(queryByText("Add to cart")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/test/inventory-card.test.tsx`
Expected: FAIL (current card doesn't render description; Add-to-cart sits outside and props differ).

- [ ] **Step 3: Rewrite `inventory-card.tsx`**

Replace the entire file with:

```tsx
import { Link } from "@tanstack/react-router";
import { getPublicUrl } from "#/lib/storage";
import { ImageOrFallback } from "./image-or-fallback";
import { InventoryStatusBadge } from "./inventory-status-badge";
import { Button } from "./ui/button";

type Props = {
  item: {
    id: string;
    name: string;
    description: string | null;
    imageUrl: string | null;
    status:
      | "available"
      | "requested"
      | "reserved"
      | "checked_out"
      | "maintenance";
  };
  signedIn: boolean;
  onAddToCart?: (itemId: string) => void;
};

export function InventoryCard({ item, signedIn, onAddToCart }: Props) {
  const src = getPublicUrl(item.imageUrl);
  const canAdd = signedIn && item.status === "available" && !!onAddToCart;
  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-border bg-card transition-colors hover:border-primary">
      <Link
        to="/inventory/$itemId"
        params={{ itemId: item.id }}
        className="flex flex-1 flex-col"
      >
        <ImageOrFallback
          src={src}
          className="aspect-[16/9] w-full object-cover"
        />
        <div className="flex flex-1 flex-col p-4">
          <h3 className="font-semibold leading-tight">{item.name}</h3>
          {item.description && (
            <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">
              {item.description}
            </p>
          )}
          <div className="mt-2">
            <InventoryStatusBadge status={item.status} />
          </div>
        </div>
      </Link>
      {canAdd && (
        <div className="p-4 pt-0">
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => onAddToCart?.(item.id)}
          >
            Add to cart
          </Button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/test/inventory-card.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/inventory-card.tsx src/test/inventory-card.test.tsx
git commit -m "feat(inventory): redesign InventoryCard with description, image, embedded add-to-cart"
```

---

## Task 7: Redesign `InventoryRow`

**Files:**
- Modify: `src/components/inventory-row.tsx`

- [ ] **Step 1: Rewrite `inventory-row.tsx`**

Replace the entire file with:

```tsx
import { Link } from "@tanstack/react-router";
import { getPublicUrl } from "#/lib/storage";
import { ImageOrFallback } from "./image-or-fallback";
import { InventoryStatusBadge } from "./inventory-status-badge";
import { Button } from "./ui/button";

type Props = {
  item: {
    id: string;
    name: string;
    description: string | null;
    imageUrl: string | null;
    status:
      | "available"
      | "requested"
      | "reserved"
      | "checked_out"
      | "maintenance";
  };
  signedIn: boolean;
  onAddToCart?: (itemId: string) => void;
};

export function InventoryRow({ item, signedIn, onAddToCart }: Props) {
  const src = getPublicUrl(item.imageUrl);
  const canAdd = signedIn && item.status === "available" && !!onAddToCart;
  return (
    <div className="flex items-stretch gap-3 overflow-hidden rounded-lg border border-border bg-card transition-colors hover:border-primary">
      <Link
        to="/inventory/$itemId"
        params={{ itemId: item.id }}
        className="flex min-w-0 flex-1 items-stretch gap-3"
      >
        <ImageOrFallback
          src={src}
          className="h-24 w-32 shrink-0 object-cover"
        />
        <div className="min-w-0 flex-1 py-3">
          <h3 className="truncate text-sm font-semibold">{item.name}</h3>
          {item.description && (
            <p className="mt-1 line-clamp-3 text-sm text-muted-foreground">
              {item.description}
            </p>
          )}
          <div className="mt-1">
            <InventoryStatusBadge status={item.status} />
          </div>
        </div>
      </Link>
      {canAdd && (
        <div className="flex shrink-0 items-center pr-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onAddToCart?.(item.id)}
          >
            Add to cart
          </Button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep "inventory-row" || echo OK`
Expected: `OK` (the `/inventory` route still passes the old props — Task 9 fixes the route; a transient error there is fine until Task 9).

- [ ] **Step 3: Commit**

```bash
git add src/components/inventory-row.tsx
git commit -m "feat(inventory): redesign InventoryRow with thumbnail, description, embedded add-to-cart"
```

---

## Task 8: Projects page layout & grid density

**Files:**
- Modify: `src/routes/projects/index.tsx`

- [ ] **Step 1: Widen the container and bound the sub-sections**

In `src/routes/projects/index.tsx`, change the outer wrapper from
`max-w-3xl` to `max-w-7xl`, wrap the filter bar in a bounded div, widen the
card grid, and bound the row list + pagination. Replace the `return (...)`
body of `ProjectsList`:

```tsx
  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:p-8">
      <h1 className="text-2xl font-semibold">Projects</h1>
      <div className="mt-4">
        <ProjectsFilterBar
          q={search.q}
          categories={search.categories}
          program={search.program}
          archivedOnly={search.archivedOnly}
          view={search.view}
        />
      </div>
      <div
        className={
          search.view === "card"
            ? "mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3"
            : "mt-6 space-y-2"
        }
      >
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No projects matched your search.
          </p>
        ) : (
          rows.map((p) => (
            <ProjectListItem key={p.id} project={p} mode={search.view} />
          ))
        )}
      </div>
      <div className="mt-6 flex items-center justify-between text-sm">
```

with:

```tsx
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 md:p-8">
      <h1 className="text-2xl font-semibold">Projects</h1>
      <div className="mt-4 max-w-4xl">
        <ProjectsFilterBar
          q={search.q}
          categories={search.categories}
          program={search.program}
          archivedOnly={search.archivedOnly}
          view={search.view}
        />
      </div>
      <div
        className={
          search.view === "card"
            ? "mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
            : "mt-6 flex max-w-4xl flex-col gap-3"
        }
      >
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No projects matched your search.
          </p>
        ) : (
          rows.map((p) => (
            <ProjectListItem key={p.id} project={p} mode={search.view} />
          ))
        )}
      </div>
      <div className="mt-6 flex max-w-4xl items-center justify-between text-sm">
```

(Only the three className strings and the wrapping `max-w-4xl` div change; the
pagination links inside are unchanged.)

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep "routes/projects/index" || echo OK`
Expected: `OK`.

- [ ] **Step 3: Commit**

```bash
git add src/routes/projects/index.tsx
git commit -m "feat(projects): widen browse layout, bound filter/rows, denser card grid"
```

---

## Task 9: Inventory page layout, pagination, row props

**Files:**
- Modify: `src/routes/inventory/index.tsx`

- [ ] **Step 1: Align pageSize to 20**

In the loader's `listInventory` call, change `pageSize: 24` to `pageSize: 20`.

- [ ] **Step 2: Rewrite the component body**

Replace the `InventoryIndex` component's `return (...)` with the widened
layout, unified row props, and pagination. Use this body (keeping the existing
`search`, `navigate`, `qc`, `session`, `data` declarations above it):

```tsx
  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const signedIn = !!session?.user;
  async function addItem(itemId: string) {
    await addToCart({ data: { itemId } });
    await qc.invalidateQueries();
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 md:p-8">
      <h1 className="text-2xl font-semibold">Inventory</h1>
      <div className="mt-4 max-w-4xl">
        <InventoryFilterBar
          q={search.q}
          status={search.status}
          category={search.category}
          view={search.view}
          categories={data.categories}
          onQChange={(q) => navigate({ search: (s) => ({ ...s, q, page: 1 }) })}
          onStatusChange={(status) =>
            navigate({ search: (s) => ({ ...s, status, page: 1 }) })
          }
          onCategoryChange={(category) =>
            navigate({ search: (s) => ({ ...s, category, page: 1 }) })
          }
          onViewChange={(view) => navigate({ search: (s) => ({ ...s, view }) })}
        />
      </div>
      {data.rows.length === 0 ? (
        <p className="mt-8 text-center text-muted-foreground">No items match.</p>
      ) : search.view === "row" ? (
        <div className="mt-6 flex max-w-4xl flex-col gap-3">
          {data.rows.map((it) => (
            <InventoryRow
              key={it.id}
              item={{ ...it, status: it.status as PublicStatus }}
              signedIn={signedIn}
              onAddToCart={addItem}
            />
          ))}
        </div>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {data.rows.map((it) => (
            <InventoryCard
              key={it.id}
              item={{ ...it, status: it.status as PublicStatus }}
              signedIn={signedIn}
              onAddToCart={addItem}
            />
          ))}
        </div>
      )}
      <div className="mt-6 flex max-w-4xl items-center justify-between text-sm">
        <button
          type="button"
          onClick={() =>
            navigate({ search: (s) => ({ ...s, page: Math.max(1, s.page - 1) }) })
          }
          disabled={data.page <= 1}
          className={
            data.page <= 1
              ? "pointer-events-none text-muted-foreground/40"
              : "hover:underline"
          }
        >
          Previous
        </button>
        <span className="text-muted-foreground">
          Page {data.page} of {totalPages}
        </span>
        <button
          type="button"
          onClick={() =>
            navigate({
              search: (s) => ({ ...s, page: Math.min(totalPages, s.page + 1) }),
            })
          }
          disabled={data.page >= totalPages}
          className={
            data.page >= totalPages
              ? "pointer-events-none text-muted-foreground/40"
              : "hover:underline"
          }
        >
          Next
        </button>
      </div>
    </div>
  );
```

Note: `data` now has `total`, `page`, `pageSize` (from `listInventory`) plus
`categories` (from the loader spread). The previous inline add-to-cart for the
card view is replaced by the shared `addItem`.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -E "routes/inventory/index|inventory-row|inventory-card" || echo OK`
Expected: `OK`.

- [ ] **Step 4: Run the inventory filter-bar test (regression)**

Run: `npx vitest run src/test/inventory-filter-bar.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/routes/inventory/index.tsx
git commit -m "feat(inventory): widen layout, add pagination, unify card/row props"
```

---

## Task 10: Adopt layout in management views

**Files:**
- Modify: `src/routes/_authed/my/bookmarks.tsx`
- Modify: `src/routes/_authed/my/projects.tsx`
- Modify: `src/routes/_authed/admin/projects/index.tsx`

- [ ] **Step 1: `my/bookmarks.tsx` — widen + card grid**

Change the outer wrapper `max-w-3xl` → `max-w-7xl`. Wrap the bookmarks grid in
the card-view grid classes. Replace the list container that currently renders
`rows.map((p) => <ProjectCard key={p.id} project={p} />)` so the cards sit in:

```tsx
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No bookmarks yet. Browse <Link to="/projects">projects</Link> and
            click the bookmark icon to save one.
          </p>
        ) : (
          rows.map((p) => <ProjectCard key={p.id} project={p} />)
        )}
      </div>
```

(Match the existing empty-state text already in the file; only the wrapper
classes and grid change. If the empty-state `<p>` should not sit inside a grid
cell, keep it outside the grid as the file currently structures it — preserve
existing conditional structure, just apply `max-w-7xl` to the page and the grid
classes to the cards container.)

- [ ] **Step 2: `my/projects.tsx` — widen + bounded rows**

Change the outer wrapper `max-w-3xl` → `max-w-7xl`. Keep the status-tab
controls as-is but ensure they sit in a `max-w-4xl` wrapper. Change the row
list container that renders `rows.map((p) => <ProjectRow key={p.id} project={p} />)`
to:

```tsx
      <div className="mt-6 flex max-w-4xl flex-col gap-3">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No projects in this view.
          </p>
        ) : (
          rows.map((p) => <ProjectRow key={p.id} project={p} />)
        )}
      </div>
```

Wrap the existing status-filter controls block in `<div className="max-w-4xl">...</div>`
(or add `max-w-4xl` to its existing wrapper) so controls align with the rows.

- [ ] **Step 3: `admin/projects/index.tsx` — widen + bounded rows**

Change the outer wrapper `max-w-4xl` → `max-w-7xl`. Wrap the status controls in
`max-w-4xl`. Change the row list container that renders
`rows.map((p) => <ProjectRow key={p.id} project={p} />)` to:

```tsx
      <div className="mt-6 flex max-w-4xl flex-col gap-3">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No projects in this view.
          </p>
        ) : (
          rows.map((p) => <ProjectRow key={p.id} project={p} />)
        )}
      </div>
```

(Preserve the existing breadcrumb/header/pagination markup; only widen the page,
bound the controls, and replace the row-list container classes.)

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -E "my/bookmarks|my/projects|admin/projects/index" || echo OK`
Expected: `OK`.

- [ ] **Step 5: Commit**

```bash
git add src/routes/_authed/my/bookmarks.tsx src/routes/_authed/my/projects.tsx src/routes/_authed/admin/projects/index.tsx
git commit -m "feat(projects): adopt unified list layout in my/admin views"
```

---

## Task 11: Full verification & cleanup

**Files:** none (verification only)

- [ ] **Step 1: Lint/format changed files**

Run: `npx biome check --write $(git diff --name-only HEAD~9; git ls-files --others --exclude-standard | grep -vE '\.playwright-mcp')`
Then re-run `npx biome check` on the same set; expected: no new errors (pre-existing `noNonNullAssertion` warnings in `_internal/inventory.ts` are acceptable).

- [ ] **Step 2: Full type check**

Run: `npx tsc --noEmit 2>&1 | grep -E "image-or-fallback|project-summary|project-card|project-row|inventory-card|inventory-row|routes/projects|routes/inventory|my/bookmarks|my/projects|admin/projects/index|search.ts|projects-queries|bookmarks.ts" || echo "OK - no errors in touched files"`
Expected: `OK - no errors in touched files`.

- [ ] **Step 3: Full unit test suite**

Run: `npm test`
Expected: all tests pass (including the new `project-card` and `inventory-card` tests). Fix any breakage before continuing.

- [ ] **Step 4: Visual verification (dev server on :3000)**

With the dev server running on `http://localhost:3000`, signed in as the seed
admin (`admin@example.com` / `password`), verify with Playwright:
- `/projects` card view: wide 7xl grid, filter box bounded, cards show image/placeholder, title, 3-line description, program · contact, Updated date; published projects show no badge.
- `/projects` row view (`?view=row`): rows bounded to filter width, thumbnail left.
- `/inventory` card view: cards show image/placeholder, name, 3-line description, status, embedded Add to cart (when signed in); pagination controls present.
- `/inventory` row view: thumbnail left, embedded Add to cart.
- `/my/bookmarks`, `/my/projects`, `/admin/projects`: consistent widths and card/row styling; management views show real status badges.
Take screenshots and confirm each.

- [ ] **Step 5: Final commit (if lint/format produced changes)**

```bash
git add -A -- . ':!README.md' ':!.playwright-mcp'
git commit -m "chore: lint/format unified list presentation"
```

---

## Self-Review notes

- **Spec coverage:** inventory placeholder (Task 1 shared component, Tasks 6/7
  use it), card/row content for projects (Tasks 4/5) and inventory (Tasks 6/7),
  styling consistency (semantic tokens across Tasks 4–7), width behavior
  (Tasks 8–10), inventory pagination + pageSize (Task 9), management-view
  adoption (Task 10), program/contact/updated data wiring (Tasks 2/3). All
  covered.
- **Status-badge rule:** `status !== "published"` implemented identically in
  ProjectCard and ProjectRow (Tasks 4/5).
- **Type consistency:** `ProjectSummary` (optional `contactName`, `updatedAt`,
  `programCourseId`, `programCourseName`) defined in Task 4 and consumed in
  Task 5; `projectSummarySelect` field names match those properties exactly
  (Task 2). Inventory `item` shape identical in Card (Task 6) and Row (Task 7).
- **No placeholders:** every code step contains full code.
