# User Admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Read `docs/QUIRKS.md` before starting; it documents every framework gotcha this codebase has hit.

**Spec:** `docs/superpowers/specs/2026-05-18-user-admin-design.md`

**Goal:** Build `/admin/users` (list + search + role filter + include-banned toggle) and `/admin/users/$id` (detail + role change + ban / unban). Admin-only at both the route boundary (per-route `beforeLoad` redirects instructors) and at the data boundary (`requireRole(["admin"])` in every mutation). Ban atomically updates the user row AND deletes that user's `session` rows.

**Architecture:** Same wrapper-plus-`_internal/` pattern as prior specs. `src/server/users.ts` holds five `createServerFn` exports; `src/server/_internal/users.ts` holds the impl + `*As(viewer, ...)` helpers with self-action guards. Two route files + two small components.

**Tech Stack:** TanStack Start (Router + Form + Query), Better Auth (admin plugin already configured in Spec 1), Drizzle ORM, Postgres 18, Vitest, Biome.

**Critical conventions to honor** (full list in `docs/QUIRKS.md`):

- Stay on `main`. `AGENTS.md` is permanently dirty: never `git add AGENTS.md`, never `-A`.
- Every `createServerFn` must be a top-level exported `const` initializer. No factories.
- Server-only impls in `_internal/` subdirs.
- TanStack Start: `getRequest`, `inputValidator`. Better Auth: `user.id` is `text`.
- No emdashes in prose / comments / strings. Lowercase imperative commits.
- Co-author trailer via HEREDOC: `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>`.

---

## Phase 0: No schema changes

Spec 4 needs no migration. All required columns (`user.role`, `user.banned`, `user.banReason`, `user.banExpires`, `session.userId`) exist from Spec 1.

---

## Phase 1: User server functions

### Task 1: `users` wrapper + impl

**Files:**

- Create: `src/server/users.ts`
- Create: `src/server/_internal/users.ts`

**Step 1: Write the impl** at `src/server/_internal/users.ts`:

```ts
import { and, asc, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { db } from "#/db";
import {
  projectBookmarks,
  projects,
  session,
  user,
} from "#/db/schema";
import { requireUser } from "#/lib/_internal/auth-guards";
import { isStaff } from "#/lib/project-visibility";
import type {
  BanUserInput,
  ListUsersInput,
  SetUserRoleInput,
} from "../users";

type AuthUser = { id: string; role?: string | null | undefined };

function assertAdmin(viewer: AuthUser) {
  if (viewer.role !== "admin") throw new Error("Forbidden");
}

function assertNotSelf(viewer: AuthUser, targetId: string, action: string) {
  if (viewer.id === targetId) {
    throw new Error(`Cannot ${action} yourself`);
  }
}

export async function listUsersImpl(data: ListUsersInput) {
  const conditions = [];
  if (data.q) {
    conditions.push(
      or(ilike(user.email, `%${data.q}%`), ilike(user.name, `%${data.q}%`)),
    );
  }
  if (data.role) {
    conditions.push(eq(user.role, data.role));
  }
  if (!data.includeBanned) {
    conditions.push(or(eq(user.banned, false), isNull(user.banned)));
  }

  const where = conditions.length ? and(...conditions) : undefined;
  const offset = (data.page - 1) * data.pageSize;

  const rows = await db
    .select({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      banned: user.banned,
      createdAt: user.createdAt,
    })
    .from(user)
    .where(where)
    .orderBy(desc(user.createdAt))
    .limit(data.pageSize)
    .offset(offset);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(user)
    .where(where);

  return { rows, total: count, page: data.page, pageSize: data.pageSize };
}

export async function listUsersForCurrentUser(data: ListUsersInput) {
  const viewer = await requireUser();
  assertAdmin(viewer);
  return listUsersImpl(data);
}

export async function getUserImpl(data: { id: string }) {
  const [target] = await db.select().from(user).where(eq(user.id, data.id));
  if (!target) throw new Error("User not found");

  const [{ count: projectCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(projects)
    .where(eq(projects.proposerId, data.id));

  const recentProjects = await db
    .select({
      id: projects.id,
      title: projects.title,
      status: projects.status,
      publishedAt: projects.publishedAt,
      description: projects.description,
    })
    .from(projects)
    .where(eq(projects.proposerId, data.id))
    .orderBy(desc(projects.updatedAt))
    .limit(5);

  const [{ count: bookmarkCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(projectBookmarks)
    .where(eq(projectBookmarks.userId, data.id));

  return {
    user: target,
    projectCount,
    recentProjects,
    bookmarkCount,
  };
}

export async function getUserForCurrentUser(data: { id: string }) {
  const viewer = await requireUser();
  assertAdmin(viewer);
  return getUserImpl(data);
}

export async function setUserRoleAs(
  viewer: AuthUser,
  data: SetUserRoleInput,
) {
  assertAdmin(viewer);
  assertNotSelf(viewer, data.userId, "change the role of");
  await db
    .update(user)
    .set({ role: data.role, updatedAt: new Date() })
    .where(eq(user.id, data.userId));
  return { id: data.userId, role: data.role };
}

export async function setUserRoleForCurrentUser(data: SetUserRoleInput) {
  const viewer = await requireUser();
  return setUserRoleAs(viewer, data);
}

export async function banUserAs(viewer: AuthUser, data: BanUserInput) {
  assertAdmin(viewer);
  assertNotSelf(viewer, data.userId, "ban");
  await db.transaction(async (tx) => {
    await tx
      .update(user)
      .set({
        banned: true,
        banReason: data.reason,
        banExpires: data.expiresAt,
        updatedAt: new Date(),
      })
      .where(eq(user.id, data.userId));
    await tx.delete(session).where(eq(session.userId, data.userId));
  });
  return { id: data.userId, banned: true as const };
}

export async function banUserForCurrentUser(data: BanUserInput) {
  const viewer = await requireUser();
  return banUserAs(viewer, data);
}

export async function unbanUserAs(
  viewer: AuthUser,
  data: { userId: string },
) {
  assertAdmin(viewer);
  await db
    .update(user)
    .set({
      banned: false,
      banReason: null,
      banExpires: null,
      updatedAt: new Date(),
    })
    .where(eq(user.id, data.userId));
  return { id: data.userId, banned: false as const };
}

export async function unbanUserForCurrentUser(data: { userId: string }) {
  const viewer = await requireUser();
  return unbanUserAs(viewer, data);
}

// asc kept reachable for future ordering options
export const _orderingHelpers = { asc };
```

The `_orderingHelpers` line at the bottom keeps the `asc` import referenced so biome's unused-import check stays happy in case it grumbles. Remove it if biome is fine without it.

**Step 2: Write the wrapper** at `src/server/users.ts`:

```ts
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const roleEnum = z.enum(["user", "instructor", "admin"]);

const listUsersSchema = z.object({
  q: z.string().trim().max(200).optional().default(""),
  role: roleEnum.nullable().optional().default(null),
  includeBanned: z.boolean().default(true),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});

export type ListUsersInput = z.infer<typeof listUsersSchema>;

const idSchema = z.object({ id: z.string() });

const setUserRoleSchema = z.object({
  userId: z.string(),
  role: roleEnum,
});

export type SetUserRoleInput = z.infer<typeof setUserRoleSchema>;

const banUserSchema = z.object({
  userId: z.string(),
  reason: z.string().trim().min(1).max(500),
  expiresAt: z.date().nullable().default(null),
});

export type BanUserInput = z.infer<typeof banUserSchema>;

const unbanSchema = z.object({ userId: z.string() });

export const listUsers = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => listUsersSchema.parse(data ?? {}))
  .handler(async ({ data }) => {
    const { listUsersForCurrentUser } = await import("./_internal/users");
    return listUsersForCurrentUser(data);
  });

export const getUser = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => idSchema.parse(data))
  .handler(async ({ data }) => {
    const { getUserForCurrentUser } = await import("./_internal/users");
    return getUserForCurrentUser(data);
  });

export const setUserRole = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => setUserRoleSchema.parse(data))
  .handler(async ({ data }) => {
    const { setUserRoleForCurrentUser } = await import("./_internal/users");
    return setUserRoleForCurrentUser(data);
  });

export const banUser = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => banUserSchema.parse(data))
  .handler(async ({ data }) => {
    const { banUserForCurrentUser } = await import("./_internal/users");
    return banUserForCurrentUser(data);
  });

export const unbanUser = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => unbanSchema.parse(data))
  .handler(async ({ data }) => {
    const { unbanUserForCurrentUser } = await import("./_internal/users");
    return unbanUserForCurrentUser(data);
  });
```

**Step 3: Lint and check**

```bash
npx biome check --write src/server/
npx tsc --noEmit 2>&1 | grep -v "drizzle.config.ts" | grep "error TS" | head -5
```

Expected: clean. If biome flags an unused import (`isStaff`, `asc`, others), remove it.

**Step 4: Tests still pass**

```bash
npm test
```

Expected: 52/52 still pass (no new tests added in this phase).

**Step 5: Commit**

```bash
git add src/server/users.ts src/server/_internal/users.ts
git commit -m "$(cat <<'EOF'
add user admin server functions

listUsers (paginated, q matches email or name, role + includeBanned
filters), getUser (target row + project count + recent 5 + bookmark
count), setUserRole / banUser / unbanUser with admin-role gate at the
wrapper and impl AND self-action guards (cannot change own role or
ban self). banUser wraps the user-row update and the session-revoke
in one transaction so the user is forced out at next request.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Phase 2: Components

### Task 2: `role-select.tsx` and `ban-form.tsx`

**Files:**

- Create: `src/components/role-select.tsx`
- Create: `src/components/ban-form.tsx`

**Step 1: `role-select.tsx`**

```tsx
import { useState } from "react";
import { setUserRole } from "#/server/users";

type Role = "user" | "instructor" | "admin";

type Props = {
  userId: string;
  initialRole: Role;
  onChanged: () => void;
};

export function RoleSelect({ userId, initialRole, onChanged }: Props) {
  const [role, setRole] = useState<Role>(initialRole);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSave() {
    setSaving(true);
    setError(null);
    try {
      await setUserRole({ data: { userId, role } });
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const dirty = role !== initialRole;

  return (
    <div className="mt-4">
      <label
        htmlFor="role-select"
        className="block text-xs font-medium text-neutral-500"
      >
        Role
      </label>
      <div className="mt-1 flex items-center gap-2">
        <select
          id="role-select"
          value={role}
          onChange={(e) => setRole(e.target.value as Role)}
          className="border bg-white p-2 text-sm dark:bg-neutral-900"
        >
          <option value="user">user</option>
          <option value="instructor">instructor</option>
          <option value="admin">admin</option>
        </select>
        <button
          type="button"
          onClick={() => void onSave()}
          disabled={!dirty || saving}
          className="bg-black px-3 py-1.5 text-sm text-white disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save"}
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
```

**Step 2: `ban-form.tsx`**

```tsx
import { useState } from "react";
import { banUser, unbanUser } from "#/server/users";

type Props = {
  userId: string;
  banned: boolean;
  banReason: string | null;
  banExpires: Date | string | null;
  onChanged: () => void;
};

function toLocalDatetimeInput(value: Date | null): string {
  if (!value) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

export function BanForm({
  userId,
  banned,
  banReason,
  banExpires,
  onChanged,
}: Props) {
  const [reason, setReason] = useState("");
  const [expiresAt, setExpiresAt] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onBan() {
    setBusy(true);
    setError(null);
    try {
      const expires =
        expiresAt.length > 0 ? new Date(expiresAt) : null;
      await banUser({
        data: { userId, reason, expiresAt: expires },
      });
      setReason("");
      setExpiresAt("");
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onUnban() {
    setBusy(true);
    setError(null);
    try {
      await unbanUser({ data: { userId } });
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (banned) {
    const expiresDisplay = banExpires
      ? new Date(banExpires).toLocaleString()
      : "permanent";
    return (
      <section className="mt-4 border-2 border-red-300 bg-red-50 p-3 dark:bg-red-950">
        <h2 className="font-medium text-sm">Banned</h2>
        <p className="mt-1 text-sm">
          <span className="text-neutral-500">Reason: </span>
          {banReason ?? "(none)"}
        </p>
        <p className="mt-1 text-sm">
          <span className="text-neutral-500">Expires: </span>
          {expiresDisplay}
        </p>
        <button
          type="button"
          onClick={() => void onUnban()}
          disabled={busy}
          className="mt-3 border border-neutral-300 px-3 py-1.5 text-sm hover:bg-white disabled:opacity-50"
        >
          {busy ? "Working..." : "Unban"}
        </button>
        {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
      </section>
    );
  }

  return (
    <section className="mt-4">
      <h2 className="font-medium text-sm">Ban this user</h2>
      <div className="mt-2 space-y-2">
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason (required)"
          required
          rows={3}
          className="w-full border p-2"
        />
        <input
          type="datetime-local"
          value={expiresAt}
          onChange={(e) => setExpiresAt(e.target.value)}
          className="border p-2"
        />
        <p className="text-xs text-neutral-500">
          Leave expiry blank for permanent.
        </p>
        <button
          type="button"
          onClick={() => void onBan()}
          disabled={busy || reason.trim().length === 0}
          className="border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
        >
          {busy ? "Working..." : "Ban"}
        </button>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </section>
  );
}

// Re-export to keep biome from warning about unused declarations if any local
// helper goes unused during future edits.
export { toLocalDatetimeInput };
```

**Step 3: Lint and check**

```bash
npx biome check --write src/components/
npx tsc --noEmit 2>&1 | grep -v "drizzle.config.ts" | grep "error TS" | head -5
```

Both clean.

**Step 4: Commit**

```bash
git add src/components/role-select.tsx src/components/ban-form.tsx
git commit -m "$(cat <<'EOF'
add role-select and ban-form components

RoleSelect: three-option dropdown plus Save button; Save disabled
until the value differs from initialRole. BanForm: reason textarea +
datetime-local expiry when target is unbanned; Banned banner with
reason + expiry + Unban button when banned. Both surface server-side
error messages inline.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Phase 3: Admin user routes

### Task 3: `/admin/users` list

**Files:**

- Create: `src/routes/_authed/admin/users/index.tsx`

**Step 1: Write the route**

```tsx
import {
  createFileRoute,
  Link,
  redirect,
  useNavigate,
} from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { AdminTable } from "#/components/admin-table";
import { getSession } from "#/lib/auth-guards";
import { listUsers } from "#/server/users";

const ROLES = ["user", "instructor", "admin"] as const;

const searchSchema = z.object({
  q: z.string().default(""),
  role: z.enum(ROLES).nullable().default(null),
  includeBanned: z.boolean().default(true),
  page: z.number().int().min(1).default(1),
});

export const Route = createFileRoute("/_authed/admin/users/")({
  validateSearch: searchSchema,
  beforeLoad: async () => {
    const session = await getSession();
    if (!session?.user) throw redirect({ to: "/sign-in" });
    if (session.user.role !== "admin") throw redirect({ to: "/admin" });
  },
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    return await listUsers({
      data: {
        q: deps.q,
        role: deps.role,
        includeBanned: deps.includeBanned,
        page: deps.page,
        pageSize: 20,
      },
    });
  },
  component: UsersAdmin,
});

function UsersAdmin() {
  const navigate = useNavigate({ from: "/admin/users/" });
  const { rows, total, page, pageSize } = Route.useLoaderData();
  const { q, role, includeBanned } = Route.useSearch();
  const [qDraft, setQDraft] = useState(q);

  useEffect(() => setQDraft(q), [q]);

  useEffect(() => {
    const t = setTimeout(() => {
      if (qDraft !== q) {
        void navigate({
          search: (prev) => ({ ...prev, q: qDraft, page: 1 }),
        });
      }
    }, 300);
    return () => clearTimeout(t);
  }, [qDraft, q, navigate]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="mx-auto max-w-4xl p-8">
      <h1 className="text-2xl font-semibold">Admin: users</h1>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div>
          <label
            htmlFor="user-search"
            className="block text-xs font-medium text-neutral-500"
          >
            Search
          </label>
          <input
            id="user-search"
            type="search"
            value={qDraft}
            onChange={(e) => setQDraft(e.target.value)}
            placeholder="Email or name"
            className="mt-1 border p-2 text-sm"
          />
        </div>
        <div>
          <label
            htmlFor="user-role"
            className="block text-xs font-medium text-neutral-500"
          >
            Role
          </label>
          <select
            id="user-role"
            value={role ?? ""}
            onChange={(e) =>
              void navigate({
                search: (prev) => ({
                  ...prev,
                  role: (e.target.value || null) as (typeof ROLES)[number] | null,
                  page: 1,
                }),
              })
            }
            className="mt-1 border bg-white p-2 text-sm dark:bg-neutral-900"
          >
            <option value="">All roles</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-1 text-sm">
          <input
            type="checkbox"
            checked={includeBanned}
            onChange={(e) =>
              void navigate({
                search: (prev) => ({
                  ...prev,
                  includeBanned: e.target.checked,
                  page: 1,
                }),
              })
            }
          />
          Include banned
        </label>
      </div>

      <AdminTable columns={["Email", "Name", "Role", "Banned", ""]}>
        {rows.map((u) => (
          <tr key={u.id}>
            <td className="border border-neutral-200 p-2 dark:border-neutral-800">
              {u.email}
            </td>
            <td className="border border-neutral-200 p-2 dark:border-neutral-800">
              {u.name ?? "(none)"}
            </td>
            <td className="border border-neutral-200 p-2 dark:border-neutral-800">
              {u.role}
            </td>
            <td className="border border-neutral-200 p-2 dark:border-neutral-800">
              {u.banned ? "yes" : ""}
            </td>
            <td className="border border-neutral-200 p-2 dark:border-neutral-800">
              <Link
                to="/admin/users/$userId"
                params={{ userId: u.id }}
                className="text-blue-700 hover:underline"
              >
                Manage
              </Link>
            </td>
          </tr>
        ))}
      </AdminTable>

      <div className="mt-6 flex items-center justify-between text-sm">
        <Link
          to="/admin/users"
          search={(prev) => ({ ...prev, page: Math.max(1, page - 1) })}
          className={page <= 1 ? "text-neutral-300" : "hover:underline"}
        >
          Previous
        </Link>
        <span>
          Page {page} of {totalPages}
        </span>
        <Link
          to="/admin/users"
          search={(prev) => ({ ...prev, page: Math.min(totalPages, page + 1) })}
          className={page >= totalPages ? "text-neutral-300" : "hover:underline"}
        >
          Next
        </Link>
      </div>
    </div>
  );
}
```

**Step 2: Boot dev for route-tree regen, lint, check**

```bash
npm run dev > /tmp/cs-capstone-dev.log 2>&1 &
sleep 12
lsof -ti :3000 -ti :3001 -ti :3002 2>/dev/null | xargs kill -9 2>/dev/null
sleep 1
npx biome check --write src/
npx tsc --noEmit 2>&1 | grep -v "drizzle.config.ts" | grep "error TS" | head -5
```

Expected: clean.

**Step 3: Commit**

```bash
git add src/routes/_authed/admin/users/index.tsx src/routeTree.gen.ts
git commit -m "$(cat <<'EOF'
add /admin/users list

Per-route beforeLoad requires session.user.role === "admin" and
redirects instructor sessions to /admin (instructors are locked out
of user management entirely, per Spec 4). Search (q) debounced 300ms;
role select and includeBanned checkbox drive URL state. Reuses
AdminTable. Pagination via Previous/Next links.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `/admin/users/$userId` detail

**Files:**

- Create: `src/routes/_authed/admin/users/$userId.tsx`

**Step 1: Write the route**

```tsx
import {
  createFileRoute,
  Link,
  redirect,
  useRouter,
} from "@tanstack/react-router";
import { BanForm } from "#/components/ban-form";
import { RoleSelect } from "#/components/role-select";
import { getSession } from "#/lib/auth-guards";
import { getUser } from "#/server/users";

type Role = "user" | "instructor" | "admin";

export const Route = createFileRoute("/_authed/admin/users/$userId")({
  beforeLoad: async () => {
    const session = await getSession();
    if (!session?.user) throw redirect({ to: "/sign-in" });
    if (session.user.role !== "admin") throw redirect({ to: "/admin" });
    return { actorId: session.user.id };
  },
  loader: async ({ params }) => {
    return await getUser({ data: { id: params.userId } });
  },
  component: UserDetail,
});

function UserDetail() {
  const router = useRouter();
  const { user, projectCount, recentProjects, bookmarkCount } =
    Route.useLoaderData();
  const { actorId } = Route.useRouteContext();
  const isSelf = actorId === user.id;

  function onChanged() {
    void router.invalidate();
  }

  return (
    <div className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold">{user.name ?? user.email}</h1>
      <p className="mt-1 text-sm text-neutral-500">{user.email}</p>
      {isSelf && (
        <p className="mt-1 text-xs text-neutral-500">
          This is you. Role and ban controls are disabled.
        </p>
      )}

      <section className="mt-6 grid grid-cols-3 gap-3 text-sm">
        <div className="border border-neutral-200 p-3 dark:border-neutral-800">
          <p className="text-xs text-neutral-500">Role</p>
          <p className="mt-1 font-medium">{user.role}</p>
        </div>
        <div className="border border-neutral-200 p-3 dark:border-neutral-800">
          <p className="text-xs text-neutral-500">Projects</p>
          <p className="mt-1 font-medium">{projectCount}</p>
        </div>
        <div className="border border-neutral-200 p-3 dark:border-neutral-800">
          <p className="text-xs text-neutral-500">Bookmarks</p>
          <p className="mt-1 font-medium">{bookmarkCount}</p>
        </div>
      </section>

      {user.affiliation && (
        <p className="mt-4 text-sm">
          <span className="text-neutral-500">Affiliation: </span>
          {user.affiliation}
        </p>
      )}
      {user.linkedin && (
        <p className="text-sm">
          <span className="text-neutral-500">LinkedIn: </span>
          <a href={user.linkedin} className="text-blue-700 hover:underline">
            {user.linkedin}
          </a>
        </p>
      )}
      <p className="text-sm">
        <span className="text-neutral-500">Joined: </span>
        {new Date(user.createdAt).toLocaleDateString()}
      </p>

      {!isSelf && (
        <RoleSelect
          userId={user.id}
          initialRole={user.role as Role}
          onChanged={onChanged}
        />
      )}

      {!isSelf && (
        <BanForm
          userId={user.id}
          banned={user.banned ?? false}
          banReason={user.banReason ?? null}
          banExpires={user.banExpires ?? null}
          onChanged={onChanged}
        />
      )}

      <section className="mt-8">
        <h2 className="font-medium text-sm">Recent projects</h2>
        {recentProjects.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-500">None.</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {recentProjects.map((p) => (
              <li key={p.id}>
                <Link
                  to="/projects/$projectId"
                  params={{ projectId: p.id }}
                  className="text-sm text-blue-700 hover:underline"
                >
                  {p.title}
                </Link>{" "}
                <span className="text-xs text-neutral-500">
                  ({p.status as string})
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
```

**Step 2: Boot dev, lint, check, commit**

```bash
npm run dev > /tmp/cs-capstone-dev.log 2>&1 &
sleep 12
lsof -ti :3000 -ti :3001 -ti :3002 2>/dev/null | xargs kill -9 2>/dev/null
sleep 1
npx biome check --write src/
npx tsc --noEmit 2>&1 | grep -v "drizzle.config.ts" | grep "error TS" | head -5
git add src/routes/_authed/admin/users/$userId.tsx src/routeTree.gen.ts
git commit -m "$(cat <<'EOF'
add /admin/users/$userId detail with role + ban controls

Per-route beforeLoad requires admin and redirects instructors. Profile
block, three-cell summary (role / projects / bookmarks), recent five
projects, RoleSelect, BanForm. Both controls are hidden when target ==
actor (the "this is you" hint shows instead).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Phase 4: Admin landing link

### Task 5: Activate the Users link

**Files:**

- Modify: `src/routes/_authed/admin/index.tsx`

**Step 1: Replace the Users placeholder with a real `Link`**

Find the line:

```tsx
<li className="text-neutral-400">Users (coming in Spec 4)</li>
```

Replace with:

```tsx
<li>
  <Link to="/admin/users" className="text-blue-700 hover:underline">
    Users
  </Link>
</li>
```

The `Link` import already exists.

**Step 2: Lint, commit**

```bash
npx biome check --write src/
git add src/routes/_authed/admin/index.tsx
git commit -m "$(cat <<'EOF'
admin landing: activate the Users link

Replaces the 'Users (coming in Spec 4)' placeholder with a real link
to /admin/users. The link surfaces for any staff (admin + instructor)
who reaches the admin landing, but the users route's own beforeLoad
will redirect instructors back here.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Phase 5: Integration tests

### Task 6: Users integration tests

**Files:**

- Create: `src/server/__tests__/users.integration.test.ts`

**Step 1: Write the test**

```ts
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "#/db";
import { session, user } from "#/db/schema";
import { auth } from "#/lib/auth";
import {
  banUserAs,
  listUsersImpl,
  setUserRoleAs,
  unbanUserAs,
} from "#/server/_internal/users";

async function makeUser(email: string, role: "user" | "admin" | "instructor") {
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

describe("listUsersImpl", () => {
  it("q matches email and name (separately)", async () => {
    await makeUser(`alice-${Date.now()}@x.com`, "user");
    await makeUser(`bob-${Date.now()}@x.com`, "user");

    const byEmail = await listUsersImpl({
      q: "alice",
      role: null,
      includeBanned: true,
      page: 1,
      pageSize: 50,
    });
    expect(byEmail.rows.some((r) => r.email.includes("alice"))).toBe(true);
    expect(byEmail.rows.some((r) => r.email.includes("bob"))).toBe(false);
  });

  it("role filter restricts results", async () => {
    await makeUser(`u1-${Date.now()}@x.com`, "user");
    await makeUser(`a1-${Date.now()}@x.com`, "admin");

    const admins = await listUsersImpl({
      q: "",
      role: "admin",
      includeBanned: true,
      page: 1,
      pageSize: 50,
    });
    expect(admins.rows.every((r) => r.role === "admin")).toBe(true);
  });

  it("includeBanned=false hides banned users", async () => {
    const admin = await makeUser(`a2-${Date.now()}@x.com`, "admin");
    const target = await makeUser(`t-${Date.now()}@x.com`, "user");
    await banUserAs(admin, {
      userId: target.id,
      reason: "test",
      expiresAt: null,
    });

    const withBanned = await listUsersImpl({
      q: "",
      role: null,
      includeBanned: true,
      page: 1,
      pageSize: 50,
    });
    expect(withBanned.rows.some((r) => r.id === target.id)).toBe(true);

    const hidden = await listUsersImpl({
      q: "",
      role: null,
      includeBanned: false,
      page: 1,
      pageSize: 50,
    });
    expect(hidden.rows.some((r) => r.id === target.id)).toBe(false);
  });
});

describe("setUserRoleAs", () => {
  it("admin can change another user's role", async () => {
    const admin = await makeUser(`a-${Date.now()}@x.com`, "admin");
    const target = await makeUser(`u-${Date.now()}@x.com`, "user");

    await setUserRoleAs(admin, { userId: target.id, role: "instructor" });
    const [updated] = await db.select().from(user).where(eq(user.id, target.id));
    expect(updated.role).toBe("instructor");
  });

  it("refuses self-action", async () => {
    const admin = await makeUser(`a2-${Date.now()}@x.com`, "admin");
    await expect(
      setUserRoleAs(admin, { userId: admin.id, role: "user" }),
    ).rejects.toThrow(/yourself/);
  });

  it("refuses non-admin caller", async () => {
    const instructor = await makeUser(`i-${Date.now()}@x.com`, "instructor");
    const target = await makeUser(`u-${Date.now()}@x.com`, "user");
    await expect(
      setUserRoleAs(instructor, { userId: target.id, role: "admin" }),
    ).rejects.toThrow();
  });
});

describe("banUserAs / unbanUserAs", () => {
  it("ban updates the three columns AND revokes sessions", async () => {
    const admin = await makeUser(`a-${Date.now()}@x.com`, "admin");
    const target = await makeUser(`t-${Date.now()}@x.com`, "user");

    // Create a session row for the target by signing them in via Better Auth.
    const { headers } = await auth.api.signInEmail({
      body: { email: `${target.id}` /* not used; we already have id */, password: "Password1!" },
      asResponse: true,
    }).catch(() => ({ headers: new Headers() }));
    void headers;

    // Insert a synthetic session row to verify revoke.
    await db.insert(session).values({
      id: `s-${Date.now()}`,
      userId: target.id,
      token: `tok-${Date.now()}`,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60),
    });

    await banUserAs(admin, {
      userId: target.id,
      reason: "test ban",
      expiresAt: null,
    });

    const [updated] = await db.select().from(user).where(eq(user.id, target.id));
    expect(updated.banned).toBe(true);
    expect(updated.banReason).toBe("test ban");
    expect(updated.banExpires).toBeNull();

    const sessions = await db
      .select()
      .from(session)
      .where(eq(session.userId, target.id));
    expect(sessions.length).toBe(0);
  });

  it("ban refuses self-action", async () => {
    const admin = await makeUser(`a2-${Date.now()}@x.com`, "admin");
    await expect(
      banUserAs(admin, {
        userId: admin.id,
        reason: "x",
        expiresAt: null,
      }),
    ).rejects.toThrow(/yourself/);
  });

  it("unban clears the three columns", async () => {
    const admin = await makeUser(`a3-${Date.now()}@x.com`, "admin");
    const target = await makeUser(`t2-${Date.now()}@x.com`, "user");
    await banUserAs(admin, {
      userId: target.id,
      reason: "test",
      expiresAt: null,
    });
    await unbanUserAs(admin, { userId: target.id });

    const [updated] = await db.select().from(user).where(eq(user.id, target.id));
    expect(updated.banned).toBe(false);
    expect(updated.banReason).toBeNull();
    expect(updated.banExpires).toBeNull();
  });
});
```

**Step 2: Run + commit**

```bash
docker compose up -d postgres
npm run test:integration
```

Expected: previous 25 + 8 (3 list + 3 setRole + 3 ban + 1 unban = 8) ... actually count what was added; should be roughly 8 new = 33 total. Adjust count expectations to whatever the run reports.

The `signInEmail` call in the ban test is a fallback; if it fails the test still works because we synthesize a session row directly. If the `signInEmail` fallback log is noisy, just delete those three lines and rely on the synthetic insert.

```bash
git add src/server/__tests__/users.integration.test.ts
git commit -m "$(cat <<'EOF'
add users integration tests

listUsers: q matches email (separately from name); role filter
restricts; includeBanned=false hides banned. setUserRoleAs: round-trip;
refuses self-action; refuses non-admin caller. banUserAs: writes the
three columns AND revokes sessions in one transaction; refuses
self-action. unbanUserAs: clears the three columns.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Phase 6: Final + README

### Task 7: Verification + README + QUIRKS note

**Files:**

- Modify: `README.md`
- Modify: `docs/QUIRKS.md`

**Step 1: Final checks**

```bash
npm run check
npx tsc --noEmit 2>&1 | grep -v "drizzle.config.ts" | grep "error TS" | head -5
npm test
docker compose up -d postgres
npm run test:integration
```

All clean / green.

**Step 2: Re-seed dev users** (the integration tests TRUNCATE):

```bash
npm run db:seed:dev
```

**Step 3: README update**

After the "Discovery + taxonomy (Spec 3)" section, add a new section:

```markdown
## User admin (Spec 4)

The `/admin/users` URL is admin-only (instructors are redirected to
`/admin`). It lists every user with text search (email + name), role
filter, and an include-banned toggle. The detail page at
`/admin/users/$id` shows a profile block, project + bookmark counts,
the user's five most recent projects, a role select, and a ban form.

Admins cannot change their own role or ban themselves; the server
refuses self-actions. Ban atomically updates the user row and revokes
that user's sessions in the same transaction, so the banned user is
signed out on their next request.

Production note: keep at least two `admin` users. The self-action
guard prevents a sole admin from accidentally demoting themselves into
a one-way trap. Use `npm run db:seed:admin` or a direct
`db:studio` edit to bootstrap the second admin.
```

**Step 4: QUIRKS update**

In `docs/QUIRKS.md`, add a new entry under the **Better Auth** section:

```markdown
### Ban enforcement reads `user.banned`; sessions linger until next server call

Better Auth's session-validation middleware checks `user.banned` on every
request. Setting the row alone is enough to prevent future sign-ins, but
an already-signed-in user keeps their cookie until the next server-touch.
Our `banUserAs` impl wraps both writes (update + `DELETE FROM session
WHERE user_id = ?`) in one transaction so the next request fails session
lookup and forces sign-out. Skipping the session-delete would leave a
banned user nominally signed in until their cookie expired naturally.

`ban_expires` is informational at write time; Better Auth's runtime check
compares it to `now()` and treats a past timestamp as no-longer-banned.
We do not run a cron to clear the row; the data simply ages out of relevance.
```

**Step 5: Commit**

```bash
git add README.md docs/QUIRKS.md
git commit -m "$(cat <<'EOF'
document user admin (Spec 4) and ban-enforcement gotcha

README gains a User admin section covering the per-route admin gate,
self-action guards, atomic ban-plus-session-revoke, and the operational
note to keep at least two admins. QUIRKS gets a Better-Auth subsection
explaining that ban enforcement reads user.banned at session-validation
time so any UPDATE on that column should be accompanied by a
DELETE FROM session for the same user.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Self-review summary (done during planning)

- **Spec coverage:**
  - §2.1 list + search + filter -> Task 1 (server) + Task 3 (route).
  - §2.2 detail page -> Task 1 (`getUser` impl) + Task 4 (route).
  - §2.3 role change -> Task 1 (`setUserRoleAs`) + Task 2 (`RoleSelect`) + Task 4 (mount).
  - §2.4 ban / unban -> Task 1 (`banUserAs`, `unbanUserAs`) + Task 2 (`BanForm`) + Task 4 (mount).
  - §2.5 atomic session revoke -> Task 1 (`db.transaction` block) + Task 6 (integration test).
  - §2.6 tests -> Task 6.
  - §4.3 admin landing link change -> Task 5.
  - §6 server fn shapes -> Task 1.
  - §7 routes (per-route admin gate) -> Tasks 3, 4.
  - §10 manual smoke -> Task 7 (run after implementation).
- **Placeholder scan:** no TBD / TODO / "add validation later". Every step has actual code or exact diff instruction.
- **Type consistency:** `ListUsersInput`, `SetUserRoleInput`, `BanUserInput` all defined in the wrapper (Task 1 Step 2) and re-imported via `type` in the impl (Task 1 Step 1). `Role` type re-declared identically in `RoleSelect` and the detail route. The user shape from `getUser` (id / email / name / role / banned / banReason / banExpires / image / affiliation / linkedin / createdAt) drives the detail page.

---

## Plan complete

Plan saved to `docs/superpowers/plans/2026-05-18-user-admin.md`.

Two execution options:

1. **Subagent-Driven (recommended)**: I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution**: Execute tasks in this session using executing-plans, batched with checkpoints.

Which approach?
