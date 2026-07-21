# EECS Capstone App: Product Requirements

This document is the canonical, exhaustive list of product features for the
Oregon State University EECS Capstone application. It captures both what has been
built and what is still planned. The original feature draft lived in the
README; it has been expanded here against the actual implementation.

**Status legend**

- ✅ Implemented
- 🟡 Partial (some of the feature exists; gaps noted)
- ⬜ Planned (not yet built)

For developer setup, architecture notes, and the active roadmap, see
[`README.md`](./README.md). For implementation quirks and gotchas, see
[`docs/QUIRKS.md`](./docs/QUIRKS.md).

---

## 1. Users, Roles & Permissions

- ✅ Three role tiers: `user`, `instructor`, `admin`.
  - `user`: default role on sign-up. Browses and bookmarks projects, submits
    proposals, browses and requests inventory.
  - `instructor`: staff privileges over the project and inventory domains
    (review projects, manage programs, manage inventory) but not user or
    category administration that is reserved for admins.
  - `admin`: full access, including user administration and category
    management.
- ✅ "Staff" is the union of `instructor` and `admin`; staff-only UI and data
  (notes, internal comments, edit logs, transition actions) are gated on it.
- ✅ Role assignment is performed by admins from the user admin surface.

## 2. Authentication & Accounts

- ✅ Sign up, log in, log out (Better Auth).
- ✅ Email + password authentication.
- ✅ Email verification required after sign-up (verification link sent on
  sign-up; auto sign-in after verification).
- ✅ Password reset by email.
- ✅ GitHub SSO.
- ⬜ Google SSO.
- ⬜ LinkedIn SSO.
- ⬜ Discord SSO.
- ⬜ Oregon State University ONID SSO.
- ✅ Profile management: name, email, affiliation, LinkedIn, avatar.
- ✅ Change password from the profile page.
- ✅ Avatar upload with the shared crop + resize image pipeline.
- ✅ Account detail view (shows the user's role).

## 3. Project Data Model

Each project carries:

- ✅ Random UUID, title, description, problem statement,
  objectives/deliverables, minimum qualifications, preferred qualifications,
  URL, contact name, contact email, image, license/IP restrictions.
- ✅ Staff-only `notes` field (never returned by public queries).
- ✅ Project proposer (linked user account, resolved from email; nullable) and
  a `proposerEmail` link key for proposers without an account yet.
- ✅ Program association.
- ✅ Program manager (main instructor).
- ✅ Collaborators table (schema present for multi-user project membership).
- ✅ Full-text search vector (Postgres generated `tsvector`, weighted across
  title, description, problem statement, objectives, and qualifications).
- ✅ Timestamps: created, updated, published, archived, soft-deleted.

## 4. Project Workflow & Lifecycle

- ✅ Statuses: `draft`, `submitted`, `approved` (not yet published),
  `changes_requested`, `published`, `archived`.
- ✅ Workflow state machine implemented as a pure module
  (`src/lib/project-workflow.ts`).
- ✅ User transitions: draft → submitted, changes_requested → submitted,
  submitted → draft.
- ✅ Admin/staff can perform all status transitions.
- ✅ Admins review and publish submitted projects.
- ✅ Admins archive published projects.
- ✅ Soft delete: projects are marked deleted (not removed). Hidden from users;
  visible to staff in a dedicated view and restorable.
- ✅ Draft projects are hard-deleted; non-draft statuses are soft-deleted.
- ✅ Visibility rules implemented as a pure module
  (`src/lib/project-visibility.ts`).

## 5. Project Comments & Review

- ✅ Admins/staff add review comments on status transitions.
- ✅ Users reply to review comments when a project is in `changes_requested`.
- ✅ Internal staff-only comments (invisible to users).
- ✅ Threaded comments (parent/child).

## 6. Logging & Audit

- ✅ Project status-change history log.
- ✅ Project edit log (changed fields, old/new values as JSON).
- ✅ Comment trail retained per project.
- ✅ Inventory item status-change history log.
- ✅ Inventory item edit log (changed fields, old/new values as JSON).

## 7. Project Browsing & User Views

- ✅ Public list of published projects at `/projects`.
- ✅ Canonical project detail at `/projects/$id`; staff-only sections appear
  conditionally for staff viewers.
- ✅ "My projects" view (`/my/projects`) with a status filter for the signed-in
  user's own created/proposed/submitted projects.
- ✅ Authenticated project create (`/projects/new`) and edit
  (`/projects/$id/edit`).
- ✅ Staff project list (`/admin/projects`) with filters and an
  include-soft-deleted toggle.

## 8. Discovery & Taxonomy

- ✅ Full-text search across title, description, problem statement, objectives,
  and qualifications.
- ✅ Filter by program.
- ✅ Filter by category.
- ✅ All filter/search state lives in URL search params (shareable links).
- ✅ Card / row listing toggle (`?view=card|row`); filters and search apply
  identically in both modes.
- ✅ Bookmarks: bookmark button on project detail (authed) and a
  `/my/bookmarks` view.

## 9. Categories & Programs

- ✅ Categories have a free-text `type` (e.g. project type, technology,
  industry, field); the admin form autocompletes existing types.
- ✅ Categories created/edited/deleted by admins (`/admin/categories`).
- ✅ Categories assigned to projects by staff only (multi-select on the project
  form).
- 🟡 Multiple category types exist and can be filtered, but per-type faceted
  filtering on the public listing is not broken out into separate filters.
- ✅ Programs = course ID + course name (+ description) with per-program
  instructors.
- ✅ Programs created/edited/deleted by admins (`/admin/programs`); instructors
  are drawn from users with role `admin` or `instructor`.
- ⬜ Gen-AI category suggestion (auto-suggesting best categories from project
  content).

## 10. AI-Assisted Proposal Review

- ✅ AI review of proposal fields (title, description, problem statement,
  objectives, qualifications, license restrictions) surfaced from the project
  form.
- ✅ Backed by AWS Bedrock (`BEDROCK_MODEL_ID`, configurable); returns
  per-field improvement suggestions.

## 11. Media & Images

- ✅ Images stored in an S3-compatible bucket (RustFS locally, AWS S3 in
  production).
- ✅ Project images and user avatars uploaded via client-side crop +
  canvas-resize so payloads stay ~150-400KB regardless of source size.
- ✅ Server runs Sharp on the upload to strip EXIF and re-encode WebP at a
  consistent quality.
- ✅ Storage rows hold keys, not URLs; `getPublicUrl(key)` builds rendered URLs
  with a pass-through for legacy `http(s)://` values (DiceBear identicons, OAuth
  images).

## 12. Inventory Management

- ✅ Item statuses: `available`, `requested`, `reserved`, `checked_out`,
  `maintenance`, `retired`.
- ✅ Item fields: name, description, category, serial, location, notes, image,
  current holder.
- ✅ Users browse inventory (default: available) and can also see requested,
  reserved, checked out, and in-maintenance items, but not retired items.
- ✅ Users cannot see who has requested/reserved/checked out an item.
- ✅ Staff add, edit, and delete inventory items.
- ✅ Cart-style requests: users request several items at once (`/my/items`
  cart, request items table).
- ✅ Staff approve or reject inventory requests (`/admin/inventory/requests`).
- ✅ Rejection requires a reason that is shown to the user; rejected/returned
  items go back to `available`.
- ✅ Staff change item status and assign holders; items auto-assign to the
  requesting user on reserve, with manual override on checkout.
- ✅ Users cannot change item status except to request available items.
- ✅ Users cancel a request while it is still `requested` or `reserved`.
- ✅ Request-item lifecycle: `pending`, `approved`, `rejected`, `cancelled`,
  `returned`, with pickup-by and due-at timestamps.
- ✅ Inventory status and edit logging (see §6).

## 13. Notifications

- ✅ In-app notification system (notifications table, type/title/message/link,
  read state).
- ✅ Notification bell in the site header.
- ✅ Used to inform users when an inventory request status changes.
- ✅ Used for project proposer notifications (skipped when a project has no
  linked account).

## 14. User Administration

- ✅ Admin-only user list at `/admin/users` (instructors are redirected to
  `/admin`).
- ✅ Text search (email + name), role filter, include-banned toggle.
- ✅ User detail at `/admin/users/$id`: profile block, project + bookmark
  counts, five most recent projects, role select, ban form.
- ✅ Self-action guards: admins cannot change their own role or ban themselves;
  the server refuses self-actions.
- ✅ Ban atomically updates the user row and revokes that user's sessions in
  one transaction (banned user is signed out on next request).

## 15. Branding / Theming

- ✅ Centralized brand config (institution name, short name, program name,
  logos, favicon, support email, color tokens) applied at runtime via a brand
  provider. Defaults to Oregon State University / EECS Capstone with Beaver
  Orange.

## 16. Landing Page

- ✅ Index page introduces the program and links to Projects.
- ✅ Inventory linked from the site header.
- 🟡 Handbook is currently a separate Astro site; not yet linked or integrated.

## 17. Project Bidding & Assignment (Stretch)

- 🟡 Schema scaffolded (`project_bids`, `project_assignments`) but no UI or
  server logic yet.
- ⬜ Students bid on preferred projects (top 5) at the start of the year for a
  specific program, with motivation and qualifications. Bids visible to admins
  and project proposers, not to other students.
- ⬜ Admins assign students to projects from bids and preferences
  (automatic or manual).

## 18. Analytics Dashboard (Stretch)

- ⬜ Analytics dashboard with charts for project trends and user engagement.
- ⬜ Projects published per academic year; projects submitted per period.
- ⬜ Customizable date ranges (academic year definition; recruitment starting
  before the academic year).

## 19. Handbook Integration

- ⬜ Integrate the separate Astro handbook into this app as a set of static
  pages, linked from the landing page.
