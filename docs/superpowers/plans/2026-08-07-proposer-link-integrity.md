# Proposer Link Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lock the proposer email field behind a re-assign modal when a real account is linked, and make a project actually claim its proposer's account once that address is verified.

**Architecture:** `projects.proposer_id` is already the signal: non-null means a real account is behind the address. `getProposerEmailForEditImpl` widens from a bare string to `{ accountLinked, accountName, email }`, which the picker uses to choose between free-text and locked modes. Separately, two Better Auth hooks call a new `claimProjectsForVerifiedUser`, gated so an address is only ever claimed once its owner has proven control of it.

**Tech Stack:** TypeScript, TanStack Start server functions, TanStack Form, Drizzle ORM on Postgres, Better Auth 1.6.25, Vitest with jsdom for components, shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-08-07-proposer-link-integrity-design.md`

## Global Constraints

- Never use emdashes in prose, comments, or copy. Use proper punctuation instead.
- Run `npm run check` and `npm run typecheck` on the whole project before committing. Never per-file.
- Unit and component tests: `npm test`. Integration: `ulimit -n 8192 && npm run test:integration`.
- This app is pre-production. Rename and restructure rather than leaving aliases or parallel paths. `getProposerEmailForEditImpl` is renamed, not duplicated.
- A project is claimed only for a **verified** address. Claiming on account creation alone would let anyone take a colleague's projects by registering at their address. Every claim path must be able to point at the proof.
- Nothing added to `src/lib/auth.ts` may throw at module scope. `getEmailSender()` already runs there and a throw fails the app's boot.
- A failed claim must never block a sign-in or a verification.
- The locked input is `readOnly`, never `disabled`. A disabled input drops out of keyboard navigation and reads poorly to a screen reader, and the value still needs to be visible and copyable.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/server/_internal/claim-projects.ts` (new) | The claim query. Case-insensitive match, `proposer_id is null` guard, idempotent. |
| `src/server/__tests__/claim-projects.integration.test.ts` (new) | Claim behavior and the verification boundary. |
| `src/lib/auth.ts` (modify) | The two hooks, both swallowing failure. |
| `src/server/_internal/projects-queries.ts` (modify) | `getProposerForEditImpl` returns the richer shape. |
| `src/server/projects-queries.ts` (modify) | Wrapper renamed to `getProposerForEdit`. |
| `src/routes/_authed/projects/$projectId/edit.tsx` (modify) | Loader returns the object rather than a string. |
| `src/routes/_authed/projects/new.tsx` (modify) | Passes the unlinked default. |
| `src/components/project-form.tsx` (modify) | Threads the shape to the picker. |
| `src/components/proposer-picker.tsx` (modify) | Two modes, the re-assign modal, the height fix, corrected help text. |
| `src/test/proposer-picker.test.tsx` (modify) | Both modes and the modal. |
| `docs/QUIRKS.md` (modify) | Why claiming is tied to verification. |

---

### Task 1: Claim projects when an address is verified

Self-contained and server-side. Nothing in the UI depends on it.

**Files:**
- Create: `src/server/_internal/claim-projects.ts`
- Test: `src/server/__tests__/claim-projects.integration.test.ts`
- Modify: `src/lib/auth.ts`

**Interfaces:**
- Consumes: `projects` from `#/db/schema`, `db` from `#/db`.
- Produces: `claimProjectsForVerifiedUser(userId: string, email: string): Promise<number>`, returning the number of projects claimed.

- [ ] **Step 1: Write the failing test**

Create `src/server/__tests__/claim-projects.integration.test.ts`. Follow the
`makeUser` shape used in `projects.integration.test.ts`.

```ts
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "#/db";
import { projects, user } from "#/db/schema";
import { auth } from "#/lib/auth";
import { claimProjectsForVerifiedUser } from "#/server/_internal/claim-projects";

async function makeProject(fields: {
  proposerEmail: string | null;
  proposerId?: string | null;
  deletedAt?: Date | null;
}) {
  const [row] = await db
    .insert(projects)
    .values({
      title: "P",
      status: "draft",
      proposerEmail: fields.proposerEmail,
      proposerId: fields.proposerId ?? null,
      deletedAt: fields.deletedAt ?? null,
    })
    .returning();
  return row;
}

async function makeAccount(email: string) {
  await auth.api.signUpEmail({
    body: { email, password: "Password1!", name: email },
  });
  const [u] = await db.select().from(user).where(eq(user.email, email));
  return u;
}

async function statusOf(id: string) {
  const [row] = await db.select().from(projects).where(eq(projects.id, id));
  return row;
}

describe("claimProjectsForVerifiedUser", () => {
  it("claims an unlinked project whose proposer email matches", async () => {
    const account = await makeAccount("claim1@x.edu");
    const project = await makeProject({ proposerEmail: "claim1@x.edu" });

    const count = await claimProjectsForVerifiedUser(account.id, "claim1@x.edu");

    expect(count).toBe(1);
    expect((await statusOf(project.id)).proposerId).toBe(account.id);
  });

  it("matches case-insensitively", async () => {
    const account = await makeAccount("claim2@x.edu");
    const project = await makeProject({ proposerEmail: "Claim2@X.EDU" });

    await claimProjectsForVerifiedUser(account.id, "claim2@x.edu");

    expect((await statusOf(project.id)).proposerId).toBe(account.id);
  });

  it("never steals a project that is already linked to someone else", async () => {
    const owner = await makeAccount("owner-c@x.edu");
    const other = await makeAccount("other-c@x.edu");
    const project = await makeProject({
      proposerEmail: "other-c@x.edu",
      proposerId: owner.id,
    });

    const count = await claimProjectsForVerifiedUser(other.id, "other-c@x.edu");

    expect(count).toBe(0);
    expect((await statusOf(project.id)).proposerId).toBe(owner.id);
  });

  it("claims soft-deleted projects so a restore is not orphaned", async () => {
    const account = await makeAccount("claim3@x.edu");
    const project = await makeProject({
      proposerEmail: "claim3@x.edu",
      deletedAt: new Date(),
    });

    await claimProjectsForVerifiedUser(account.id, "claim3@x.edu");

    expect((await statusOf(project.id)).proposerId).toBe(account.id);
  });

  it("is idempotent", async () => {
    const account = await makeAccount("claim4@x.edu");
    await makeProject({ proposerEmail: "claim4@x.edu" });

    expect(await claimProjectsForVerifiedUser(account.id, "claim4@x.edu")).toBe(1);
    expect(await claimProjectsForVerifiedUser(account.id, "claim4@x.edu")).toBe(0);
  });

  it("claims nothing for a blank or non-matching address", async () => {
    const account = await makeAccount("claim5@x.edu");
    await makeProject({ proposerEmail: "someone-else@x.edu" });

    expect(await claimProjectsForVerifiedUser(account.id, "")).toBe(0);
    expect(await claimProjectsForVerifiedUser(account.id, "claim5@x.edu")).toBe(0);
  });
});

describe("the verification boundary", () => {
  it("does not claim on an unverified password sign-up", async () => {
    const project = await makeProject({ proposerEmail: "unverified@x.edu" });

    const account = await makeAccount("unverified@x.edu");

    // signUpEmail leaves emailVerified false, so the create hook's guard must
    // decline. This is the whole security property: registering at an address
    // must not claim its projects.
    expect(account.emailVerified).toBe(false);
    expect((await statusOf(project.id)).proposerId).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `ulimit -n 8192 && npm run test:integration -- claim-projects`
Expected: FAIL, cannot resolve `#/server/_internal/claim-projects`.

- [ ] **Step 3: Write the claim function**

Create `src/server/_internal/claim-projects.ts`:

```ts
import { and, isNull, sql } from "drizzle-orm";
import { db } from "#/db";
import { projects } from "#/db/schema";

/**
 * Links every unclaimed project whose proposer email matches `email` to
 * `userId`, and returns how many were claimed.
 *
 * Only ever called for an address whose owner has proven control of it.
 * Claiming on sign-up alone would let anyone take a colleague's projects by
 * registering at their address, so both call sites in `src/lib/auth.ts` gate on
 * verification.
 *
 * Idempotent: the `proposer_id is null` guard means a repeat call claims
 * nothing. Soft-deleted projects are claimed too, so restoring one does not
 * produce a project with no owner.
 */
export async function claimProjectsForVerifiedUser(
  userId: string,
  email: string
): Promise<number> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) {
    return 0;
  }
  const claimed = await db
    .update(projects)
    .set({ proposerId: userId })
    .where(
      and(
        isNull(projects.proposerId),
        // Case-insensitive on purpose. This will not use
        // projects_proposer_email_idx, which is on the raw column; at capstone
        // scale that costs nothing and correctness matters more.
        sql`lower(${projects.proposerEmail}) = ${normalized}`
      )
    )
    .returning({ id: projects.id });
  return claimed.length;
}
```

- [ ] **Step 4: Wire both hooks into `src/lib/auth.ts`**

Add the import beside the existing ones:

```ts
import { claimProjectsForVerifiedUser } from "#/server/_internal/claim-projects";
```

Add this helper above `export const auth`:

```ts
/**
 * Claims a newly verified user's projects. Swallows failure on purpose: a
 * claim must never block a sign-in or a verification, and the operation is
 * idempotent, so the next verification or sign-in retries it for free.
 */
async function claimProjectsFor(userId: string, email: string): Promise<void> {
  try {
    await claimProjectsForVerifiedUser(userId, email);
  } catch (error) {
    console.error(`Claiming projects failed for user ${userId}`, error);
  }
}
```

Add `afterEmailVerification` inside the existing `emailVerification` block:

```ts
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    callbackURL: "/verify-email",
    sendVerificationEmail: async ({ user, url }) => {
      await emailSender.sendVerification({ to: user.email, url });
    },
    // The address is proven at exactly this moment, so this is where a project
    // may be linked to its proposer.
    afterEmailVerification: async (verified) => {
      await claimProjectsFor(verified.id, verified.email);
    },
  },
```

Add `databaseHooks` as a new top-level key:

```ts
  databaseHooks: {
    user: {
      create: {
        // Covers OAuth, which never visits the email-verification routes and so
        // never fires afterEmailVerification. The guard is what keeps this from
        // claiming for an unverified password sign-up, where emailVerified is
        // false at creation.
        after: async (created) => {
          if (created.emailVerified) {
            await claimProjectsFor(created.id, created.email);
          }
        },
      },
    },
  },
```

If Task 2 of the review-emails plan has already landed, `sendVerificationEmail`
reads `emailSender.send(user.email, verificationEmail({ url }))` instead. Keep
whichever form is in the file; only add the new key.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `ulimit -n 8192 && npm run test:integration -- claim-projects`
Expected: PASS.

- [ ] **Step 6: Prove the security test can fail**

Temporarily remove the `if (created.emailVerified)` guard, re-run, and confirm
"does not claim on an unverified password sign-up" FAILS. Revert. A guard whose
test cannot fail is not a guard.

- [ ] **Step 7: Settle the GitHub question the spec left open**

The spec could not determine whether a GitHub sign-up arrives with
`emailVerified` true, because the provider source is bundled. Determine it:

```bash
grep -rl "emailVerified" node_modules/better-auth/dist/ | head
```

and read whichever module maps the OAuth profile. Record the finding as a
comment beside the `create.after` hook, one sentence, saying whether GitHub
sign-ups are claimed. Do **not** widen the guard either way. If GitHub users
arrive unverified, that is a correct outcome under this spec, and Task 3's help
text should say linking happens on verification rather than on sign-in.

- [ ] **Step 8: Run the whole suite, check, and commit**

```bash
npm test && ulimit -n 8192 && npm run test:integration
npm run check && npm run typecheck
git add src/server/_internal/claim-projects.ts src/server/__tests__/claim-projects.integration.test.ts src/lib/auth.ts
git commit -m "feat(projects): claim a proposer's projects when their address is verified"
```

---

### Task 2: Expose whether an account is linked

**Files:**
- Modify: `src/server/_internal/projects-queries.ts:330-361`
- Modify: `src/server/projects-queries.ts:61-70`
- Modify: `src/routes/_authed/projects/$projectId/edit.tsx:37-46` and `:114`
- Modify: `src/routes/_authed/projects/new.tsx:54`
- Modify: `src/components/project-form.tsx:70,84,419-427`
- Test: `src/server/__tests__/projects.integration.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces:
  - `interface ProposerForEdit { accountLinked: boolean; accountName: string | null; email: string }`
  - `getProposerForEditAs(viewer: Viewer | null, data: { projectId: string }): Promise<ProposerForEdit>`
  - `getProposerForEditImpl(data: { projectId: string }): Promise<ProposerForEdit>`, a thin `getViewer()` wrapper
  - server function `getProposerForEdit`, same input schema as before
  - `ProjectForm` prop `proposer?: ProposerForEdit`

**Why the `As` split.** The current `getProposerEmailForEditImpl` calls
`getViewer()` directly, so it reads request context and cannot be exercised from
an integration test at all. Every other query in this area has an
`*As(viewer, ...)` companion, and the README's architecture section names that
as the convention: those helpers "let integration tests exercise business logic
directly, without the HTTP layer". This function is the outlier; Task 2 brings
it into line, which is also what makes Step 1's tests possible.

Note `projects.integration.test.ts:380` already has a test referencing
`getProposerEmailForEdit` by name in a comment; update that comment.

- [ ] **Step 1: Write the failing test**

Append to `src/server/__tests__/projects.integration.test.ts`:

```ts
describe("getProposerForEditImpl", () => {
  it("reports a linked account with its current email and name", async () => {
    const staff = await makeUser("staff-pfe@x.edu", "admin");
    const owner = await makeUser("owner-pfe@x.edu", "user");
    const { id } = await createProjectAs(owner, baseProject());

    const result = await getProposerForEditAs(staff, { projectId: id });

    expect(result.accountLinked).toBe(true);
    expect(result.email).toBe("owner-pfe@x.edu");
    expect(result.accountName).toBe("owner-pfe@x.edu");
  });

  it("reports an external proposer as unlinked", async () => {
    const staff = await makeUser("staff-pfe2@x.edu", "admin");
    const { id } = await createProjectAs(staff, {
      ...baseProject(),
      proposerEmail: "outsider@example.com",
    });

    const result = await getProposerForEditAs(staff, { projectId: id });

    expect(result.accountLinked).toBe(false);
    expect(result.email).toBe("outsider@example.com");
    expect(result.accountName).toBeNull();
  });

  it("reports a project with no proposer at all as unlinked and blank", async () => {
    const staff = await makeUser("staff-pfe3@x.edu", "admin");
    const { id } = await createProjectAs(staff, baseProject());
    await db
      .update(projects)
      .set({ proposerId: null, proposerEmail: null })
      .where(eq(projects.id, id));

    const result = await getProposerForEditAs(staff, { projectId: id });

    expect(result.accountLinked).toBe(false);
    expect(result.email).toBe("");
  });

  it("refuses a non-staff viewer", async () => {
    const owner = await makeUser("owner-pfe4@x.edu", "user");
    const { id } = await createProjectAs(owner, baseProject());

    await expect(
      getProposerForEditAs(owner, { projectId: id })
    ).rejects.toThrow("Forbidden");
  });
});
```

Import `getProposerForEditAs` from `#/server/_internal/projects-queries` at the
top of the file, beside the existing `getProjectAs` import.

- [ ] **Step 2: Run the test to verify it fails**

Run: `ulimit -n 8192 && npm run test:integration -- projects`
Expected: FAIL, `getProposerForEditAs` is not exported.

- [ ] **Step 3: Widen the implementation and split out the `As` helper**

In `src/server/_internal/projects-queries.ts`, rename, change the return type,
and take the viewer as a parameter. The account-first precedence and its comment
stay exactly as they are. Match the `Viewer` type that `getProjectAs` in this
same file takes.

```ts
export interface ProposerForEdit {
  accountLinked: boolean;
  accountName: string | null;
  email: string;
}

export async function getProposerForEditAs(
  viewer: Viewer | null,
  data: { projectId: string }
): Promise<ProposerForEdit> {
  if (!isStaff(viewer)) {
    throw new Error("Forbidden");
  }
  const [project] = await db
    .select({
      proposerId: projects.proposerId,
      proposerEmail: projects.proposerEmail,
    })
    .from(projects)
    .where(eq(projects.id, data.projectId));
  if (!project) {
    return { accountLinked: false, accountName: null, email: "" };
  }
  // proposerId is canonical: when the project is linked to an account, prefill
  // that account's current email so an untouched staff save re-resolves to the
  // same proposer. Fall back to the stored email only when no account is linked.
  if (project.proposerId) {
    const [account] = await db
      .select({ email: user.email, name: user.name })
      .from(user)
      .where(eq(user.id, project.proposerId));
    if (account?.email) {
      return {
        accountLinked: true,
        accountName: account.name ?? null,
        email: account.email,
      };
    }
  }
  return {
    accountLinked: false,
    accountName: null,
    email: project.proposerEmail ?? "",
  };
}

/**
 * Request-context wrapper. Mirrors the *As / *Impl split the rest of this file
 * uses so integration tests can call the As form directly.
 */
export async function getProposerForEditImpl(data: {
  projectId: string;
}): Promise<ProposerForEdit> {
  return getProposerForEditAs(await getViewer(), data);
}
```

Delete the old `getProposerEmailForEditImpl`. Do not leave an alias.

- [ ] **Step 4: Rename the server function**

In `src/server/projects-queries.ts`:

```ts
export const getProposerForEdit = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) =>
    z.object({ projectId: z.string().uuid() }).parse(data)
  )
  .handler(async ({ data }) => {
    const { getProposerForEditImpl } = await import(
      "./_internal/projects-queries"
    );
    return getProposerForEditImpl(data);
  });
```

- [ ] **Step 5: Update the two routes**

In `src/routes/_authed/projects/$projectId/edit.tsx`, change the import to
`getProposerForEdit` and the loader:

```ts
    const proposer = data.viewerIsStaff
      ? await getProposerForEdit({ data: { projectId: params.projectId } })
      : { accountLinked: false, accountName: null, email: "" };
    return {
      ...data,
      categoryIds: categoryRows.map((c) => c.id),
      proposer,
    };
```

Update the destructure in `EditProject` from `proposerEmail` to `proposer`, and
pass `proposer={proposer}` to `ProjectForm` alongside the existing
`showProposer={viewerIsStaff}`. Wherever the old `proposerEmail` string fed the
form's default value, use `proposer.email`.

In `src/routes/_authed/projects/new.tsx`, a new project has no proposer, so pass
the unlinked default:

```tsx
          proposer={{ accountLinked: false, accountName: null, email: "" }}
          showProposer={isStaff}
```

- [ ] **Step 6: Thread it through the form**

In `src/components/project-form.tsx`, add to the props interface beside
`showProposer?: boolean`:

```ts
  proposer?: ProposerForEdit;
```

Import the type from `#/server/_internal/projects-queries` as a type-only
import, or redeclare it locally if importing server internals into a component
breaks the bundle; check which the codebase already does for shared types.

Destructure `proposer` beside `showProposer`, and pass both new values down:

```tsx
            {showProposer && (
              <form.Field name="proposerEmail">
                {(field: AnyForm) => (
                  <ProposerPicker
                    accountLinked={proposer?.accountLinked ?? false}
                    accountName={proposer?.accountName ?? null}
                    onChange={(email) => field.handleChange(email)}
                    value={field.state.value as string}
                  />
                )}
              </form.Field>
            )}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `ulimit -n 8192 && npm run test:integration -- projects`
Expected: PASS.

- [ ] **Step 8: Check and commit**

```bash
npm run check && npm run typecheck
git add src/server src/routes src/components/project-form.tsx
git commit -m "feat(projects): report whether a proposer address has an account"
```

At this point `ProposerPicker` receives two props it ignores. Task 3 uses them.

---

### Task 3: The locked field and the re-assign modal

**Files:**
- Modify: `src/components/proposer-picker.tsx`
- Test: `src/test/proposer-picker.test.tsx`

**Interfaces:**
- Consumes: `accountLinked` and `accountName` from Task 2.
- Produces: no new exports.

- [ ] **Step 1: Write the failing tests**

Append to `src/test/proposer-picker.test.tsx`. The existing tests render the
picker with only `value` and `onChange`; give those `accountLinked={false}` and
`accountName={null}` so they keep exercising the unlocked path.

**There is no `@testing-library/jest-dom` in this project.** Matchers like
`toHaveAttribute` and `toBeInTheDocument` do not exist here. Assert on DOM
properties directly, the way the existing tests in this file already do
(`const input = getByLabelText(...) as HTMLInputElement; expect(input.value)...`).
The a11y suite's `toHaveAttribute` calls are Playwright's, a different matcher
set entirely, and are not available in Vitest.

```ts
describe("ProposerPicker when an account is linked", () => {
  it("locks the field and offers Re-assign instead of Find account", () => {
    const { getByLabelText, getByText, queryByText } = render(
      <ProposerPicker
        accountLinked
        accountName="Alex Kim"
        onChange={vi.fn()}
        value="alex@oregonstate.edu"
      />
    );

    const input = getByLabelText("Proposer email") as HTMLInputElement;
    expect(input.readOnly).toBe(true);
    expect(getByText("Re-assign")).toBeTruthy();
    expect(queryByText("Find account")).toBeNull();
  });

  it("names the linked account so staff know who they would displace", () => {
    const { getByText } = render(
      <ProposerPicker
        accountLinked
        accountName="Alex Kim"
        onChange={vi.fn()}
        value="alex@oregonstate.edu"
      />
    );

    expect(getByText(/Alex Kim/)).toBeTruthy();
  });

  it("re-assigns to a selected account", async () => {
    mockedSearch.mockResolvedValue([
      { email: "jo@oregonstate.edu", id: "u2", name: "Jo Diaz" },
    ]);
    const onChange = vi.fn();
    const { getByText, getByPlaceholderText } = render(
      <ProposerPicker
        accountLinked
        accountName="Alex Kim"
        onChange={onChange}
        value="alex@oregonstate.edu"
      />
    );

    fireEvent.click(getByText("Re-assign"));
    fireEvent.change(getByPlaceholderText("Search accounts..."), {
      target: { value: "jo" },
    });
    await waitFor(() => getByText("Jo Diaz"));
    fireEvent.click(getByText("Jo Diaz"));

    expect(onChange).toHaveBeenCalledWith("jo@oregonstate.edu");
  });

  it("unlinks to an external proposer", () => {
    const onChange = vi.fn();
    const { getByText } = render(
      <ProposerPicker
        accountLinked
        accountName="Alex Kim"
        onChange={onChange}
        value="alex@oregonstate.edu"
      />
    );

    fireEvent.click(getByText("Re-assign"));
    fireEvent.click(getByText("Remove the link and set an external proposer"));

    expect(onChange).toHaveBeenCalledWith("");
  });

  it("leaves the field editable when no account is linked", () => {
    const { getByLabelText, getByText } = render(
      <ProposerPicker
        accountLinked={false}
        accountName={null}
        onChange={vi.fn()}
        value="outsider@example.com"
      />
    );

    const input = getByLabelText("Proposer email") as HTMLInputElement;
    expect(input.readOnly).toBe(false);
    expect(getByText("Find account")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- proposer-picker`
Expected: FAIL. There is no "Re-assign" button and the input is never readonly.

- [ ] **Step 3: Extract the account search so both modes share it**

The popover and the modal show the same search. Pull it into one local
component in the same file rather than duplicating the `Command` block:

```tsx
function AccountSearch({ onPick }: { onPick: (email: string) => void }) {
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<Match[]>([]);

  useEffect(() => {
    if (!query.trim()) {
      setMatches([]);
      return;
    }
    const handle = setTimeout(() => {
      void (async () => {
        try {
          const rows = (await searchUsers({ data: { q: query } })) as Match[];
          setMatches(rows);
        } catch {
          setMatches([]);
        }
      })();
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [query]);

  return (
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
            <CommandItem key={m.id} onSelect={() => onPick(m.email)} value={m.email}>
              <span className="font-medium">{m.name}</span>
              <span className="ml-2 text-muted-foreground text-xs">{m.email}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  );
}
```

The `query` and `matches` state and the debounce effect move out of
`ProposerPicker` into this component.

- [ ] **Step 4: Render the two modes**

`ProposerPicker` becomes:

```tsx
export function ProposerPicker({
  accountLinked,
  accountName,
  value,
  onChange,
}: {
  accountLinked: boolean;
  accountName: string | null;
  value: string;
  onChange: (email: string) => void;
}) {
  const [findOpen, setFindOpen] = useState(false);
  const [reassignOpen, setReassignOpen] = useState(false);

  return (
    <div className="space-y-1.5">
      <Label htmlFor="proposerEmail">Proposer email</Label>
      <div className="flex gap-2">
        <Input
          className={accountLinked ? "bg-muted text-muted-foreground" : undefined}
          id="proposerEmail"
          name="proposerEmail"
          onChange={(e) => onChange(e.target.value)}
          placeholder="proposer@oregonstate.edu"
          // Read-only rather than disabled: a disabled input is skipped by
          // keyboard navigation and announced poorly, and staff still need to
          // read and copy the address.
          readOnly={accountLinked}
          type="email"
          value={value}
        />
        {accountLinked ? (
          <Button
            className="h-9"
            onClick={() => setReassignOpen(true)}
            type="button"
            variant="outline"
          >
            Re-assign
          </Button>
        ) : (
          <Popover onOpenChange={setFindOpen} open={findOpen}>
            <PopoverTrigger asChild>
              <Button className="h-9" type="button" variant="outline">
                Find account
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 p-0">
              <AccountSearch
                onPick={(email) => {
                  onChange(email);
                  setFindOpen(false);
                }}
              />
            </PopoverContent>
          </Popover>
        )}
      </div>
      <p className="text-muted-foreground text-xs">
        {accountLinked
          ? `Linked to ${accountName ?? "an account"}. Re-assign to move this project to a different person.`
          : "Links to the proposer's account once they verify this email address. Leave blank for an external proposer."}
      </p>

      <Dialog onOpenChange={setReassignOpen} open={reassignOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Re-assign this project</DialogTitle>
            <DialogDescription>
              {`This project belongs to ${accountName ?? value}. Choosing someone else moves it to them: it leaves the current proposer's list and they stop receiving updates about it.`}
            </DialogDescription>
          </DialogHeader>
          <AccountSearch
            onPick={(email) => {
              onChange(email);
              setReassignOpen(false);
            }}
          />
          <DialogFooter className="sm:justify-between">
            <Button
              onClick={() => {
                onChange("");
                setReassignOpen(false);
              }}
              type="button"
              variant="ghost"
            >
              Remove the link and set an external proposer
            </Button>
            <Button
              onClick={() => setReassignOpen(false)}
              type="button"
              variant="ghost"
            >
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

Add the dialog imports:

```ts
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
```

Note the corrected help text. The old copy promised linking "when they first
sign in with this email", which was false before Task 1 and is still not quite
right after it: linking happens on verification, not on sign-in.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- proposer-picker`
Expected: PASS, including the pre-existing tests updated in Step 1.

- [ ] **Step 6: Verify in the browser**

```bash
npm run dev
```

As an admin, open the edit form for a project whose proposer has an account:

1. The field is greyed and cannot be typed into; the button reads "Re-assign".
2. The button and the field are the same height. Confirm in devtools that both
   compute to 36px.
3. "Re-assign" opens a modal naming the current proposer; picking someone
   replaces the address; "Remove the link" clears it and the field becomes
   editable after save and reload.
4. On a project with an external proposer, the field is editable and the button
   still reads "Find account".

- [ ] **Step 7: Check and commit**

```bash
npm run check && npm run typecheck
git add src/components/proposer-picker.tsx src/test/proposer-picker.test.tsx
git commit -m "feat(projects): gate the proposer field behind a re-assign modal"
```

---

### Task 4: Documentation

**Files:**
- Modify: `docs/QUIRKS.md`
- Modify: `README.md`

- [ ] **Step 1: Document the verification boundary in QUIRKS.md**

Add a section:

```markdown
### Projects are claimed only by a verified address

`projects.proposer_id` is set at write time by `resolveProposerId`, which only
matches accounts that already exist. A project proposed for someone who has not
signed up yet stays unlinked, and an unlinked proposer gets no "My projects"
entry, no status notifications, and no review emails.

`claimProjectsForVerifiedUser` closes that gap from two hooks in
`src/lib/auth.ts`: `afterEmailVerification` for the password path, and
`databaseHooks.user.create.after` for OAuth, guarded on `emailVerified`.

The guard is the point. Claiming on account creation alone would let anyone take
a colleague's projects by registering at their address. Anything that adds a
third claim path must be able to name the proof of ownership it relies on.

Note that one address with both a password account and GitHub ends up as a
single user row with two `account` rows: Better Auth links them implicitly, and
only when the local row is already verified. So no third hook is needed, and the
`proposer_id is null` guard makes the claim idempotent anyway.
```

- [ ] **Step 2: Update the README roadmap**

The README's "Known issues" section describes defects in built code. Neither of
the two entries there relates to this work, so leave them. In the architecture
conventions list, add one line after the project-workflow bullet:

```markdown
- A project's proposer is `proposer_id` when an account exists and
  `proposer_email` otherwise. Staff cannot retype a linked address directly; the
  edit form routes that through a re-assign modal. See
  [`docs/QUIRKS.md`](./docs/QUIRKS.md).
```

- [ ] **Step 3: Check and commit**

```bash
npm run check
git add docs/QUIRKS.md README.md
git commit -m "docs: record the proposer link gate and the verification boundary"
```

---

## Self-Review

**Spec coverage.** The gate and its two modes are Task 3; the signal reaching the
UI is Task 2; late linking with its verification guard is Task 1; the height fix
is Task 3 Step 4; the corrected help text is Task 3 Step 4; the spec's error
handling table is covered by Task 1 Step 4's swallow helper and Task 2's
not-found branch. The spec's open GitHub question is Task 1 Step 7.

**Deviation from the spec.** The spec described the modal as carrying "an
explicit confirmation naming both the current and the new proposer". The plan
names the current proposer in the dialog description and re-assigns on selection
without a second confirm step, because the modal is itself the confirmation and
a two-step flow inside a popover-like search reads badly. If a hard confirm is
wanted, it belongs as a follow-up rather than smuggled in here.

**Shared component, not duplicated.** Task 3 Step 3 extracts `AccountSearch`
because the popover and the modal render the same search. Writing it twice would
have been the obvious way and is the thing a reviewer should reject.

**Two corrections found while reviewing, both of which would have failed on
first run.** `getProposerEmailForEditImpl` calls `getViewer()` and so cannot be
called from an integration test; Task 2 splits out `getProposerForEditAs`, which
is the convention the README already documents and which this one function was
missing. And there is no `@testing-library/jest-dom` here, so `toHaveAttribute`
does not exist in Vitest; the component tests assert on DOM properties as the
existing tests in that file do. The `toHaveAttribute` calls elsewhere in
`src/test/a11y/` are Playwright's.

**Type consistency.** `ProposerForEdit`'s three fields are produced in Task 2 and
consumed unchanged in Tasks 2 and 3. `accountLinked` and `accountName` are the
same names in the route, the form, and the picker.
`claimProjectsForVerifiedUser(userId, email)` is produced in Task 1 and used only
there. `getProposerForEditAs` takes the same `Viewer | null` first parameter as
`getProjectAs` in the same file.

**Ordering.** Task 1 is independent and can land first. Task 3 depends on Task 2
for its props. Between Tasks 2 and 3 the picker receives two props it ignores,
which is noted at the end of Task 2 so a reviewer does not read it as a defect.
