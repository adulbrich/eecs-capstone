# Project Mentorship Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mark projects as student-proposed, let staff record a mentor's email, and show the
public a "Seeking mentor" badge or the mentor's name, never the address.

**Architecture:** Two new columns on `projects`. One staff-only server function writes them
and logs the edit. The shared `projectSummarySelect` projection and `projectDetailView`
carry `studentProposed`, a SQL-derived `seekingMentor` flag, and a mentor name resolved by
a correlated subquery on `lower(user.email)`. A `MentorshipBadges` component renders the
public state on card, row and detail page; a "Mentorship" section in the staff panel edits
it.

**Tech Stack:** TanStack Start server functions, Drizzle ORM on PostgreSQL, Zod, React with
shadcn/ui, Vitest (unit under jsdom, integration against docker Postgres), Biome via
ultracite.

**Spec:** `docs/superpowers/specs/2026-09-02-project-mentorship-design.md`. Issue #75 is
the originating spec; the design doc records where the issue's picture of the tree was wrong.

## Global Constraints

- Prose contains no emdashes and no emojis: commit messages, comments, string literals,
  docs. A `--` standing in for a dash is the same violation.
- Conventional Commits, lowercase imperative subject, area in parens:
  `feat(projects): add the student-proposed and mentor columns`.
- Keep the body short or leave it out. Keep the `Co-Authored-By` trailer. Never publish a
  `claude.ai/code/session` link.
- Stage files by name. Never `git add -A` or `git add .`.
- Branch is `claude/issue-75-mentorship`. Never commit to `main`.
- `*As(viewer, ...)` first, wrapper second, in the same file. `src/server/__tests__/seam-convention.test.ts` enforces it.
- Every `createServerFn` gets a line in `src/server/__tests__/access-contract.ts` or `access-contract.test.ts` fails.
- Import `createServerFn` from `@tanstack/react-start`; use `.inputValidator(...)`.
- An impl imports its input types from its domain wrapper (`../projects`), never from a schema.
- Run Vitest with the agent sandbox off and `ulimit -n 8192` set, on the Node in `.nvmrc` (24.16.0).
- Before every commit: `npm run check`, `npm run typecheck`, `npm test`. Run
  `npm run test:integration` (docker Postgres and RustFS up) for any task touching the
  database layer.
- `mentorEmail` never reaches a public payload. Every read task re-checks this.

---

### Task 1: Schema columns and migration

**Files:**
- Modify: `src/db/schema.ts:148` (after `isSponsored`)
- Create: `drizzle/0017_project_mentorship.sql` (generated)
- Modify: `drizzle/meta/_journal.json`, `drizzle/meta/0017_snapshot.json` (generated)

**Interfaces:**
- Produces: `projects.studentProposed: boolean` (not null, default false) and
  `projects.mentorEmail: string | null` on the Drizzle table, used by every later task.

- [ ] **Step 1: Add the columns**

In `src/db/schema.ts`, directly after the `isSponsored` line:

```ts
    // Public. Marks a project as a student's own proposal, which is what makes
    // "Seeking mentor" show while mentorEmail is null. Written by staff only,
    // during review; a student has no reason to self-classify. Not derived
    // from the proposer's role or affiliation, both of which drift. See #75.
    studentProposed: boolean("student_proposed").notNull().default(false),
    // Staff-only, never in a public payload. Resolved to a name at read time
    // by a case-insensitive match on user.email. No FK and no mentor_id:
    // mentorship grants no permission, so an id would be a denormalization
    // with nothing to trust it for. #84 nulls it when that account is deleted.
    mentorEmail: text("mentor_email"),
```

- [ ] **Step 2: Generate the migration**

Run (needs `DATABASE_URL` from `.env.local`, docker Postgres up):

```bash
npx drizzle-kit generate --name project_mentorship
```

Expected: `drizzle/0017_project_mentorship.sql` containing exactly:

```sql
ALTER TABLE "projects" ADD COLUMN "student_proposed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "mentor_email" text;
```

If it contains anything else, the schema drifted from the last snapshot; stop and report.

- [ ] **Step 3: Apply it locally and typecheck**

```bash
npm run db:migrate
npm run typecheck
```

Expected: migration applies, typecheck clean.

- [ ] **Step 4: Commit**

```bash
git add src/db/schema.ts drizzle/0017_project_mentorship.sql drizzle/meta/_journal.json drizzle/meta/0017_snapshot.json
git commit -m "feat(projects): add the student-proposed and mentor columns"
```

---

### Task 2: Read path, the projection and the detail view

**Files:**
- Modify: `src/server/_internal/project-summary.ts`
- Modify: `src/lib/project-visibility.ts:110-206`
- Modify: `src/server/_internal/projects-queries.ts:258-267` (`getProjectAs`)
- Test: `src/lib/__tests__/project-visibility.test.ts:150-240`
- Test: `src/server/__tests__/projects.integration.test.ts:280-320`

**Interfaces:**
- Consumes: the two columns from Task 1.
- Produces: `mentorNameSql: SQL<string | null>` and `seekingMentorSql: SQL<boolean>`
  exported from `project-summary.ts`; `projectSummarySelect` and `ProjectDetailView` gain
  `studentProposed: boolean`, `seekingMentor: boolean`, `mentorName: string | null`.
  `ProjectRow` gains those three plus `mentorEmail: string | null`.

- [ ] **Step 1: Write the failing unit test**

In `src/lib/__tests__/project-visibility.test.ts`, add `"mentorName"`, `"seekingMentor"`
and `"studentProposed"` to `DETAIL_KEYS` (keep the array sorted), add
`"mentorEmail"` to the list in the "omits the private link key" test, and extend `row()`:

```ts
    programId: "prog-1",
    mentorEmail: "mentor@x.test",
    mentorName: null,
    seekingMentor: false,
    studentProposed: false,
    ...overrides,
```

Add one test in the `projectDetailView` describe:

```ts
  it("carries the mentor name and the seeking flag for every viewer, never the address", () => {
    const seeking = row({ mentorEmail: null, seekingMentor: true, studentProposed: true });
    for (const viewer of [anon, other, owner, admin]) {
      const view = projectDetailView(seeking, viewer);
      expect(view.studentProposed).toBe(true);
      expect(view.seekingMentor).toBe(true);
      expect(view.mentorName).toBeNull();
      expect("mentorEmail" in view).toBe(false);
    }
    const named = row({ mentorName: "Dana Lee" });
    expect(projectDetailView(named, anon).mentorName).toBe("Dana Lee");
  });
```

- [ ] **Step 2: Run it to see it fail**

```bash
ulimit -n 8192 && npx vitest run src/lib/__tests__/project-visibility.test.ts
```

Expected: FAIL, the key-set test and the new test.

- [ ] **Step 3: Add the SQL fragments and widen the projection**

In `src/server/_internal/project-summary.ts`:

```ts
/**
 * The mentor, resolved at read time. A correlated subquery rather than a join
 * so the four consumers of `projectSummarySelect` pick it up without each
 * adding a join, same as `categories` in the admin export. Case-insensitive
 * on purpose, and therefore not on the `user.email` index; at capstone scale
 * that costs nothing and it is the same trade `claim-projects.ts` makes.
 *
 * `LIMIT 1` is belt and braces: `user.email` is unique, but only byte-wise.
 */
export const mentorNameSql = sql<string | null>`(
  SELECT ${user.name} FROM ${user}
  WHERE lower(${user.email}) = lower(${projects.mentorEmail})
  LIMIT 1
)`;

/**
 * "Needs a mentor" is derived, never stored, so it cannot drift from the
 * mentor being assigned. It lives here rather than in the client because the
 * public payload does not carry `mentorEmail`: without this flag a client
 * could not tell "no mentor" from "a mentor is lined up who has not signed up
 * yet", and the second must show nothing rather than "Seeking mentor".
 */
export const seekingMentorSql = sql<boolean>`(${projects.studentProposed} AND ${projects.mentorEmail} IS NULL)`;

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
  // Public by design, all three. The address itself is not here and must not
  // be: it is staff information, see `adminProjectSummarySelect`'s note on
  // proposerEmail for the same distinction.
  studentProposed: projects.studentProposed,
  seekingMentor: seekingMentorSql,
  mentorName: mentorNameSql,
};
```

The `sql` import already exists in that file. `user` is already imported.

- [ ] **Step 4: Name the fields in the detail view**

In `src/lib/project-visibility.ts`, add to `ProjectRow`:

```ts
  mentorEmail: string | null;
  mentorName: string | null;
  seekingMentor: boolean;
  studentProposed: boolean;
```

Add to `ProjectDetailView`:

```ts
  /** The resolved account's name. Null when unset or when nobody has signed up at that address. */
  mentorName: string | null;
  /** `studentProposed` with no mentor address on file. Derived in SQL, never stored. */
  seekingMentor: boolean;
  studentProposed: boolean;
```

Add to the object `projectDetailView` returns, after `isSponsored`:

```ts
    // Public by design, all three: the marker a student browsing the catalog
    // is looking for, and the mentor as a name only. `mentorEmail` is not
    // named here and must not be. It is an address staff typed, which the
    // person may never have chosen to publish, and it stays on the staff read
    // in projects-queries.ts. See #75.
    studentProposed: project.studentProposed,
    seekingMentor: project.seekingMentor,
    mentorName: project.mentorName,
```

- [ ] **Step 5: Select the fragments in `getProjectAs`**

In `src/server/_internal/projects-queries.ts`, replace the first select of `getProjectAs`:

```ts
export async function getProjectAs(viewer: Viewer, data: { id: string }) {
  // The row plus the two read-time mentor fields. Selected here rather than
  // joined by the view, because the view is pure and this is the only place
  // a project row is read for the detail page.
  const [row] = await db
    .select({
      project: projects,
      mentorName: mentorNameSql,
      seekingMentor: seekingMentorSql,
    })
    .from(projects)
    .where(eq(projects.id, data.id));
  const project = row
    ? { ...row.project, mentorName: row.mentorName, seekingMentor: row.seekingMentor }
    : undefined;
  if (!project) {
```

Everything below that `if` is unchanged; `project` keeps its name. Extend the import from
`./project-summary`:

```ts
import {
  adminProjectSummarySelect,
  mentorNameSql,
  projectSummarySelect,
  seekingMentorSql,
} from "./project-summary";
```

- [ ] **Step 6: Extend the integration key pin**

In `src/server/__tests__/projects.integration.test.ts`, add `"mentorName"`,
`"seekingMentor"` and `"studentProposed"` to `PUBLIC_KEYS`, sorted. In the same test, after
the `forAnon` assertions, add:

```ts
    expect("mentorEmail" in (forAnon ?? {})).toBe(false);
```

- [ ] **Step 7: Run unit, typecheck and the two suites**

```bash
ulimit -n 8192 && npx vitest run src/lib/__tests__/project-visibility.test.ts && npm run typecheck && npm run check
ulimit -n 8192 && npx vitest run --config vitest.integration.config.ts src/server/__tests__/projects.integration.test.ts src/server/__tests__/bookmarks.integration.test.ts src/server/__tests__/search.integration.test.ts
```

Expected: all PASS. The bookmark and search suites exercise the correlated subquery inside
their own joins, which is the point of running them.

- [ ] **Step 8: Commit**

```bash
git add src/server/_internal/project-summary.ts src/lib/project-visibility.ts src/server/_internal/projects-queries.ts src/lib/__tests__/project-visibility.test.ts src/server/__tests__/projects.integration.test.ts
git commit -m "feat(projects): carry the mentor name and seeking flag in public reads"
```

---

### Task 3: Write path, the staff-only mentorship update

**Files:**
- Modify: `src/server/projects.ts` (schema, type, server function)
- Modify: `src/server/_internal/projects.ts` (seam and wrapper, after `updateProjectForCurrentUser`)
- Modify: `src/server/__tests__/access-contract.ts:273`
- Create: `src/server/__tests__/mentorship.integration.test.ts`

**Interfaces:**
- Consumes: `diffRowFields`, `loadProjectOr404`, `assertStaff`, `projectEditLog` (all present in `_internal/projects.ts`).
- Produces: `MentorshipInput = { id: string; mentorEmail: string | null; studentProposed: boolean }`
  exported from `src/server/projects.ts`; `updateProjectMentorshipAs(viewer: Viewer, data: MentorshipInput): Promise<{ id: string; updated: boolean }>`;
  server function `updateProjectMentorship`. Task 5 calls the server function.

- [ ] **Step 1: Write the failing integration tests**

Create `src/server/__tests__/mentorship.integration.test.ts`:

```ts
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "#/db";
import { programs, projectEditLog, projects, user } from "#/db/schema";
import { auth } from "#/lib/auth";
import { projectSummarySelect } from "#/server/_internal/project-summary";
import {
  createProjectAs,
  forceTransitionAs,
  updateProjectAs,
  updateProjectMentorshipAs,
} from "#/server/_internal/projects";
import { getProjectAs } from "#/server/_internal/projects-queries";

async function makeUser(email: string, role: "user" | "admin") {
  await auth.api.signUpEmail({
    body: { email, password: "Password1!", name: `Name of ${email}` },
  });
  await db
    .update(user)
    .set({ emailVerified: true, ...(role === "user" ? {} : { role }) })
    .where(eq(user.email, email));
  const [u] = await db.select().from(user).where(eq(user.email, email));
  return { id: u.id, role: u.role, email: u.email, name: u.name };
}

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
    teamsSupported: 1,
  };
}

async function columns(id: string) {
  const [row] = await db
    .select({
      mentorEmail: projects.mentorEmail,
      studentProposed: projects.studentProposed,
    })
    .from(projects)
    .where(eq(projects.id, id));
  return row;
}

describe("updateProjectMentorshipAs", () => {
  it("refuses a non-staff viewer, the proposer included", async () => {
    const owner = await makeUser(`mo-${Date.now()}@x.com`, "user");
    const { id } = await createProjectAs(owner, baseProject());
    await expect(
      updateProjectMentorshipAs(owner, {
        id,
        mentorEmail: "m@x.com",
        studentProposed: true,
      })
    ).rejects.toThrow("Forbidden");
    expect(await columns(id)).toEqual({
      mentorEmail: null,
      studentProposed: false,
    });
  });

  it("writes both columns and one edit log row, and an unchanged save writes none", async () => {
    const admin = await makeUser(`ma-${Date.now()}@x.com`, "admin");
    const { id } = await createProjectAs(admin, baseProject());

    const first = await updateProjectMentorshipAs(admin, {
      id,
      mentorEmail: "  Mentor@X.com ",
      studentProposed: true,
    });
    expect(first.updated).toBe(true);
    // Trimmed, and stored as typed: the match is case-insensitive at read
    // time, so lowercasing here would only hide what staff entered.
    expect(await columns(id)).toEqual({
      mentorEmail: "Mentor@X.com",
      studentProposed: true,
    });

    const again = await updateProjectMentorshipAs(admin, {
      id,
      mentorEmail: "Mentor@X.com",
      studentProposed: true,
    });
    expect(again.updated).toBe(false);

    const log = await db
      .select()
      .from(projectEditLog)
      .where(eq(projectEditLog.projectId, id));
    expect(log).toHaveLength(1);
    expect(log[0].editorId).toBe(admin.id);
    expect(log[0].changedFields).toEqual(["studentProposed", "mentorEmail"]);
  });

  it("clears the address when given null or an empty string", async () => {
    const admin = await makeUser(`mc-${Date.now()}@x.com`, "admin");
    const { id } = await createProjectAs(admin, baseProject());
    await updateProjectMentorshipAs(admin, {
      id,
      mentorEmail: "m@x.com",
      studentProposed: false,
    });
    await updateProjectMentorshipAs(admin, {
      id,
      mentorEmail: "",
      studentProposed: false,
    });
    expect((await columns(id)).mentorEmail).toBeNull();
  });

  it("is unreachable through updateProjectAs, even for staff", async () => {
    const admin = await makeUser(`mu-${Date.now()}@x.com`, "admin");
    const { id } = await createProjectAs(admin, baseProject());
    // Extra keys on the ordinary edit payload. `ProjectInput` has no room for
    // them, so they must fall on the floor rather than be written.
    const smuggled = {
      ...baseProject(),
      id,
      mentorEmail: "smuggled@x.com",
      studentProposed: true,
    };
    await updateProjectAs(admin, smuggled);
    expect(await columns(id)).toEqual({
      mentorEmail: null,
      studentProposed: false,
    });
  });
});

describe("the three public states", () => {
  async function publishedProject() {
    const admin = await makeUser(`mp-${Date.now()}-${Math.random()}@x.com`, "admin");
    const { id } = await createProjectAs(admin, baseProject());
    await forceTransitionAs(admin, id, "published", undefined, {
      sendEmail: false,
    });
    return { admin, id };
  }

  it("shows seeking only for a student-proposed project with no address", async () => {
    const { admin, id } = await publishedProject();
    let { project } = await getProjectAs(null, { id });
    expect(project?.studentProposed).toBe(false);
    expect(project?.seekingMentor).toBe(false);
    expect(project?.mentorName).toBeNull();

    await updateProjectMentorshipAs(admin, {
      id,
      mentorEmail: null,
      studentProposed: true,
    });
    ({ project } = await getProjectAs(null, { id }));
    expect(project?.studentProposed).toBe(true);
    expect(project?.seekingMentor).toBe(true);
    expect(project?.mentorName).toBeNull();
  });

  it("shows nothing for an address with no account, then the name once it exists, case-insensitively", async () => {
    const { admin, id } = await publishedProject();
    const stamp = Date.now();
    await updateProjectMentorshipAs(admin, {
      id,
      mentorEmail: `Mentor-${stamp}@X.com`,
      studentProposed: true,
    });
    let { project } = await getProjectAs(null, { id });
    expect(project?.seekingMentor).toBe(false);
    expect(project?.mentorName).toBeNull();
    expect("mentorEmail" in (project ?? {})).toBe(false);

    const mentor = await makeUser(`mentor-${stamp}@x.com`, "user");
    ({ project } = await getProjectAs(null, { id }));
    expect(project?.mentorName).toBe(mentor.name);
    expect(project?.seekingMentor).toBe(false);
  });

  it("reaches the shared listing projection", async () => {
    const { admin, id } = await publishedProject();
    await updateProjectMentorshipAs(admin, {
      id,
      mentorEmail: null,
      studentProposed: true,
    });
    const [row] = await db
      .select(projectSummarySelect)
      .from(projects)
      .leftJoin(programs, eq(projects.programId, programs.id))
      .where(eq(projects.id, id));
    expect(row.studentProposed).toBe(true);
    expect(row.seekingMentor).toBe(true);
    expect(row.mentorName).toBeNull();
    expect("mentorEmail" in row).toBe(false);
  });

  it("never carries the address for the proposer either", async () => {
    const owner = await makeUser(`mown-${Date.now()}@x.com`, "user");
    const admin = await makeUser(`madm-${Date.now()}@x.com`, "admin");
    const { id } = await createProjectAs(owner, baseProject());
    await updateProjectMentorshipAs(admin, {
      id,
      mentorEmail: "private@x.com",
      studentProposed: false,
    });
    const { project } = await getProjectAs(owner, { id });
    expect(project).not.toBeNull();
    expect("mentorEmail" in (project ?? {})).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

```bash
ulimit -n 8192 && npx vitest run --config vitest.integration.config.ts src/server/__tests__/mentorship.integration.test.ts
```

Expected: FAIL, `updateProjectMentorshipAs` is not exported.

- [ ] **Step 3: Add the input schema and server function**

In `src/server/projects.ts`, after `updateProjectSchema` / `UpdateProjectInput`:

```ts
const mentorshipSchema = z.object({
  id: z.string().uuid(),
  // Empty string is the form clearing the field; the impl folds it to null.
  mentorEmail: z.string().email().max(320).nullable().or(z.literal("")),
  studentProposed: z.boolean(),
});

export type MentorshipInput = z.infer<typeof mentorshipSchema>;
```

After `updateProject`:

```ts
export const updateProjectMentorship = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => mentorshipSchema.parse(data))
  .handler(async ({ data }) => {
    const { updateProjectMentorshipForCurrentUser } = await import(
      "./_internal/projects"
    );
    return updateProjectMentorshipForCurrentUser(data);
  });
```

- [ ] **Step 4: Add the seam and wrapper**

In `src/server/_internal/projects.ts`, extend the type import:

```ts
import type {
  MentorshipInput,
  ProjectInput,
  UpdateProjectInput,
} from "../projects";
```

After `updateProjectAs`:

```ts
/**
 * The only writer of `studentProposed` and `mentorEmail`.
 *
 * Staff-only, and deliberately not part of `updateProjectAs`: neither key
 * exists on `ProjectInput`, so the shared form cannot carry them and a
 * proposer has no endpoint that accepts them. That is what makes "staff edit
 * these" structural rather than a check someone remembers to keep.
 *
 * The address is trimmed and stored as typed. Matching is case-insensitive
 * at read time (`mentorNameSql`), so lowercasing here would only hide what
 * staff entered from the edit log.
 *
 * No embedding refresh: neither column is part of the embedding source text.
 */
export async function updateProjectMentorshipAs(
  viewer: Viewer,
  data: MentorshipInput
): Promise<{ id: string; updated: boolean }> {
  assertStaff(viewer);
  const existing = await loadProjectOr404(data.id);
  const newValues: Partial<typeof projects.$inferSelect> = {
    studentProposed: data.studentProposed,
    mentorEmail: data.mentorEmail?.trim() || null,
  };
  const { changedFields, newDiff, oldDiff } = diffRowFields(
    existing,
    newValues
  );
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
}

export async function updateProjectMentorshipForCurrentUser(
  data: MentorshipInput
) {
  const viewer = await requireUser();
  return updateProjectMentorshipAs(viewer, data);
}
```

Keep the two adjacent. `assertStaff` narrows `viewer`, so `viewer.id` typechecks.

- [ ] **Step 5: Declare the access level**

In `src/server/__tests__/access-contract.ts`, after the `updateProject` line:

```ts
  "server/projects.ts:updateProjectMentorship": {
    level: "staff",
    note: "The only writer of studentProposed and mentorEmail. Neither key exists on ProjectInput, so updateProject cannot reach them; this endpoint is what keeps the pair staff-only.",
  },
```

- [ ] **Step 6: Run the tests**

```bash
ulimit -n 8192 && npx vitest run --config vitest.integration.config.ts src/server/__tests__/mentorship.integration.test.ts
ulimit -n 8192 && npm run check && npm run typecheck && npm test
```

Expected: all PASS, including `access-contract.test.ts` and `seam-convention.test.ts`.

- [ ] **Step 7: Commit**

```bash
git add src/server/projects.ts src/server/_internal/projects.ts src/server/__tests__/access-contract.ts src/server/__tests__/mentorship.integration.test.ts
git commit -m "feat(projects): let staff record a mentor and mark a project student-proposed"
```

---

### Task 4: Staff read of the raw mentorship record

**Files:**
- Modify: `src/server/_internal/projects-queries.ts` (after `getProposerForEditImpl`)
- Modify: `src/server/projects-queries.ts` (type re-export and server function)
- Modify: `src/server/__tests__/access-contract.ts`
- Test: `src/server/__tests__/mentorship.integration.test.ts`

**Interfaces:**
- Consumes: `mentorNameSql` from Task 2.
- Produces: `ProjectMentorship = { mentorEmail: string; mentorName: string | null; studentProposed: boolean }`
  re-exported from `src/server/projects-queries.ts`; `getProjectMentorshipAs(viewer, { projectId })`;
  server function `getProjectMentorship`. Task 5 renders from it.

- [ ] **Step 1: Write the failing test**

Append to `src/server/__tests__/mentorship.integration.test.ts`, importing
`getProjectMentorshipAs` from `#/server/_internal/projects-queries`:

```ts
describe("getProjectMentorshipAs", () => {
  it("returns the raw address and the resolved name to staff, and Forbidden to anyone else", async () => {
    const owner = await makeUser(`go-${Date.now()}@x.com`, "user");
    const admin = await makeUser(`ga-${Date.now()}@x.com`, "admin");
    const { id } = await createProjectAs(owner, baseProject());

    expect(await getProjectMentorshipAs(admin, { projectId: id })).toEqual({
      mentorEmail: "",
      mentorName: null,
      studentProposed: false,
    });

    await updateProjectMentorshipAs(admin, {
      id,
      mentorEmail: owner.email.toUpperCase(),
      studentProposed: true,
    });
    expect(await getProjectMentorshipAs(admin, { projectId: id })).toEqual({
      mentorEmail: owner.email.toUpperCase(),
      mentorName: owner.name,
      studentProposed: true,
    });

    await expect(
      getProjectMentorshipAs(owner, { projectId: id })
    ).rejects.toThrow("Forbidden");
    await expect(
      getProjectMentorshipAs(null, { projectId: id })
    ).rejects.toThrow("Forbidden");
  });
});
```

- [ ] **Step 2: Run it to see it fail**

```bash
ulimit -n 8192 && npx vitest run --config vitest.integration.config.ts src/server/__tests__/mentorship.integration.test.ts
```

Expected: FAIL, `getProjectMentorshipAs` is not exported.

- [ ] **Step 3: Add the seam and wrapper**

In `src/server/_internal/projects-queries.ts`, after `getProposerForEditImpl`:

```ts
export interface ProjectMentorship {
  /** As stored. Empty string when unset, so the input can bind to it directly. */
  mentorEmail: string;
  /** The account at that address, if one exists. Null is "no account yet". */
  mentorName: string | null;
  studentProposed: boolean;
}

/**
 * The staff read of the mentor address. The public payload carries only the
 * resolved name; this is the one endpoint that returns the address, and it
 * must not widen, for the same reason `getProposerForEditAs` does not.
 */
export async function getProjectMentorshipAs(
  viewer: Viewer,
  data: { projectId: string }
): Promise<ProjectMentorship> {
  if (!isStaff(viewer)) {
    throw new Error("Forbidden");
  }
  const [row] = await db
    .select({
      mentorEmail: projects.mentorEmail,
      mentorName: mentorNameSql,
      studentProposed: projects.studentProposed,
    })
    .from(projects)
    .where(eq(projects.id, data.projectId));
  if (!row) {
    throw new Error("Project not found");
  }
  return {
    mentorEmail: row.mentorEmail ?? "",
    mentorName: row.mentorName,
    studentProposed: row.studentProposed,
  };
}

export async function getProjectMentorshipImpl(data: { projectId: string }) {
  return getProjectMentorshipAs(await getViewer(), data);
}
```

- [ ] **Step 4: Add the server function**

In `src/server/projects-queries.ts`, extend the type re-export:

```ts
export type {
  ProjectMentorship,
  ProposerForEdit,
} from "./_internal/projects-queries";
```

After `getProposerForEdit`:

```ts
export const getProjectMentorship = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) =>
    z.object({ projectId: z.string().uuid() }).parse(data)
  )
  .handler(async ({ data }) => {
    const { getProjectMentorshipImpl } = await import(
      "./_internal/projects-queries"
    );
    return getProjectMentorshipImpl(data);
  });
```

- [ ] **Step 5: Declare the access level**

In `src/server/__tests__/access-contract.ts`, after the `getProposerForEdit` entry:

```ts
  "server/projects-queries.ts:getProjectMentorship": {
    level: "staff",
    note: "Returns mentorEmail, an address staff typed rather than one the person published. The public payload carries only the resolved name and the seeking flag.",
  },
```

- [ ] **Step 6: Run the tests**

```bash
ulimit -n 8192 && npx vitest run --config vitest.integration.config.ts src/server/__tests__/mentorship.integration.test.ts
ulimit -n 8192 && npm run check && npm run typecheck && npm test
```

Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add src/server/_internal/projects-queries.ts src/server/projects-queries.ts src/server/__tests__/access-contract.ts src/server/__tests__/mentorship.integration.test.ts
git commit -m "feat(projects): add the staff read of a project's mentorship record"
```

---

### Task 5: The badges on card, row and detail page

**Files:**
- Create: `src/components/mentorship-badges.tsx`
- Create: `src/test/mentorship-badges.test.tsx`
- Modify: `src/components/project-card.tsx`
- Modify: `src/components/project-row.tsx`
- Modify: `src/routes/projects/$projectId.tsx`
- Test: `src/test/project-card.test.tsx`, `src/test/project-row.test.tsx`

**Interfaces:**
- Consumes: `studentProposed`, `seekingMentor`, `mentorName` on the summary and detail payloads (Task 2).
- Produces: `MentorshipBadges({ seekingMentor, studentProposed, className? })`, and
  `ProjectSummary` gains optional `seekingMentor?: boolean` and `studentProposed?: boolean`.

- [ ] **Step 1: Write the failing component test**

Create `src/test/mentorship-badges.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MentorshipBadges } from "#/components/mentorship-badges";

afterEach(cleanup);

describe("MentorshipBadges", () => {
  it("renders nothing when neither flag is set", () => {
    const { container } = render(
      <MentorshipBadges seekingMentor={false} studentProposed={false} />
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders the student marker alone when a mentor is on file", () => {
    const { getByText, queryByText } = render(
      <MentorshipBadges seekingMentor={false} studentProposed />
    );
    expect(getByText("Student proposed")).toBeTruthy();
    expect(queryByText("Seeking mentor")).toBeNull();
  });

  it("renders both when a student project has no mentor", () => {
    const { getByText } = render(
      <MentorshipBadges seekingMentor studentProposed />
    );
    expect(getByText("Student proposed")).toBeTruthy();
    expect(getByText("Seeking mentor")).toBeTruthy();
  });
});
```

Add to `src/test/project-card.test.tsx` inside the describe:

```tsx
  it("shows the mentorship badges when the summary carries them", () => {
    const { getByText, queryByText } = render(
      <ProjectCard project={{ ...base, seekingMentor: true, studentProposed: true }} />
    );
    expect(getByText("Student proposed")).toBeTruthy();
    expect(getByText("Seeking mentor")).toBeTruthy();
    expect(queryByText("mentor@")).toBeNull();
  });
```

Add the same test to `src/test/project-row.test.tsx` with `ProjectRow`.

- [ ] **Step 2: Run them to see them fail**

```bash
ulimit -n 8192 && npx vitest run src/test/mentorship-badges.test.tsx src/test/project-card.test.tsx src/test/project-row.test.tsx
```

Expected: FAIL, module not found and badge text absent.

- [ ] **Step 3: Write the component**

Create `src/components/mentorship-badges.tsx`:

```tsx
import { cn } from "#/lib/utils.ts";
import { Badge } from "./ui/badge";

/**
 * The public mentorship state of a project, as badges.
 *
 * Two flags rather than the mentor's address because the address never
 * reaches a public payload. `seekingMentor` is derived on the server as
 * "student proposed with no address on file", which is what lets a project
 * whose mentor has not signed up yet show nothing rather than a false
 * "Seeking mentor". See #75.
 *
 * Rendered by the card, the row and the detail page, so the three cannot
 * compute the badges three ways.
 */
export function MentorshipBadges({
  className,
  seekingMentor,
  studentProposed,
}: {
  className?: string;
  seekingMentor: boolean;
  studentProposed: boolean;
}) {
  if (!(studentProposed || seekingMentor)) {
    return null;
  }
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {studentProposed && <Badge variant="outline">Student proposed</Badge>}
      {seekingMentor && (
        <Badge
          style={{
            backgroundColor: "var(--status-warning-bg)",
            color: "var(--status-warning)",
          }}
          variant="status"
        >
          Seeking mentor
        </Badge>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Render it on the card and the row**

In `src/components/project-card.tsx`, add to `ProjectSummary`:

```ts
  seekingMentor?: boolean;
  studentProposed?: boolean;
```

Import `MentorshipBadges` from `./mentorship-badges`. In `ProjectCard`, directly after the
title/status `div`:

```tsx
          <MentorshipBadges
            className="mt-2"
            seekingMentor={project.seekingMentor ?? false}
            studentProposed={project.studentProposed ?? false}
          />
```

In `src/components/project-row.tsx`, the same element after the title/status `div`, with
`className="mt-1"`.

- [ ] **Step 5: Render it on the detail page, plus the mentor section**

In `src/routes/projects/$projectId.tsx`, import `MentorshipBadges`. After the title/status
`div` at the top of the returned JSX:

```tsx
      <MentorshipBadges
        className="mt-3"
        seekingMentor={project.seekingMentor}
        studentProposed={project.studentProposed}
      />
```

After `<ContactSection ... />`:

```tsx
      <MentorSection name={project.mentorName} />
```

Add beside `ContactSection`:

```tsx
/**
 * The mentor as a name only. When the address on file matches no account this
 * renders nothing, by design: the email would publish a person who has not
 * signed up, and "Seeking mentor" would be false. See #75.
 */
function MentorSection({ name }: { name: string | null }) {
  if (!name) {
    return null;
  }
  return (
    <section className="mt-8">
      <SectionHeading>Mentor</SectionHeading>
      <p className="mt-2">{name}</p>
    </section>
  );
}
```

- [ ] **Step 6: Run the tests and checks**

```bash
ulimit -n 8192 && npx vitest run src/test/mentorship-badges.test.tsx src/test/project-card.test.tsx src/test/project-row.test.tsx && npm run check && npm run typecheck
```

Expected: PASS, clean.

- [ ] **Step 7: Commit**

```bash
git add src/components/mentorship-badges.tsx src/test/mentorship-badges.test.tsx src/components/project-card.tsx src/components/project-row.tsx src/routes/projects/\$projectId.tsx src/test/project-card.test.tsx src/test/project-row.test.tsx
git commit -m "feat(projects): show student-proposed and mentor state on the catalog"
```

---

### Task 6: The Mentorship section in the staff panel

**Files:**
- Modify: `src/components/staff-project-panel.tsx`
- Test: `src/test/staff-project-panel.test.tsx`

**Interfaces:**
- Consumes: `getProjectMentorship` and `ProjectMentorship` from `#/server/projects-queries` (Task 4), `updateProjectMentorship` from `#/server/projects` (Task 3).
- Produces: nothing later tasks import.

- [ ] **Step 1: Read the existing panel test's mocks**

Open `src/test/staff-project-panel.test.tsx` and note how it mocks `#/server/projects` and
`#/server/projects-queries` with `vi.mock`. The new server functions must be added to those
mock factories or the panel throws on mount. Add `getProjectMentorship: vi.fn(async () => ({
mentorEmail: "", mentorName: null, studentProposed: false }))` to the queries mock and
`updateProjectMentorship: vi.fn(async () => ({ id: "p", updated: true }))` to the projects
mock, following the exact shape the file already uses.

- [ ] **Step 2: Write the failing test**

Add to `src/test/staff-project-panel.test.tsx`:

```tsx
  it("saves the mentorship record and reports the account match", async () => {
    const { getProjectMentorship } = await import("#/server/projects-queries");
    const { updateProjectMentorship } = await import("#/server/projects");
    (getProjectMentorship as ReturnType<typeof vi.fn>).mockResolvedValue({
      mentorEmail: "mentor@x.test",
      mentorName: "Dana Lee",
      studentProposed: true,
    });
    render(<StaffProjectPanel onChanged={() => {}} project={project("draft")} />);
    const input = (await screen.findByLabelText("Mentor email")) as HTMLInputElement;
    expect(input.value).toBe("mentor@x.test");
    expect(await screen.findByText("Account: Dana Lee")).toBeTruthy();

    fireEvent.change(input, { target: { value: "other@x.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Save mentorship" }));
    await waitFor(() =>
      expect(updateProjectMentorship).toHaveBeenCalledWith({
        data: { id: project("draft").id, mentorEmail: "other@x.test", studentProposed: true },
      })
    );
  });
```

Use the file's existing helper that builds the `project` prop (it is named `project` or
similar; match it) and its existing imports of `fireEvent`, `screen`, `waitFor`.

- [ ] **Step 3: Run it to see it fail**

```bash
ulimit -n 8192 && npx vitest run src/test/staff-project-panel.test.tsx
```

Expected: FAIL, no element labelled "Mentor email".

- [ ] **Step 4: Add the section**

In `src/components/staff-project-panel.tsx`:

Imports:

```ts
import type { ProjectMentorship, ProposerForEdit } from "#/server/projects-queries";
import { updateProjectMentorship, /* existing names */ } from "#/server/projects";
import { getProjectMentorship, getProposerForEdit, listProjectEditLog } from "#/server/projects-queries";
import { Input } from "./ui/input";
```

Change the existing `ProposerForEdit` import from `#/server/_internal/projects-queries` to
the wrapper module above, so the component imports no server internals.

State, beside the proposer state:

```ts
  const [mentorship, setMentorship] = useState<ProjectMentorship | null>(null);
  const [mentorEmail, setMentorEmail] = useState("");
  const [studentProposed, setStudentProposed] = useState(false);
  const [mentorshipBusy, setMentorshipBusy] = useState(false);
  const [mentorshipError, setMentorshipError] = useState<string | null>(null);

  const loadMentorship = useCallback(async () => {
    try {
      const record = await getProjectMentorship({
        data: { projectId: project.id },
      });
      setMentorship(record);
      setMentorEmail(record.mentorEmail);
      setStudentProposed(record.studentProposed);
    } catch {
      // Staff-only endpoint; on failure the section stays at its defaults and
      // a save still round-trips through the server's own gate.
    }
  }, [project.id]);

  useEffect(() => {
    void loadMentorship();
  }, [loadMentorship]);

  async function saveMentorship() {
    setMentorshipBusy(true);
    setMentorshipError(null);
    try {
      await updateProjectMentorship({
        data: { id: project.id, mentorEmail: mentorEmail.trim(), studentProposed },
      });
      await loadMentorship();
      onChanged();
    } catch (e) {
      setMentorshipError((e as Error)?.message || "Save failed");
    } finally {
      setMentorshipBusy(false);
    }
  }
```

Add `useCallback` to the React import. The section, between the Proposer and Status sections:

```tsx
      <PanelSection title="Mentorship">
        <div className="space-y-3">
          <Label className="font-normal">
            <Checkbox
              checked={studentProposed}
              onCheckedChange={(checked) => setStudentProposed(checked === true)}
            />
            Student proposed
          </Label>
          <div className="space-y-1.5">
            <Label htmlFor="mentor-email">Mentor email</Label>
            <Input
              autoComplete="off"
              id="mentor-email"
              onChange={(e) => setMentorEmail(e.target.value)}
              placeholder="mentor@example.com"
              type="email"
              value={mentorEmail}
            />
            <MentorshipHint record={mentorship} />
          </div>
          {mentorshipError && (
            <p className="text-destructive text-sm">{mentorshipError}</p>
          )}
          <Button
            disabled={mentorshipBusy}
            onClick={() => void saveMentorship()}
            size="sm"
            type="button"
          >
            {mentorshipBusy ? "Saving..." : "Save mentorship"}
          </Button>
        </div>
      </PanelSection>
```

And, at module level below `STATUS_LABEL`:

```tsx
/**
 * Whether the saved address has an account, stated from the saved record
 * rather than the draft: the match is resolved server-side and is only known
 * after a save. A student-proposed project with no address is what the public
 * sees as "Seeking mentor", so that is said here too.
 */
function MentorshipHint({ record }: { record: ProjectMentorship | null }) {
  if (!record) {
    return null;
  }
  if (!record.mentorEmail) {
    return (
      <p className="text-muted-foreground text-xs">
        {record.studentProposed
          ? "No mentor on file. The catalog shows this project as seeking a mentor."
          : "No mentor on file."}
      </p>
    );
  }
  return (
    <p className="text-muted-foreground text-xs">
      {record.mentorName
        ? `Account: ${record.mentorName}`
        : "No account with this address yet. The catalog shows no mentor until they sign up."}
    </p>
  );
}
```

- [ ] **Step 5: Run the tests and checks**

```bash
ulimit -n 8192 && npx vitest run src/test/staff-project-panel.test.tsx && npm run check && npm run typecheck && npm test
```

Expected: PASS, clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/staff-project-panel.tsx src/test/staff-project-panel.test.tsx
git commit -m "feat(projects): edit mentorship from the staff panel"
```

---

### Task 7: Docs, full verification, PR

**Files:**
- Modify: `PRD.md` (the projects feature list near line 87)
- Modify: `docs/QUIRKS.md` (the project domain rules section)

- [ ] **Step 1: Record the feature**

In `PRD.md`, after the "Teams supported" bullet near line 87, add:

```markdown
- ✅ Student-proposed marker and mentor: staff mark a project as student-proposed and
  record a mentor's email from the staff panel. The public sees a "Student proposed"
  badge, a "Seeking mentor" badge while no address is on file, and the mentor's name once
  that address has an account. The address itself never leaves staff reads. (#75)
```

Match the checkmark glyph the surrounding bullets use.

In `docs/QUIRKS.md`, in the project domain rules section, add a subsection following the
"When you add a quirk" pattern:

```markdown
### Mentorship is two staff-only columns and one derived flag

`projects.student_proposed` and `projects.mentor_email` are written only by
`updateProjectMentorshipAs`. Neither is on `ProjectInput`, so `updateProjectAs` cannot
touch them; keep it that way rather than adding staff branches to the form.

The mentor is resolved at read time by `mentorNameSql`, a case-insensitive match on
`user.email`. There is no `mentor_id`: mentorship grants no permission, so an id would
only be a denormalization. `seekingMentor` is `student_proposed AND mentor_email IS
NULL`, computed in `seekingMentorSql`, because the public payload does not carry the
address and a client cannot otherwise tell "no mentor" from "a mentor who has not signed
up yet". The second state shows nothing, on purpose. `mentor_email` reaches exactly one
endpoint, `getProjectMentorship`, which is staff. See #75.
```

- [ ] **Step 2: Full verification**

```bash
ulimit -n 8192 && npm run check && npm run typecheck && npm test
ulimit -n 8192 && npm run test:integration
```

Expected: all green. If the integration suite has pre-existing noise, `docs/QUIRKS.md`
"Pre-existing infra noise" says what to ignore; anything else is a regression.

- [ ] **Step 3: Commit and push**

```bash
git add PRD.md docs/QUIRKS.md
git commit -m "docs(projects): record the mentorship rules"
git push -u origin claude/issue-75-mentorship
```

- [ ] **Step 4: Open the PR**

Body: what changed, the two places the issue's picture of the tree was wrong (no staff
`isSponsored` control; `isSponsored` is proposer-editable), the visibility table from the
spec, and "Closes #75". Note that the account-deletion scrub lands with #84. No session
link. End with the generated-with line the harness supplies.

- [ ] **Step 5: Review loop**

Run `mattpocock-skills:code-review` against `origin/main`. Fix or decline each finding in
writing, then run it again until a pass raises nothing new.
