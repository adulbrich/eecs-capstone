# Spec 2: Project Domain

**Date:** 2026-05-16
**Status:** Draft (pending user review)
**Author:** Alexander Ulbrich (with Claude)
**Supersedes:** N/A
**Builds on:** [Spec 1: Auth Foundation](2026-05-15-auth-foundation-design.md)
**Next specs:** Spec 3 (Discovery + admin dashboards), Spec 4 (Media).

## 1. Purpose

Ship the project-domain layer end to end: project CRUD, a strict server-side state machine, status history rendered as a timeline, threaded review comments (admin to user reply, plus admin-only internal notes), an edit log, and notifications driven off status changes and comments with a header bell-icon UI. After this spec, a proposer can create a draft, submit it for review, receive change requests, resubmit, and see it published; an admin or instructor can review, request changes, approve, publish, archive, soft-delete, and leave both public and internal comments.

Spec 3 will add discovery (full-text search, filters, public browse refinements) and the admin dashboards for programs, categories, and users. Spec 4 will add S3-backed image uploads.

## 2. Goals

1. **CRUD with permissions.** Proposers create projects, edit their own (except when archived or soft-deleted), and hard-delete their own drafts. Staff (admin + instructor, treated identically for project actions in Spec 2) can do anything.
2. **Strict server-side state machine.** Every workflow transition is gated by a pure `canTransition(from, to, role)` function. Server functions refuse invalid transitions with a 4xx. The transition table is the single source of truth.
3. **Status history visible to the user.** Every status change writes a row to the existing `project_status_history` table inside the same transaction as the status update. The project detail renders these as a timeline.
4. **Comments.** Admin review comments (public to the proposer), proposer replies (only when status is `changes_requested`), admin-only internal comments. Single-level threading (replies live one level deep).
5. **Edit log.** Every server-side project update writes a row to a new `project_edit_log` table capturing changed fields, old values, new values, editor, and time. Renders on the admin detail view.
6. **Notifications.** Status changes and non-internal comments write rows to the existing `notifications` table. A bell icon in the site header shows unread count and a dropdown of the latest ten. Polls every 60s with focus-refetch.
7. **Forms via TanStack Form.** All non-trivial project forms use `@tanstack/react-form` with Zod validation. Trivial single-input forms (a comment box, status action buttons) stay as plain `<form>` to avoid inconsistent boilerplate.
8. **Tests.** Pure-function unit tests for the workflow and visibility modules. Integration tests against the docker-compose Postgres for the end-to-end happy paths and the comment + notification rules.

## 3. Non-Goals (deferred)

- Full-text search and the projects listing's filter UI (Spec 3).
- Category assignment on the project form, and the admin CRUD UIs for categories, programs, and users (Spec 3). Projects in Spec 2 do not surface categories in the form. The `project_categories` join stays in the schema.
- Project image upload and the S3 abstraction (Spec 4). The `image_url` column stays as a free-text URL field for v1.
- Inventory module (post-MVP).
- Bidding and assignment flows (post-MVP).
- Realtime notifications (SSE / WebSocket). Polling is sufficient.
- `project_collaborators` UI and permission grants. Table left untouched.
- Markdown rendering for descriptions and comments. Plain text with `whitespace-pre-wrap`.
- A "delete comment" UI. Cascading FK is in place for future use.

## 4. Architecture

### 4.1 Server modules

| Path                             | Responsibility                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/project-workflow.ts`    | Pure module. Exports the `Status`, `ActorRole`, `TRANSITIONS` table, and `canTransition(from, to, role)` plus `assertTransitionAllowed(...)`. No DB access. No I/O.                                                                                                                                                                                |
| `src/lib/project-visibility.ts`  | Pure module. Exports `canSeeProject(project, viewer)`, `canEditProject(project, viewer)`, `stripStaffOnlyFields(project, viewer)`, `filterCommentsForViewer(comments, viewer)`. No DB.                                                                                                                                                             |
| `src/server/projects.ts`         | One `createServerFn` per workflow mutation: `createProject`, `updateProject`, `submitProject`, `requestChanges`, `approveProject`, `publishProject`, `archiveProject`, `restoreArchived`, `softDeleteProject`, `restoreProject`, `hardDeleteProject`. Each wraps its writes in `db.transaction` and emits the history + notification rows it owns. |
| `src/server/projects-queries.ts` | Read-only `createServerFn` with `method: "GET"`: `listPublishedProjects(page, pageSize)`, `listMyProjects(filter)`, `listAdminProjects(filter)`, `getProject(id)`, `listProjectHistory(id)`, `listProjectEditLog(id)` (staff only). Applies visibility filtering before returning.                                                                 |
| `src/server/comments.ts`         | `addComment({ projectId, content, parentId?, isInternal? })`, `listComments(projectId)`. Enforces "internal requires staff", "replies require parent in same project", "non-staff cannot post comments on a project they cannot see".                                                                                                              |
| `src/server/notifications.ts`    | `listMyNotifications()`, `markRead(id)`, `markAllRead()`, `unreadCount()`.                                                                                                                                                                                                                                                                         |
| `src/server/_internal/notify.ts` | Internal helper (NOT a server function): `recordStatusChangeNotifications(tx, project, oldStatus, newStatus, actorId)` and `recordCommentNotifications(tx, project, comment)`. Called from inside the workflow and comment writes so notifications land in the same transaction.                                                                   |

### 4.2 Client modules

| Path                                              | Responsibility                                                                                                                                                                                                   |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/routes/projects/index.tsx`                   | Public list of published projects, paginated (offset, page size 20).                                                                                                                                             |
| `src/routes/projects/$projectId.tsx`              | Public detail. Renders title, description, problem statement, objectives, qualifications, contact info, license, image. Status timeline below. Non-internal comments below the timeline.                         |
| `src/routes/_authed/projects/new.tsx`             | Create form. On success, navigates to `/projects/$id`.                                                                                                                                                           |
| `src/routes/_authed/projects/$projectId/edit.tsx` | Edit form. Loader checks `canEditProject`; redirects on miss.                                                                                                                                                    |
| `src/routes/_authed/my/projects.tsx`              | My-projects list with status sub-filter.                                                                                                                                                                         |
| `src/routes/_authed/admin/projects/index.tsx`     | Admin list with status filter and "include soft-deleted" toggle. Detail links go to canonical `/projects/$id`.                                                                                                   |
| `src/components/project-form.tsx`                 | Shared TanStack Form component used by new + edit. Single Zod schema. Submit handler is a prop (different server function per page).                                                                             |
| `src/components/staff-project-panel.tsx`          | Staff-only sections rendered conditionally on the canonical detail page: internal notes, internal comments, edit log, transition action buttons keyed off `canTransition`. Returns `null` for non-staff viewers. |
| `src/components/project-card.tsx`                 | List item.                                                                                                                                                                                                       |
| `src/components/status-badge.tsx`                 | Color-coded status pill (one color per status).                                                                                                                                                                  |
| `src/components/status-timeline.tsx`              | Renders `project_status_history` rows as a vertical timeline with actor + comment.                                                                                                                               |
| `src/components/comment-thread.tsx`               | Renders top-level comments and one-deep replies. Internal comments visually distinct (yellow border, "internal" pill, staff-only). Inline reply form on each parent comment.                                     |
| `src/components/notification-bell.tsx`            | Header bell with unread count. Dropdown of latest 10. Click navigates and marks read.                                                                                                                            |
| `src/lib/apply-server-errors.ts`                  | Tiny client helper: maps a thrown `ZodError` from a server function back to TanStack Form's field-level errors.                                                                                                  |

### 4.3 Why these boundaries

- **Workflow as a pure module** (`project-workflow.ts`) means the state machine is one file, no DB coupling, trivially unit-testable.
- **Visibility as a pure module** (`project-visibility.ts`) is the single place we answer "can this viewer see this row, this field, this comment". Server queries and React components both consume it.
- **One server function per workflow action** (Option A from brainstorming) keeps each gate small and grep-able: searching for `publishProject` finds the one place projects are published.
- **`projects.ts` (writes) split from `projects-queries.ts` (reads)** prevents accidentally adding a read inside a mutation file and forgetting cache invalidation; also makes import lists shorter at the call site.
- **Notifications via an internal helper called inside the same transaction** keeps history, status, and notification writes atomic. Decoupled background queues are out of scope.
- **Shared `project-form.tsx`** stops drift between create and edit pages on field labels, validation, and Zod schema.
- **`apply-server-errors`** stops every form file from re-implementing the same Zod-to-field-error mapping.

## 5. Data model

### 5.1 New table

`project_edit_log`:

| Column           | Type                                                 | Notes                                                     |
| ---------------- | ---------------------------------------------------- | --------------------------------------------------------- |
| `id`             | uuid PK, defaultRandom                               |                                                           |
| `project_id`     | uuid not null, FK -> `projects.id` ON DELETE CASCADE |                                                           |
| `editor_id`      | text not null, FK -> `user.id` ON DELETE RESTRICT    |                                                           |
| `changed_fields` | `text[]` not null                                    | List of field names that actually changed in this update. |
| `old_values`     | `jsonb` not null                                     | Map of `{field: oldValue}`, only the fields that changed. |
| `new_values`     | `jsonb` not null                                     | Map of `{field: newValue}`, only the fields that changed. |
| `created_at`     | timestamptz not null defaultNow                      |                                                           |

Index: `project_edit_log_project_idx` on `(project_id, created_at desc)`.

Drizzle definition lives at the bottom of `src/db/schema.ts` (or in a new `src/db/project-edit-log.ts` re-exported from `schema.ts`; either is fine, plan can pick).

### 5.2 Schema fixes

These land alongside the new table in a single migration:

- **Self-FK on `project_comments.parent_id`.** Add `.references(() => projectComments.id, { onDelete: "cascade" })`. Deferred from Spec 1 (Section 5.4) so it lands now.
- **`projects.status` becomes `notNull()`.** Currently has a default but allows null. Safe migration because no row violates it.
- **Doc string on `projects.notes`.** TS-side JSDoc comment that says "staff-visible only; never returned in public queries". No DB change.

### 5.3 Indexes added

All in the same migration:

- `projects(status)`
- `projects(deleted_at)`
- `projects(proposer_id)`
- `projects(program_id)`
- `projects(published_at desc)` for the public list ordering
- `project_status_history(project_id, created_at desc)`
- `project_comments(project_id, created_at)`
- `notifications(user_id, read, created_at desc)`
- `project_edit_log(project_id, created_at desc)` (in the table def above)

### 5.4 What is intentionally not in this spec

- `tsvector` + GIN index on `projects` (Spec 3).
- `categories.type` -> `pgEnum` (Spec 3).
- Cleaning the `// internal only` and similar comments from `schema.ts` (Spec 3).
- A general-purpose `activity_log`. Status, comments, and edits each have their own table; we will revisit unified audit only if a real need appears.

## 6. State machine

### 6.1 Roles

`ActorRole` collapses to two values for workflow purposes:

- `owner`: the project's `proposer_id`.
- `staff`: any user with `role` in `("admin", "instructor")`.

A staff user acting on their own project is treated as `staff` for transition purposes (they have the wider rights). Other authenticated users without ownership or staff role cannot transition at all.

### 6.2 Transition table

In `src/lib/project-workflow.ts`:

```ts
type Status =
  | "draft"
  | "submitted"
  | "approved"
  | "changes_requested"
  | "published"
  | "archived";

type ActorRole = "owner" | "staff";

const TRANSITIONS: Record<Status, Partial<Record<ActorRole, Status[]>>> = {
  draft: { owner: ["submitted"], staff: ["submitted", "approved"] },
  submitted: {
    owner: ["draft"],
    staff: ["draft", "approved", "changes_requested"],
  },
  changes_requested: { owner: ["submitted"], staff: ["submitted", "approved"] },
  approved: { staff: ["published", "changes_requested"] },
  published: { staff: ["archived"] },
  archived: { staff: ["published"] },
};

export function canTransition(
  from: Status,
  to: Status,
  role: ActorRole
): boolean {
  return (TRANSITIONS[from][role] ?? []).includes(to);
}

export function assertTransitionAllowed(
  from: Status,
  to: Status,
  role: ActorRole
): void {
  if (!canTransition(from, to, role)) {
    throw new Error(`Transition ${from} -> ${to} not allowed for ${role}`);
  }
}
```

### 6.3 Independent flags (not transitions)

These are orthogonal to the status field and have their own gates.

| Action                   | Allowed when                               | Allowed actors | Effect                                       |
| ------------------------ | ------------------------------------------ | -------------- | -------------------------------------------- |
| Hard delete              | `status = 'draft' AND deleted_at IS NULL`  | owner or staff | `DELETE FROM projects WHERE id = ?`          |
| Soft delete              | `status != 'draft' AND deleted_at IS NULL` | staff          | Sets `deleted_at = now()`. Status unchanged. |
| Restore from soft delete | `deleted_at IS NOT NULL`                   | staff          | Sets `deleted_at = NULL`. Status unchanged.  |

A soft-deleted project is hidden from every query except `listAdminProjects(includeSoftDeleted=true)` and the staff detail view.

## 7. Visibility rules

`src/lib/project-visibility.ts`, pure.

| Viewer                            | Can see project                                    | Sees `notes` | Sees internal comments | Can edit                                         |
| --------------------------------- | -------------------------------------------------- | ------------ | ---------------------- | ------------------------------------------------ |
| Anonymous                         | `status = 'published' AND deleted_at IS NULL` only | No           | No                     | No                                               |
| Authenticated non-owner non-staff | Above; plus own bids/assignments (post-MVP)        | No           | No                     | No                                               |
| Owner                             | All statuses of own; soft-deleted hidden           | Own only     | No                     | Own only, except when `archived` or soft-deleted |
| Staff                             | Everything including soft-deleted, all statuses    | Yes          | Yes                    | Yes                                              |

Rules of thumb:

- `getProject` always loads the row, then applies `stripStaffOnlyFields(project, viewer)` before returning. We never send `notes` or internal comments to a client and rely on the client not to render them.
- `listPublishedProjects` is one SQL query: `WHERE status = 'published' AND deleted_at IS NULL`. Public traffic never touches drafts.
- `listMyProjects` filters by `proposer_id = viewer.id`. Excludes soft-deleted by default.
- `listAdminProjects` defaults to excluding soft-deleted and has an `includeSoftDeleted: boolean` param.

## 8. Comments

### 8.1 Model and rules

- Top-level comments belong to a project.
- Replies have `parent_id` pointing at another comment on the same project. Replies are one level deep; the UI does not allow replying to a reply, and the server rejects such writes.
- `is_internal = true` means the comment is staff-only.
- Posting rules enforced server-side:
  - To post on a project, the viewer must be authenticated and satisfy `canSeeProject`.
  - To post `is_internal: true`, the viewer must be staff.
  - To post a reply, the parent must exist, belong to the same project, and not itself be a reply.
  - No status-based gate on posting. Owners may comment on their own projects in any status (including draft, to leave themselves notes, and during active review). Staff may comment any time. The README's "users can reply when changes_requested" is preserved at the level of "what's typically useful" rather than as a hard gate; the workflow does not depend on comment timing.
  - Empty / whitespace-only content is rejected.

### 8.2 Visibility

| Viewer    | Sees non-internal                | Sees internal |
| --------- | -------------------------------- | ------------- |
| Anonymous | Yes (on published projects only) | No            |
| Owner     | Yes                              | No            |
| Staff     | Yes                              | Yes           |

`listComments` returns the filtered list. Internal comments are stripped server-side, not hidden client-side.

### 8.3 Threading depth

One. Strictly enforced server-side. The UI does not render a "reply" button under replies.

## 9. Notifications

### 9.1 Triggers

All happen inside the same DB transaction as the originating write.

| Event                               | Recipient(s)                                                                                                                                   | Title                                          | Link                                                  |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------- |
| Status change                       | Project proposer, unless they are the actor.                                                                                                   | `Your project '{title}' is now {status}`       | `/projects/{id}`                                      |
| Non-internal comment                | Project proposer (if not the comment author). For replies: also the parent comment author (if different from both the proposer and the actor). | `New comment on '{title}'`                     | `/projects/{id}#comment-{id}`                         |
| Internal comment                    | No notification. Intentional, to keep noise down.                                                                                              |                                                |                                                       |
| Soft delete / restore / hard delete | Project proposer (if not the actor).                                                                                                           | `Your project '{title}' was {action} by staff` | `/projects/{id}` (404 if hard-deleted, which is fine) |

### 9.2 UI

- `notification-bell.tsx` mounts in the site header for authenticated users.
- Shows unread count as a small red badge. Displays `9+` if `unreadCount >= 10`.
- Click opens a dropdown of the latest ten (regardless of read state).
- Clicking a notification calls `markRead(id)`, then navigates to its `link`.
- "Mark all read" button at the bottom calls `markAllRead()`.

### 9.3 Polling

TanStack Query with `refetchOnWindowFocus: true` and `refetchInterval: 60_000`. Acceptable at capstone scale. Realtime stays out of scope until a need shows up.

## 10. Forms

### 10.1 TanStack Form

Used for any form with more than 2 fields or any form with field-level validation:

- `project-form.tsx` (the create + edit form).
- Comment reply form when validation grows beyond "non-empty" (Spec 2 keeps it simple, so this stays plain).

Used with the Zod adapter so the project schema is the single source of truth (server validator and client form share it).

### 10.2 Plain `<form>` fallback

Used for trivial forms:

- New top-level comment input.
- "Reply" inline input.
- Status action buttons.
- Notification bell controls.

This keeps the codebase from acquiring TanStack Form boilerplate around one-line interactions.

### 10.3 Server-error mapping

`src/lib/apply-server-errors.ts`:

```ts
import type { FormApi } from "@tanstack/react-form";
import { ZodError } from "zod";

export function applyServerErrors(
  form: FormApi<unknown, unknown>,
  err: unknown
) {
  if (err instanceof ZodError) {
    for (const issue of err.issues) {
      const field = issue.path.join(".");
      form.setFieldMeta(field as never, (prev) => ({
        ...prev,
        errors: [...(prev?.errors ?? []), issue.message],
      }));
    }
    return true;
  }
  return false;
}
```

Submit handler calls `applyServerErrors(form, err)` and falls back to a generic error banner if it returns false.

## 11. Routes

| Path                        | Layout          | Component                              | Notes                                                                                                                                                                                                  |
| --------------------------- | --------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/projects`                 | Public          | `projects/index.tsx`                   | Paginated published list.                                                                                                                                                                              |
| `/projects/$projectId`      | Public          | `projects/$projectId.tsx`              | Canonical project detail. Staff sections (notes, internal comments, edit log, transition action buttons) render conditionally when the viewer is staff. One URL per project regardless of viewer role. |
| `/projects/new`             | `_authed`       | `_authed/projects/new.tsx`             | Create form.                                                                                                                                                                                           |
| `/projects/$projectId/edit` | `_authed`       | `_authed/projects/$projectId/edit.tsx` | Edit form. Loader rejects if not `canEditProject`. Staff see additional fields (`notes`).                                                                                                              |
| `/my/projects`              | `_authed`       | `_authed/my/projects.tsx`              | Own projects list with status sub-filter.                                                                                                                                                              |
| `/admin/projects`           | `_authed/admin` | `_authed/admin/projects/index.tsx`     | Admin list view of all projects: status filter, include-soft-deleted toggle, links to canonical `/projects/$id`.                                                                                       |

Notes on the routing model:

- Single canonical URL per project (`/projects/$id`). Avoids two diverging templates and lets staff share project URLs with non-staff users; each viewer just sees the slice they are allowed to see.
- `/admin/projects` exists only as a _list_ URL because the admin list is a fundamentally different query (all statuses, soft-deleted, filters). Detail navigation from the admin list links back to `/projects/$id`.
- The existing `_authed/admin/index.tsx` stub from Spec 1 stays as the admin landing page and gets a small links list pointing at `/admin/projects` (and at the future Spec 3 admin pages).
- `/projects/new` and `/projects/$projectId/edit` live under the `_authed` layout so they inherit the session guard.

## 12. Testing

| Layer       | What we cover                                                                                                                                                                                                                            | Tooling                                                         |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Unit (pure) | `project-workflow.ts`: every cell of the transition table, owner attempts to staff-only transitions, staff attempts on archived/published, the two `assert*` throw shape.                                                                | Vitest, no mocks.                                               |
| Unit (pure) | `project-visibility.ts`: visibility matrix per viewer kind; `stripStaffOnlyFields` actually strips; `filterCommentsForViewer` actually filters internal.                                                                                 | Vitest, no mocks.                                               |
| Integration | Full workflow happy path: create -> submit -> request changes -> resubmit -> approve -> publish -> archive. After each step, query history, query notifications for the proposer, assert expected counts and titles.                     | Vitest against docker-compose Postgres, same harness as Spec 1. |
| Integration | Negative workflow paths: owner cannot publish; owner cannot delete a submitted project; staff cannot transition from draft to published in one step; soft-deleted projects do not appear in `listPublishedProjects` or `listMyProjects`. | Same harness.                                                   |
| Integration | Comments: staff posts review comment; owner replies (status=changes_requested); owner cannot post when status=draft; staff posts internal; owner's `listComments` excludes the internal one.                                             | Same harness.                                                   |
| Integration | Notifications: status change writes a row for the proposer; proposer commenting on own project does NOT write a self-notification; staff internal comment writes NO notification.                                                        | Same harness.                                                   |
| Integration | Edit log: updating a single field writes one log row with that field's old + new value only; updating nothing writes no row.                                                                                                             | Same harness.                                                   |

**No browser/E2E tests in Spec 2.** The spec ships a manual smoke checklist (Section 14) instead.

## 13. Risk callouts

1. **Edit-log payload size.** `old_values` / `new_values` capture only the fields that actually changed. The diff happens server-side before insert. Skipping the diff would let long `objectives` edits balloon the table; with the diff, the log is proportional to actual change volume.
2. **Transaction scope.** Status change + history insert + notification insert MUST happen in one Drizzle transaction. Each workflow function explicitly wraps its writes with `db.transaction(async (tx) => ...)` and passes `tx` to the internal `notify` helpers. Forgetting this would produce phantom history rows or missing notifications under concurrent load.
3. **`project_comments.parent_id` cascade.** Deleting a parent comment cascades to its replies. No UI exposes this in Spec 2, but staff could do it via Drizzle Studio and lose reply context. Acceptable for v1; revisit if comment deletion ever becomes a feature.
4. **Notification polling cost.** 60s polling per signed-in user uses the `notifications(user_id, read, created_at desc)` index. Fine at capstone scale; revisit if traffic grows in Spec 3 work.
5. **TanStack Form + Zod + server-function integration.** Server throws `ZodError` on validator failure; client catches with `applyServerErrors`. If TanStack Form's `setFieldMeta` API changes between versions, the helper is the one place to update. Path-array-to-dotted-string mapping assumes flat field names; nested object fields in the project schema would need additional work (current fields are all flat so this is fine).
6. **`getWebRequest` was actually `getRequest`, `validator` was actually `inputValidator`** (Spec 1 risk realized): all Spec 2 server functions will use the verified names. Plan references will match.

## 14. Manual smoke checklist (post-implementation)

Run with at least two browser sessions (one staff, one non-staff user).

1. **Create + edit (proposer).** Sign in as a non-staff user. `/projects/new`, fill all fields, submit. Land on `/projects/$id`, status `draft`. Edit one field, save. In a second browser signed in as staff, open the same `/projects/$id` URL and confirm the edit log row appears in the staff-only panel.
2. **Submit + review.** Proposer submits. Staff browser sees the project in `/admin/projects`, clicks through to `/projects/$id`, leaves a public review comment, and clicks "Request changes". Proposer's bell icon shows an unread notification. Proposer reads it, sees status `changes_requested` and the comment. Proposer replies. Staff sees the reply.
3. **Approve + publish.** Staff approves, then publishes. Proposer notification fires. Public unauthenticated visitor sees the project at `/projects` and `/projects/$id` (and does NOT see the staff panel).
4. **Internal comment.** Staff adds an internal comment from the staff panel on `/projects/$id`. Proposer reloads the same URL and does NOT see it. A second staff session does.
5. **Archive + restore.** Staff archives. Public list no longer shows it. Staff restores. Public list shows again.
6. **Soft delete.** Staff soft-deletes a published project. Public list does not show it. Admin list with "include soft-deleted" shows it. Staff restores; public list shows it again.
7. **Hard delete.** Proposer creates a draft, then hard-deletes it from their my-projects view. Row is gone. The admin view does not show it (including with soft-deleted toggle on).
8. **Invalid transition.** Staff tries (via the URL or devtools) to call `publishProject` on a project in `draft`. Server rejects with 4xx; UI shows error.
9. **Notification bell.** Bell shows correct unread count. "Mark all read" zeroes it. Refreshing the page does not bring the count back.

## 15. Open Questions

None at design time. User confirmed: instructor and admin behave identically for project actions in Spec 2; collaborators table left untouched; edit-log table dedicated (not generic activity log); comments + history UI + notifications all in scope.

## 16. Approval

Awaiting user review. Once approved, the next step is `superpowers:writing-plans` to produce the implementation plan.
