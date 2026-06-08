# Proposer Account Linking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Read `docs/QUIRKS.md` before starting; it documents every framework gotcha this codebase has hit, including that the integration suite truncates the dev database.

**Goal:** Let staff link a project's proposer to an existing account by email (with a searchable account picker on the project form), or leave the proposer blank and enter contact details by hand, and tell proposers that contact info is publicly visible. Store the proposer's email as a stable link key so projects without an account yet can be back-linked later. This is Phase A of the design; the OSU ONID provider and the live sign-in auto-link are Phase B and out of scope here.

**Architecture:** `projects.proposerId` becomes nullable (FK `onDelete: set null`) and gains a sibling `proposerEmail` link key. The email is the canonical handle the staff form edits; the server resolves it to an account id on every write (email to `user.id`, unique). When no account matches, `proposerId` stays null and the email is retained for a future back-link. A staff-gated `searchUsers` server function powers a `ProposerPicker` combobox built from the existing shadcn `Command` + `Popover` primitives. The notification helpers gain a null-proposer guard so transitions on unlinked projects do not violate the `notifications.userId` not-null FK.

**Tech Stack:** Drizzle ORM + PostgreSQL, TanStack Start server functions (the `server` to `_internal` split with `*As` / `*ForCurrentUser` helpers), TanStack Form, shadcn/ui (`Command`, `Popover`, `Input`, `Button`), Zod, Vitest (unit + integration).

Spec: `docs/superpowers/specs/2026-06-07-proposer-account-linking-design.md`

---

## File Structure

- Modify `src/db/schema.ts`: `proposers.proposerId` nullable + `onDelete: "set null"`, new `proposerEmail` column + index.
- Generate a Drizzle migration under `drizzle/` (via `npm run db:generate`).
- Modify `src/server/_internal/notify.ts`: accept a nullable `proposerId` and skip when it is null.
- Modify `src/lib/project-visibility.ts`: `VisibleProject.proposerId` becomes `string | null`; `stripStaffOnlyFields` also nulls `proposerEmail` for non-staff (privacy).
- Modify `src/server/users.ts`: add `searchUsers` server function.
- Modify `src/server/_internal/users.ts`: add `searchUsersAs` / `searchUsersForCurrentUser`, staff-gated.
- Modify `src/server/projects.ts`: `projectInputSchema` gains optional `proposerEmail`.
- Modify `src/server/_internal/projects.ts`: `resolveProposerId`, staff-gated proposer writes in create/update, edit-log coverage.
- Modify `src/server/projects-queries.ts` and `src/server/_internal/projects-queries.ts`: add a staff-gated `getProposerEmailForEdit` server function for the edit-form prefill (keeps the linked email off the public read path).
- Create `src/components/proposer-picker.tsx`: staff-only email field + account search combobox.
- Modify `src/components/project-form.tsx`: `showProposer` prop, `proposerEmail` in schema/values, render the picker and the public-visibility note.
- Modify `src/routes/_authed/projects/$projectId/edit.tsx` and `src/routes/_authed/projects/new.tsx`: pass `showProposer`, prefill and submit `proposerEmail`.
- Tests: `src/server/__tests__/users-search.integration.test.ts`, additions to `src/server/__tests__/projects.integration.test.ts`, `src/test/proposer-picker.test.tsx`.

---

## Task 1: Schema change and migration

**Files:**
- Modify: `src/db/schema.ts`
- Generate: `drizzle/` migration

- [ ] **Step 1: Make `proposerId` nullable and add `proposerEmail`**

In `src/db/schema.ts`, in the `projects` table, change the `proposerId` column and add `proposerEmail` immediately after it:

```ts
    proposerId: text("proposer_id").references(() => user.id, {
      onDelete: "set null",
    }),
    proposerEmail: text("proposer_email"),
```

(The change: drop `.notNull()` and switch `onDelete` from `"restrict"` to `"set null"`.)

Add an index for back-fill lookups in the table's index array (alongside `projects_proposer_id_idx`):

```ts
    index("projects_proposer_email_idx").on(t.proposerEmail),
```

- [ ] **Step 2: Generate the migration**

Run: `npm run db:generate`
Expected: a new file appears under `drizzle/` altering `projects` (proposer_id nullable + FK recreated as `ON DELETE SET NULL`, new `proposer_email` column, new index). Inspect it to confirm it does not drop and recreate the table.

- [ ] **Step 3: Apply the migration**

Run: `npm run db:migrate`
Expected: migration applies cleanly against the local database (`docker compose up -d` must be running).

- [ ] **Step 4: Typecheck to surface null ripples**

Run: `npm run typecheck`
Expected: errors only where code assumes `proposerId` is non-null. The next tasks fix the two known sites (`notify.ts`, `project-visibility.ts`); if typecheck names any others, note them and address them in the matching task. Do not commit yet if typecheck is red.

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.ts drizzle
git commit -m "make project proposer nullable and add proposer email link key"
```

---

## Task 2: Null-safe notifications

**Files:**
- Modify: `src/server/_internal/notify.ts`
- Modify: `src/lib/project-visibility.ts`
- Test: `src/server/__tests__/projects.integration.test.ts`

- [ ] **Step 1: Write a failing integration test for a null-proposer transition**

Append to `src/server/__tests__/projects.integration.test.ts` a test that inserts a project with a null `proposerId` and forces a status change, asserting it does not throw and writes no proposer notification. Match the file's existing imports and `makeUser` style. The shape:

```ts
describe("transitions on an unlinked (null proposer) project", () => {
  it("does not throw and writes no proposer notification", async () => {
    const staff = await makeUser(`staff-${Date.now()}@x.com`, "admin");
    const [project] = await db
      .insert(projects)
      .values({
        title: "Unlinked",
        proposerId: null,
        proposerEmail: "ghost@example.edu",
        status: "submitted",
      })
      .returning();

    await expect(
      forceTransitionAs(staff, project.id, "approved")
    ).resolves.toMatchObject({ status: "approved" });

    const notes = await db
      .select()
      .from(notifications)
      .where(eq(notifications.link, `/projects/${project.id}`));
    expect(notes).toHaveLength(0);
  });
});
```

Ensure `notifications` and `forceTransitionAs` are imported in the test file (add to the existing imports if missing).

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:integration -- src/server/__tests__/projects.integration.test.ts`
Expected: FAIL with a not-null violation on `notifications.userId` (the helper tries to insert a null recipient).

- [ ] **Step 3: Guard the notification helpers**

In `src/server/_internal/notify.ts`, change the `Project` interface so the proposer is nullable:

```ts
interface Project {
  id: string;
  proposerId: string | null;
  title: string;
}
```

In `recordStatusChangeNotifications` and `recordSoftDeleteNotification`, broaden the early return to also skip a null proposer:

```ts
  if (!project.proposerId || project.proposerId === actorId) {
    return;
  }
```

In `recordCommentNotifications`, guard the proposer before adding it to the recipient set:

```ts
  if (project.proposerId && comment.authorId !== project.proposerId) {
    recipients.add(project.proposerId);
  }
```

- [ ] **Step 4: Relax the visibility type and strip the email for non-staff**

In `src/lib/project-visibility.ts`, change `VisibleProject` so `proposerId` is nullable:

```ts
  proposerId: string | null;
```

`isOwner` already compares with `===`, so a null proposer simply never matches a viewer.

`proposerEmail` is staff-only and must never reach a public payload. `getProjectImpl` (the read path behind the public detail page) returns `stripStaffOnlyFields(project, viewer)`, which currently nulls only `notes`. Extend the non-staff branch to also null the email:

```ts
  return { ...project, notes: null, proposerEmail: null };
```

- [ ] **Step 5: Verify the test passes and typecheck is clean**

Run: `npm run test:integration -- src/server/__tests__/projects.integration.test.ts`
Expected: PASS, including the new test.
Run: `npm run typecheck`
Expected: zero errors (the two known null ripples are now resolved).

- [ ] **Step 6: Commit**

```bash
git add src/server/_internal/notify.ts src/lib/project-visibility.ts src/server/__tests__/projects.integration.test.ts
git commit -m "skip proposer notifications when a project has no linked account"
```

---

## Task 3: Staff user-search server function

**Files:**
- Modify: `src/server/users.ts`
- Modify: `src/server/_internal/users.ts`
- Test: `src/server/__tests__/users-search.integration.test.ts`

- [ ] **Step 1: Write the failing integration test**

Create `src/server/__tests__/users-search.integration.test.ts`:

```ts
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "#/db";
import { user } from "#/db/schema";
import { auth } from "#/lib/auth";
import { searchUsersAs } from "../_internal/users";

async function makeUser(email: string, role: "user" | "instructor" | "admin") {
  await auth.api.signUpEmail({
    body: { email, password: "Password1!", name: email },
  });
  await db
    .update(user)
    .set({ emailVerified: true, role })
    .where(eq(user.email, email));
  const [u] = await db.select().from(user).where(eq(user.email, email));
  return { id: u.id, role: u.role };
}

describe("searchUsers", () => {
  it("matches by email fragment for a staff viewer", async () => {
    const staff = await makeUser(`staff-${Date.now()}@x.com`, "instructor");
    const target = await makeUser(`needle-${Date.now()}@x.com`, "user");

    const rows = await searchUsersAs(staff, { q: "needle" });
    expect(rows.some((r) => r.id === target.id)).toBe(true);
    expect(rows[0]).toHaveProperty("email");
    expect(rows[0]).not.toHaveProperty("banned");
  });

  it("forbids a non-staff viewer", async () => {
    const plain = await makeUser(`plain-${Date.now()}@x.com`, "user");
    await expect(searchUsersAs(plain, { q: "x" })).rejects.toThrow("Forbidden");
  });

  it("returns an empty list for a blank query", async () => {
    const staff = await makeUser(`staff2-${Date.now()}@x.com`, "admin");
    const rows = await searchUsersAs(staff, { q: "" });
    expect(rows).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:integration -- src/server/__tests__/users-search.integration.test.ts`
Expected: FAIL (cannot find `searchUsersAs` / `searchUsersForCurrentUser`).

- [ ] **Step 3: Implement the staff-gated search**

In `src/server/_internal/users.ts`, add the `isStaff` import at the top:

```ts
import { isStaff } from "#/lib/project-visibility";
```

Add an `assertStaff` guard near `assertAdmin`:

```ts
function assertStaff(viewer: AuthUser) {
  if (!isStaff({ id: viewer.id, role: viewer.role ?? null })) {
    throw new Error("Forbidden");
  }
}
```

Add the search implementation and its helpers (place after `getUserForCurrentUser`):

```ts
const SEARCH_LIMIT = 10;

export async function searchUsersAs(
  viewer: AuthUser,
  data: { q: string }
): Promise<{ id: string; name: string; email: string }[]> {
  assertStaff(viewer);
  const q = data.q.trim();
  if (!q) {
    return [];
  }
  return db
    .select({ id: user.id, name: user.name, email: user.email })
    .from(user)
    .where(or(ilike(user.email, `%${q}%`), ilike(user.name, `%${q}%`)))
    .orderBy(user.email)
    .limit(SEARCH_LIMIT);
}

export async function searchUsersForCurrentUser(data: { q: string }) {
  const viewer = await requireUser();
  return searchUsersAs(viewer, data);
}
```

(`or`, `ilike`, `user`, and `requireUser` are already imported in this file.)

- [ ] **Step 4: Expose the server function**

In `src/server/users.ts`, add a schema and a `searchUsers` GET server function:

```ts
const searchUsersSchema = z.object({ q: z.string().trim().max(200).default("") });

export const searchUsers = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => searchUsersSchema.parse(data ?? {}))
  .handler(async ({ data }) => {
    const { searchUsersForCurrentUser } = await import("./_internal/users");
    return searchUsersForCurrentUser(data);
  });
```

- [ ] **Step 5: Verify the test passes**

Run: `npm run test:integration -- src/server/__tests__/users-search.integration.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/server/users.ts src/server/_internal/users.ts src/server/__tests__/users-search.integration.test.ts
git commit -m "add staff-gated searchUsers server function"
```

---

## Task 4: Resolve proposer by email on create and update

**Files:**
- Modify: `src/server/projects.ts`
- Modify: `src/server/_internal/projects.ts`
- Modify: `src/server/projects-queries.ts`
- Modify: `src/server/_internal/projects-queries.ts`
- Test: `src/server/__tests__/projects.integration.test.ts`

- [ ] **Step 1: Write failing integration tests for proposer linking**

Append to `src/server/__tests__/projects.integration.test.ts`:

```ts
describe("staff proposer linking by email", () => {
  it("links proposerId when the email matches an account", async () => {
    const staff = await makeUser(`staff-${Date.now()}@x.com`, "admin");
    const target = await makeUser(`target-${Date.now()}@x.com`, "user");

    const { id } = await createProjectAs(staff, {
      title: "Linked",
      proposerEmail: target.email,
    } as never);

    const [row] = await db.select().from(projects).where(eq(projects.id, id));
    expect(row.proposerId).toBe(target.id);
    expect(row.proposerEmail).toBe(target.email);
  });

  it("keeps proposerId null when the email matches no account", async () => {
    const staff = await makeUser(`staff2-${Date.now()}@x.com`, "admin");
    const { id } = await createProjectAs(staff, {
      title: "Pending",
      proposerEmail: "noaccount@example.edu",
    } as never);

    const [row] = await db.select().from(projects).where(eq(projects.id, id));
    expect(row.proposerId).toBeNull();
    expect(row.proposerEmail).toBe("noaccount@example.edu");
  });

  it("ignores proposerEmail from a non-staff creator", async () => {
    const plain = await makeUser(`plain-${Date.now()}@x.com`, "user");
    const other = await makeUser(`other-${Date.now()}@x.com`, "user");
    const { id } = await createProjectAs(plain, {
      title: "Self",
      proposerEmail: other.email,
    } as never);

    const [row] = await db.select().from(projects).where(eq(projects.id, id));
    expect(row.proposerId).toBe(plain.id);
    expect(row.proposerEmail).toBeNull();
  });
});
```

Make sure `makeUser` in this file returns `email` (extend it if it currently returns only `id`/`role`), and that `createProjectAs` and `projects` are imported.

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:integration -- src/server/__tests__/projects.integration.test.ts`
Expected: FAIL (`proposerEmail` not accepted / not persisted; proposerId not resolved).

- [ ] **Step 3: Add `proposerEmail` to the input schema**

In `src/server/projects.ts`, add to `projectInputSchema`:

```ts
  proposerEmail: z
    .string()
    .email()
    .max(200)
    .nullable()
    .optional()
    .or(z.literal("")),
```

- [ ] **Step 4: Add the resolver and write logic**

In `src/server/_internal/projects.ts`, import `user` and `eq` is already imported; add `user` to the schema import:

```ts
import { projectEditLog, projectStatusHistory, projects, user } from "#/db/schema";
```

Add the resolver helper (after `loadProjectOr404`):

```ts
async function resolveProposerId(
  email: string | null | undefined
): Promise<string | null> {
  if (!email) {
    return null;
  }
  const [match] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, email));
  return match?.id ?? null;
}
```

In `createProjectAs`, replace the hardcoded `proposerId: viewer.id` with staff-aware resolution. Before the insert:

```ts
  const staff = isStaff(viewerToVisibility(viewer));
  const proposerEmail = staff ? data.proposerEmail || null : null;
  const proposerId = proposerEmail
    ? await resolveProposerId(proposerEmail)
    : viewer.id;
```

and in the `.values({ ... })` object set:

```ts
      proposerId,
      proposerEmail,
```

(Remove the old `proposerId: viewer.id` line; keep `notes: allowedNotes`. Reuse the existing `allowedNotes` staff check or the new `staff` constant; do not compute `isStaff` twice.)

In `updateProjectAs`, the proposer is staff-only. Add `proposerEmail` to the `PROJECT_EDITABLE_FIELDS` list so changes are diffed and logged, then in the staff branch resolve and stage both columns. After the existing `if (staff) { newValues.notes = data.notes ?? null; }` block, extend it:

```ts
  if (staff) {
    newValues.notes = data.notes ?? null;
    const proposerEmail = data.proposerEmail || null;
    newValues.proposerEmail = proposerEmail;
    newValues.proposerId = proposerEmail
      ? await resolveProposerId(proposerEmail)
      : null;
  }
```

Add `"proposerEmail"` and `"proposerId"` to `PROJECT_EDITABLE_FIELDS`, and in the diff loop skip them for non-staff just as `notes` is skipped:

```ts
    if (!staff && (field === "notes" || field === "proposerEmail" || field === "proposerId")) {
      continue;
    }
```

> Note on not orphaning an existing proposer: the edit route (Task 6) prefills the form's `proposerEmail` from the linked account's email, so a staff save that does not touch the proposer re-resolves to the same `proposerId`. Clearing the field is the explicit unlink gesture.

- [ ] **Step 5: Add a staff-gated `getProposerEmailForEdit` for the form prefill**

The edit form must prefill the proposer email from the linked account so a staff save that leaves the proposer untouched re-resolves to the same `proposerId` (the non-orphan guarantee). Do NOT add this to `getProjectImpl`: that read path feeds the public detail page, and putting a resolved account email there would ship staff-only PII to every viewer. Instead add a separate staff-gated function that the edit loader alone calls.

In `src/server/_internal/projects-queries.ts`, add:

```ts
export async function getProposerEmailForEditImpl(data: {
  projectId: string;
}): Promise<string> {
  const viewer = await getViewer();
  if (!isStaff(viewer)) {
    throw new Error("Forbidden");
  }
  const [project] = await db
    .select({ proposerId: projects.proposerId, proposerEmail: projects.proposerEmail })
    .from(projects)
    .where(eq(projects.id, data.projectId));
  if (!project) {
    return "";
  }
  if (project.proposerEmail) {
    return project.proposerEmail;
  }
  if (!project.proposerId) {
    return "";
  }
  const [account] = await db
    .select({ email: user.email })
    .from(user)
    .where(eq(user.id, project.proposerId));
  return account?.email ?? "";
}
```

(`getViewer`, `isStaff`, `projects`, `eq`, and `db` are already imported here; add `user` to the schema import if missing.)

In `src/server/projects-queries.ts`, expose it as a staff-only server function:

```ts
export const getProposerEmailForEdit = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) =>
    z.object({ projectId: z.string().uuid() }).parse(data)
  )
  .handler(async ({ data }) => {
    const { getProposerEmailForEditImpl } = await import(
      "./_internal/projects-queries"
    );
    return getProposerEmailForEditImpl(data);
  });
```

- [ ] **Step 6: Verify tests pass and typecheck**

Run: `npm run test:integration -- src/server/__tests__/projects.integration.test.ts`
Expected: PASS, including the three new linking tests.
Run: `npm run typecheck`
Expected: zero errors.

- [ ] **Step 7: Commit**

```bash
git add src/server/projects.ts src/server/_internal/projects.ts src/server/__tests__/projects.integration.test.ts
git commit -m "resolve project proposer from email on staff create and update"
```

---

## Task 5: Proposer picker and public-visibility note

**Files:**
- Create: `src/components/proposer-picker.tsx`
- Modify: `src/components/project-form.tsx`
- Test: `src/test/proposer-picker.test.tsx`

- [ ] **Step 1: Write the failing component test**

Create `src/test/proposer-picker.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("#/server/users", () => ({
  searchUsers: vi.fn(),
}));

import { ProposerPicker } from "#/components/proposer-picker";
import { searchUsers } from "#/server/users";

const mockedSearch = vi.mocked(searchUsers);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ProposerPicker", () => {
  it("renders the email value and lets you type a new one", () => {
    const onChange = vi.fn();
    const { getByLabelText } = render(
      <ProposerPicker onChange={onChange} value="known@example.edu" />
    );
    const input = getByLabelText("Proposer email") as HTMLInputElement;
    expect(input.value).toBe("known@example.edu");
    fireEvent.change(input, { target: { value: "new@example.edu" } });
    expect(onChange).toHaveBeenCalledWith("new@example.edu");
  });

  it("fills the email from a selected search result", async () => {
    mockedSearch.mockResolvedValue([
      { id: "u1", name: "Pat Lee", email: "pat@example.edu" },
    ] as never);
    const onChange = vi.fn();
    const { getByPlaceholderText, findByText } = render(
      <ProposerPicker onChange={onChange} value="" />
    );
    fireEvent.change(getByPlaceholderText("Search accounts..."), {
      target: { value: "pat" },
    });
    fireEvent.click(await findByText(/pat@example.edu/));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith("pat@example.edu"));
  });

  it("selects a result by keyboard (ArrowDown then Enter)", async () => {
    mockedSearch.mockResolvedValue([
      { id: "u1", name: "Pat Lee", email: "pat@example.edu" },
    ] as never);
    const onChange = vi.fn();
    const { getByPlaceholderText, findByText } = render(
      <ProposerPicker onChange={onChange} value="" />
    );
    const search = getByPlaceholderText("Search accounts...");
    fireEvent.change(search, { target: { value: "pat" } });
    await findByText(/pat@example.edu/);
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "Enter" });
    await waitFor(() => expect(onChange).toHaveBeenCalledWith("pat@example.edu"));
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -- src/test/proposer-picker.test.tsx`
Expected: FAIL (module `#/components/proposer-picker` not found).

- [ ] **Step 3: Build the picker**

Create `src/components/proposer-picker.tsx`. It is a controlled input over the proposer email, plus a search popover that fills the email from an existing account. Use the existing `Command`, `Popover`, `Input`, `Label`, and `Button` primitives. Debounce the search with a top-level constant delay.

```tsx
import { useEffect, useRef, useState } from "react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "#/components/ui/command";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "#/components/ui/popover";
import { Button } from "#/components/ui/button";
import { searchUsers } from "#/server/users";

const SEARCH_DEBOUNCE_MS = 250;

type Match = { id: string; name: string; email: string };

export function ProposerPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (email: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<Match[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) {
      clearTimeout(timer.current);
    }
    if (!query.trim()) {
      setMatches([]);
      return;
    }
    timer.current = setTimeout(async () => {
      try {
        const rows = (await searchUsers({ data: { q: query } })) as Match[];
        setMatches(rows);
      } catch {
        setMatches([]);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      if (timer.current) {
        clearTimeout(timer.current);
      }
    };
  }, [query]);

  return (
    <div className="space-y-1.5">
      <Label htmlFor="proposerEmail">Proposer email</Label>
      <div className="flex gap-2">
        <Input
          id="proposerEmail"
          name="proposerEmail"
          onChange={(e) => onChange(e.target.value)}
          placeholder="proposer@oregonstate.edu"
          type="email"
          value={value}
        />
        <Popover onOpenChange={setOpen} open={open}>
          <PopoverTrigger asChild>
            <Button size="sm" type="button" variant="outline">
              Find account
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 p-0">
            <Command shouldFilter={false}>
              <CommandInput
                onValueChange={setQuery}
                placeholder="Search accounts..."
                value={query}
              />
              <CommandList>
                <CommandEmpty>No accounts found.</CommandEmpty>
                <CommandGroup>
                  {matches.map((m) => (
                    <CommandItem
                      key={m.id}
                      onSelect={() => {
                        onChange(m.email);
                        setOpen(false);
                      }}
                      value={m.email}
                    >
                      <span className="font-medium">{m.name}</span>
                      <span className="ml-2 text-muted-foreground text-xs">
                        {m.email}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>
      <p className="text-muted-foreground text-xs">
        Links this project to the proposer's account, now or when they first
        sign in with this email. Leave blank for an external proposer.
      </p>
    </div>
  );
}
```

If the `Command` subcomponents (`CommandEmpty`, etc.) are not all exported from `src/components/ui/command.tsx`, add the missing exports rather than inventing new ones.

- [ ] **Step 4: Wire the picker, schema, and note into `project-form.tsx`**

In `src/components/project-form.tsx`:

- Add `proposerEmail` to `projectFormSchema` using the existing `optionalEmail` union:

```ts
  proposerEmail: optionalEmail,
```

- Add `proposerEmail: initial?.proposerEmail ?? ""` to `defaultValues`.
- Add `showProposer?: boolean` to `Props` and destructure it in the component signature.
- Import the picker: `import { ProposerPicker } from "./proposer-picker";`
- Render the picker at the top of the staff section. Place it just before the staff-only `notes` field, gated on `showProposer`, wired to the form field:

```tsx
      {showProposer && (
        <form.Field name="proposerEmail">
          {(field: AnyForm) => (
            <ProposerPicker
              onChange={(email) => field.handleChange(email)}
              value={field.state.value as string}
            />
          )}
        </form.Field>
      )}
```

- Add the public-visibility note directly above the `Contact name` field:

```tsx
      <p className="text-muted-foreground text-xs">
        Contact details below are shown publicly on the project page. Leave them
        blank to keep them private.
      </p>
```

- [ ] **Step 5: Run the component tests**

Run: `npm run test -- src/test/proposer-picker.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/components/proposer-picker.tsx src/components/project-form.tsx src/test/proposer-picker.test.tsx src/components/ui/command.tsx
git commit -m "add staff proposer picker and public contact note to the project form"
```

---

## Task 6: Wire the edit and new routes

**Files:**
- Modify: `src/routes/_authed/projects/$projectId/edit.tsx`
- Modify: `src/routes/_authed/projects/new.tsx`

- [ ] **Step 1: Edit route prefill, submit, and gate**

In `src/routes/_authed/projects/$projectId/edit.tsx`:

- Import the new server function alongside the existing imports:

```tsx
import { getProject, getProposerEmailForEdit } from "#/server/projects-queries";
```

- In the loader, resolve the proposer email for staff only and return it. After the `categoryRows` fetch:

```tsx
    const proposerEmail = data.viewerIsStaff
      ? await getProposerEmailForEdit({ data: { projectId: params.projectId } })
      : "";
    return {
      ...data,
      categoryIds: categoryRows.map((c) => c.id),
      proposerEmail,
    };
```

- In the component, destructure it from the loader data in one read:

```tsx
  const { project, viewerIsStaff, categoryIds, proposerEmail } =
    Route.useLoaderData();
```

- In the `initial` object, add `proposerEmail` directly (it is already the resolved string):

```tsx
            proposerEmail,
```

- In `onSubmit`, include the proposer email in the `updateProject` payload, staff-gated:

```tsx
                proposerEmail: viewerIsStaff ? values.proposerEmail || null : undefined,
```

- Pass the gate prop to the form: `showProposer={viewerIsStaff}`.

- [ ] **Step 2: New route gate and submit**

In `src/routes/_authed/projects/new.tsx`:

- Pass `showProposer={isStaff}` to `ProjectForm`.
- In `onSubmit`, include `proposerEmail: isStaff ? values.proposerEmail || null : undefined` in the `createProject` payload.

- [ ] **Step 3: Typecheck and lint**

Run: `npm run typecheck`
Expected: zero errors.
Run: `npm run check`
Expected: no Biome violations in the changed files.

- [ ] **Step 4: Manual verification**

With `docker compose up -d` and `npm run dev`, signed in as an admin or instructor:
- Open New project: confirm the Proposer email field and Find account button appear; create a draft linking an existing account by search; confirm the project detail shows the contact info you entered and the project lists under that account in admin user detail.
- Open an existing project's edit page: confirm the proposer email prefills to the current proposer's account email and that saving without touching it preserves the proposer.
- Sign in as a normal user: confirm the Proposer field is not shown and creating a project still attributes it to you.

- [ ] **Step 5: Commit**

```bash
git add src/routes/_authed/projects/$projectId/edit.tsx src/routes/_authed/projects/new.tsx
git commit -m "expose the proposer picker on the project new and edit routes"
```

---

## Task 7: Full verification

- [ ] **Step 1: Unit tests**

Run: `npm run test`
Expected: PASS, including `proposer-picker`.

- [ ] **Step 2: Integration tests**

Run: `npm run test:integration`
Expected: PASS, including `users-search.integration` and the new `projects.integration` cases.

- [ ] **Step 3: Lint, format, typecheck**

Run: `npm run check && npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 5: Final formatting commit if needed**

```bash
git add -A
git commit -m "formatting for proposer account linking" || echo "nothing to commit"
```

---

## Self-Review Notes

- **Spec coverage:** nullable `proposerId` + `proposerEmail` key (Task 1), null-safety sweep on notifications (Task 2), staff-gated `searchUsers` (Task 3), email-to-account resolution on staff create/update with edit-log coverage (Task 4), the proposer picker plus the public-visibility note (Task 5), route wiring with non-orphaning prefill (Task 6). Phase B (ONID provider, `account.accountLinking`, the `databaseHook` back-fill, and the legacy import script) is intentionally excluded; the `proposerEmail` key and `resolveProposerId` are the seams it will reuse.
- **Decisions honored:** ONID deferred; `proposerEmail` retained after linking (never cleared on resolve); the public `contactEmail` is only ever entered manually and is never populated from an account email.
- **Security:** every proposer mutation is staff-gated server-side (`isStaff`), so a crafted non-staff request carrying `proposerEmail` is ignored, not honored. `searchUsers` requires staff and returns only `{ id, name, email }`, never ban or role internals.
- **Privacy:** `proposerEmail` is stripped for non-staff in `stripStaffOnlyFields`, so it never rides the public detail payload, and the linked-account email is resolved only through the staff-gated `getProposerEmailForEdit`, which the edit loader calls for staff alone. Neither value reaches an anonymous viewer.
- **Non-orphan guarantee:** the edit form prefills `proposerEmail` from the linked account's email, so a staff save that leaves the proposer untouched re-resolves to the same `proposerId`; clearing the field is the explicit unlink.
- **Type consistency:** `proposerId` is `string | null` end to end (`schema`, `VisibleProject`, `notify` `Project`); `resolveProposerId(email) -> string | null` is the single resolution point used by both create and update.
