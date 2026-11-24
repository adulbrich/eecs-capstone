# Mentorship and Team Capacity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users opt in as mentors (with a team capacity) on their profile, give staff a `/admin/mentors` page to see and edit them, and let a project record how many teams it supports.

**Architecture:** The two mentor fields are Better Auth `additionalFields` on the `user` table (like `affiliation`/`linkedin`), added via `src/lib/auth.ts` and a CLI schema regeneration. `teamsSupported` is a plain integer column on `projects`. The profile form persists mentor fields through `updateProfile`; new staff-gated server functions back the `/admin/mentors` page. Everything is informational, no authorization change.

**Tech Stack:** TanStack Start (React SSR), TanStack Router, Better Auth, Drizzle ORM on PostgreSQL, shadcn/ui + Radix, Zod, Vitest.

Source spec: `docs/superpowers/specs/2026-07-23-mentorship-team-capacity-design.md`

## Global Constraints

- Mentor fields: `wantsToMentor` (boolean, default `false`), `mentorTeamCount` (integer, default `1`, range 1 to 5). Project field: `teamsSupported` (integer, default `1`, range 1 to 5).
- Mentor fields live in Better Auth `additionalFields`; never hand-edit `src/db/auth-schema.ts` except to add DB defaults the CLI omitted (documented in the README).
- Opting in as a mentor requires a non-empty `affiliation` (name is already required at sign-up). Validated in the same profile submit.
- The mentor opt-in control is a `Switch` with the exact helper copy: **"For professionals and faculty, not students."**
- Mentoring grants no access, role, or authorization change. It is informational only.
- `teamsSupported` is rendered only in staff contexts (staff panel, admin views), never in the public project detail `Section` blocks.
- `/admin/mentors` and the mentor server functions are gated to staff (`admin` or `instructor`) via the existing `isStaff` helper. `/admin/users` stays admin-only.
- Run `npm run check` and `npm run typecheck` before every commit; both must be clean.
- Integration tests (`*.integration.test.ts`) need `docker compose up -d` and run via `npm run test:integration`. They TRUNCATE the dev database. Component tests live in `src/test/<name>.test.tsx` with `// @vitest-environment jsdom` on line 1; `@testing-library/jest-dom` is NOT installed (plain Vitest matchers only).

---

## File Structure

**Created:**

- `drizzle/00NN_*.sql`: generated migration (mentor columns + `teams_supported`).
- `src/routes/_authed/admin/mentors/index.tsx`: the mentors admin page.
- `src/server/__tests__/mentors.integration.test.ts`: mentor server function tests.
- `src/test/profile-schema.test.ts`: profile schema unit tests.

**Modified:**

- `src/lib/auth.ts`: add the two `additionalFields`.
- `src/db/auth-schema.ts`: regenerated (reviewed for defaults).
- `src/db/schema.ts`: `projects.teamsSupported`.
- `src/server/profile.ts` + `src/server/_internal/profile.ts`: mentor fields + refine + persist.
- `src/routes/_authed/profile.tsx`: mentorship section.
- `src/components/project-form.tsx`: `teamsSupported` schema + field.
- `src/server/_internal/projects.ts`: `teamsSupported` in the editable/value maps.
- `src/components/staff-project-panel.tsx`: display `teamsSupported`.
- `src/server/users.ts` + `src/server/_internal/users.ts`: `listMentors`, `setUserMentorStatus`.
- `src/routes/_authed/admin/index.tsx`: Mentors NavCard.
- `src/routes/_authed/admin/users/$userId.tsx`: read-only mentor line.

---

## Task 1: Schema and migration

**Files:**

- Modify: `src/lib/auth.ts:41-44`
- Regenerate: `src/db/auth-schema.ts`
- Modify: `src/db/schema.ts` (projects table, near `licenseRestrictions`)
- Create: `drizzle/00NN_*.sql` (generated, then reviewed)

**Interfaces:**

- Produces: `user.wantsToMentor` (boolean), `user.mentorTeamCount` (integer), `projects.teamsSupported` (integer). Every later task reads these exact names.

**Context:** Better Auth owns the `user` table; the only safe way to add columns there is `additionalFields`, which the CLI regenerates into `auth-schema.ts` (README documents this). `integer` is already imported in `schema.ts`. Better Auth's `defaultValue` is applied at row creation in app code; the CLI may not emit a DB-level default, so the generated columns must be reviewed and given DB defaults so existing rows are not null.

- [ ] **Step 1: Add the additionalFields**

In `src/lib/auth.ts`, extend the `additionalFields`:

```ts
  user: {
    additionalFields: {
      affiliation: { type: "string", required: false },
      linkedin: { type: "string", required: false },
      wantsToMentor: { type: "boolean", required: false, defaultValue: false },
      mentorTeamCount: { type: "number", required: false, defaultValue: 1 },
    },
  },
```

- [ ] **Step 2: Regenerate the Better Auth schema**

Run: `npx -y @better-auth/cli generate --config src/lib/auth.ts --output src/db/auth-schema.ts`
Expected: `src/db/auth-schema.ts` gains `wantsToMentor` and `mentorTeamCount` columns on the `user` table, alongside the existing `affiliation`/`linkedin`.

- [ ] **Step 3: Review and fix the generated columns**

Open `src/db/auth-schema.ts` and confirm the two new columns. Ensure they are:

```ts
  wantsToMentor: boolean("wants_to_mentor").notNull().default(false),
  mentorTeamCount: integer("mentor_team_count").notNull().default(1),
```

If the CLI generated them nullable or without a DB `.default(...)`, hand-add `.notNull().default(...)` so existing rows backfill to `false` / `1`. If the CLI generated `mentorTeamCount` as a non-integer numeric type, change it to `integer`. Confirm `boolean` and `integer` are imported at the top of the file. This is the one sanctioned hand-edit of the generated file; note it in the report.

- [ ] **Step 4: Add the project column**

In `src/db/schema.ts`, in the `projects` table, after `licenseRestrictions`:

```ts
    licenseRestrictions: text("license_restrictions"),
    teamsSupported: integer("teams_supported").notNull().default(1),
```

- [ ] **Step 5: Generate and apply the migration**

Run: `npm run db:generate`
Expected: a new `drizzle/00NN_*.sql` adding `wants_to_mentor`, `mentor_team_count` to `user` and `teams_supported` to `projects`, all `NOT NULL DEFAULT`.

Review the generated SQL. Confirm it only ADDS the three columns and does not drop or alter `affiliation`, `linkedin`, or any other column.

Run: `npm run db:migrate`
Expected: applies cleanly. Verify:

```bash
docker exec cs-capstone-database psql -U postgres -d eecs_capstone -c "\d user" -c "\d projects" | grep -E "wants_to_mentor|mentor_team_count|teams_supported"
```

Expected: `wants_to_mentor | boolean`, `mentor_team_count | integer`, `teams_supported | integer`, each `not null default`.

- [ ] **Step 6: Prove the addition is inert**

Run: `npm run typecheck && npm run check && npm run test && npm run test:integration`
Expected: all pass. No behavior changed yet.

- [ ] **Step 7: Commit**

```bash
git add src/lib/auth.ts src/db/auth-schema.ts src/db/schema.ts drizzle/
git commit -m "feat: add mentor user fields and project teams-supported column"
```

---

## Task 2: Profile server (mentor fields, affiliation refine, persist)

**Files:**

- Modify: `src/server/profile.ts:4-10`
- Modify: `src/server/_internal/profile.ts`
- Test: `src/test/profile-schema.test.ts` (create)
- Test: `src/server/__tests__/profile.integration.test.ts` (create if absent, else extend)

**Interfaces:**

- Consumes: the `user` columns from Task 1.
- Produces:

  ```ts
  // profileSchema output type (ProfileInput)
  { name: string; affiliation?: string | null; linkedin?: string | null;
    wantsToMentor: boolean; mentorTeamCount: number }
  ```

  Task 3 (profile UI) sends exactly this shape to `updateProfile`.

**Context:** `profileSchema` (`src/server/profile.ts`) currently validates `name`, `affiliation`, `linkedin`. `updateProfileForCurrentUser` writes them with `db.update(user).set({...})`. The affiliation-required-when-mentor rule is a `.refine` so it is enforced server-side regardless of the client.

- [ ] **Step 1: Write the failing schema test**

Create `src/test/profile-schema.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { profileSchema } from "#/server/profile";

const base = { name: "Dana Lee", affiliation: "OSU", linkedin: null };

describe("profileSchema mentor rules", () => {
  it("accepts an opt-in with an affiliation", () => {
    const r = profileSchema.safeParse({
      ...base,
      wantsToMentor: true,
      mentorTeamCount: 3,
    });
    expect(r.success).toBe(true);
  });

  it("rejects an opt-in with a blank affiliation, on the affiliation path", () => {
    const r = profileSchema.safeParse({
      ...base,
      affiliation: "",
      wantsToMentor: true,
      mentorTeamCount: 1,
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0].path).toEqual(["affiliation"]);
    }
  });

  it("allows a blank affiliation when not opting in", () => {
    const r = profileSchema.safeParse({
      ...base,
      affiliation: "",
      wantsToMentor: false,
      mentorTeamCount: 1,
    });
    expect(r.success).toBe(true);
  });

  it("rejects a team count outside 1 to 5", () => {
    expect(
      profileSchema.safeParse({
        ...base,
        wantsToMentor: true,
        mentorTeamCount: 6,
      }).success
    ).toBe(false);
    expect(
      profileSchema.safeParse({
        ...base,
        wantsToMentor: true,
        mentorTeamCount: 0,
      }).success
    ).toBe(false);
  });

  it("defaults wantsToMentor to false and mentorTeamCount to 1", () => {
    const r = profileSchema.parse({ name: "Dana Lee" });
    expect(r.wantsToMentor).toBe(false);
    expect(r.mentorTeamCount).toBe(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/test/profile-schema.test.ts`
Expected: FAIL. `profileSchema` is not exported and lacks the mentor fields.

- [ ] **Step 3: Extend the schema**

In `src/server/profile.ts`, replace the schema and export it:

```ts
export const profileSchema = z
  .object({
    name: z.string().min(1).max(120),
    affiliation: z.string().max(200).nullable().optional(),
    linkedin: z.string().url().max(300).nullable().optional(),
    wantsToMentor: z.boolean().default(false),
    mentorTeamCount: z.number().int().min(1).max(5).default(1),
  })
  .refine((v) => !v.wantsToMentor || Boolean(v.affiliation?.trim()), {
    message: "Affiliation is required to opt in as a mentor",
    path: ["affiliation"],
  });
```

(The existing `export type ProfileInput = z.infer<typeof profileSchema>;` still works.)

- [ ] **Step 4: Persist the mentor fields**

In `src/server/_internal/profile.ts`, add both fields to the `.set(...)`:

```ts
    .set({
      name: data.name,
      affiliation: data.affiliation ?? null,
      linkedin: data.linkedin ?? null,
      wantsToMentor: data.wantsToMentor,
      mentorTeamCount: data.mentorTeamCount,
      updatedAt: new Date(),
    })
```

- [ ] **Step 5: Run the schema test to verify it passes**

Run: `npx vitest run src/test/profile-schema.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Add an integration test for persistence**

Add to `src/server/__tests__/profile.integration.test.ts` (create the file with a `makeUser` helper following `projects.integration.test.ts` if it does not exist):

```ts
it("persists mentor fields", async () => {
  const u = await makeUser(`m-${Date.now()}@x.com`);
  await updateProfileForCurrentUserAsserting(u.id, {
    name: "Dana Lee",
    affiliation: "OSU",
    linkedin: null,
    wantsToMentor: true,
    mentorTeamCount: 4,
  });
  const [row] = await db.select().from(user).where(eq(user.id, u.id));
  expect(row.wantsToMentor).toBe(true);
  expect(row.mentorTeamCount).toBe(4);
});
```

Since `updateProfileForCurrentUser` reads the request session, either expose a small `updateProfileAs(userId, data)` seam in `_internal/profile.ts` (mirroring the `*As` convention) and call it directly, or mock `requireUser`. Prefer the `updateProfileAs(userId, data)` seam: refactor `updateProfileForCurrentUser` to `updateProfileAs(current.id, data)` and test the seam.

- [ ] **Step 7: Run integration + lint + typecheck**

Run: `npm run test:integration && npm run check && npm run typecheck`
Expected: PASS, clean.

- [ ] **Step 8: Commit**

```bash
git add src/server/profile.ts src/server/_internal/profile.ts src/test/profile-schema.test.ts src/server/__tests__/profile.integration.test.ts
git commit -m "feat: validate and persist mentor opt-in on the profile"
```

---

## Task 3: Profile UI (mentorship section)

**Files:**

- Modify: `src/routes/_authed/profile.tsx`
- Test: `src/test/profile-mentor.test.tsx` (create)

**Interfaces:**

- Consumes: `updateProfile` accepting `{ name, affiliation, linkedin, wantsToMentor, mentorTeamCount }` (Task 2); the route context `user` now carries `wantsToMentor` / `mentorTeamCount`.
- Produces: nothing consumed later.

**Context:** The profile form (`onSaveProfile`) reads `name`/`affiliation`/`linkedin` from `FormData`. A Radix `Switch` is not a native form input, so the mentor fields use React state and are passed into the `updateProfile` call alongside the FormData values. The `ProfileUser` interface gains the two fields (the session user carries them after Task 1).

- [ ] **Step 1: Write the failing component test**

Create `src/test/profile-mentor.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => () => ({}),
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
  useRouter: () => ({ invalidate: () => undefined }),
}));
vi.mock("#/server/interests", () => ({
  getMyInterests: () => Promise.resolve({ interestsText: "" }),
  saveMyInterests: vi.fn(),
}));
vi.mock("#/server/profile", () => ({ updateProfile: vi.fn() }));
vi.mock("#/lib/auth-client", () => ({ authClient: {} }));

import { MentorFields } from "#/routes/_authed/profile";

afterEach(cleanup);

describe("MentorFields", () => {
  it("labels the switch and shows the audience note", () => {
    render(
      <MentorFields
        count={1}
        onCountChange={() => {}}
        onToggle={() => {}}
        wants={false}
      />
    );
    expect(
      screen.getByRole("switch", { name: /want to mentor/i })
    ).toBeTruthy();
    expect(document.body.textContent).toContain(
      "For professionals and faculty, not students"
    );
  });

  it("reveals the team-count field only when opted in", () => {
    const { rerender } = render(
      <MentorFields
        count={1}
        onCountChange={() => {}}
        onToggle={() => {}}
        wants={false}
      />
    );
    expect(screen.queryByLabelText(/how many teams/i)).toBeNull();
    rerender(
      <MentorFields
        count={2}
        onCountChange={() => {}}
        onToggle={() => {}}
        wants
      />
    );
    expect(screen.getByLabelText(/how many teams/i)).toBeTruthy();
  });
});
```

Extracting a `MentorFields` component (exported from `profile.tsx`) keeps the switch/count logic unit-testable without rendering the whole route.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/test/profile-mentor.test.tsx`
Expected: FAIL, `MentorFields` is not exported.

- [ ] **Step 3: Add the MentorFields component and wire the form**

In `src/routes/_authed/profile.tsx`:

Add to the imports:

```tsx
import { Switch } from "#/components/ui/switch";
```

Add the two fields to `ProfileUser`:

```tsx
interface ProfileUser {
  affiliation?: string | null;
  email: string;
  id: string;
  image?: string | null;
  linkedin?: string | null;
  mentorTeamCount?: number | null;
  name: string | null;
  role: string | null | undefined;
  wantsToMentor?: boolean | null;
}
```

Add the exported presentational component (above `Profile`):

```tsx
export function MentorFields({
  wants,
  count,
  onToggle,
  onCountChange,
}: {
  count: number;
  onCountChange: (n: number) => void;
  onToggle: (on: boolean) => void;
  wants: boolean;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Switch
          checked={wants}
          id="wants-to-mentor"
          onCheckedChange={onToggle}
        />
        <Label className="font-normal" htmlFor="wants-to-mentor">
          I want to mentor a team
        </Label>
      </div>
      <p className="text-muted-foreground text-xs">
        For professionals and faculty, not students.
      </p>
      {wants && (
        <div className="space-y-1.5">
          <Label htmlFor="mentor-team-count">
            How many teams can you mentor?
          </Label>
          <Input
            className="w-24"
            id="mentor-team-count"
            max={5}
            min={1}
            onChange={(e) => onCountChange(Number(e.target.value))}
            type="number"
            value={count}
          />
        </div>
      )}
    </div>
  );
}
```

In `Profile`, add state seeded from the user and render the section inside the profile form, and include the fields in the submit. Add near the other `useState` calls:

```tsx
const [wantsToMentor, setWantsToMentor] = useState(Boolean(user.wantsToMentor));
const [mentorTeamCount, setMentorTeamCount] = useState(
  user.mentorTeamCount ?? 1
);
```

In `onSaveProfile`, extend the `updateProfile` data:

```tsx
await updateProfile({
  data: {
    name: String(form.get("name") ?? ""),
    affiliation: String(form.get("affiliation") ?? "") || null,
    linkedin: String(form.get("linkedin") ?? "") || null,
    wantsToMentor,
    mentorTeamCount,
  },
});
```

Render `MentorFields` inside the profile `<form>`, after the LinkedIn field and before the submit button:

```tsx
<MentorFields
  count={mentorTeamCount}
  onCountChange={setMentorTeamCount}
  onToggle={setWantsToMentor}
  wants={wantsToMentor}
/>;
```

The server refine rejects an opt-in with a blank affiliation; that rejection surfaces through the existing `catch` into `setError`, and the affiliation input is in the same form.

- [ ] **Step 4: Run the component test to verify it passes**

Run: `npx vitest run src/test/profile-mentor.test.tsx`
Expected: PASS, 2 tests.

- [ ] **Step 5: Typecheck, lint, and manual check**

Run: `npm run typecheck && npm run check`
Expected: clean.

Manually (dev server): on `/profile`, toggle the switch, confirm the count field appears (1 to 5), and that saving with the switch on but affiliation blank shows the affiliation error.

- [ ] **Step 6: Commit**

```bash
git add src/routes/_authed/profile.tsx src/test/profile-mentor.test.tsx
git commit -m "feat: add a mentorship opt-in section to the profile"
```

---

## Task 4: Project teams-supported (form, persistence, staff display)

**Files:**

- Modify: `src/components/project-form.tsx` (schema + field)
- Modify: `src/server/_internal/projects.ts` (editable fields + value maps)
- Modify: `src/components/staff-project-panel.tsx` (display)
- Test: `src/server/__tests__/projects.integration.test.ts` (extend)

**Interfaces:**

- Consumes: `projects.teamsSupported` (Task 1).
- Produces: `teamsSupported` on the project create/update input and on the loaded project row.

**Context:** `projectFormSchema` and `PROJECT_EDITABLE_FIELDS` drive what is persisted and diffed. The field is set by whoever edits the project (not staff-only), but shown only in staff contexts. `StaffProjectPanel` has a `section` around line 204 for staff-only details.

- [ ] **Step 1: Write the failing integration test**

Add to `src/server/__tests__/projects.integration.test.ts`:

```ts
it("persists and defaults teamsSupported", async () => {
  const admin = await makeUser(`t-${Date.now()}@x.com`, "admin");
  const { id } = await createProjectAs(admin, baseProject());
  const [created] = await db.select().from(projects).where(eq(projects.id, id));
  expect(created.teamsSupported).toBe(1);

  await updateProjectAs(admin, { ...baseProject(), id, teamsSupported: 3 });
  const [updated] = await db.select().from(projects).where(eq(projects.id, id));
  expect(updated.teamsSupported).toBe(3);
});
```

`baseProject()` in that file will need a `teamsSupported` default; add `teamsSupported: 1` to it (and to the `UpdateProjectInput` typing path).

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run --config vitest.integration.config.ts src/server/__tests__/projects.integration.test.ts`
Expected: FAIL. `teamsSupported` is not persisted.

- [ ] **Step 3: Add to the form schema**

In `src/components/project-form.tsx`, add to `projectFormSchema`:

```ts
  teamsSupported: z.number().int().min(1).max(5).default(1),
```

and to the form's default values (`initial?.teamsSupported ?? 1`).

- [ ] **Step 4: Add to the editable fields and value maps**

In `src/server/_internal/projects.ts`, add `"teamsSupported"` to `PROJECT_EDITABLE_FIELDS`, and add `teamsSupported: data.teamsSupported ?? 1` to both the `createProjectAs` `.values({...})` and the `updateProjectAs` `newValues` map.

- [ ] **Step 5: Add the form field**

In `src/components/project-form.tsx`, render a control near the program field:

```tsx
<form.Field name="teamsSupported">
  {(field: AnyForm) => (
    <div>
      <Label htmlFor="teamsSupported">Teams this project can support</Label>
      <Input
        className="mt-1 w-24"
        id="teamsSupported"
        max={5}
        min={1}
        onChange={(e) => field.handleChange(Number(e.target.value))}
        type="number"
        value={field.state.value as number}
      />
    </div>
  )}
</form.Field>;
```

- [ ] **Step 6: Display it staff-only**

In `src/components/staff-project-panel.tsx`, inside the staff-only `section` (around line 204), add:

```tsx
<p className="text-sm">
  <span className="text-muted-foreground">Teams supported: </span>
  {project.teamsSupported ?? 1}
</p>;
```

Confirm the `project` prop type carries `teamsSupported`; widen it if needed. Do NOT add this to the public `Section` blocks in `src/routes/projects/$projectId.tsx`.

- [ ] **Step 7: Run the integration test to verify it passes**

Run: `npx vitest run --config vitest.integration.config.ts src/server/__tests__/projects.integration.test.ts`
Expected: PASS.

- [ ] **Step 8: Typecheck, lint, full suites**

Run: `npm run typecheck && npm run check && npm run test && npm run test:integration`
Expected: clean and green.

- [ ] **Step 9: Commit**

```bash
git add src/components/project-form.tsx src/server/_internal/projects.ts src/components/staff-project-panel.tsx src/server/__tests__/projects.integration.test.ts
git commit -m "feat: record how many teams a project supports (staff-visible)"
```

---

## Task 5: Mentor server functions (listMentors, setUserMentorStatus)

**Files:**

- Modify: `src/server/users.ts`
- Modify: `src/server/_internal/users.ts`
- Test: `src/server/__tests__/mentors.integration.test.ts` (create)

**Interfaces:**

- Consumes: the `user` mentor columns (Task 1); `isStaff` from `#/lib/project-visibility`.
- Produces:

  ```ts
  // src/server/_internal/users.ts
  export async function listMentorsAs(viewer: { id: string; role: string | null }):
    Promise<{ rows: { id: string; name: string | null; email: string;
      affiliation: string | null; mentorTeamCount: number }[] }>;
  export async function setUserMentorStatusAs(
    viewer, data: { userId: string; wantsToMentor: boolean; mentorTeamCount: number }
  ): Promise<{ ok: true }>;
  ```

  Task 6 (the page) calls the `listMentors` / `setUserMentorStatus` server functions.

**Context:** These mirror the existing `*As(viewer, ...)` + `*ForCurrentUser` split (`_internal/users.ts` already has `getUserImpl`, `getUserForCurrentUser`, etc.). `assertAdmin` exists; add an `assertStaff` (or reuse `isStaff`) so instructors are allowed.

- [ ] **Step 1: Write the failing test**

Create `src/server/__tests__/mentors.integration.test.ts`:

```ts
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "#/db";
import { user } from "#/db/schema";
import { auth } from "#/lib/auth";
import { listMentorsAs, setUserMentorStatusAs } from "#/server/_internal/users";

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

describe("mentor server functions", () => {
  it("lists only opted-in users", async () => {
    const staff = await makeUser(`s-${Date.now()}@x.com`, "instructor");
    const mentor = await makeUser(`m-${Date.now()}@x.com`, "user");
    const other = await makeUser(`o-${Date.now()}@x.com`, "user");
    await db
      .update(user)
      .set({ wantsToMentor: true, mentorTeamCount: 2, affiliation: "OSU" })
      .where(eq(user.id, mentor.id));

    const { rows } = await listMentorsAs(staff);
    expect(rows.map((r) => r.id)).toEqual([mentor.id]);
    expect(rows[0].mentorTeamCount).toBe(2);
    expect(rows.map((r) => r.id)).not.toContain(other.id);
  });

  it("refuses a non-staff viewer", async () => {
    const plain = await makeUser(`p-${Date.now()}@x.com`, "user");
    await expect(listMentorsAs(plain)).rejects.toThrow("Forbidden");
  });

  it("staff can edit a user's mentor status", async () => {
    const staff = await makeUser(`s2-${Date.now()}@x.com`, "admin");
    const target = await makeUser(`u-${Date.now()}@x.com`, "user");
    await db
      .update(user)
      .set({ wantsToMentor: true, mentorTeamCount: 3 })
      .where(eq(user.id, target.id));

    await setUserMentorStatusAs(staff, {
      userId: target.id,
      wantsToMentor: false,
      mentorTeamCount: 1,
    });
    const [row] = await db.select().from(user).where(eq(user.id, target.id));
    expect(row.wantsToMentor).toBe(false);

    await expect(
      setUserMentorStatusAs(target, {
        userId: target.id,
        wantsToMentor: true,
        mentorTeamCount: 2,
      })
    ).rejects.toThrow("Forbidden");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `docker compose up -d && npx vitest run --config vitest.integration.config.ts src/server/__tests__/mentors.integration.test.ts`
Expected: FAIL. `listMentorsAs` / `setUserMentorStatusAs` are not exported.

- [ ] **Step 3: Implement the internal functions**

In `src/server/_internal/users.ts`, add:

```ts
function assertStaff(viewer: AuthUser) {
  if (!isStaff({ id: viewer.id, role: viewer.role ?? null })) {
    throw new Error("Forbidden");
  }
}

export async function listMentorsAs(viewer: AuthUser) {
  assertStaff(viewer);
  const rows = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      affiliation: user.affiliation,
      mentorTeamCount: user.mentorTeamCount,
    })
    .from(user)
    .where(eq(user.wantsToMentor, true))
    .orderBy(user.name);
  return { rows };
}

export async function setUserMentorStatusAs(
  viewer: AuthUser,
  data: { userId: string; wantsToMentor: boolean; mentorTeamCount: number }
) {
  assertStaff(viewer);
  await db
    .update(user)
    .set({
      wantsToMentor: data.wantsToMentor,
      mentorTeamCount: data.mentorTeamCount,
      updatedAt: new Date(),
    })
    .where(eq(user.id, data.userId));
  return { ok: true as const };
}

export async function listMentorsForCurrentUser() {
  return listMentorsAs(await requireUser());
}

export async function setUserMentorStatusForCurrentUser(data: {
  userId: string;
  wantsToMentor: boolean;
  mentorTeamCount: number;
}) {
  return setUserMentorStatusAs(await requireUser(), data);
}
```

`isStaff` is imported already in this file. `requireUser` returns `{ id, role }`.

- [ ] **Step 4: Add the server functions**

In `src/server/users.ts`, add:

```ts
export const listMentors = createServerFn({ method: "GET" }).handler(
  async () => {
    const { listMentorsForCurrentUser } = await import("./_internal/users");
    return listMentorsForCurrentUser();
  }
);

export const setUserMentorStatus = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    z
      .object({
        userId: z.string(),
        wantsToMentor: z.boolean(),
        mentorTeamCount: z.number().int().min(1).max(5),
      })
      .parse(data)
  )
  .handler(async ({ data }) => {
    const { setUserMentorStatusForCurrentUser } = await import(
      "./_internal/users"
    );
    return setUserMentorStatusForCurrentUser(data);
  });
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run --config vitest.integration.config.ts src/server/__tests__/mentors.integration.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Typecheck, lint, commit**

```bash
npm run typecheck && npm run check
git add src/server/users.ts src/server/_internal/users.ts src/server/__tests__/mentors.integration.test.ts
git commit -m "feat: add staff server functions to list and edit mentors"
```

---

## Task 6: Admin mentors page, overview link, and user-detail indicator

**Files:**

- Create: `src/routes/_authed/admin/mentors/index.tsx`
- Modify: `src/routes/_authed/admin/index.tsx` (Mentors NavCard)
- Modify: `src/routes/_authed/admin/users/$userId.tsx` (mentor line)

**Interfaces:**

- Consumes: `listMentors`, `setUserMentorStatus` (Task 5); `AdminTable`, `EmptyState`, `Input`, `Button`.
- Produces: nothing consumed later. Final task.

**Context:** `/admin/users` is admin-only; this page must allow instructors too. Match the other admin routes' `beforeLoad` but allow `["admin", "instructor"]` (as `/admin/projects` already does). Reuse `AdminTable` (`src/components/admin-table.tsx`) for the layout.

- [ ] **Step 1: Create the mentors route**

Create `src/routes/_authed/admin/mentors/index.tsx`:

```tsx
import {
  createFileRoute,
  Link,
  redirect,
  useRouter,
} from "@tanstack/react-router";
import { useState } from "react";
import { AdminTable } from "#/components/admin-table";
import { EmptyState } from "#/components/empty-state";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "#/components/ui/breadcrumb";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { getSession } from "#/lib/auth-guards";
import { pageTitle } from "#/lib/page-title";
import { listMentors, setUserMentorStatus } from "#/server/users";

export const Route = createFileRoute("/_authed/admin/mentors/")({
  head: () => ({ meta: [{ title: pageTitle("Mentors") }] }),
  beforeLoad: async () => {
    const session = await getSession();
    if (!session?.user) {
      throw redirect({ to: "/sign-in" });
    }
    if (!["admin", "instructor"].includes(session.user.role ?? "")) {
      throw redirect({ to: "/" });
    }
  },
  loader: async () => await listMentors(),
  component: MentorsAdmin,
});

function MentorRow({
  mentor,
}: {
  mentor: {
    affiliation: string | null;
    email: string;
    id: string;
    mentorTeamCount: number;
    name: string | null;
  };
}) {
  const router = useRouter();
  const [count, setCount] = useState(mentor.mentorTeamCount);

  async function save(wantsToMentor: boolean) {
    await setUserMentorStatus({
      data: { userId: mentor.id, wantsToMentor, mentorTeamCount: count },
    });
    router.invalidate();
  }

  return (
    <tr>
      <td className="border border-border p-2" data-label="Name">
        {mentor.name ?? "(none)"}
      </td>
      <td className="border border-border p-2" data-label="Affiliation">
        {mentor.affiliation ?? "(none)"}
      </td>
      <td className="border border-border p-2" data-label="Email">
        {mentor.email}
      </td>
      <td className="border border-border p-2" data-label="Teams">
        <Input
          aria-label={`Teams for ${mentor.name ?? mentor.email}`}
          className="w-20"
          max={5}
          min={1}
          onChange={(e) => setCount(Number(e.target.value))}
          type="number"
          value={count}
        />
      </td>
      <td className="border border-border p-2">
        <div className="flex gap-2">
          <Button onClick={() => save(true)} size="sm" variant="outline">
            Save
          </Button>
          <Button onClick={() => save(false)} size="sm" variant="outline">
            Remove
          </Button>
        </div>
      </td>
    </tr>
  );
}

function MentorsAdmin() {
  const { rows } = Route.useLoaderData();

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 md:p-8">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to="/admin">Admin</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Mentors</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <h1 className="mt-2 font-semibold text-2xl">Mentors</h1>
      <p className="mt-1 text-muted-foreground text-sm">
        Users who have volunteered to mentor a team. Adjust their team capacity
        or remove them.
      </p>
      {rows.length === 0 ? (
        <EmptyState>No mentors yet.</EmptyState>
      ) : (
        <div className="mt-4">
          <AdminTable columns={["Name", "Affiliation", "Email", "Teams", ""]}>
            {rows.map((m) => (
              <MentorRow key={m.id} mentor={m} />
            ))}
          </AdminTable>
        </div>
      )}
    </div>
  );
}
```

Confirm `AdminTable`'s prop name for headers matches (`columns`); adjust to its actual API if different (check `src/components/admin-table.tsx`).

- [ ] **Step 2: Add the overview NavCard**

In `src/routes/_authed/admin/index.tsx`, add `Handshake` to the `lucide-react` import and a NavCard in the "Manage" grid (visible to all staff, not gated by `isAdmin`):

```tsx
<NavCard
  description="See who volunteered to mentor and set capacity"
  icon={Handshake}
  label="Mentors"
  to="/admin/mentors"
/>;
```

- [ ] **Step 3: Add the mentor line to the user detail page**

In `src/routes/_authed/admin/users/$userId.tsx`, destructure the fields (they are on `user`) and, near the affiliation/joined lines, add:

```tsx
{
  user.wantsToMentor && (
    <p className="text-sm">
      <span className="text-muted-foreground">Mentor: </span>
      yes ({user.mentorTeamCount ?? 1} teams)
    </p>
  );
}
```

- [ ] **Step 4: Typecheck, lint**

Run: `npm run typecheck && npm run check`
Expected: clean.

- [ ] **Step 5: Manual + accessibility check**

Run `npm run dev`: as an instructor and as an admin, open `/admin/mentors`, confirm the list, editing a count, and removing a mentor all work and that a `user`-role account is redirected. Confirm the Mentors NavCard appears on `/admin` for both staff roles.

Run: `npm run test:accessibility`
Expected: PASS, including the new page's controls having accessible names.

- [ ] **Step 6: Full suites and commit**

Run: `npm run test && npm run test:integration`
Expected: green.

```bash
git add src/routes/_authed/admin/mentors/index.tsx src/routes/_authed/admin/index.tsx src/routes/_authed/admin/users/\$userId.tsx
git commit -m "feat: add the /admin/mentors page, overview link, and user-detail indicator"
```

---

## Self-Review

**Spec coverage:**

| Spec section                                                          | Task                                            |
| --------------------------------------------------------------------- | ----------------------------------------------- |
| Schema: mentor `additionalFields`, `teamsSupported`, migration        | Task 1                                          |
| Profile: mentor fields, affiliation-required refine, persist          | Task 2                                          |
| Profile UI: switch with audience copy, conditional count              | Task 3                                          |
| Project: `teamsSupported` form field, persistence, staff-only display | Task 4                                          |
| Server: `listMentors`, `setUserMentorStatus` (staff-gated)            | Task 5                                          |
| `/admin/mentors` page, overview NavCard, user-detail indicator        | Task 6                                          |
| Bounds 1 to 5 on both counts                                          | Tasks 2, 4, 5 (schemas)                         |
| Staff gating (admin + instructor) vs admin-only users page            | Tasks 5, 6                                      |
| Purely informational (no access change)                               | No task adds authorization from the mentor flag |
| Testing: schema refine, persistence, staff gate, a11y                 | Tasks 2, 4, 5, 6                                |

**Type consistency:** `wantsToMentor` (boolean) and `mentorTeamCount` (number, 1 to 5) are the names used in Task 1 (columns), Task 2 (`profileSchema`, persist), Task 3 (UI state and `updateProfile` payload), Task 5 (`listMentorsAs`, `setUserMentorStatusAs`), and Task 6 (page). `teamsSupported` (number, 1 to 5) is used in Task 1 (column), Task 4 (form schema, value maps, staff display). The `*As(viewer, ...)` seam names (`listMentorsAs`, `setUserMentorStatusAs`, `updateProfileAs`) are introduced in their tasks and consumed only by their tests and server-function wrappers.

**Placeholder scan:** none. Two steps say "confirm against the actual file" rather than asserting: `AdminTable`'s header prop name (Task 6 Step 1) and the `StaffProjectPanel` project prop type (Task 4 Step 6). Both name the specific file to check, because those exact APIs were not read in full during planning and guessing them could produce a broken call.

**Risk note:** Task 1 Step 3 is the load-bearing verification. Better Auth's `number` additionalField and `defaultValue` handling is the one place the generated output must be reviewed (column type and DB default), mirroring the pgvector migration hand-edit precedent. If the generated `mentor_team_count` is not an integer or lacks a NOT NULL default, the plan's Step 3 corrects it before anything downstream relies on it.
