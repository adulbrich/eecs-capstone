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
  (internal comments, edit logs, transition actions, proposer email, inventory
  private notes) are gated on it. Project private notes are the one shared
  surface: staff and the project's proposer both see and edit them (§3).
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
- ✅ Profile management: name, email, affiliation, LinkedIn, avatar, and a
  private free-text interests statement that drives personalized project
  recommendations (see §8).
- ✅ Mentorship opt-in: a profile toggle ("I want to mentor a team", labelled
  "For professionals and faculty, not students") and a teams-to-mentor count
  (1-5, default 1). Opting in requires an affiliation. Staff act on these via
  the mentors admin surface (see §14).
- ✅ Change password from the profile page.
- ✅ Avatar upload with the shared crop + resize image pipeline.
- ✅ Account detail view (shows the user's role).

## 3. Project Data Model

Each project carries:

- ✅ Random UUID, title, description, problem statement,
  objectives/deliverables, minimum qualifications, preferred qualifications,
  URL, contact name, contact email, image, license/IP restrictions.
- ✅ The long text fields (description, problem statement, objectives, both
  qualification fields, license/IP restrictions) accept Markdown, authored with
  a formatting toolbar and Edit/Preview tabs and rendered safely as React
  elements (no raw HTML, no `dangerouslySetInnerHTML`). Card and row summaries
  strip the markup back to plain text.
- ✅ Semantic embedding vector (pgvector), written when a project is published
  and refreshed when its indexed text changes, powering recommendations (§8).
- ✅ Private notes (`notes`) field, labelled "Private notes" wherever it
  appears. Visible and editable to staff and to the project's proposer, who
  authors it on `/projects/new`; stripped from the payload for every other
  viewer, signed in or not, on published projects included.
- ✅ Project proposer (linked user account, resolved from email; nullable) and
  a `proposerEmail` link key for proposers without an account yet.
- ✅ Program association.
- ✅ Program manager (main instructor).
- ✅ Teams supported: how many student teams the project can take on (1-5,
  default 1), set and edited by staff on the project form.
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
- ✅ Comments show the author's display name, not their user id.
- ✅ A reply to an internal comment is always internal: the checkbox is forced
  on and disabled in the UI, and the server coerces the flag regardless of what
  the client sends. The converse is deliberately allowed, so staff can leave an
  internal reply under a comment the proposer can see.
- ✅ Private notes, status history, and comments render inside one bordered
  "Private" panel on the project page, visible to the proposer and staff, with
  a single audience statement instead of per-section explanations.

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
- ✅ Staff project list (`/admin/projects`) with status and program filters and
  a show-soft-deleted switch, all held in URL search params.
- ✅ Consistent list presentation: fixed-ratio row thumbnails, boolean filters
  rendered as switches aligned with the adjacent inputs, status dropdowns
  (including an "All statuses" option), and a shared centered empty state across
  the list pages.

## 8. Discovery & Taxonomy

- ✅ Full-text search across title, description, problem statement, objectives,
  and qualifications.
- ✅ Filter by program.
- ✅ Filter by category.
- ✅ All filter/search state lives in URL search params (shareable links).
- ✅ Card / row listing toggle (`?view=card|row`); filters and search apply
  identically in both modes.
- ✅ Sort control on the public listing: most relevant (default), newest, and
  "recommended for you".
- ✅ Personalized recommendations: signed-in users write an interests statement
  on their profile; it and every published project are embedded with Amazon
  Titan Text Embeddings V2 (pgvector), and the recommended sort ranks projects
  by cosine similarity to the interests vector. Falls back to relevance ordering
  when a viewer has no interest vector yet; interest vectors never leave the
  server, and projects are embedded only on publish.
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
  per-field improvement suggestions as Markdown, matching the fields' format.

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
- ✅ Projects without an image of their own render a branded default
  (`public/project-placeholder.webp`, 960x540 WebP) on cards, rows, and the
  detail hero. It is presentation only and is never written to
  `projects.image_url`, so "no image" stays recoverable.

## 12. Inventory Management

- ✅ Item statuses: `available`, `requested`, `reserved`, `checked_out`,
  `maintenance`, `retired`.
- ✅ Item fields: name, description, category, serial, label, location, image,
  current holder.
- ✅ Private notes: a staff-only free-text field for details like locker codes
  and storage quirks, using the same "Private notes" wording as projects (§3).
  Stripped from every non-staff list row and detail payload; the audience line
  differs from the project one because an item has no proposer.
- ✅ Users browse inventory (default: available) and can also see requested,
  reserved, checked out, and in-maintenance items, but not retired items.
- ✅ Users cannot see who has requested/reserved/checked out an item.
- ✅ Staff add, edit, and delete inventory items. Every item-scoped surface
  lives under `/inventory` (`/inventory/new`, `/inventory/$itemId`,
  `/inventory/$itemId/edit`), with staff-only routes guarded individually;
  `/admin/inventory` keeps only the cross-item management table and the
  request queue. This mirrors how projects are laid out.
- ✅ One item detail page for everyone: every viewer sees image, name,
  status, category, and description; signed-in users additionally see
  Add to cart when the item is available; staff additionally render a
  staff panel with serial, label, location, private notes, the Edit link and
  the lifecycle controls.
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

- ✅ Admin overview (`/admin`): project, published, awaiting-review, inventory
  request, and user counts. The "Awaiting review" and "Inventory requests"
  tiles turn into colored, clickable alerts that deep-link to the filtered work
  queues (`/admin/projects?status=submitted`,
  `/admin/inventory/requests?tab=pending`) when items are pending.
- ✅ Admin-only user list at `/admin/users` (instructors are redirected to
  `/admin`).
- ✅ Text search (email + name), role filter, include-banned toggle.
- ✅ User detail at `/admin/users/$id`: profile block, sign-in source (account
  providers such as GitHub or email/password), a mentor indicator (opt-in state
  and team count), project + bookmark counts, five most recent projects, role
  select, ban form.
- ✅ Mentors page at `/admin/mentors`, open to all staff (admins and
  instructors, unlike the admin-only user list): lists users who opted in to
  mentoring with their affiliation, and lets staff adjust each mentor's opt-in
  state and team capacity. Surfaced from the admin overview.
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

- ✅ Index page leads with the whole value proposition (propose, manage through
  review, browse, borrow equipment) rather than framing proposals as
  student-only, and links to Projects.
- ✅ Four feature cards: browse, propose, manage review, borrow equipment.
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
