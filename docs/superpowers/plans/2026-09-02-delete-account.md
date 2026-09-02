# Delete Account Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a signed-in user close their own account from `/profile`, anonymizing the
`user` row in place and deleting only what a real DELETE would cascade.

**Architecture:** A `deleted_at` column on `user`. Two server functions in
`src/server/account.ts` with `*As(viewer, ...)` seams in `_internal/account.ts`: a preview
read that returns blockers and programs, and the delete, which re-checks blockers, scrubs
the row, deletes every cascade-edge row and nulls `proposer_email` and matching
`mentor_email` in one transaction, then best-effort deletes the avatar object. A
`DeleteAccountDialog` on `AlertDialog` with a typed-email gate, in a Danger zone on the
profile page.

**Tech Stack:** TanStack Start server functions, Drizzle ORM on PostgreSQL, Better Auth
(`additionalFields`), Zod, React with shadcn/ui `AlertDialog`, Vitest unit and integration.

**Spec:** `docs/superpowers/specs/2026-09-02-delete-account-design.md`; issue #84 is the
originating spec, the design doc records the cascade-edge rule and what changed since it
was written.

## Global Constraints

- Prose contains no emdashes and no emojis, anywhere.
- Conventional Commits, lowercase imperative subject, area in parens, short body,
  `Co-Authored-By` kept, no session link.
- Stage files by name. Branch `feat/delete-account`, never `main`.
- `*As(viewer, ...)` first, wrapper second, same file; every `createServerFn` declared in
  `access-contract.ts`; impl imports input types from `../account`.
- `auth-schema.ts` is hand-maintained: add the column there and in `auth.ts`, then
  `drizzle-kit generate`, and review the SQL.
- Vitest with sandbox off and `ulimit -n 8192`; the integration suite shares the docker
  database with any other session's run, so a run with foreign truncations is not a
  result.
- A failed avatar delete must not abort the deletion.

---

### Task 1: `deleted_at`

**Files:** `src/db/auth-schema.ts` (after `mentorTeamCount`), `src/lib/auth.ts`
(`user.additionalFields`), generated `drizzle/0018_user_deleted_at.sql` and meta.

- [ ] Add `deletedAt: timestamp("deleted_at", { withTimezone: true })` to `user`, and
  `deletedAt: { type: "date", required: false, input: false }` to `additionalFields`.
- [ ] `npx drizzle-kit generate --name user_deleted_at`; expect one `ADD COLUMN
  "deleted_at" timestamp with time zone`. `npm run db:migrate`, `npm run typecheck`.
- [ ] Commit `feat(auth): add user.deleted_at`.

### Task 2: the preview seam

**Files:** create `src/server/_internal/account.ts`, `src/server/account.ts`,
`src/server/__tests__/account.integration.test.ts`; modify `access-contract.ts`.

**Produces:**

```ts
export interface AccountViewer { email: string; id: string; image?: string | null; role?: string | null }
export interface DeletionPreview {
  blockers: { items: { id: string; name: string }[]; lastAdmin: boolean };
  email: string;
  programs: { courseId: string; courseName: string; id: string }[];
}
export async function getAccountDeletionPreviewAs(viewer: AccountViewer): Promise<DeletionPreview>
export async function getAccountDeletionPreviewForCurrentUser(): Promise<DeletionPreview>
```

Held items: `inventory_items` in `reserved` or `checked_out` where `current_holder_id`
is the viewer or `lower(current_holder_email)` is the viewer's address, plus items on the
viewer's `approved` request lines. `lastAdmin`: viewer role is `admin` and
`count(*) where role = 'admin'` is 1. Programs: join `program_instructors` to `programs`.

- [ ] Tests first: held item blocks; approved line blocks; a returned line does not; last
  admin blocks; a second admin unblocks; instructor rows list their programs.
- [ ] Implement; server function `getAccountDeletionPreview` (GET, `authenticated`).
- [ ] Commit `feat(account): preview what deleting an account will do`.

### Task 3: the delete seam

**Files:** same three plus `access-contract.ts`.

**Produces:**

```ts
export async function deleteAccountAs(viewer: AccountViewer, data: { confirmEmail: string }): Promise<{ ok: true }>
export async function deleteAccountForCurrentUser(data: { confirmEmail: string }): Promise<{ ok: true }>
```

Order: `confirmEmail` must equal `viewer.email` case-insensitively or throw `Email does
not match`; re-run the preview and throw `Account has outstanding items` or `The last
admin cannot delete their account`; load the row for `image`; transaction: update `user`
per the spec table, delete from `session`, `account`, `user_interests`,
`program_instructors`, `project_collaborators`, `project_bookmarks`,
`inventory_cart_items`, `notifications`, `ai_review_usage` by user id, update `projects`
set `proposer_email = null` where `proposer_id = id`, update `projects` set `mentor_email
= null` where `lower(mentor_email) = lower(email)`; after commit
`deleteOwnedObject(previousImage, avatarKeys(id))`.

- [ ] Tests first, per the spec's list, including the cascade-edge pin: read
  `src/db/schema.ts` and `auth-schema.ts` off disk, collect every table whose FK into
  `user.id` says `onDelete: "cascade"`, and assert the list equals the one the impl
  exports as `CASCADE_TABLES`.
- [ ] A separate `account-storage.integration.test.ts` that `vi.mock`s
  `#/lib/_internal/storage` so `getObjectStorage().delete` throws, and asserts the row is
  still scrubbed.
- [ ] Implement; server function `deleteAccount` (POST, `authenticated`, Zod
  `{ confirmEmail: z.string().max(320) }`).
- [ ] Commit `feat(account): let a user delete their own account`.

### Task 4: the dialog

**Files:** create `src/components/delete-account-dialog.tsx`,
`src/test/delete-account-dialog.test.tsx`; modify `src/routes/_authed/profile.tsx`.

Props: `{ email: string; preview: DeletionPreview | null; onDeleted: () => void }`.
Trigger: `Button variant="destructive"` "Delete account". Content: the six statements,
the program list when non-empty, the block message with a `/my/items` link when
`blockers.items` is non-empty or `lastAdmin`. Input `aria-label="Confirm email"`; the
destructive action is disabled until the typed value equals `email` case-insensitively,
and always when blocked. On confirm: `deleteAccount({ data: { confirmEmail } })`, then
`onDeleted()`; the profile page sets `window.location.href = "/"`.

- [ ] Tests first: gate disabled until the email matches; programs listed; blocked state
  shows the item names and no gate; confirm calls the server function.
- [ ] Implement; profile page loads the preview in an effect and renders a "Danger zone"
  section below the privacy link.
- [ ] Commit `feat(profile): add the delete account dialog`.

### Task 5: docs, verification, PR

- [ ] PRD line under Authentication & Accounts; QUIRKS entry under Better Auth ("Deleting
  an account anonymizes the row; the cascade rule") cross-referencing the privacy entry;
  README "Better Auth schema" needs nothing new.
- [ ] `npm run check`, `npm run typecheck`, `npm test`, `npm run test:integration` with no
  other session running, `npm run test:smoke` if the profile flow is in it (check the
  job comment in `ci.yml`).
- [ ] Push, PR closing #84, review loop with `mattpocock-skills:code-review` until a pass
  raises nothing new.
