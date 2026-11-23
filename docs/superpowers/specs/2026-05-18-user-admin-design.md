# Spec 4: User Admin

**Date:** 2026-05-18
**Status:** Draft (pending user review)
**Author:** Alexander Ulbrich (with Claude)
**Supersedes:** N/A
**Builds on:** [Spec 1: Auth Foundation](2026-05-15-auth-foundation-design.md), [Spec 2: Project Domain](2026-05-16-project-domain-design.md), [Spec 3: Discovery + Project Taxonomy](2026-05-17-discovery-and-taxonomy-design.md)
**Next spec:** Spec 5 (Media: S3 abstraction + image uploads).

## 1. Purpose

Build the admin user-management surface at `/admin/users` (list, search by email or name, filter by role) and `/admin/users/$id` (detail with their projects + bookmarks count, role change, ban / unban with optional expiry). Admin-only (per Better Auth's `adminRoles: ["admin"]` from Spec 1; instructor cannot use these). Server-side self-action guards prevent an admin from demoting or banning themselves.

## 2. Goals

1. **List + search + filter** at `/admin/users`. Paginated. Text search across email and name; role filter (`user` / `instructor` / `admin`); include-banned toggle.
2. **Per-user detail** at `/admin/users/$id`. Shows email, name, role, ban status, sign-up date, project count + 5 most recent projects, bookmark count.
3. **Role change** via a dropdown. Allowed values: `user`, `instructor`, `admin`. Self-action blocked server-side.
4. **Ban / unban** via a form. Ban requires a reason (max 500 chars), optional ISO-date expiry. Self-action blocked. Unban clears the three ban columns.
5. **Atomic session revoke on ban.** Setting `banned=true` and deleting that user's `session` rows happen in one transaction. Forces the user out at their next server call.
6. **Tests.** Integration coverage for list filters, setRole + ban + unban round-trips, self-action refusals, session-revoke side effect, and admin-only gate.
7. **No regressions.** Existing 52 unit + 25 integration tests still green.

## 3. Non-Goals (deferred)

- Impersonation (act-as). Useful for support but introduces a session-stack and a persistent "currently impersonating" banner; defer to a follow-up.
- Manual email-verified toggle. Edge case (broken verification link) that we have not hit; defer.
- Force-revoke-all-sessions as a standalone action. Ban already does this; standalone is rare.
- Hard delete. The FK `RESTRICT` rules from Spec 1 on content authorship would block it for any user with projects or comments. Ban is the destructive action of record.
- Admin action audit log. Project events have status_history and edit_log; a parallel admin-action log would be useful but isn't in scope here.
- Bulk operations (bulk ban, bulk role change). Not requested.

## 4. Architecture

### 4.1 Server modules

Same pattern as prior specs: client-safe wrapper + server-only `_internal/` impl.

| Path                            | Responsibility                                                                                                                                                                                                                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/server/users.ts`           | createServerFn wrappers (`listUsers`, `getUser`, `setUserRole`, `banUser`, `unbanUser`). Each does one dynamic import per handler and forwards to the impl. Schemas (Zod) live here for input validation.                                                                                   |
| `src/server/_internal/users.ts` | Impls. Direct Drizzle reads/writes against `user` and `session`. Exposes `*As(viewer, ...)` helpers for tests and `*ForCurrentUser(...)` for the wrappers. Self-action guards inline. The ban impl wraps writes in `db.transaction` so the session-revoke is atomic with the column update. |

The admin role gate is enforced two ways: a `requireRole(["admin"])` at the wrapper boundary AND an `assertAdmin(viewer)` at the top of every impl (defense in depth, matching the project's "guard at both layers" rule).

### 4.2 Client modules

| Path                                         | Responsibility                                                                                                                                                                                                    |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/routes/_authed/admin/users/index.tsx`   | List with paginated table. Search input (debounced 300ms; same pattern as `projects-filter-bar`), role filter dropdown, include-banned checkbox. URL-driven via `validateSearch`. Reuses `AdminTable`.            |
| `src/routes/_authed/admin/users/$userId.tsx` | Detail view. Profile block, ban status block (Banned banner when active, with reason + expiry), `<RoleSelect />`, `<BanForm />`. Loads projects + bookmarks counts.                                               |
| `src/components/role-select.tsx`             | Three-option `<select>` with onChange + a small Save button. Hidden when target is the viewer.                                                                                                                    |
| `src/components/ban-form.tsx`                | When `target.banned` is false: reason textarea + optional expiry datetime-local input + Ban button. When `target.banned` is true: shows current reason + expiry + Unban button. Hidden when target is the viewer. |

### 4.3 Existing files changed

- `src/routes/_authed/admin/index.tsx`: replace `"Users (coming in Spec 4)"` placeholder with a real `Link` to `/admin/users`.
- `docs/QUIRKS.md`: add a Better Auth note that ban enforcement happens via the session-validation middleware reading `user.banned`, but active cookies stay valid until the next server call. The atomic session-delete in our ban impl forces the next request to fail.

### 4.4 Why these boundaries

- **Direct DB writes (not Better Auth's `auth.api.banUser`)** matches the codebase's existing pattern from Specs 2-3: every mutation is a Drizzle call inside an `_internal/` impl. Using `auth.api.banUser` from inside our impl would need request-context propagation that we deliberately avoid. The semantic is identical: Better Auth's session check reads the same columns we write.
- **One server-fn module for the whole user-admin surface** because all five actions (list, get, setRole, ban, unban) share the same admin gate, target type, and visibility rules. Splitting them would just duplicate the gate.
- **`RoleSelect` and `BanForm` as separate components** so the detail page is short and either control can be reused in future bulk views.
- **Self-action guard in the impl, not just the UI**, because server functions can be called directly via the network panel; a UI-only hide is a security theater.

## 5. Data model

**No new columns. No migration.** All required columns exist from Spec 1's Better Auth admin plugin schema generation:

- `user.role` (text, default `'user'`, not null)
- `user.banned` (boolean, default false)
- `user.banReason` (text, nullable)
- `user.banExpires` (timestamptz, nullable)
- `session.userId` (text, FK to `user.id`, `ON DELETE CASCADE`)

To revoke sessions when banning, `DELETE FROM "session" WHERE user_id = $1` in the same transaction as the `UPDATE "user"`.

## 6. Server function shapes

### 6.1 `listUsers`

```ts
input: {
  q?: string;                                // searches email + name (ilike)
  role?: "user" | "instructor" | "admin" | null;
  includeBanned?: boolean;                   // default true
  page?: number;                             // default 1
  pageSize?: number;                         // default 20, max 100
}
output: {
  rows: Array<{
    id: string;
    email: string;
    name: string | null;
    role: string;
    banned: boolean | null;
    createdAt: Date;
  }>;
  total: number;
  page: number;
  pageSize: number;
}
guard: requireRole(["admin"])
```

SQL: `SELECT ... FROM "user" WHERE (email ILIKE %q% OR name ILIKE %q%) AND role = $role AND (banned = false OR includeBanned) ORDER BY created_at DESC LIMIT $pageSize OFFSET ...`.

### 6.2 `getUser`

```ts
input: { id: string }
output: {
  user: {
    id, email, name, role, banned, banReason, banExpires, image, affiliation, linkedin, createdAt, updatedAt
  };
  projectCount: number;
  recentProjects: ProjectSummary[];    // up to 5
  bookmarkCount: number;
}
guard: requireRole(["admin"])
```

### 6.3 `setUserRole`

```ts
input: { userId: string; role: "user" | "instructor" | "admin" }
output: { id: string; role: string }
guard: requireRole(["admin"]); throws "Cannot change your own role" if viewer.id === userId
```

### 6.4 `banUser`

```ts
input: {
  userId: string;
  reason: string;            // 1..500 chars, trimmed
  expiresAt: Date | null;    // optional; null means permanent
}
output: { id: string; banned: true }
guard: requireRole(["admin"]); throws "Cannot ban yourself" if viewer.id === userId

effect (one transaction):
  UPDATE "user" SET banned=true, ban_reason=$reason, ban_expires=$expiresAt
    WHERE id=$userId
  DELETE FROM "session" WHERE user_id=$userId
```

### 6.5 `unbanUser`

```ts
input: { userId: string }
output: { id: string; banned: false }
guard: requireRole(["admin"])

effect:
  UPDATE "user" SET banned=false, ban_reason=NULL, ban_expires=NULL
    WHERE id=$userId
```

(Self-action allowed here; unbanning yourself is a no-op since you wouldn't be signed in if you were banned. We don't guard it.)

## 7. Routes

| Path                   | Layout          | Component                         | Notes                                                      |
| ---------------------- | --------------- | --------------------------------- | ---------------------------------------------------------- |
| `/admin/users`         | `_authed/admin` | `_authed/admin/users/index.tsx`   | List with URL-driven search/filter/page.                   |
| `/admin/users/$userId` | `_authed/admin` | `_authed/admin/users/$userId.tsx` | Detail + role + ban controls. Notfound when id is missing. |

Both routes add their OWN `beforeLoad` that requires `role === "admin"` (the parent `_authed/admin.tsx` only requires admin OR instructor). Instructors visiting `/admin/users` are redirected to `/admin`. Each server fn additionally re-checks `requireRole(["admin"])` so mutations are admin-only at the data boundary too.

## 8. Testing

| Layer       | What we cover                                                                                                                                                  | Tooling                         |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| Integration | listUsersImpl: q matches by email AND name (separately and combined). role filter restricts. includeBanned=false hides banned. Pagination + total are correct. | Vitest against docker Postgres. |
| Integration | setUserRoleAs: round-trips through user.role. Refuses when target == actor. Refuses when actor role !== "admin" (e.g., instructor).                            | Same.                           |
| Integration | banUserAs: updates the three columns AND deletes the target's sessions. Refuses when target == actor. Refuses when actor is not admin.                         | Same.                           |
| Integration | unbanUserAs: clears the three columns. Allowed when target == actor (no-op in practice).                                                                       | Same.                           |
| Integration | getUserImpl: returns project count + recent 5 + bookmark count. Admin gate enforced.                                                                           | Same.                           |

No new browser tests. Manual smoke at Section 10.

## 9. Risk callouts

1. **Banned user with valid cookie.** Once we delete their `session` rows, the next server request (loader / server-fn call) fails session lookup and they are signed out. Until then, the cached client may still render; we accept this transient state.
2. **Sole admin self-demote / self-ban.** Self-action guards block both. If a single admin accidentally needs to step down, another admin (or direct DB intervention via `db:studio`) must do it. Recommended: keep at least two `admin` users in production. The dev seed already creates one `admin` plus an `instructor`; bootstrapping a second admin for prod is a deploy-time concern outside this spec.
3. **Ban expiry is enforced by Better Auth's session check, not by a cron.** A banned user with a past `banExpires` can sign in again because Better Auth's runtime treats them as no longer banned. The row stays `banned=true` with a historical timestamp. Acceptable: no background work required, the state is just informational once expiry passes.
4. **`listUsers` may surface user email + name to admins.** No PII redaction is needed for v1 (admins have full access by definition). If we ever introduce a "support-staff" role with lesser privileges, that would need redaction.
5. **Atomicity.** Ban's two writes share a single `db.transaction`. If the session delete fails for any reason, the user-table update rolls back, preventing a "banned but still signed-in" inconsistency.

## 10. Manual smoke checklist (post-implementation)

Run signed in as `admin@example.com`.

1. **List + filters.** Visit `/admin/users`. Three rows. Filter `role=user`: just `user@example.com`. Search `instr` in the search box: just the instructor. Toggle "Include banned" off, refresh: no change (none banned yet).
2. **Detail.** Open `instructor@example.com` row. See profile + role select + ban form. Project count = 0 unless you have seeded data; bookmark count = 0.
3. **Role change.** Change the instructor's role to `admin`. Save. Reload the list: role column reflects the change. Change back.
4. **Ban.** Open `user@example.com`. Ban with reason "test ban", no expiry. In another browser (or incognito) signed in as that user: refresh any page. They should be signed out / blocked.
5. **Banned state in UI.** Back in admin: refresh the detail page. The "Banned" banner appears with the reason. The form now shows an Unban button instead.
6. **Unban.** Click Unban. The other browser can sign in again.
7. **Self-action refusal.** Open YOUR OWN detail page (`/admin/users/<your-id>`). The RoleSelect and BanForm are hidden / disabled. Attempting to call the server function directly (devtools) throws.
8. **Non-admin gate.** Sign out, sign in as `instructor@example.com`. Try to visit `/admin/users`. The route's `beforeLoad` redirects to `/admin` (no user list visible). Direct server-fn calls (via devtools) also reject with `Forbidden` because `requireRole(["admin"])` denies instructor.

## 11. Open questions

None. User confirmed: instructors are locked out of `/admin/users` entirely via a per-route admin-only `beforeLoad` that redirects to `/admin`. Server functions remain `requireRole(["admin"])` for defense in depth.

## 12. Approval

Awaiting user review. Once approved, the next step is `superpowers:writing-plans` to produce the implementation plan.
