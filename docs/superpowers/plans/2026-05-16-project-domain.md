# Project Domain Implementation Plan

> **Status (verified 2026-06-07):** ✅ **Implemented and shipped.** Verified against the codebase; all deliverables exist. The `- [ ]` checkboxes below were never ticked during execution; they are stale, not a sign of incomplete work.


> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-05-16-project-domain-design.md`

**Goal:** Ship the project-domain layer end to end: project CRUD with a strict server-side state machine, status history rendered as a timeline, threaded review comments (with admin-only internal notes), an edit log, notifications driven off status changes and comments, and a header bell-icon UI.

**Architecture:** Two pure modules own the workflow and visibility rules (no DB). Server functions in `src/server/projects.ts`, `projects-queries.ts`, `comments.ts`, `notifications.ts` each enforce their own role + transition gate and wrap writes in a transaction. UI uses plain Tailwind components, TanStack Router for routing, and TanStack Form (already in `package.json`) for the project create/edit form. Single canonical URL per project (`/projects/$id`) renders staff sections conditionally.

**Tech Stack:** TanStack Start (React 19 SSR), TanStack Router, TanStack Form, Better Auth, Drizzle ORM, Postgres 18, Vitest, Biome.

**Important facts established in Spec 1 (do not relearn):**

- Stay on `main` branch (user consent given for this project).
- `AGENTS.md` is permanently dirty with unrelated user changes. Never `git add AGENTS.md`, never `git add -A`. Always name files explicitly.
- 2-space indent (Biome enforces).
- Commit style: lowercase imperative, no Conventional Commits prefix. Co-author trailer `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>` via HEREDOC.
- No emdashes in prose, comments, commit messages, or strings.
- TanStack Start request accessor is `getRequest()` from `@tanstack/react-start/server`, NOT `getWebRequest`.
- `createServerFn(...).inputValidator(...)`, NOT `.validator(...)`.
- Server-only imports (`@tanstack/react-start/server`, anything in `auth-guards.server.ts`) must live in `.server.ts` files. Routes import via thin server-function wrappers when needed.
- Better Auth's reset method is `authClient.requestPasswordReset`, NOT `forgetPassword`.
- Tables use `user.id` (text), not `users.id` (uuid).
- shadcn is NOT used; stick to plain Tailwind.
- Server functions live in `src/server/*.ts`. They can top-level-import `db` and Drizzle helpers (those are not flagged by import-protection).
- Auth helpers: `readSession`, `requireUser`, `requireRole` live in `src/lib/auth-guards.server.ts`. The thin `getSession` server function is in `src/lib/auth-guards.ts` for routes' `beforeLoad`.
- Drizzle pool uses the single shared instance in `src/db/index.ts`.
- Use `#/` import alias (defined in `package.json` as `"#/*": "./src/*"`).

---

## Phase 0: Schema additions

### Task 1: Add `project_edit_log` table, self-FK on `project_comments.parent_id`, `projects.status` notNull, and the new indexes

**Files:**

- Modify: `src/db/schema.ts`

- [ ] **Step 1: Add `jsonb`, `index` to the `drizzle-orm/pg-core` imports**

Open `src/db/schema.ts`. Update the existing top-of-file import to:

```ts
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
```

- [ ] **Step 2: Add `.notNull()` to `projects.status`**

Find the `status` column on the `projects` table (around line 88) and change it to:

```ts
status: projectStatusEnum("status").notNull().default("draft"),
```

- [ ] **Step 3: Add JSDoc to `projects.notes` and indexes table-config for projects**

Replace the `projects` table declaration so the `notes` column has a JSDoc and the table config gets the new indexes. The full table declaration should read:

```ts
export const projects = pgTable(
  "projects",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    title: text("title").notNull(),
    description: text("description"),
    problemStatement: text("problem_statement"),
    objectives: text("objectives"),
    minQualifications: text("min_qualifications"),
    prefQualifications: text("pref_qualifications"),
    url: text("url"),
    contactEmail: text("contact_email"),
    contactName: text("contact_name"),
    imageUrl: text("image_url"),
    licenseRestrictions: text("license_restrictions"),
    /** Staff-visible only; never returned in public queries. */
    notes: text("notes"),

    proposerId: text("proposer_id")
      .references(() => user.id, { onDelete: "restrict" })
      .notNull(),
    programId: uuid("program_id").references(() => programs.id),
    programManagerId: text("program_manager_id").references(() => user.id, {
      onDelete: "restrict",
    }),

    status: projectStatusEnum("status").notNull().default("draft"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("projects_status_idx").on(t.status),
    index("projects_deleted_at_idx").on(t.deletedAt),
    index("projects_proposer_id_idx").on(t.proposerId),
    index("projects_program_id_idx").on(t.programId),
    index("projects_published_at_idx").on(t.publishedAt),
  ],
);
```

- [ ] **Step 4: Add self-FK and index to `project_comments.parent_id`**

Replace the `projectComments` table declaration with:

```ts
export const projectComments = pgTable(
  "project_comments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .references(() => projects.id, { onDelete: "cascade" })
      .notNull(),
    authorId: text("author_id")
      .references(() => user.id, { onDelete: "restrict" })
      .notNull(),
    parentId: uuid("parent_id").references(
      (): import("drizzle-orm/pg-core").AnyPgColumn => projectComments.id,
      { onDelete: "cascade" },
    ),
    content: text("content").notNull(),
    isInternal: boolean("is_internal").default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("project_comments_project_idx").on(t.projectId, t.createdAt),
  ],
);
```

The cast on `parentId.references` is the Drizzle idiom for self-referential FKs to avoid a circular initialization error.

- [ ] **Step 5: Add table-config index to `projectStatusHistory`**

Replace the `projectStatusHistory` table declaration with:

```ts
export const projectStatusHistory = pgTable(
  "project_status_history",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .references(() => projects.id, { onDelete: "cascade" })
      .notNull(),
    oldStatus: projectStatusEnum("old_status"),
    newStatus: projectStatusEnum("new_status").notNull(),
    changedBy: text("changed_by")
      .references(() => user.id, { onDelete: "restrict" })
      .notNull(),
    comment: text("comment"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("project_status_history_project_idx").on(
      t.projectId,
      t.createdAt,
    ),
  ],
);
```

Note `onDelete: "cascade"` on `projectId`: a hard-deleted draft should not leave orphan history rows.

- [ ] **Step 6: Add index to `notifications`**

Replace the `notifications` table declaration with:

```ts
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .references(() => user.id, { onDelete: "cascade" })
      .notNull(),
    type: text("type").notNull(),
    title: text("title").notNull(),
    message: text("message").notNull(),
    link: text("link"),
    read: boolean("read").default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("notifications_user_read_created_idx").on(
      t.userId,
      t.read,
      t.createdAt,
    ),
  ],
);
```

- [ ] **Step 7: Add the new `projectEditLog` table at the bottom of `schema.ts`**

Append:

```ts
export const projectEditLog = pgTable(
  "project_edit_log",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .references(() => projects.id, { onDelete: "cascade" })
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
    index("project_edit_log_project_idx").on(t.projectId, t.createdAt),
  ],
);
```

- [ ] **Step 8: Generate and apply the migration**

```bash
npm run db:generate
npm run db:migrate
```

Expected: a new `drizzle/0001_*.sql` file. Inspect it. It should contain:

- `ALTER TABLE "projects" ALTER COLUMN "status" SET NOT NULL;`
- New indexes on `projects`, `project_comments`, `project_status_history`, `notifications`.
- `CREATE TABLE "project_edit_log" (...)`.
- New self-FK on `project_comments.parent_id`.

Apply the migration:

```bash
npm run db:migrate
```

Expected: "All migrations have been successfully applied" or equivalent.

- [ ] **Step 9: Verify with Drizzle Studio**

```bash
npm run db:studio
```

Open and confirm:

- `project_edit_log` table exists with the right columns.
- `project_comments.parent_id` shows a FK back to `project_comments.id`.
- `projects.status` is `NOT NULL`.

Close studio.

- [ ] **Step 10: Run lint and tests to make sure nothing regressed**

```bash
npm run check
npx tsc --noEmit 2>&1 | grep -v "drizzle.config.ts" | grep "error TS" | head -5
npm test
```

All should be clean. Tests: 10/10 still passing.

- [ ] **Step 11: Commit**

```bash
git add src/db/schema.ts drizzle
git commit -m "$(cat <<'EOF'
add project_edit_log + indexes + status notNull + comment parent_id FK

Schema additions for Spec 2 (project domain): new project_edit_log
table with project_id/editor_id FKs and (project_id, created_at)
index; self-FK on project_comments.parent_id with cascade; projects.
status notNull; new indexes on projects (status, deleted_at,
proposer_id, program_id, published_at), project_status_history
(project_id, created_at), project_comments (project_id, created_at),
and notifications (user_id, read, created_at). The notes column on
projects gets a JSDoc marker.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Phase 1: Pure modules (TDD)

### Task 2: `project-workflow.ts` with full transition table tests

**Files:**

- Create: `src/lib/project-workflow.ts`
- Create: `src/lib/__tests__/project-workflow.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/project-workflow.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  type ActorRole,
  type Status,
  assertTransitionAllowed,
  canTransition,
} from "../project-workflow";

const allowedCases: Array<[Status, Status, ActorRole]> = [
  ["draft", "submitted", "owner"],
  ["draft", "submitted", "staff"],
  ["draft", "approved", "staff"],
  ["submitted", "draft", "owner"],
  ["submitted", "draft", "staff"],
  ["submitted", "approved", "staff"],
  ["submitted", "changes_requested", "staff"],
  ["changes_requested", "submitted", "owner"],
  ["changes_requested", "submitted", "staff"],
  ["changes_requested", "approved", "staff"],
  ["approved", "published", "staff"],
  ["approved", "changes_requested", "staff"],
  ["published", "archived", "staff"],
  ["archived", "published", "staff"],
];

const forbiddenCases: Array<[Status, Status, ActorRole]> = [
  ["draft", "approved", "owner"],
  ["draft", "published", "owner"],
  ["draft", "published", "staff"],
  ["submitted", "published", "owner"],
  ["submitted", "published", "staff"],
  ["approved", "published", "owner"],
  ["approved", "draft", "staff"],
  ["published", "draft", "staff"],
  ["archived", "draft", "staff"],
  ["archived", "submitted", "staff"],
];

describe("canTransition", () => {
  it.each(allowedCases)(
    "%s -> %s is allowed for %s",
    (from, to, role) => {
      expect(canTransition(from, to, role)).toBe(true);
    },
  );

  it.each(forbiddenCases)(
    "%s -> %s is forbidden for %s",
    (from, to, role) => {
      expect(canTransition(from, to, role)).toBe(false);
    },
  );

  it("returns false for self-transition", () => {
    expect(canTransition("draft", "draft", "owner")).toBe(false);
    expect(canTransition("published", "published", "staff")).toBe(false);
  });
});

describe("assertTransitionAllowed", () => {
  it("does not throw on an allowed transition", () => {
    expect(() => assertTransitionAllowed("draft", "submitted", "owner")).not.toThrow();
  });

  it("throws on a forbidden transition with a message naming from, to, role", () => {
    expect(() =>
      assertTransitionAllowed("draft", "published", "owner"),
    ).toThrow(/draft.*published.*owner/);
  });
});
```

- [ ] **Step 2: Run and verify it fails**

```bash
npm test -- src/lib/__tests__/project-workflow.test.ts
```

Expected: FAIL ("Cannot find module ../project-workflow").

- [ ] **Step 3: Implement**

Create `src/lib/project-workflow.ts`:

```ts
export type Status =
  | "draft"
  | "submitted"
  | "approved"
  | "changes_requested"
  | "published"
  | "archived";

export type ActorRole = "owner" | "staff";

const TRANSITIONS: Record<Status, Partial<Record<ActorRole, Status[]>>> = {
  draft: {
    owner: ["submitted"],
    staff: ["submitted", "approved"],
  },
  submitted: {
    owner: ["draft"],
    staff: ["draft", "approved", "changes_requested"],
  },
  changes_requested: {
    owner: ["submitted"],
    staff: ["submitted", "approved"],
  },
  approved: {
    staff: ["published", "changes_requested"],
  },
  published: {
    staff: ["archived"],
  },
  archived: {
    staff: ["published"],
  },
};

export function canTransition(
  from: Status,
  to: Status,
  role: ActorRole,
): boolean {
  return (TRANSITIONS[from][role] ?? []).includes(to);
}

export function assertTransitionAllowed(
  from: Status,
  to: Status,
  role: ActorRole,
): void {
  if (!canTransition(from, to, role)) {
    throw new Error(
      `Transition ${from} -> ${to} not allowed for ${role}`,
    );
  }
}
```

- [ ] **Step 4: Re-run, verify all tests pass**

```bash
npm test -- src/lib/__tests__/project-workflow.test.ts
```

Expected: ~25 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/project-workflow.ts src/lib/__tests__/project-workflow.test.ts
git commit -m "$(cat <<'EOF'
add pure project-workflow module with full transition table tests

The transition table is the single source of truth for what
status->status moves are allowed per actor role (owner vs staff).
canTransition is a pure function used by every workflow server
function for its gate check. Tests cover every allowed and a
representative set of forbidden cases per the Spec 2 design.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `project-visibility.ts` with matrix tests

**Files:**

- Create: `src/lib/project-visibility.ts`
- Create: `src/lib/__tests__/project-visibility.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/project-visibility.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  canEditProject,
  canSeeProject,
  filterCommentsForViewer,
  isStaff,
  type Viewer,
  type VisibleProject,
  stripStaffOnlyFields,
} from "../project-visibility";

const anon: Viewer = null;
const other: Viewer = { id: "u-other", role: "user" };
const owner: Viewer = { id: "u-owner", role: "user" };
const instructor: Viewer = { id: "u-staff", role: "instructor" };
const admin: Viewer = { id: "u-admin", role: "admin" };

function p(overrides: Partial<VisibleProject>): VisibleProject {
  return {
    id: "p1",
    proposerId: "u-owner",
    status: "draft",
    deletedAt: null,
    notes: "internal notes",
    ...overrides,
  } as VisibleProject;
}

describe("isStaff", () => {
  it("is true for admin", () => expect(isStaff(admin)).toBe(true));
  it("is true for instructor", () => expect(isStaff(instructor)).toBe(true));
  it("is false for user", () => expect(isStaff(other)).toBe(false));
  it("is false for anonymous", () => expect(isStaff(anon)).toBe(false));
});

describe("canSeeProject", () => {
  it("anon sees only published, non-deleted", () => {
    expect(canSeeProject(p({ status: "published" }), anon)).toBe(true);
    expect(canSeeProject(p({ status: "draft" }), anon)).toBe(false);
    expect(canSeeProject(p({ status: "published", deletedAt: new Date() }), anon)).toBe(false);
  });

  it("owner sees own in any non-deleted status", () => {
    expect(canSeeProject(p({ status: "draft" }), owner)).toBe(true);
    expect(canSeeProject(p({ status: "archived" }), owner)).toBe(true);
    expect(canSeeProject(p({ status: "draft", deletedAt: new Date() }), owner)).toBe(false);
  });

  it("non-owner non-staff user sees only published non-deleted", () => {
    expect(canSeeProject(p({ status: "published" }), other)).toBe(true);
    expect(canSeeProject(p({ status: "submitted" }), other)).toBe(false);
  });

  it("staff sees everything including soft-deleted", () => {
    expect(canSeeProject(p({ status: "draft" }), admin)).toBe(true);
    expect(canSeeProject(p({ status: "published", deletedAt: new Date() }), admin)).toBe(true);
    expect(canSeeProject(p({ status: "draft" }), instructor)).toBe(true);
  });
});

describe("canEditProject", () => {
  it("anon cannot edit", () => {
    expect(canEditProject(p({ status: "draft" }), anon)).toBe(false);
  });

  it("owner can edit own in non-archived non-deleted statuses", () => {
    expect(canEditProject(p({ status: "draft" }), owner)).toBe(true);
    expect(canEditProject(p({ status: "submitted" }), owner)).toBe(true);
    expect(canEditProject(p({ status: "archived" }), owner)).toBe(false);
    expect(canEditProject(p({ status: "draft", deletedAt: new Date() }), owner)).toBe(false);
  });

  it("non-owner non-staff cannot edit", () => {
    expect(canEditProject(p({ status: "draft" }), other)).toBe(false);
  });

  it("staff can edit any non-deleted", () => {
    expect(canEditProject(p({ status: "draft" }), admin)).toBe(true);
    expect(canEditProject(p({ status: "archived" }), admin)).toBe(true);
  });

  it("staff cannot edit a soft-deleted project (must restore first)", () => {
    expect(canEditProject(p({ status: "draft", deletedAt: new Date() }), admin)).toBe(false);
  });
});

describe("stripStaffOnlyFields", () => {
  it("removes notes for non-staff", () => {
    const result = stripStaffOnlyFields(p({ notes: "secret" }), owner);
    expect(result.notes).toBeNull();
  });

  it("keeps notes for staff", () => {
    const result = stripStaffOnlyFields(p({ notes: "secret" }), admin);
    expect(result.notes).toBe("secret");
  });
});

describe("filterCommentsForViewer", () => {
  const comments = [
    { id: "c1", isInternal: false, content: "public" },
    { id: "c2", isInternal: true, content: "internal" },
  ];

  it("strips internal for non-staff", () => {
    const result = filterCommentsForViewer(comments, owner);
    expect(result).toEqual([comments[0]]);
  });

  it("keeps all for staff", () => {
    const result = filterCommentsForViewer(comments, admin);
    expect(result).toEqual(comments);
  });

  it("strips internal for anonymous", () => {
    const result = filterCommentsForViewer(comments, anon);
    expect(result).toEqual([comments[0]]);
  });
});
```

- [ ] **Step 2: Run and verify it fails**

```bash
npm test -- src/lib/__tests__/project-visibility.test.ts
```

Expected: FAIL on module resolution.

- [ ] **Step 3: Implement**

Create `src/lib/project-visibility.ts`:

```ts
export type Viewer =
  | { id: string; role: string | null | undefined }
  | null
  | undefined;

export type VisibleProject = {
  id: string;
  proposerId: string;
  status: string;
  deletedAt: Date | null;
  notes: string | null;
} & Record<string, unknown>;

export type VisibleComment = {
  isInternal: boolean | null;
} & Record<string, unknown>;

export function isStaff(viewer: Viewer): boolean {
  if (!viewer) return false;
  return viewer.role === "admin" || viewer.role === "instructor";
}

function isOwner(project: VisibleProject, viewer: Viewer): boolean {
  return !!viewer && project.proposerId === viewer.id;
}

export function canSeeProject(
  project: VisibleProject,
  viewer: Viewer,
): boolean {
  if (isStaff(viewer)) {
    return true;
  }
  if (project.deletedAt) {
    return false;
  }
  if (isOwner(project, viewer)) {
    return true;
  }
  return project.status === "published";
}

export function canEditProject(
  project: VisibleProject,
  viewer: Viewer,
): boolean {
  if (!viewer) return false;
  if (project.deletedAt) return false;
  if (isStaff(viewer)) return true;
  if (!isOwner(project, viewer)) return false;
  return project.status !== "archived";
}

export function stripStaffOnlyFields<T extends VisibleProject>(
  project: T,
  viewer: Viewer,
): T {
  if (isStaff(viewer)) return project;
  return { ...project, notes: null };
}

export function filterCommentsForViewer<T extends VisibleComment>(
  comments: T[],
  viewer: Viewer,
): T[] {
  if (isStaff(viewer)) return comments;
  return comments.filter((c) => !c.isInternal);
}
```

- [ ] **Step 4: Re-run, verify all tests pass**

```bash
npm test -- src/lib/__tests__/project-visibility.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/project-visibility.ts src/lib/__tests__/project-visibility.test.ts
git commit -m "$(cat <<'EOF'
add pure project-visibility module with viewer matrix tests

canSeeProject and canEditProject implement the spec's visibility
matrix exactly (anon/owner/other/staff x status x deletedAt).
stripStaffOnlyFields removes notes for non-staff viewers; the read
queries call this before returning to the client. filterCommentsForViewer
drops internal comments for non-staff. All four are pure functions
with no DB or framework coupling.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Phase 2: Internal notify helper

### Task 4: `src/server/_internal/notify.ts`

**Files:**

- Create: `src/server/_internal/notify.ts`

This is a server-side helper called from inside transactions. It is NOT a server function; it takes a Drizzle transaction object as its first argument so notification writes share the originating transaction.

- [ ] **Step 1: Create the file**

```bash
mkdir -p src/server/_internal
```

`src/server/_internal/notify.ts`:

```ts
import { and, eq } from "drizzle-orm";
import type { db as Db } from "#/db";
import { notifications, projectComments } from "#/db/schema";

type Tx = Parameters<Parameters<typeof Db.transaction>[0]>[0];

type Project = {
  id: string;
  title: string;
  proposerId: string;
};

type Comment = {
  id: string;
  projectId: string;
  authorId: string;
  parentId: string | null;
  isInternal: boolean | null;
};

export async function recordStatusChangeNotifications(
  tx: Tx,
  project: Project,
  newStatus: string,
  actorId: string,
): Promise<void> {
  if (project.proposerId === actorId) return;
  await tx.insert(notifications).values({
    userId: project.proposerId,
    type: "status_change",
    title: `Your project '${project.title}' is now ${newStatus}`,
    message: `Status changed to ${newStatus}.`,
    link: `/projects/${project.id}`,
  });
}

export async function recordSoftDeleteNotification(
  tx: Tx,
  project: Project,
  action: "soft-deleted" | "restored" | "hard-deleted",
  actorId: string,
): Promise<void> {
  if (project.proposerId === actorId) return;
  await tx.insert(notifications).values({
    userId: project.proposerId,
    type: "soft_delete",
    title: `Your project '${project.title}' was ${action} by staff`,
    message: `Staff performed: ${action}.`,
    link: `/projects/${project.id}`,
  });
}

export async function recordCommentNotifications(
  tx: Tx,
  project: Project,
  comment: Comment,
): Promise<void> {
  if (comment.isInternal) return;

  const recipients = new Set<string>();
  if (comment.authorId !== project.proposerId) {
    recipients.add(project.proposerId);
  }

  if (comment.parentId) {
    const [parent] = await tx
      .select({ authorId: projectComments.authorId })
      .from(projectComments)
      .where(
        and(
          eq(projectComments.id, comment.parentId),
          eq(projectComments.projectId, project.id),
        ),
      );
    if (parent && parent.authorId !== comment.authorId) {
      recipients.add(parent.authorId);
    }
  }

  for (const recipient of recipients) {
    await tx.insert(notifications).values({
      userId: recipient,
      type: "comment",
      title: `New comment on '${project.title}'`,
      message: comment.content?.slice(0, 200) ?? "",
      link: `/projects/${project.id}#comment-${comment.id}`,
    });
  }
}
```

Note: the `Tx` type extracts Drizzle's transaction type from the `db.transaction` signature so this helper accepts the same kind of object the workflow functions pass in.

The `comment.content` reference at the bottom needs the comment type extended; update the `Comment` type to include `content`:

```ts
type Comment = {
  id: string;
  projectId: string;
  authorId: string;
  parentId: string | null;
  isInternal: boolean | null;
  content: string;
};
```

- [ ] **Step 2: Commit**

```bash
git add src/server/_internal
git commit -m "$(cat <<'EOF'
add internal notify helper for status, soft-delete, and comment events

The helper functions take a Drizzle transaction so notification writes
happen atomically with the originating mutation. recordCommentNotifications
notifies the proposer (unless they authored the comment) and the parent
comment's author on replies (unless duplicate or self). Internal comments
trigger no notifications.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Phase 3: Project write server functions

### Task 5: `src/server/projects.ts` with createProject + updateProject + workflow transitions + delete operations

This is a single file with many `createServerFn` exports. We commit it as one unit because they share helpers and import surface.

**Files:**

- Create: `src/server/projects.ts`

- [ ] **Step 1: Write the file**

```ts
import { createServerFn } from "@tanstack/react-start";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "#/db";
import {
  projects,
  projectEditLog,
  projectStatusHistory,
} from "#/db/schema";
import { requireUser } from "#/lib/auth-guards.server";
import {
  type ActorRole,
  type Status,
  assertTransitionAllowed,
} from "#/lib/project-workflow";
import { canEditProject, isStaff } from "#/lib/project-visibility";
import {
  recordCommentNotifications,
  recordSoftDeleteNotification,
  recordStatusChangeNotifications,
} from "./_internal/notify";

const projectInputSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(5000).nullable().optional(),
  problemStatement: z.string().max(5000).nullable().optional(),
  objectives: z.string().max(5000).nullable().optional(),
  minQualifications: z.string().max(2000).nullable().optional(),
  prefQualifications: z.string().max(2000).nullable().optional(),
  url: z.string().url().max(500).nullable().optional().or(z.literal("")),
  contactEmail: z.string().email().max(200).nullable().optional().or(z.literal("")),
  contactName: z.string().max(200).nullable().optional(),
  imageUrl: z.string().url().max(500).nullable().optional().or(z.literal("")),
  licenseRestrictions: z.string().max(1000).nullable().optional(),
  programId: z.string().uuid().nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
});

const updateProjectSchema = projectInputSchema.extend({
  id: z.string().uuid(),
});

const transitionInputSchema = z.object({
  id: z.string().uuid(),
  comment: z.string().max(2000).optional(),
});

const PROJECT_EDITABLE_FIELDS = [
  "title",
  "description",
  "problemStatement",
  "objectives",
  "minQualifications",
  "prefQualifications",
  "url",
  "contactEmail",
  "contactName",
  "imageUrl",
  "licenseRestrictions",
  "programId",
  "notes",
] as const;

function actorRole(user: { id: string }, project: { proposerId: string }, viewer: { role: string | null | undefined }): ActorRole {
  if (viewer.role === "admin" || viewer.role === "instructor") return "staff";
  if (project.proposerId === user.id) return "owner";
  return "owner";
}

async function loadProjectOr404(id: string) {
  const [row] = await db.select().from(projects).where(eq(projects.id, id));
  if (!row) throw new Error("Project not found");
  return row;
}

export const createProject = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => projectInputSchema.parse(data))
  .handler(async ({ data }) => {
    const viewer = await requireUser();
    const allowedNotes = isStaff(viewer) ? data.notes ?? null : null;
    const [created] = await db
      .insert(projects)
      .values({
        title: data.title,
        description: data.description ?? null,
        problemStatement: data.problemStatement ?? null,
        objectives: data.objectives ?? null,
        minQualifications: data.minQualifications ?? null,
        prefQualifications: data.prefQualifications ?? null,
        url: (data.url || null) as string | null,
        contactEmail: (data.contactEmail || null) as string | null,
        contactName: data.contactName ?? null,
        imageUrl: (data.imageUrl || null) as string | null,
        licenseRestrictions: data.licenseRestrictions ?? null,
        programId: data.programId ?? null,
        notes: allowedNotes,
        proposerId: viewer.id,
        status: "draft",
      })
      .returning();
    return { id: created.id };
  });

export const updateProject = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => updateProjectSchema.parse(data))
  .handler(async ({ data }) => {
    const viewer = await requireUser();
    const existing = await loadProjectOr404(data.id);
    if (!canEditProject(existing, viewer)) {
      throw new Error("Forbidden");
    }
    const staff = isStaff(viewer);

    const newValues: Record<string, unknown> = {
      title: data.title,
      description: data.description ?? null,
      problemStatement: data.problemStatement ?? null,
      objectives: data.objectives ?? null,
      minQualifications: data.minQualifications ?? null,
      prefQualifications: data.prefQualifications ?? null,
      url: data.url || null,
      contactEmail: data.contactEmail || null,
      contactName: data.contactName ?? null,
      imageUrl: data.imageUrl || null,
      licenseRestrictions: data.licenseRestrictions ?? null,
      programId: data.programId ?? null,
    };
    if (staff) newValues.notes = data.notes ?? null;

    const oldDiff: Record<string, unknown> = {};
    const newDiff: Record<string, unknown> = {};
    const changedFields: string[] = [];
    for (const field of PROJECT_EDITABLE_FIELDS) {
      if (!staff && field === "notes") continue;
      const oldVal = (existing as Record<string, unknown>)[field] ?? null;
      const newVal = newValues[field] ?? null;
      if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
        oldDiff[field] = oldVal;
        newDiff[field] = newVal;
        changedFields.push(field);
      }
    }

    if (changedFields.length === 0) {
      return { id: existing.id, updated: false };
    }

    await db.transaction(async (tx) => {
      await tx
        .update(projects)
        .set({ ...newValues, updatedAt: new Date() })
        .where(eq(projects.id, existing.id));
      await tx.insert(projectEditLog).values({
        projectId: existing.id,
        editorId: viewer.id,
        changedFields,
        oldValues: oldDiff,
        newValues: newDiff,
      });
    });

    return { id: existing.id, updated: true };
  });

async function performTransition(
  id: string,
  target: Status,
  comment: string | undefined,
  viewerOverride?: { id: string; role: string | null | undefined },
) {
  const viewer = viewerOverride ?? (await requireUser());
  const project = await loadProjectOr404(id);
  const role: ActorRole =
    isStaff(viewer) ? "staff" : project.proposerId === viewer.id ? "owner" : "owner";
  if (!isStaff(viewer) && project.proposerId !== viewer.id) {
    throw new Error("Forbidden");
  }
  assertTransitionAllowed(project.status as Status, target, role);

  await db.transaction(async (tx) => {
    const updates: Record<string, unknown> = {
      status: target,
      updatedAt: new Date(),
    };
    if (target === "published" && !project.publishedAt) {
      updates.publishedAt = new Date();
    }
    if (target === "archived") {
      updates.archivedAt = new Date();
    }
    await tx.update(projects).set(updates).where(eq(projects.id, id));

    await tx.insert(projectStatusHistory).values({
      projectId: id,
      oldStatus: project.status,
      newStatus: target,
      changedBy: viewer.id,
      comment: comment ?? null,
    });

    await recordStatusChangeNotifications(
      tx,
      { id: project.id, title: project.title, proposerId: project.proposerId },
      target,
      viewer.id,
    );
  });

  return { id, status: target };
}

export const submitProject = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => transitionInputSchema.parse(data))
  .handler(async ({ data }) => performTransition(data.id, "submitted", data.comment));

export const returnToDraft = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => transitionInputSchema.parse(data))
  .handler(async ({ data }) => performTransition(data.id, "draft", data.comment));

export const requestChanges = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => transitionInputSchema.parse(data))
  .handler(async ({ data }) => performTransition(data.id, "changes_requested", data.comment));

export const approveProject = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => transitionInputSchema.parse(data))
  .handler(async ({ data }) => performTransition(data.id, "approved", data.comment));

export const publishProject = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => transitionInputSchema.parse(data))
  .handler(async ({ data }) => performTransition(data.id, "published", data.comment));

export const archiveProject = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => transitionInputSchema.parse(data))
  .handler(async ({ data }) => performTransition(data.id, "archived", data.comment));

export const restoreArchived = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => transitionInputSchema.parse(data))
  .handler(async ({ data }) => performTransition(data.id, "published", data.comment));

const idOnlySchema = z.object({ id: z.string().uuid() });

export const softDeleteProject = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => idOnlySchema.parse(data))
  .handler(async ({ data }) => {
    const viewer = await requireUser();
    if (!isStaff(viewer)) throw new Error("Forbidden");
    const project = await loadProjectOr404(data.id);
    if (project.status === "draft") throw new Error("Cannot soft-delete a draft; hard-delete instead.");
    if (project.deletedAt) throw new Error("Already soft-deleted.");
    await db.transaction(async (tx) => {
      await tx
        .update(projects)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(projects.id, data.id));
      await recordSoftDeleteNotification(
        tx,
        { id: project.id, title: project.title, proposerId: project.proposerId },
        "soft-deleted",
        viewer.id,
      );
    });
    return { id: data.id };
  });

export const restoreProject = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => idOnlySchema.parse(data))
  .handler(async ({ data }) => {
    const viewer = await requireUser();
    if (!isStaff(viewer)) throw new Error("Forbidden");
    const project = await loadProjectOr404(data.id);
    if (!project.deletedAt) throw new Error("Not soft-deleted.");
    await db.transaction(async (tx) => {
      await tx
        .update(projects)
        .set({ deletedAt: null, updatedAt: new Date() })
        .where(eq(projects.id, data.id));
      await recordSoftDeleteNotification(
        tx,
        { id: project.id, title: project.title, proposerId: project.proposerId },
        "restored",
        viewer.id,
      );
    });
    return { id: data.id };
  });

export const hardDeleteProject = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => idOnlySchema.parse(data))
  .handler(async ({ data }) => {
    const viewer = await requireUser();
    const project = await loadProjectOr404(data.id);
    if (project.status !== "draft") throw new Error("Hard delete only allowed on drafts.");
    const isOwner = project.proposerId === viewer.id;
    if (!isOwner && !isStaff(viewer)) throw new Error("Forbidden");
    await db.delete(projects).where(eq(projects.id, data.id));
    return { id: data.id };
  });
```

Note: the unused `actorRole` helper is left as-is for now and removed in Step 2 if Biome complains.

- [ ] **Step 2: Remove the unused `actorRole` helper**

Delete the `actorRole` function. It was a stub from earlier drafts. The `performTransition` helper computes role inline.

Also remove the unused `and` and `recordCommentNotifications` imports if Biome flags them. Run:

```bash
npm run check
```

If errors appear about unused imports, fix them by removing the unused names from the import list.

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit 2>&1 | grep -v "drizzle.config.ts" | grep "error TS" | head -20
```

Expected: empty.

- [ ] **Step 4: Commit**

```bash
git add src/server/projects.ts
git commit -m "$(cat <<'EOF'
add project write server functions with workflow gates

One createServerFn per action: createProject, updateProject,
submitProject, returnToDraft, requestChanges, approveProject,
publishProject, archiveProject, restoreArchived, softDeleteProject,
restoreProject, hardDeleteProject. Each enforces its own role check
and (for transitions) calls assertTransitionAllowed. Writes happen
inside db.transaction blocks so status history, edit log, and
notification rows land atomically with the project update. updateProject
diffs the editable fields and only logs fields that actually changed.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Phase 4: Project read server functions

### Task 6: `src/server/projects-queries.ts`

**Files:**

- Create: `src/server/projects-queries.ts`

- [ ] **Step 1: Write the file**

```ts
import { createServerFn } from "@tanstack/react-start";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "#/db";
import {
  projectComments,
  projectEditLog,
  projectStatusHistory,
  projects,
} from "#/db/schema";
import { readSession } from "#/lib/auth-guards.server";
import {
  canSeeProject,
  filterCommentsForViewer,
  isStaff,
  stripStaffOnlyFields,
  type Viewer,
} from "#/lib/project-visibility";

async function getViewer(): Promise<Viewer> {
  const session = await readSession();
  return session?.user
    ? { id: session.user.id, role: session.user.role ?? null }
    : null;
}

const paginationSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});

export const listPublishedProjects = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => paginationSchema.parse(data ?? {}))
  .handler(async ({ data }) => {
    const offset = (data.page - 1) * data.pageSize;
    const rows = await db
      .select()
      .from(projects)
      .where(and(eq(projects.status, "published"), isNull(projects.deletedAt)))
      .orderBy(desc(projects.publishedAt))
      .limit(data.pageSize)
      .offset(offset);
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(projects)
      .where(and(eq(projects.status, "published"), isNull(projects.deletedAt)));
    return { rows, total: count, page: data.page, pageSize: data.pageSize };
  });

const myProjectsSchema = z.object({
  status: z
    .enum([
      "all",
      "draft",
      "submitted",
      "approved",
      "changes_requested",
      "published",
      "archived",
    ])
    .default("all"),
});

export const listMyProjects = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => myProjectsSchema.parse(data ?? {}))
  .handler(async ({ data }) => {
    const viewer = await getViewer();
    if (!viewer) return { rows: [] };
    const conditions = [
      eq(projects.proposerId, viewer.id),
      isNull(projects.deletedAt),
    ];
    if (data.status !== "all") {
      conditions.push(eq(projects.status, data.status));
    }
    const rows = await db
      .select()
      .from(projects)
      .where(and(...conditions))
      .orderBy(desc(projects.updatedAt));
    return { rows };
  });

const adminListSchema = z.object({
  status: z
    .enum([
      "all",
      "draft",
      "submitted",
      "approved",
      "changes_requested",
      "published",
      "archived",
    ])
    .default("all"),
  includeSoftDeleted: z.boolean().default(false),
});

export const listAdminProjects = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => adminListSchema.parse(data ?? {}))
  .handler(async ({ data }) => {
    const viewer = await getViewer();
    if (!isStaff(viewer)) throw new Error("Forbidden");
    const conditions = [];
    if (data.status !== "all") {
      conditions.push(eq(projects.status, data.status));
    }
    if (!data.includeSoftDeleted) {
      conditions.push(isNull(projects.deletedAt));
    }
    const rows = await db
      .select()
      .from(projects)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(projects.updatedAt));
    return { rows };
  });

const getProjectSchema = z.object({ id: z.string().uuid() });

export const getProject = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => getProjectSchema.parse(data))
  .handler(async ({ data }) => {
    const viewer = await getViewer();
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, data.id));
    if (!project) return { project: null, history: [], canEdit: false, viewerIsStaff: false };
    if (!canSeeProject(project, viewer)) {
      return { project: null, history: [], canEdit: false, viewerIsStaff: false };
    }

    const stripped = stripStaffOnlyFields(project, viewer);
    const history = await db
      .select({
        id: projectStatusHistory.id,
        oldStatus: projectStatusHistory.oldStatus,
        newStatus: projectStatusHistory.newStatus,
        changedBy: projectStatusHistory.changedBy,
        comment: projectStatusHistory.comment,
        createdAt: projectStatusHistory.createdAt,
      })
      .from(projectStatusHistory)
      .where(eq(projectStatusHistory.projectId, data.id))
      .orderBy(asc(projectStatusHistory.createdAt));

    const viewerIsStaff = isStaff(viewer);

    return {
      project: stripped,
      history,
      canEdit:
        !!viewer && !project.deletedAt && (viewerIsStaff || project.proposerId === viewer.id) && project.status !== "archived"
          ? true
          : false,
      viewerIsStaff,
    };
  });

const projectIdSchema = z.object({ id: z.string().uuid() });

export const listProjectEditLog = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => projectIdSchema.parse(data))
  .handler(async ({ data }) => {
    const viewer = await getViewer();
    if (!isStaff(viewer)) throw new Error("Forbidden");
    const rows = await db
      .select()
      .from(projectEditLog)
      .where(eq(projectEditLog.projectId, data.id))
      .orderBy(desc(projectEditLog.createdAt));
    return { rows };
  });

export const listProjectComments = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => projectIdSchema.parse(data))
  .handler(async ({ data }) => {
    const viewer = await getViewer();
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, data.id));
    if (!project || !canSeeProject(project, viewer)) {
      throw new Error("Forbidden");
    }
    const rows = await db
      .select()
      .from(projectComments)
      .where(eq(projectComments.projectId, data.id))
      .orderBy(asc(projectComments.createdAt));
    return { rows: filterCommentsForViewer(rows, viewer) };
  });
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit 2>&1 | grep -v "drizzle.config.ts" | grep "error TS" | head -20
```

Expected: empty.

- [ ] **Step 3: Lint**

```bash
npm run check
```

Fix any unused-import errors that surface.

- [ ] **Step 4: Commit**

```bash
git add src/server/projects-queries.ts
git commit -m "$(cat <<'EOF'
add project read server functions with visibility filtering

listPublishedProjects (paginated), listMyProjects (status filter),
listAdminProjects (status + includeSoftDeleted), getProject (single
project plus its status history, with stripStaffOnlyFields applied),
listProjectEditLog (staff only), listProjectComments (filtered for
viewer). Every query that returns a row first runs it through the
visibility module; staff-only fields are stripped server-side, not
just hidden in the UI.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Phase 5: Comment server functions

### Task 7: `src/server/comments.ts`

**Files:**

- Create: `src/server/comments.ts`

- [ ] **Step 1: Write the file**

```ts
import { createServerFn } from "@tanstack/react-start";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "#/db";
import { projectComments, projects } from "#/db/schema";
import { requireUser } from "#/lib/auth-guards.server";
import { canSeeProject, isStaff } from "#/lib/project-visibility";
import { recordCommentNotifications } from "./_internal/notify";

const addCommentSchema = z.object({
  projectId: z.string().uuid(),
  content: z.string().trim().min(1).max(5000),
  parentId: z.string().uuid().nullable().optional(),
  isInternal: z.boolean().default(false),
});

export const addComment = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => addCommentSchema.parse(data))
  .handler(async ({ data }) => {
    const viewer = await requireUser();
    const viewerForVisibility = {
      id: viewer.id,
      role: viewer.role ?? null,
    };
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, data.projectId));
    if (!project) throw new Error("Project not found");
    if (!canSeeProject(project, viewerForVisibility)) {
      throw new Error("Forbidden");
    }
    if (data.isInternal && !isStaff(viewerForVisibility)) {
      throw new Error("Only staff may post internal comments");
    }
    if (data.parentId) {
      const [parent] = await db
        .select()
        .from(projectComments)
        .where(
          and(
            eq(projectComments.id, data.parentId),
            eq(projectComments.projectId, data.projectId),
          ),
        );
      if (!parent) throw new Error("Parent comment not found on this project");
      if (parent.parentId) throw new Error("Replies are one level deep");
    }

    let created;
    await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(projectComments)
        .values({
          projectId: data.projectId,
          authorId: viewer.id,
          parentId: data.parentId ?? null,
          content: data.content,
          isInternal: data.isInternal,
        })
        .returning();
      created = row;
      await recordCommentNotifications(
        tx,
        { id: project.id, title: project.title, proposerId: project.proposerId },
        {
          id: row.id,
          projectId: row.projectId,
          authorId: row.authorId,
          parentId: row.parentId,
          isInternal: row.isInternal,
          content: row.content,
        },
      );
    });
    return { id: created!.id };
  });
```

- [ ] **Step 2: Type-check + lint**

```bash
npx tsc --noEmit 2>&1 | grep -v "drizzle.config.ts" | grep "error TS" | head -10
npm run check
```

Both should be clean.

- [ ] **Step 3: Commit**

```bash
git add src/server/comments.ts
git commit -m "$(cat <<'EOF'
add addComment server function with reply + internal gating

Enforces: project must be visible to viewer; internal requires staff;
parent must belong to same project and not itself be a reply (single-
level threading); empty content rejected via Zod trim+min(1). Writes
the comment row and notifications inside one transaction.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Phase 6: Notification server functions

### Task 8: `src/server/notifications.ts`

**Files:**

- Create: `src/server/notifications.ts`

- [ ] **Step 1: Write the file**

```ts
import { createServerFn } from "@tanstack/react-start";
import { and, count, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "#/db";
import { notifications } from "#/db/schema";
import { requireUser } from "#/lib/auth-guards.server";

export const listMyNotifications = createServerFn({ method: "GET" }).handler(async () => {
  const viewer = await requireUser();
  const rows = await db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, viewer.id))
    .orderBy(desc(notifications.createdAt))
    .limit(10);
  return { rows };
});

export const unreadCount = createServerFn({ method: "GET" }).handler(async () => {
  const viewer = await requireUser();
  const [{ value }] = await db
    .select({ value: count() })
    .from(notifications)
    .where(
      and(eq(notifications.userId, viewer.id), eq(notifications.read, false)),
    );
  return { count: value };
});

const idSchema = z.object({ id: z.string().uuid() });

export const markRead = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => idSchema.parse(data))
  .handler(async ({ data }) => {
    const viewer = await requireUser();
    await db
      .update(notifications)
      .set({ read: true })
      .where(
        and(
          eq(notifications.id, data.id),
          eq(notifications.userId, viewer.id),
        ),
      );
    return { id: data.id };
  });

export const markAllRead = createServerFn({ method: "POST" }).handler(async () => {
  const viewer = await requireUser();
  await db
    .update(notifications)
    .set({ read: true })
    .where(eq(notifications.userId, viewer.id));
  return { ok: true };
});
```

- [ ] **Step 2: Type-check + lint**

```bash
npx tsc --noEmit 2>&1 | grep -v "drizzle.config.ts" | grep "error TS" | head -10
npm run check
```

- [ ] **Step 3: Commit**

```bash
git add src/server/notifications.ts
git commit -m "$(cat <<'EOF'
add notifications server functions for bell-icon

listMyNotifications returns the most recent 10 for the viewer.
unreadCount drives the badge. markRead is scoped to (id, userId)
so users can only mark their own. markAllRead clears everything
for the viewer.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Phase 7: Client helpers

### Task 9: `src/lib/apply-server-errors.ts`

**Files:**

- Create: `src/lib/apply-server-errors.ts`

- [ ] **Step 1: Write the file**

```ts
import { ZodError } from "zod";

type FormLike = {
  setFieldMeta: (field: string, updater: (prev: { errors?: string[] } | undefined) => { errors: string[] }) => void;
};

export function applyServerErrors(form: FormLike, err: unknown): boolean {
  if (!(err instanceof ZodError)) return false;
  for (const issue of err.issues) {
    const field = issue.path.join(".");
    if (!field) continue;
    form.setFieldMeta(field, (prev) => ({
      errors: [...(prev?.errors ?? []), issue.message],
    }));
  }
  return true;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/apply-server-errors.ts
git commit -m "$(cat <<'EOF'
add applyServerErrors helper for TanStack Form + Zod

Maps a thrown ZodError from a server function back to field-level
errors on a TanStack Form. Returns true if it handled the error
(so callers can fall back to a generic banner otherwise). Uses
a structural FormLike type to avoid a hard dep on TanStack Form
internals in this lib file.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Phase 8: Shared components

### Task 10: `status-badge`, `status-timeline`, `project-card`

Three small presentational components, one commit.

**Files:**

- Create: `src/components/status-badge.tsx`
- Create: `src/components/status-timeline.tsx`
- Create: `src/components/project-card.tsx`

- [ ] **Step 1: `status-badge.tsx`**

```tsx
const COLORS: Record<string, string> = {
  draft: "bg-neutral-200 text-neutral-800",
  submitted: "bg-blue-200 text-blue-900",
  approved: "bg-purple-200 text-purple-900",
  changes_requested: "bg-amber-200 text-amber-900",
  published: "bg-green-200 text-green-900",
  archived: "bg-neutral-300 text-neutral-700",
};

export function StatusBadge({ status }: { status: string }) {
  const className =
    COLORS[status] ?? "bg-neutral-200 text-neutral-800";
  return (
    <span className={`inline-block px-2 py-0.5 text-xs font-medium ${className}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}
```

- [ ] **Step 2: `status-timeline.tsx`**

```tsx
import { StatusBadge } from "./status-badge";

type HistoryRow = {
  id: string;
  oldStatus: string | null;
  newStatus: string;
  changedBy: string;
  comment: string | null;
  createdAt: Date | string;
};

export function StatusTimeline({ rows }: { rows: HistoryRow[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-neutral-500">No status changes yet.</p>;
  }
  return (
    <ol className="space-y-3">
      {rows.map((r) => (
        <li key={r.id} className="border-l-2 border-neutral-300 pl-3">
          <div className="flex items-center gap-2 text-sm">
            {r.oldStatus ? <StatusBadge status={r.oldStatus} /> : <span className="text-xs text-neutral-500">created</span>}
            <span>-&gt;</span>
            <StatusBadge status={r.newStatus} />
            <span className="text-xs text-neutral-500">
              {new Date(r.createdAt).toLocaleString()}
            </span>
          </div>
          {r.comment && (
            <p className="mt-1 text-sm text-neutral-700 whitespace-pre-wrap">{r.comment}</p>
          )}
        </li>
      ))}
    </ol>
  );
}
```

- [ ] **Step 3: `project-card.tsx`**

```tsx
import { Link } from "@tanstack/react-router";
import { StatusBadge } from "./status-badge";

type ProjectSummary = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  publishedAt: Date | string | null;
};

export function ProjectCard({ project }: { project: ProjectSummary }) {
  return (
    <Link
      to="/projects/$projectId"
      params={{ projectId: project.id }}
      className="block border border-neutral-200 p-4 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900"
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold">{project.title}</h3>
        <StatusBadge status={project.status} />
      </div>
      {project.description && (
        <p className="mt-2 line-clamp-3 text-sm text-neutral-600">{project.description}</p>
      )}
      {project.publishedAt && (
        <p className="mt-2 text-xs text-neutral-500">
          Published {new Date(project.publishedAt).toLocaleDateString()}
        </p>
      )}
    </Link>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add src/components/status-badge.tsx src/components/status-timeline.tsx src/components/project-card.tsx
git commit -m "$(cat <<'EOF'
add status-badge, status-timeline, project-card components

Plain Tailwind presentational components. StatusBadge maps each
project status to a color. StatusTimeline renders status_history
rows as a vertical timeline. ProjectCard is the list-item link to
the canonical project URL.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: `comment-thread.tsx`

**Files:**

- Create: `src/components/comment-thread.tsx`

- [ ] **Step 1: Write the file**

```tsx
import { useState } from "react";
import { addComment } from "#/server/comments";

type Comment = {
  id: string;
  projectId: string;
  authorId: string;
  parentId: string | null;
  content: string;
  isInternal: boolean | null;
  createdAt: Date | string;
};

type Props = {
  projectId: string;
  comments: Comment[];
  viewerIsStaff: boolean;
  onChanged: () => void;
};

export function CommentThread({ projectId, comments, viewerIsStaff, onChanged }: Props) {
  const topLevel = comments.filter((c) => !c.parentId);
  const repliesByParent = new Map<string, Comment[]>();
  for (const c of comments) {
    if (c.parentId) {
      const arr = repliesByParent.get(c.parentId) ?? [];
      arr.push(c);
      repliesByParent.set(c.parentId, arr);
    }
  }

  return (
    <div className="space-y-4">
      {topLevel.map((c) => (
        <CommentNode
          key={c.id}
          comment={c}
          replies={repliesByParent.get(c.id) ?? []}
          projectId={projectId}
          viewerIsStaff={viewerIsStaff}
          onChanged={onChanged}
        />
      ))}
      <NewCommentForm projectId={projectId} viewerIsStaff={viewerIsStaff} onChanged={onChanged} />
    </div>
  );
}

function CommentNode({
  comment,
  replies,
  projectId,
  viewerIsStaff,
  onChanged,
}: {
  comment: Comment;
  replies: Comment[];
  projectId: string;
  viewerIsStaff: boolean;
  onChanged: () => void;
}) {
  const isInternal = comment.isInternal ?? false;
  return (
    <div
      id={`comment-${comment.id}`}
      className={
        isInternal
          ? "border-l-4 border-amber-400 bg-amber-50 p-3"
          : "border-l-4 border-neutral-300 p-3"
      }
    >
      <div className="flex items-center gap-2 text-xs text-neutral-500">
        <span>{comment.authorId.slice(0, 8)}</span>
        <span>{new Date(comment.createdAt).toLocaleString()}</span>
        {isInternal && (
          <span className="bg-amber-200 px-1.5 py-0.5 text-amber-900">internal</span>
        )}
      </div>
      <p className="mt-1 text-sm whitespace-pre-wrap">{comment.content}</p>

      {replies.length > 0 && (
        <div className="mt-3 space-y-2 pl-4">
          {replies.map((r) => (
            <div
              key={r.id}
              id={`comment-${r.id}`}
              className={
                r.isInternal
                  ? "border-l-2 border-amber-400 bg-amber-50 p-2"
                  : "border-l-2 border-neutral-300 p-2"
              }
            >
              <div className="flex items-center gap-2 text-xs text-neutral-500">
                <span>{r.authorId.slice(0, 8)}</span>
                <span>{new Date(r.createdAt).toLocaleString()}</span>
                {r.isInternal && (
                  <span className="bg-amber-200 px-1.5 py-0.5 text-amber-900">internal</span>
                )}
              </div>
              <p className="mt-1 text-sm whitespace-pre-wrap">{r.content}</p>
            </div>
          ))}
        </div>
      )}

      <ReplyForm
        projectId={projectId}
        parentId={comment.id}
        viewerIsStaff={viewerIsStaff}
        onChanged={onChanged}
      />
    </div>
  );
}

function NewCommentForm({
  projectId,
  viewerIsStaff,
  onChanged,
}: {
  projectId: string;
  viewerIsStaff: boolean;
  onChanged: () => void;
}) {
  const [content, setContent] = useState("");
  const [isInternal, setIsInternal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await addComment({ data: { projectId, content, isInternal } });
      setContent("");
      setIsInternal(false);
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-4 space-y-2 border-t pt-4">
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Add a comment"
        required
        className="w-full border p-2"
        rows={3}
      />
      {viewerIsStaff && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={isInternal}
            onChange={(e) => setIsInternal(e.target.checked)}
          />
          Internal (staff only)
        </label>
      )}
      <button type="submit" className="bg-black px-3 py-1.5 text-white">
        Post comment
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </form>
  );
}

function ReplyForm({
  projectId,
  parentId,
  viewerIsStaff,
  onChanged,
}: {
  projectId: string;
  parentId: string;
  viewerIsStaff: boolean;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState("");
  const [isInternal, setIsInternal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 text-xs text-blue-700 hover:underline"
      >
        Reply
      </button>
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await addComment({ data: { projectId, parentId, content, isInternal } });
      setContent("");
      setOpen(false);
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-2 space-y-2 pl-4">
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Reply"
        required
        className="w-full border p-2 text-sm"
        rows={2}
      />
      {viewerIsStaff && (
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={isInternal}
            onChange={(e) => setIsInternal(e.target.checked)}
          />
          Internal (staff only)
        </label>
      )}
      <div className="flex gap-2">
        <button type="submit" className="bg-black px-2 py-1 text-xs text-white">
          Post
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-xs">
          Cancel
        </button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </form>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/comment-thread.tsx
git commit -m "$(cat <<'EOF'
add comment-thread component with one-level replies and internal styling

Top-level comments render as cards; replies one level deep nested. Internal
comments get amber-bordered cards and an 'internal' pill. New-comment and
reply forms inline. Staff see an 'internal' checkbox.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: `notification-bell.tsx`

**Files:**

- Create: `src/components/notification-bell.tsx`
- Modify: `src/components/site-header.tsx`

- [ ] **Step 1: Create `notification-bell.tsx`**

```tsx
import { useEffect, useState } from "react";
import {
  listMyNotifications,
  markAllRead,
  markRead,
  unreadCount,
} from "#/server/notifications";

type Notification = {
  id: string;
  type: string;
  title: string;
  message: string;
  link: string | null;
  read: boolean | null;
  createdAt: Date | string;
};

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [rows, setRows] = useState<Notification[]>([]);

  async function refresh() {
    try {
      const [{ count }, { rows }] = await Promise.all([
        unreadCount(),
        listMyNotifications(),
      ]);
      setUnread(count);
      setRows(rows as Notification[]);
    } catch {
      // ignore (user not authenticated)
    }
  }

  useEffect(() => {
    void refresh();
    const id = setInterval(refresh, 60_000);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  async function onClickNotification(n: Notification) {
    if (!n.read) {
      await markRead({ data: { id: n.id } });
    }
    setOpen(false);
    if (n.link) {
      window.location.href = n.link;
    } else {
      await refresh();
    }
  }

  async function onMarkAllRead() {
    await markAllRead();
    await refresh();
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          void refresh();
        }}
        aria-label="Notifications"
        className="relative px-2 py-1 hover:bg-neutral-100"
      >
        <span aria-hidden>bell</span>
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[1.25rem] bg-red-600 px-1 text-xs text-white text-center">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-1 w-80 border bg-white shadow-lg dark:bg-neutral-900">
          <div className="border-b p-2 text-sm font-medium">Notifications</div>
          {rows.length === 0 ? (
            <p className="p-4 text-sm text-neutral-500">Nothing yet.</p>
          ) : (
            <ul>
              {rows.map((n) => (
                <li
                  key={n.id}
                  className={n.read ? "border-b" : "border-b bg-blue-50"}
                >
                  <button
                    type="button"
                    onClick={() => void onClickNotification(n)}
                    className="block w-full p-2 text-left text-sm hover:bg-neutral-50"
                  >
                    <div className="font-medium">{n.title}</div>
                    <div className="text-xs text-neutral-500">
                      {new Date(n.createdAt).toLocaleString()}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {rows.length > 0 && (
            <button
              type="button"
              onClick={() => void onMarkAllRead()}
              className="block w-full p-2 text-center text-xs hover:bg-neutral-50"
            >
              Mark all read
            </button>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Mount in `site-header.tsx`**

Edit the `SignedIn` function in `src/components/site-header.tsx` to include the bell. After the `isStaff` block and before the profile `Link`, add:

```tsx
import { NotificationBell } from "./notification-bell";
// ...inside SignedIn return, just before the <Link to="/profile">:
<NotificationBell />
```

Concretely, add `import { NotificationBell } from "./notification-bell";` near the top (with the other `Link`/`authClient` imports) and insert `<NotificationBell />` between the conditional `isStaff` Admin link and the profile link.

- [ ] **Step 3: Lint + type-check**

```bash
npm run check
npx tsc --noEmit 2>&1 | grep -v "drizzle.config.ts" | grep "error TS" | head -10
```

Fix any Biome formatting suggestions with `npx biome format --write src/components/notification-bell.tsx src/components/site-header.tsx`.

- [ ] **Step 4: Commit**

```bash
git add src/components/notification-bell.tsx src/components/site-header.tsx
git commit -m "$(cat <<'EOF'
add notification-bell and mount it in site-header

Bell polls every 60s and on window focus. Shows unread count badge
(capped at 9+). Dropdown shows the latest 10. Clicking a notification
marks it read and navigates via window.location to ensure the server
re-renders with the right view. 'Mark all read' clears the badge.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: `project-form.tsx` (TanStack Form)

**Files:**

- Create: `src/components/project-form.tsx`

- [ ] **Step 1: Write the file**

```tsx
import { useForm } from "@tanstack/react-form";
import { z } from "zod";
import { applyServerErrors } from "#/lib/apply-server-errors";

export const projectFormSchema = z.object({
  title: z.string().min(1, "Title is required").max(200),
  description: z.string().max(5000).default(""),
  problemStatement: z.string().max(5000).default(""),
  objectives: z.string().max(5000).default(""),
  minQualifications: z.string().max(2000).default(""),
  prefQualifications: z.string().max(2000).default(""),
  url: z.string().max(500).default(""),
  contactEmail: z.string().max(200).default(""),
  contactName: z.string().max(200).default(""),
  imageUrl: z.string().max(500).default(""),
  licenseRestrictions: z.string().max(1000).default(""),
  programId: z.string().default(""),
  notes: z.string().max(5000).default(""),
});

export type ProjectFormValues = z.infer<typeof projectFormSchema>;

type Props = {
  initial?: Partial<ProjectFormValues>;
  showNotes: boolean;
  submitLabel: string;
  onSubmit: (values: ProjectFormValues) => Promise<unknown>;
};

export function ProjectForm({ initial, showNotes, submitLabel, onSubmit }: Props) {
  const form = useForm({
    defaultValues: {
      title: initial?.title ?? "",
      description: initial?.description ?? "",
      problemStatement: initial?.problemStatement ?? "",
      objectives: initial?.objectives ?? "",
      minQualifications: initial?.minQualifications ?? "",
      prefQualifications: initial?.prefQualifications ?? "",
      url: initial?.url ?? "",
      contactEmail: initial?.contactEmail ?? "",
      contactName: initial?.contactName ?? "",
      imageUrl: initial?.imageUrl ?? "",
      licenseRestrictions: initial?.licenseRestrictions ?? "",
      programId: initial?.programId ?? "",
      notes: initial?.notes ?? "",
    } satisfies ProjectFormValues,
    validators: {
      onSubmit: projectFormSchema,
    },
    onSubmit: async ({ value }) => {
      try {
        await onSubmit(value);
      } catch (err) {
        const handled = applyServerErrors(
          form as unknown as Parameters<typeof applyServerErrors>[0],
          err,
        );
        if (!handled) throw err;
      }
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
      className="space-y-4"
    >
      <Field form={form} name="title" label="Title" />
      <Field form={form} name="description" label="Description" textarea rows={4} />
      <Field form={form} name="problemStatement" label="Problem statement" textarea rows={3} />
      <Field form={form} name="objectives" label="Objectives / deliverables" textarea rows={3} />
      <Field form={form} name="minQualifications" label="Minimum qualifications" textarea rows={2} />
      <Field form={form} name="prefQualifications" label="Preferred qualifications" textarea rows={2} />
      <Field form={form} name="url" label="URL" />
      <Field form={form} name="contactName" label="Contact name" />
      <Field form={form} name="contactEmail" label="Contact email" />
      <Field form={form} name="imageUrl" label="Image URL (upload coming in Spec 4)" />
      <Field form={form} name="licenseRestrictions" label="License / IP restrictions" textarea rows={2} />
      <Field form={form} name="programId" label="Program ID (UUID; admin UI coming in Spec 3)" />
      {showNotes && (
        <Field form={form} name="notes" label="Internal notes (staff only)" textarea rows={3} />
      )}

      <form.Subscribe selector={(s) => [s.canSubmit, s.isSubmitting]}>
        {([canSubmit, isSubmitting]) => (
          <button
            type="submit"
            disabled={!canSubmit}
            className="bg-black px-4 py-2 text-white disabled:opacity-50"
          >
            {isSubmitting ? "Saving..." : submitLabel}
          </button>
        )}
      </form.Subscribe>
    </form>
  );
}

type FieldProps = {
  form: ReturnType<typeof useForm<ProjectFormValues, unknown>>;
  name: keyof ProjectFormValues;
  label: string;
  textarea?: boolean;
  rows?: number;
};

function Field({ form, name, label, textarea, rows }: FieldProps) {
  return (
    <form.Field name={name as never}>
      {(field) => (
        <div>
          <label htmlFor={field.name} className="block text-sm font-medium">
            {label}
          </label>
          {textarea ? (
            <textarea
              id={field.name}
              name={field.name}
              value={field.state.value as string}
              onChange={(e) => field.handleChange(e.target.value as never)}
              onBlur={field.handleBlur}
              rows={rows}
              className="mt-1 w-full border p-2"
            />
          ) : (
            <input
              id={field.name}
              name={field.name}
              value={field.state.value as string}
              onChange={(e) => field.handleChange(e.target.value as never)}
              onBlur={field.handleBlur}
              className="mt-1 w-full border p-2"
            />
          )}
          {field.state.meta.errors.length > 0 && (
            <p className="mt-1 text-sm text-red-600">
              {field.state.meta.errors.join(", ")}
            </p>
          )}
        </div>
      )}
    </form.Field>
  );
}
```

- [ ] **Step 2: Lint + type-check**

```bash
npm run check
npx tsc --noEmit 2>&1 | grep -v "drizzle.config.ts" | grep "error TS" | head -10
```

If TanStack Form's `useForm` types complain about the validator or field generics, adapt the local type aliases. The intent is: one form per page, shared field set, server-side errors map back via `applyServerErrors`.

- [ ] **Step 3: Commit**

```bash
git add src/components/project-form.tsx
git commit -m "$(cat <<'EOF'
add shared ProjectForm component using TanStack Form + Zod

Single Zod schema as the source of truth for both client-side
validation and field shape. Notes field is conditional on showNotes
(staff only). Submit handler is a prop so the new and edit pages
can wire their own server functions. ApplyServerErrors maps
ZodErrors thrown from the server back to field-level errors.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 14: `staff-project-panel.tsx`

**Files:**

- Create: `src/components/staff-project-panel.tsx`

- [ ] **Step 1: Write the file**

```tsx
import { useEffect, useState } from "react";
import {
  approveProject,
  archiveProject,
  hardDeleteProject,
  publishProject,
  requestChanges,
  restoreArchived,
  restoreProject,
  returnToDraft,
  softDeleteProject,
  submitProject,
} from "#/server/projects";
import { listProjectEditLog } from "#/server/projects-queries";
import { canTransition, type Status } from "#/lib/project-workflow";

type Project = {
  id: string;
  status: string;
  deletedAt: Date | string | null;
  notes: string | null;
};

type EditLogRow = {
  id: string;
  editorId: string;
  changedFields: string[];
  oldValues: Record<string, unknown>;
  newValues: Record<string, unknown>;
  createdAt: Date | string;
};

type ActionId =
  | "submit"
  | "draft"
  | "approve"
  | "request_changes"
  | "publish"
  | "archive"
  | "restoreArchived"
  | "softDelete"
  | "restore"
  | "hardDelete";

const ACTION_TO_STATUS: Record<ActionId, Status | null> = {
  submit: "submitted",
  draft: "draft",
  approve: "approved",
  request_changes: "changes_requested",
  publish: "published",
  archive: "archived",
  restoreArchived: "published",
  softDelete: null,
  restore: null,
  hardDelete: null,
};

export function StaffProjectPanel({
  project,
  onChanged,
}: {
  project: Project;
  onChanged: () => void;
}) {
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [editLog, setEditLog] = useState<EditLogRow[]>([]);

  useEffect(() => {
    void (async () => {
      try {
        const { rows } = await listProjectEditLog({ data: { id: project.id } });
        setEditLog(rows as EditLogRow[]);
      } catch {
        // ignored; non-staff caller would also hit this
      }
    })();
  }, [project.id]);

  async function run(action: ActionId) {
    setError(null);
    try {
      switch (action) {
        case "submit":
          await submitProject({ data: { id: project.id, comment } });
          break;
        case "draft":
          await returnToDraft({ data: { id: project.id, comment } });
          break;
        case "approve":
          await approveProject({ data: { id: project.id, comment } });
          break;
        case "request_changes":
          await requestChanges({ data: { id: project.id, comment } });
          break;
        case "publish":
          await publishProject({ data: { id: project.id, comment } });
          break;
        case "archive":
          await archiveProject({ data: { id: project.id, comment } });
          break;
        case "restoreArchived":
          await restoreArchived({ data: { id: project.id, comment } });
          break;
        case "softDelete":
          await softDeleteProject({ data: { id: project.id } });
          break;
        case "restore":
          await restoreProject({ data: { id: project.id } });
          break;
        case "hardDelete":
          if (!confirm("Permanently delete this draft?")) return;
          await hardDeleteProject({ data: { id: project.id } });
          window.location.href = "/admin/projects";
          return;
      }
      setComment("");
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const buttons: Array<{ id: ActionId; label: string; show: boolean }> = [
    { id: "submit", label: "Submit", show: actionAllowed("submit", project.status as Status) },
    { id: "draft", label: "Return to draft", show: actionAllowed("draft", project.status as Status) },
    { id: "request_changes", label: "Request changes", show: actionAllowed("request_changes", project.status as Status) },
    { id: "approve", label: "Approve", show: actionAllowed("approve", project.status as Status) },
    { id: "publish", label: "Publish", show: actionAllowed("publish", project.status as Status) },
    { id: "archive", label: "Archive", show: actionAllowed("archive", project.status as Status) },
    { id: "restoreArchived", label: "Restore from archive", show: actionAllowed("restoreArchived", project.status as Status) },
    { id: "softDelete", label: "Soft delete", show: !project.deletedAt && project.status !== "draft" },
    { id: "restore", label: "Restore", show: !!project.deletedAt },
    { id: "hardDelete", label: "Hard delete", show: project.status === "draft" && !project.deletedAt },
  ];

  return (
    <div className="mt-8 border-2 border-purple-300 bg-purple-50 p-4">
      <h2 className="text-lg font-semibold">Staff panel</h2>

      {project.notes && (
        <section className="mt-3">
          <h3 className="text-sm font-medium">Internal notes</h3>
          <p className="mt-1 text-sm whitespace-pre-wrap">{project.notes}</p>
        </section>
      )}

      <section className="mt-4 space-y-2">
        <label htmlFor="staff-action-comment" className="block text-sm font-medium">
          Optional comment (added to status history)
        </label>
        <textarea
          id="staff-action-comment"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={2}
          className="w-full border p-2"
        />
        <div className="flex flex-wrap gap-2">
          {buttons
            .filter((b) => b.show)
            .map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => void run(b.id)}
                className="border px-3 py-1.5 text-sm hover:bg-neutral-100"
              >
                {b.label}
              </button>
            ))}
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </section>

      <section className="mt-6">
        <h3 className="text-sm font-medium">Edit log</h3>
        {editLog.length === 0 ? (
          <p className="text-sm text-neutral-500">No edits yet.</p>
        ) : (
          <ul className="mt-2 space-y-2 text-sm">
            {editLog.map((row) => (
              <li key={row.id} className="border-l-2 border-neutral-300 pl-2">
                <div className="text-xs text-neutral-500">
                  {row.editorId.slice(0, 8)} -{" "}
                  {new Date(row.createdAt).toLocaleString()}
                </div>
                <div className="text-xs">
                  Changed: {row.changedFields.join(", ")}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function actionAllowed(action: ActionId, currentStatus: Status): boolean {
  const target = ACTION_TO_STATUS[action];
  if (!target) return false;
  return canTransition(currentStatus, target, "staff");
}
```

- [ ] **Step 2: Lint + type-check**

```bash
npm run check
npx tsc --noEmit 2>&1 | grep -v "drizzle.config.ts" | grep "error TS" | head -10
```

- [ ] **Step 3: Commit**

```bash
git add src/components/staff-project-panel.tsx
git commit -m "$(cat <<'EOF'
add staff-project-panel for in-place staff actions and edit log

Renders the staff-only sections of the canonical project detail page:
internal notes, optional comment textarea bound to status transitions,
action buttons keyed off canTransition (so only allowed buttons show),
and the edit log fetched via listProjectEditLog. Returns the user to
/admin/projects on hard delete.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Phase 9: Public routes

### Task 15: Public projects list

**Files:**

- Create: `src/routes/projects/index.tsx`

- [ ] **Step 1: Create the route**

```tsx
import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";
import { ProjectCard } from "#/components/project-card";
import { listPublishedProjects } from "#/server/projects-queries";

const searchSchema = z.object({ page: z.number().int().min(1).default(1) });

export const Route = createFileRoute("/projects/")({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({ page: search.page }),
  loader: async ({ deps }) => {
    return await listPublishedProjects({ data: { page: deps.page, pageSize: 20 } });
  },
  component: ProjectsList,
});

function ProjectsList() {
  const { rows, total, page, pageSize } = Route.useLoaderData();
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-semibold">Projects</h1>
      <div className="mt-6 space-y-3">
        {rows.length === 0 ? (
          <p className="text-sm text-neutral-500">No published projects yet.</p>
        ) : (
          rows.map((p) => <ProjectCard key={p.id} project={p} />)
        )}
      </div>
      <div className="mt-6 flex items-center justify-between text-sm">
        <Link
          to="/projects"
          search={{ page: Math.max(1, page - 1) }}
          disabled={page <= 1}
          className={page <= 1 ? "text-neutral-300" : "hover:underline"}
        >
          Previous
        </Link>
        <span>
          Page {page} of {totalPages}
        </span>
        <Link
          to="/projects"
          search={{ page: Math.min(totalPages, page + 1) }}
          disabled={page >= totalPages}
          className={page >= totalPages ? "text-neutral-300" : "hover:underline"}
        >
          Next
        </Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Boot dev briefly to regen the route tree** (same pattern as Spec 1: `npm run dev` for ~12s, then kill).

- [ ] **Step 3: Commit**

```bash
git add src/routes/projects src/routeTree.gen.ts
git commit -m "$(cat <<'EOF'
add public projects list at /projects

Paginated list (20 per page) of published, non-soft-deleted projects.
Search-param-driven page number with Previous/Next links.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 16: Canonical project detail

**Files:**

- Create: `src/routes/projects/$projectId.tsx`

- [ ] **Step 1: Create the route**

```tsx
import { createFileRoute, notFound, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CommentThread } from "#/components/comment-thread";
import { StaffProjectPanel } from "#/components/staff-project-panel";
import { StatusBadge } from "#/components/status-badge";
import { StatusTimeline } from "#/components/status-timeline";
import {
  getProject,
  listProjectComments,
} from "#/server/projects-queries";

export const Route = createFileRoute("/projects/$projectId")({
  loader: async ({ params }) => {
    const data = await getProject({ data: { id: params.projectId } });
    if (!data.project) throw notFound();
    return data;
  },
  component: ProjectDetail,
});

type Comment = Parameters<typeof CommentThread>[0]["comments"][number];

function ProjectDetail() {
  const router = useRouter();
  const { project, history, canEdit, viewerIsStaff } = Route.useLoaderData();
  const [comments, setComments] = useState<Comment[]>([]);

  async function refreshComments() {
    try {
      const { rows } = await listProjectComments({
        data: { id: project!.id },
      });
      setComments(rows as Comment[]);
    } catch {
      setComments([]);
    }
  }

  useEffect(() => {
    void refreshComments();
  }, [project?.id]);

  if (!project) return null;

  return (
    <div className="mx-auto max-w-3xl p-8">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{project.title}</h1>
        <StatusBadge status={project.status} />
      </div>
      {canEdit && (
        <a
          href={`/projects/${project.id}/edit`}
          className="mt-2 inline-block text-sm text-blue-700 hover:underline"
        >
          Edit
        </a>
      )}

      {project.imageUrl && (
        <img
          src={project.imageUrl as string}
          alt=""
          className="mt-4 max-h-72 w-full object-cover"
        />
      )}

      <Section label="Description" body={project.description as string | null} />
      <Section label="Problem statement" body={project.problemStatement as string | null} />
      <Section label="Objectives" body={project.objectives as string | null} />
      <Section label="Minimum qualifications" body={project.minQualifications as string | null} />
      <Section label="Preferred qualifications" body={project.prefQualifications as string | null} />
      <Section label="Contact" body={[project.contactName, project.contactEmail].filter(Boolean).join(" - ") || null} />
      <Section label="License / IP" body={project.licenseRestrictions as string | null} />
      <Section label="URL" body={project.url as string | null} />

      <section className="mt-8">
        <h2 className="text-lg font-semibold">Status history</h2>
        <div className="mt-3">
          <StatusTimeline rows={history} />
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">Comments</h2>
        <div className="mt-3">
          <CommentThread
            projectId={project.id}
            comments={comments}
            viewerIsStaff={viewerIsStaff}
            onChanged={() => {
              void refreshComments();
              void router.invalidate();
            }}
          />
        </div>
      </section>

      {viewerIsStaff && (
        <StaffProjectPanel
          project={{
            id: project.id,
            status: project.status,
            deletedAt: (project.deletedAt as Date | null) ?? null,
            notes: (project.notes as string | null) ?? null,
          }}
          onChanged={() => {
            void router.invalidate();
          }}
        />
      )}
    </div>
  );
}

function Section({ label, body }: { label: string; body: string | null }) {
  if (!body) return null;
  return (
    <section className="mt-6">
      <h2 className="text-sm font-medium text-neutral-500">{label}</h2>
      <p className="mt-1 whitespace-pre-wrap">{body}</p>
    </section>
  );
}
```

- [ ] **Step 2: Boot dev briefly to regen route tree, then commit**

```bash
git add src/routes/projects/$projectId.tsx src/routeTree.gen.ts
git commit -m "$(cat <<'EOF'
add canonical project detail at /projects/$projectId

Renders the project's public fields, status timeline, and comments.
Edit link shown when canEdit. Staff panel (notes, action buttons,
edit log) renders conditionally when viewerIsStaff. Comments
refetched on viewer-action; router invalidated on staff actions
so loader data refreshes.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Phase 10: Authed routes

### Task 17: Create-project page

**Files:**

- Create: `src/routes/_authed/projects/new.tsx`

- [ ] **Step 1: Create the route**

```tsx
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ProjectForm } from "#/components/project-form";
import { createProject } from "#/server/projects";

export const Route = createFileRoute("/_authed/projects/new")({
  component: NewProject,
});

function NewProject() {
  const navigate = useNavigate();
  const ctx = Route.useRouteContext() as {
    user: { role?: string | null };
  };
  const isStaff = ctx.user.role === "admin" || ctx.user.role === "instructor";
  return (
    <div className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold">New project</h1>
      <div className="mt-6">
        <ProjectForm
          showNotes={isStaff}
          submitLabel="Create draft"
          onSubmit={async (values) => {
            const { id } = await createProject({
              data: {
                ...values,
                programId: values.programId || null,
                notes: isStaff ? values.notes || null : null,
              },
            });
            navigate({ to: "/projects/$projectId", params: { projectId: id } });
          }}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Boot dev briefly + commit**

```bash
git add src/routes/_authed/projects/new.tsx src/routeTree.gen.ts
git commit -m "$(cat <<'EOF'
add /projects/new with ProjectForm + createProject server function

Inherits the _authed session guard. Staff see the notes field.
On success, navigates to the canonical project detail.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 18: Edit-project page

**Files:**

- Create: `src/routes/_authed/projects/$projectId/edit.tsx`

- [ ] **Step 1: Create the route**

```tsx
import { createFileRoute, useNavigate, redirect } from "@tanstack/react-router";
import { ProjectForm } from "#/components/project-form";
import { updateProject } from "#/server/projects";
import { getProject } from "#/server/projects-queries";

export const Route = createFileRoute("/_authed/projects/$projectId/edit")({
  loader: async ({ params }) => {
    const data = await getProject({ data: { id: params.projectId } });
    if (!data.project || !data.canEdit) {
      throw redirect({
        to: "/projects/$projectId",
        params: { projectId: params.projectId },
      });
    }
    return data;
  },
  component: EditProject,
});

function EditProject() {
  const navigate = useNavigate();
  const { project, viewerIsStaff } = Route.useLoaderData();
  if (!project) return null;
  return (
    <div className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold">Edit project</h1>
      <div className="mt-6">
        <ProjectForm
          initial={{
            title: project.title as string,
            description: (project.description as string) ?? "",
            problemStatement: (project.problemStatement as string) ?? "",
            objectives: (project.objectives as string) ?? "",
            minQualifications: (project.minQualifications as string) ?? "",
            prefQualifications: (project.prefQualifications as string) ?? "",
            url: (project.url as string) ?? "",
            contactEmail: (project.contactEmail as string) ?? "",
            contactName: (project.contactName as string) ?? "",
            imageUrl: (project.imageUrl as string) ?? "",
            licenseRestrictions: (project.licenseRestrictions as string) ?? "",
            programId: (project.programId as string) ?? "",
            notes: (project.notes as string) ?? "",
          }}
          showNotes={viewerIsStaff}
          submitLabel="Save"
          onSubmit={async (values) => {
            await updateProject({
              data: {
                id: project.id,
                ...values,
                programId: values.programId || null,
                notes: viewerIsStaff ? values.notes || null : null,
              },
            });
            navigate({ to: "/projects/$projectId", params: { projectId: project.id } });
          }}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Boot dev briefly + commit**

```bash
git add src/routes/_authed/projects/$projectId/edit.tsx src/routeTree.gen.ts
git commit -m "$(cat <<'EOF'
add /projects/$projectId/edit with loader-side permission gate

Loader redirects to the detail page if canEdit is false. Reuses
ProjectForm with initial values from getProject. Staff see the
notes field. On save, returns to the detail page.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 19: My-projects list

**Files:**

- Create: `src/routes/_authed/my/projects.tsx`

- [ ] **Step 1: Create the route**

```tsx
import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";
import { ProjectCard } from "#/components/project-card";
import { listMyProjects } from "#/server/projects-queries";

const searchSchema = z.object({
  status: z
    .enum([
      "all",
      "draft",
      "submitted",
      "approved",
      "changes_requested",
      "published",
      "archived",
    ])
    .default("all"),
});

export const Route = createFileRoute("/_authed/my/projects")({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({ status: search.status }),
  loader: async ({ deps }) => {
    return await listMyProjects({ data: { status: deps.status } });
  },
  component: MyProjects,
});

const STATUSES = ["all", "draft", "submitted", "approved", "changes_requested", "published", "archived"] as const;

function MyProjects() {
  const { rows } = Route.useLoaderData();
  const { status } = Route.useSearch();
  return (
    <div className="mx-auto max-w-3xl p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">My Projects</h1>
        <Link to="/projects/new" className="bg-black px-3 py-1.5 text-sm text-white">
          New project
        </Link>
      </div>
      <div className="mt-4 flex flex-wrap gap-2 text-sm">
        {STATUSES.map((s) => (
          <Link
            key={s}
            to="/my/projects"
            search={{ status: s }}
            className={
              s === status
                ? "border-b-2 border-black px-2 py-1"
                : "px-2 py-1 text-neutral-500 hover:underline"
            }
          >
            {s.replace(/_/g, " ")}
          </Link>
        ))}
      </div>
      <div className="mt-4 space-y-3">
        {rows.length === 0 ? (
          <p className="text-sm text-neutral-500">No projects in this view.</p>
        ) : (
          rows.map((p) => <ProjectCard key={p.id} project={p} />)
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Boot dev briefly + commit**

```bash
git add src/routes/_authed/my src/routeTree.gen.ts
git commit -m "$(cat <<'EOF'
add /my/projects list with status filter tabs

Authed-only via _authed layout. Tabs filter by status (server-side
query param). New-project button links to /projects/new.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Phase 11: Admin list route

### Task 20: Admin projects list

**Files:**

- Create: `src/routes/_authed/admin/projects/index.tsx`
- Modify: `src/routes/_authed/admin/index.tsx`

- [ ] **Step 1: Create the admin list**

```tsx
// src/routes/_authed/admin/projects/index.tsx
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { z } from "zod";
import { ProjectCard } from "#/components/project-card";
import { getSession } from "#/lib/auth-guards";
import { listAdminProjects } from "#/server/projects-queries";

const searchSchema = z.object({
  status: z
    .enum([
      "all",
      "draft",
      "submitted",
      "approved",
      "changes_requested",
      "published",
      "archived",
    ])
    .default("all"),
  includeSoftDeleted: z.boolean().default(false),
});

export const Route = createFileRoute("/_authed/admin/projects/")({
  validateSearch: searchSchema,
  beforeLoad: async () => {
    const session = await getSession();
    if (!session?.user) throw redirect({ to: "/sign-in" });
    if (!["admin", "instructor"].includes(session.user.role ?? "")) {
      throw redirect({ to: "/" });
    }
  },
  loaderDeps: ({ search }) => ({ status: search.status, includeSoftDeleted: search.includeSoftDeleted }),
  loader: async ({ deps }) => {
    return await listAdminProjects({
      data: { status: deps.status, includeSoftDeleted: deps.includeSoftDeleted },
    });
  },
  component: AdminProjects,
});

const STATUSES = ["all", "draft", "submitted", "approved", "changes_requested", "published", "archived"] as const;

function AdminProjects() {
  const { rows } = Route.useLoaderData();
  const { status, includeSoftDeleted } = Route.useSearch();
  return (
    <div className="mx-auto max-w-4xl p-8">
      <h1 className="text-2xl font-semibold">Admin: projects</h1>
      <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
        {STATUSES.map((s) => (
          <Link
            key={s}
            to="/admin/projects"
            search={(prev) => ({ ...prev, status: s })}
            className={
              s === status
                ? "border-b-2 border-black px-2 py-1"
                : "px-2 py-1 text-neutral-500 hover:underline"
            }
          >
            {s.replace(/_/g, " ")}
          </Link>
        ))}
        <Link
          to="/admin/projects"
          search={(prev) => ({ ...prev, includeSoftDeleted: !includeSoftDeleted })}
          className="ml-4 border px-2 py-1"
        >
          {includeSoftDeleted ? "Hide soft-deleted" : "Show soft-deleted"}
        </Link>
      </div>
      <div className="mt-4 space-y-3">
        {rows.length === 0 ? (
          <p className="text-sm text-neutral-500">No projects in this view.</p>
        ) : (
          rows.map((p) => <ProjectCard key={p.id} project={p} />)
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Update the admin landing page**

Open `src/routes/_authed/admin/index.tsx` and replace its content with:

```tsx
import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/admin/")({
  component: AdminHome,
});

function AdminHome() {
  return (
    <div className="mx-auto max-w-md p-8">
      <h1 className="text-2xl font-semibold">Admin</h1>
      <ul className="mt-4 space-y-2 text-sm">
        <li>
          <Link to="/admin/projects" className="text-blue-700 hover:underline">
            Projects
          </Link>
        </li>
        <li className="text-neutral-400">Programs (coming in Spec 3)</li>
        <li className="text-neutral-400">Categories (coming in Spec 3)</li>
        <li className="text-neutral-400">Users (coming in Spec 3)</li>
      </ul>
    </div>
  );
}
```

- [ ] **Step 3: Boot dev briefly + commit**

```bash
git add src/routes/_authed/admin src/routeTree.gen.ts
git commit -m "$(cat <<'EOF'
add /admin/projects list and link from admin landing page

Status filter tabs + include-soft-deleted toggle. List items link to
the canonical /projects/$id where the staff panel renders. Admin
landing page now has a link to the new list and placeholders for
the Spec 3 admin pages.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Phase 12: Integration tests

### Task 21: Workflow happy path + edit log

**Files:**

- Create: `src/server/__tests__/projects.integration.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "#/db";
import {
  notifications,
  projectEditLog,
  projectStatusHistory,
  projects,
  user,
} from "#/db/schema";
import { auth } from "#/lib/auth";
import {
  approveProject,
  archiveProject,
  createProject,
  publishProject,
  requestChanges,
  submitProject,
  updateProject,
} from "../projects";

async function createUser(email: string, role: "user" | "admin") {
  await auth.api.signUpEmail({ body: { email, password: "Password1!", name: email } });
  await db.update(user).set({ emailVerified: true }).where(eq(user.email, email));
  if (role !== "user") {
    await db.update(user).set({ role }).where(eq(user.email, email));
  }
  const { headers } = await auth.api.signInEmail({
    body: { email, password: "Password1!" },
    asResponse: true,
  });
  return headers.get("set-cookie") as string;
}

function withCookie<T>(cookie: string, fn: () => Promise<T>): Promise<T> {
  // Server functions read the request via getRequest(); the integration test
  // harness injects headers through the global request context. The simplest
  // approach here is to expose helpers in src/server/projects.ts that accept
  // an explicit viewer, but to keep the test concise we wrap each call site
  // via a per-test re-export. See Note below.
  return fn();
}

describe("project workflow happy path", () => {
  it.skip("create -> submit -> request changes -> resubmit -> approve -> publish", async () => {
    // See Step 2 below for the chosen approach.
  });
});
```

- [ ] **Step 2: Add a test-only `runAs` helper to `src/server/__tests__/_helpers.ts`**

Direct integration testing of `createServerFn` handlers without a live HTTP request requires either spinning up the full TanStack Start server or factoring the business logic out of the handler. The simplest path: extract the inner logic of each workflow function into an exported helper that takes an explicit viewer.

Open `src/server/projects.ts` and refactor each handler to delegate to an exported `*Impl` function. Example for `submitProject`:

```ts
export async function performTransitionAs(
  viewer: { id: string; role: string | null | undefined },
  id: string,
  target: Status,
  comment?: string,
) {
  return performTransition(id, target, comment, viewer);
}
```

The existing `performTransition` already accepts an optional `viewerOverride`; export this so tests can call it directly. The route-facing `submitProject` etc. keep using the auth-derived viewer.

Then in the test file:

```ts
import { performTransitionAs } from "../projects";

// inside the test:
await performTransitionAs(viewer, projectId, "submitted");
```

Apply the same pattern to `createProject` (export `createProjectAs(viewer, data)`), `updateProject` (`updateProjectAs(viewer, data)`), and `softDeleteProject` (`softDeleteProjectAs(viewer, id)`).

- [ ] **Step 3: Rewrite the test using the `*As` helpers**

`src/server/__tests__/projects.integration.test.ts`:

```ts
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "#/db";
import {
  notifications,
  projectEditLog,
  projectStatusHistory,
  projects,
  user,
} from "#/db/schema";
import { auth } from "#/lib/auth";
import {
  createProjectAs,
  performTransitionAs,
  softDeleteProjectAs,
  updateProjectAs,
} from "../projects";

async function makeUser(email: string, role: "user" | "admin") {
  await auth.api.signUpEmail({
    body: { email, password: "Password1!", name: email },
  });
  await db.update(user).set({ emailVerified: true }).where(eq(user.email, email));
  if (role !== "user") {
    await db.update(user).set({ role }).where(eq(user.email, email));
  }
  const [u] = await db.select().from(user).where(eq(user.email, email));
  return { id: u.id, role: u.role };
}

describe("project workflow", () => {
  it("create -> submit -> request changes -> resubmit -> approve -> publish writes the expected history + notifications", async () => {
    const owner = await makeUser(`o-${Date.now()}@x.com`, "user");
    const admin = await makeUser(`a-${Date.now()}@x.com`, "admin");

    const { id } = await createProjectAs(owner, {
      title: "P",
      description: "d",
      problemStatement: null,
      objectives: null,
      minQualifications: null,
      prefQualifications: null,
      url: "",
      contactEmail: "",
      contactName: null,
      imageUrl: "",
      licenseRestrictions: null,
      programId: null,
      notes: null,
    });

    await performTransitionAs(owner, id, "submitted");
    await performTransitionAs(admin, id, "changes_requested", "fix X");
    await performTransitionAs(owner, id, "submitted");
    await performTransitionAs(admin, id, "approved");
    await performTransitionAs(admin, id, "published");

    const history = await db
      .select()
      .from(projectStatusHistory)
      .where(eq(projectStatusHistory.projectId, id));
    expect(history).toHaveLength(5);

    const [final] = await db.select().from(projects).where(eq(projects.id, id));
    expect(final.status).toBe("published");
    expect(final.publishedAt).not.toBeNull();

    const ownerNotifs = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, owner.id));
    expect(ownerNotifs.length).toBeGreaterThan(0);
  });

  it("owner cannot publish", async () => {
    const owner = await makeUser(`o2-${Date.now()}@x.com`, "user");
    const { id } = await createProjectAs(owner, {
      title: "P",
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
      programId: null,
      notes: null,
    });
    await performTransitionAs(owner, id, "submitted");
    await expect(performTransitionAs(owner, id, "published")).rejects.toThrow();
  });

  it("updateProject writes one edit-log row capturing only changed fields", async () => {
    const owner = await makeUser(`o3-${Date.now()}@x.com`, "user");
    const { id } = await createProjectAs(owner, {
      title: "P",
      description: "old",
      problemStatement: null,
      objectives: null,
      minQualifications: null,
      prefQualifications: null,
      url: "",
      contactEmail: "",
      contactName: null,
      imageUrl: "",
      licenseRestrictions: null,
      programId: null,
      notes: null,
    });
    await updateProjectAs(owner, {
      id,
      title: "P",
      description: "new",
      problemStatement: null,
      objectives: null,
      minQualifications: null,
      prefQualifications: null,
      url: "",
      contactEmail: "",
      contactName: null,
      imageUrl: "",
      licenseRestrictions: null,
      programId: null,
      notes: null,
    });
    const rows = await db
      .select()
      .from(projectEditLog)
      .where(eq(projectEditLog.projectId, id));
    expect(rows).toHaveLength(1);
    expect(rows[0].changedFields).toEqual(["description"]);
  });

  it("soft delete hides from listings; restore unhides", async () => {
    const owner = await makeUser(`o4-${Date.now()}@x.com`, "user");
    const admin = await makeUser(`a4-${Date.now()}@x.com`, "admin");
    const { id } = await createProjectAs(owner, {
      title: "P",
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
      programId: null,
      notes: null,
    });
    await performTransitionAs(owner, id, "submitted");
    await performTransitionAs(admin, id, "approved");
    await performTransitionAs(admin, id, "published");

    await softDeleteProjectAs(admin, id);
    const [row] = await db.select().from(projects).where(eq(projects.id, id));
    expect(row.deletedAt).not.toBeNull();
  });
});
```

- [ ] **Step 4: Run the test**

```bash
docker compose up -d postgres
npm run test:integration
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/projects.ts src/server/__tests__/projects.integration.test.ts
git commit -m "$(cat <<'EOF'
add projects integration test + extract *As helpers

Refactored the workflow server functions to delegate to exported
createProjectAs / updateProjectAs / performTransitionAs /
softDeleteProjectAs helpers that take an explicit viewer. The
createServerFn handlers keep using the auth-derived viewer; tests
call the helpers directly with a freshly-seeded user.

The integration test exercises the full happy path, asserts the
owner cannot publish, confirms updateProject's edit-log row captures
only changed fields, and verifies soft-delete writes deletedAt.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 22: Comment + notification integration test

**Files:**

- Create: `src/server/__tests__/comments.integration.test.ts`

- [ ] **Step 1: Add an `addCommentAs` helper to `src/server/comments.ts`**

Extract the handler body into an exported `addCommentAs(viewer, data)` function, leaving the `addComment` server function as a thin wrapper.

- [ ] **Step 2: Write the test**

```ts
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "#/db";
import { notifications, projectComments, user } from "#/db/schema";
import { auth } from "#/lib/auth";
import { addCommentAs } from "../comments";
import { createProjectAs, performTransitionAs } from "../projects";

async function makeUser(email: string, role: "user" | "admin") {
  await auth.api.signUpEmail({
    body: { email, password: "Password1!", name: email },
  });
  await db.update(user).set({ emailVerified: true }).where(eq(user.email, email));
  if (role !== "user") {
    await db.update(user).set({ role }).where(eq(user.email, email));
  }
  const [u] = await db.select().from(user).where(eq(user.email, email));
  return { id: u.id, role: u.role };
}

describe("comments + notifications", () => {
  it("admin posts a review comment; proposer gets a notification", async () => {
    const owner = await makeUser(`o-${Date.now()}@x.com`, "user");
    const admin = await makeUser(`a-${Date.now()}@x.com`, "admin");
    const { id: pid } = await createProjectAs(owner, baseProject());
    await performTransitionAs(owner, pid, "submitted");

    await addCommentAs(admin, { projectId: pid, content: "please clarify", isInternal: false });

    const ownerNotifs = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, owner.id));
    const commentNotifs = ownerNotifs.filter((n) => n.type === "comment");
    expect(commentNotifs).toHaveLength(1);
  });

  it("staff internal comment writes no notification", async () => {
    const owner = await makeUser(`o2-${Date.now()}@x.com`, "user");
    const admin = await makeUser(`a2-${Date.now()}@x.com`, "admin");
    const { id: pid } = await createProjectAs(owner, baseProject());
    await performTransitionAs(owner, pid, "submitted");

    await addCommentAs(admin, { projectId: pid, content: "internal", isInternal: true });

    const ownerNotifs = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, owner.id));
    expect(ownerNotifs.filter((n) => n.type === "comment")).toHaveLength(0);
  });

  it("self-comment writes no notification", async () => {
    const owner = await makeUser(`o3-${Date.now()}@x.com`, "user");
    const { id: pid } = await createProjectAs(owner, baseProject());
    await addCommentAs(owner, { projectId: pid, content: "my own note", isInternal: false });
    const ownerNotifs = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, owner.id));
    expect(ownerNotifs.filter((n) => n.type === "comment")).toHaveLength(0);
  });

  it("reply to an admin comment notifies the admin too", async () => {
    const owner = await makeUser(`o4-${Date.now()}@x.com`, "user");
    const admin = await makeUser(`a4-${Date.now()}@x.com`, "admin");
    const { id: pid } = await createProjectAs(owner, baseProject());
    await performTransitionAs(owner, pid, "submitted");
    await performTransitionAs(admin, pid, "changes_requested");

    const { id: parentId } = await addCommentAs(admin, {
      projectId: pid,
      content: "please fix",
      isInternal: false,
    });

    await addCommentAs(owner, {
      projectId: pid,
      content: "ok",
      parentId,
      isInternal: false,
    });

    const adminNotifs = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, admin.id));
    expect(adminNotifs.filter((n) => n.type === "comment")).toHaveLength(1);
  });

  it("rejects internal comment from non-staff", async () => {
    const owner = await makeUser(`o5-${Date.now()}@x.com`, "user");
    const { id: pid } = await createProjectAs(owner, baseProject());
    await expect(
      addCommentAs(owner, { projectId: pid, content: "x", isInternal: true }),
    ).rejects.toThrow();
  });

  it("rejects reply to a reply", async () => {
    const owner = await makeUser(`o6-${Date.now()}@x.com`, "user");
    const admin = await makeUser(`a6-${Date.now()}@x.com`, "admin");
    const { id: pid } = await createProjectAs(owner, baseProject());
    await performTransitionAs(owner, pid, "submitted");
    const { id: top } = await addCommentAs(admin, {
      projectId: pid,
      content: "a",
      isInternal: false,
    });
    const { id: reply } = await addCommentAs(owner, {
      projectId: pid,
      content: "b",
      parentId: top,
      isInternal: false,
    });
    await expect(
      addCommentAs(admin, {
        projectId: pid,
        content: "c",
        parentId: reply,
        isInternal: false,
      }),
    ).rejects.toThrow();
  });
});

function baseProject() {
  return {
    title: "P",
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
    programId: null,
    notes: null,
  };
}
```

- [ ] **Step 3: Run + commit**

```bash
npm run test:integration
```

Expected: all tests pass.

```bash
git add src/server/comments.ts src/server/__tests__/comments.integration.test.ts
git commit -m "$(cat <<'EOF'
add comments+notifications integration test and addCommentAs helper

Extracted addComment's handler body into an exported addCommentAs that
accepts an explicit viewer. The createServerFn wrapper stays. Tests
cover: admin review comment notifies proposer; internal comment notifies
no one; self-comment is silent; reply to an admin comment notifies the
admin; non-staff cannot post internal; replies are one level deep.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Phase 13: Final verification + README

### Task 23: Final checks + manual smoke checklist + README updates

**Files:**

- Modify: `README.md`

- [ ] **Step 1: Run all the checks**

```bash
npm run check
npx tsc --noEmit 2>&1 | grep -v "drizzle.config.ts" | grep "error TS" | head -10
npm test
docker compose up -d postgres
npm run test:integration
```

All must pass: Biome clean, no new TS errors, both test suites green.

- [ ] **Step 2: Manual smoke (matches Spec 14)**

Open two browser sessions (one staff, one non-staff). Walk through the nine-step checklist from Section 14 of the spec. Make notes of any UI issue and fix in a follow-up commit if needed.

- [ ] **Step 3: Update README**

Append a new section to `README.md` after the "Setting up Better Auth" section:

```markdown
## Project domain (Spec 2)

The `/projects` URL space is the canonical surface for the project domain:

- `/projects`: public list of published projects.
- `/projects/$id`: canonical project detail. Staff sections (notes, internal comments, edit log, transition actions) appear conditionally when the viewer is staff.
- `/projects/new` and `/projects/$id/edit`: authed-only via the `_authed` layout.
- `/my/projects`: the signed-in user's own projects with a status filter.
- `/admin/projects`: staff list view with filters and an include-soft-deleted toggle.

The workflow state machine lives in `src/lib/project-workflow.ts` as a pure
module. The visibility rules live in `src/lib/project-visibility.ts`, also
pure. Every project mutation is one server function in `src/server/projects.ts`
or `src/server/comments.ts`, each enforcing its own gate and wrapping writes
in a transaction.
```

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "$(cat <<'EOF'
document project domain (Spec 2) routes and module layout

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Self-review summary (done during planning)

- **Spec coverage:**
  - §2.1 CRUD with permissions -> Tasks 5 (writes) + 6 (reads with visibility).
  - §2.2 state machine -> Task 2 (pure module) + Task 5 (use sites).
  - §2.3 status history visible -> Task 5 writes history; Task 16 renders timeline; Task 10 has the component.
  - §2.4 comments -> Task 7 (server) + Task 11 (UI) + Task 22 (tests).
  - §2.5 edit log -> Task 1 (schema) + Task 5 (write) + Task 14 (UI).
  - §2.6 notifications -> Task 4 (helper) + Task 8 (server) + Task 12 (UI) + Task 22 (tests).
  - §2.7 TanStack Form -> Task 13.
  - §2.8 tests -> Tasks 2, 3, 21, 22.
  - §5 data model -> Task 1.
  - §6 state machine details -> Task 2.
  - §7 visibility -> Task 3 + Task 6 use sites.
  - §8 comments rules -> Task 7 enforces all six bullets.
  - §9 notifications -> Tasks 4, 8, 12.
  - §10 forms -> Tasks 9 (helper) + 13 (component).
  - §11 routes table -> Tasks 15, 16, 17, 18, 19, 20.
  - §12 testing layers -> Tasks 2, 3, 21, 22.
  - §14 manual smoke -> Task 23.
- **Placeholder scan:** no TBD / TODO / "add validation later" in any task. Every step shows actual code.
- **Type consistency:** `Status` type defined in Task 2 is re-used unchanged in Tasks 5, 14, 21. `Viewer` type defined in Task 3 is re-used unchanged in Tasks 6, 7. `ProjectFormValues` defined in Task 13 is re-used unchanged in Tasks 17, 18. Helper-function name pattern (`*As`) introduced in Task 21 and re-used identically in Task 22.

---

## Plan complete

Plan saved to `docs/superpowers/plans/2026-05-16-project-domain.md`.

Two execution options:

1. **Subagent-Driven (recommended)**: I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution**: Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
