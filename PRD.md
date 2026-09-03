# EECS Capstone App: Product Requirements

This document is the canonical, exhaustive list of product features for the
Oregon State University EECS Capstone application. It captures both what has been
built and what is still planned. The original feature draft lived in the
README; it has been expanded here against the actual implementation.

**Status legend**

- [x] Implemented
- [ ] Partial: some of the feature exists; the gaps are noted
- [ ] Planned (not yet built)

For developer setup, architecture notes, and the active roadmap, see
[`README.md`](./README.md). For implementation quirks and gotchas, see
[`docs/QUIRKS.md`](./docs/QUIRKS.md).

---

## 1. Users, Roles & Permissions

- [x] Three role tiers: `user`, `instructor`, `admin`.
  - `user`: default role on sign-up. Browses and bookmarks projects, submits
    proposals, browses and requests inventory.
  - `instructor`: staff privileges over the project and inventory domains
    (review projects, manage programs, manage inventory) but not user or
    category administration that is reserved for admins.
  - `admin`: full access, including user administration and category
    management.
- [x] "Staff" is the union of `instructor` and `admin`; staff-only UI and data
  (internal comments, edit logs, transition actions, proposer email, inventory
  private notes) are gated on it. Project private notes are the one shared
  surface: staff and the project's proposer both see and edit them (§3).
- [x] Role assignment is performed by admins from the user admin surface.

## 2. Authentication & Accounts

- [x] Sign up, log in, log out (Better Auth).
- [x] Email + password authentication.
- [x] Email verification required after sign-up (verification link sent on
  sign-up; auto sign-in after verification).
- [x] Password reset by email.
- [x] A project proposed for someone before they have an account links to that
  account once they verify the address. Only verification does this, never
  sign-up alone, so nobody can claim another person's projects by registering
  at their address.
- [x] GitHub SSO.
- [ ] Google SSO.
- [ ] LinkedIn SSO.
- [ ] Discord SSO.
- [ ] Oregon State University ONID SSO.
- [x] Profile management: name, affiliation, LinkedIn, avatar, and a private
  free-text interests statement that drives personalized project
  recommendations (see §8). The email address is displayed but not editable:
  `profileSchema` does not accept it, and Better Auth's change-email endpoint
  stays disabled because `user.changeEmail.enabled` is never set. This applies
  to every account, not only to GitHub sign-ins.
- [x] Mentorship opt-in: a profile toggle ("I want to mentor a team", labelled
  "For professionals and faculty, not students") and a teams-to-mentor count
  (1-5, default 1). Opting in requires an affiliation. Staff act on these via
  the mentors admin surface (see §14).
- [x] Change password from the profile page.
- [x] Privacy policy at `/privacy`: a short public page, static in the repo,
  stating what the app collects, that published projects stay public, and what
  closing an account removes and keeps. Linked from sign-up (as a notice, not a
  checkbox; nothing is recorded), sign-in, and the profile page. No footer and
  no separate terms document. (#91)
- [x] Self-service account deletion from the profile page, behind a dialog that
  states what stays and requires the person to type their own email. The `user`
  row is anonymized in place rather than deleted, because authorship and audit
  records point at it; only what a real DELETE would cascade (sessions,
  accounts, interests, bookmarks, cart, notifications, program memberships,
  collaborations, review usage) is removed. Projects stay published and read
  "Deleted user"; contact details typed into them and equipment records stay.
  Blocked while an item is out or a request is approved, and for the only admin.
  Irreversible, immediate, and a re-registered address cannot reclaim old
  projects. (#84; the admin-executed version is #29)
- [x] Avatar upload with the shared crop + resize image pipeline.
- [x] Account detail view (shows the user's role).

## 3. Project Data Model

Each project carries:

- [x] Random UUID, title, description, problem statement,
  objectives/deliverables, minimum qualifications, preferred qualifications,
  URL, contact name, contact email, image, license/IP restrictions.
- [x] The long text fields (description, problem statement, objectives, both
  qualification fields, license/IP restrictions) accept Markdown, authored with
  a formatting toolbar and Edit/Preview tabs and rendered safely as React
  elements (no raw HTML, no `dangerouslySetInnerHTML`). Listing cards and table
  cells strip the markup back to plain text.
- [x] Semantic embedding vector (pgvector), written when a project is published
  and refreshed when its indexed text changes, powering recommendations (§8).
- [x] Private notes (`notes`) field, labelled "Private notes" wherever it
  appears. Visible and editable to staff and to the project's proposer, who
  authors it on `/projects/new`; stripped from the payload for every other
  viewer, signed in or not, on published projects included.
- [x] Project proposer (linked user account, resolved from email; nullable) and
  a `proposerEmail` link key for proposers without an account yet.
- [x] Program association.
- [x] Teams supported: how many student teams the project can take on (1-5,
  default 1), set and edited by staff on the project form.
- [x] Student-proposed marker and mentor: staff mark a project as student-proposed
  and record a mentor's email from the staff panel. The public sees a "Student
  proposed" badge, a "Seeking mentor" badge while no address is on file, and the
  mentor's name once that address has an account. The address itself never
  leaves staff reads. (#75)
- [x] `/my/bookmarks` is a small decision table: title with thumbnail, program,
  status, accepting applicants, teams supported, NDA/IP, origin (student
  proposed and mentor state in one cell), saved-on date, and a remove button.
  Sorted newest save first, no view toggle and no column picker. Visibility is
  re-checked on read, and one line says how many saved projects dropped out
  rather than letting the list shrink silently. (#106)
- [x] Accepting applicants flag: a published project with a full roster stays
  listed, marked "Not accepting applicants" on its page, its card and its
  table row, with a listing filter to hide such projects. Staff and the
  proposer edit it as an ordinary form field, so the edit log records it.
  A boolean, not a status, so it stays orthogonal to the review workflow. (#72)
- [x] Collaborators table (schema present for multi-user project membership).
- [x] Full-text search vector (Postgres generated `tsvector`, weighted across
  title, description, problem statement, objectives, and qualifications).
- [x] Timestamps: created, updated, published, archived, soft-deleted.

## 4. Project Workflow & Lifecycle

- [x] Statuses: `draft`, `submitted`, `approved` (not yet published),
  `changes_requested`, `published`, `archived`.
- [x] Workflow state machine implemented as a pure module
  (`src/lib/project-workflow.ts`).
- [x] User transitions: draft → submitted, changes_requested → submitted,
  submitted → draft.
- [x] Admin/staff can perform all status transitions.
- [x] Admins review and publish submitted projects.
- [x] Admins archive published projects.
- [x] Soft delete: projects are marked deleted (not removed). Hidden from users;
  visible to staff in a dedicated view and restorable.
- [x] Draft projects are hard-deleted; non-draft statuses are soft-deleted.
- [x] Visibility rules implemented as a pure module
  (`src/lib/project-visibility.ts`).
- [x] The proposer email field is read-only once a real account is linked, and
  changing it goes through a re-assign modal that names both people and offers
  an explicit unlink for genuinely external proposers. It is free text when no
  account is linked.

## 5. Project Comments & Review

- [x] Admins/staff add review comments on status transitions.
- [x] Users reply to review comments when a project is in `changes_requested`.
- [x] Internal staff-only comments (invisible to users).
- [x] Threaded comments (parent/child).
- [x] Comments show the author's display name, not their user id.
- [x] A reply to an internal comment is always internal: the checkbox is forced
  on and disabled in the UI, and the server coerces the flag regardless of what
  the client sends. The converse is deliberately allowed, so staff can leave an
  internal reply under a comment the proposer can see.
- [x] Private notes, status history, and comments render inside one bordered
  "Private" panel on the project page, visible to the proposer and staff, with
  a single audience statement instead of per-section explanations.

## 6. Logging & Audit

- [x] Project status-change history log.
- [x] Project edit log (changed fields, old/new values as JSON).
- [x] Comment trail retained per project.
- [x] Inventory item status-change history log.
- [x] Inventory item edit log (changed fields, old/new values as JSON).

## 7. Project Browsing & User Views

- [x] Public list of published projects at `/projects`.
- [x] Canonical project detail at `/projects/$id`; staff-only sections appear
  conditionally for staff viewers.
- [x] "My projects" view (`/my/projects`) with a status filter for the signed-in
  user's own created/proposed/submitted projects.
- [x] Authenticated project create (`/projects/new`) and edit
  (`/projects/$id/edit`).
- [x] Staff project list (`/admin/projects`) with status and program filters and
  a show-soft-deleted switch, all held in URL search params.
- [x] Consistent list presentation: fixed-ratio thumbnails, boolean filters
  rendered as switches aligned with the adjacent inputs, status dropdowns
  (including an "All statuses" option), and a shared centered empty state across
  the list pages.

## 8. Discovery & Taxonomy

- [x] Full-text search across title, description, problem statement, objectives,
  and qualifications.
- [x] Filter by program.
- [x] Filter by category.
- [x] All filter/search state lives in URL search params (shareable links).
- [x] Card / table listing toggle (`?view=card|table`); filters and search apply
  identically in both modes. The card is responsive (image on top below `md`,
  beside the text from `md` up); the table is the same `AdminDataTable` the
  admin pages use, with column visibility and a client-side column sort.
- [x] Sort control on the public listing: most relevant (default), newest, and
  "recommended for you".
- [x] Personalized recommendations: signed-in users write an interests statement
  on their profile; it and every published project are embedded with Amazon
  Titan Text Embeddings V2 (pgvector), and the recommended sort ranks projects
  by cosine similarity to the interests vector. Falls back to relevance ordering
  when a viewer has no interest vector yet; interest vectors never leave the
  server, and projects are embedded only on publish.
- [x] Bookmarks: bookmark button on project detail and a toggle on every row of
  the public listing (authed), and a `/my/bookmarks` view.

## 9. Categories & Programs

- [x] Every category belongs to one `domain`, `project` or `inventory`, fixed
  at creation and immutable afterwards, so a category can only ever appear in
  the picker it was made for. `/admin/categories` has a tab per domain.
- [x] Project categories additionally have a free-text `type` (e.g. project
  type, technology, industry, field) that groups them in the pickers; the
  admin form autocompletes existing types. Inventory categories are flat and
  carry no type.
- [x] Categories created/edited/deleted by admins (`/admin/categories`).
- [x] Categories assigned by staff only, many per record, through a
  multi-select on both the project form and the item form.
- [ ] Partial: Multiple category types exist and can be filtered, but per-type faceted
  filtering on the public listing is not broken out into separate filters.
- [x] The admin categories table shows a usage count per category: for the
  project domain, every project filed under it except drafts and
  soft-deleted ones, so submitted, approved, changes-requested, published
  and archived all count; for the inventory domain, every item, with no
  status filter. Counted from the matching junction table on read, not
  cached, and computed in the same query that fetches the rows.
- [x] Programs = course ID + course name (+ description) with per-program
  instructors.
- [x] Programs created/edited/deleted by admins (`/admin/programs`); instructors
  are drawn from users with role `admin` or `instructor`.
- [ ] Gen-AI category suggestion (auto-suggesting best categories from project
  content).

## 10. AI-Assisted Proposal Review

- [x] AI review of proposal fields (title, description, problem statement,
  objectives, qualifications, license restrictions) surfaced from the project
  form.
- [x] Backed by AWS Bedrock (`BEDROCK_MODEL_ID`, configurable); returns
  per-field improvement suggestions as Markdown, matching the fields' format.
- [x] Staff-only scope assessment on the project's staff panel: a verdict
  (under-scoped, about right, too large) against one term and against three
  terms, a confidence, and a short rationale, stored on the project and shown
  as stale when the text or the program's term count moves. Programs carry a
  staff-editable `term_count`. Metered under its own limit pair; never shown
  to proposers or students (#61).

## 11. Media & Images

- [x] Images stored in an S3-compatible bucket (RustFS locally, AWS S3 in
  production).
- [x] Project images and user avatars uploaded via client-side crop +
  canvas-resize so payloads stay ~150-400KB regardless of source size.
- [x] Server runs Sharp on the upload to strip EXIF and re-encode WebP at a
  consistent quality.
- [x] Storage rows hold keys, not URLs; `getPublicUrl(key)` builds rendered URLs
  with a pass-through for legacy `http(s)://` values (DiceBear identicons, OAuth
  images).
- [x] Projects without an image of their own render a branded default
  (`public/project-placeholder.webp`, 960x540 WebP) on cards, rows, and the
  detail hero. It is presentation only and is never written to
  `projects.image_url`, so "no image" stays recoverable.

## 12. Inventory Management

- [x] Item statuses: `available`, `requested`, `reserved`, `checked_out`,
  `maintenance`, `retired`.
- [x] Item fields: name, description, categories (many, from the inventory
  domain), serial, label, location, image, current holder.
- [x] Private notes: a staff-only free-text field for details like locker codes
  and storage quirks, using the same "Private notes" wording as projects (§3).
  Stripped from every non-staff list row and detail payload; the audience line
  differs from the project one because an item has no proposer.
- [x] Users browse inventory (default: available) and can also see requested,
  reserved, checked out, and in-maintenance items, but not retired items. The
  listing has the same card and table modes as projects (`?view=card|table`,
  one stored preference for both), the table limited to name, status,
  categories and description.
- [x] Users cannot see who has requested/reserved/checked out an item.
- [x] Staff add, edit, and delete inventory items. Every item-scoped surface
  lives under `/inventory` (`/inventory/new`, `/inventory/$itemId`,
  `/inventory/$itemId/edit`), with staff-only routes guarded individually;
  `/admin/inventory` keeps only the cross-item management table and the
  request queue. This mirrors how projects are laid out.
- [x] One item detail page for everyone: every viewer sees image, name,
  status, category, and description; signed-in users additionally see
  Add to borrow list when the item is available; staff additionally render two
  panels, splitting what the item is from what is happening to it. A
  "Private" panel holds its serial, label, location and private notes with
  the Edit link beside them, mirroring the project page's private panel; a
  staff panel holds the lifecycle controls, the status history and the
  danger zone.
- [x] Borrow-list requests: users assemble a borrow list and submit several
  items at once (`/my/items` borrow list tab, request items table). The list
  is called a cart in code (`inventory_cart_items`, `getCart`) and a borrow
  list in every user-facing string.
- [x] Staff approve or reject inventory requests (`/admin/inventory/requests`).
- [x] Rejection requires a reason that is shown to the user; rejected/returned
  items go back to `available`.
- [x] Staff change item status and assign holders; items auto-assign to the
  requesting user on reserve, with manual override on checkout.
- [x] Staff-assigned holds need no request line: an item that was never carted
  can be reserved or checked out directly, assigned to an address, or to an
  ad-hoc label when the hold is not on a person at all. An address that
  matches an account resolves to it (and so notifies the holder) the same way
  a project's proposer email resolves to a proposer; an address with no
  account still records the typed name and program instead. The hold's
  pickup-by and due-at live on the item, so they survive whether or not a
  request line exists.
- [x] One item can involve two people: the student who requested it and the
  teammate who collected it. The request stays attributed to its requester,
  while the item's holder columns describe whoever is actually carrying it.
  The request queue and the requester's My Items both name the collector,
  and the collector sees the item in their own My Items, which is what tells
  them they are holding something. Read from the status history rather than
  copied onto the request line, so it survives the return that clears the
  item's holder columns.
- [x] The item form marks every non-public field individually rather than
  boxing them together: serial, label and location each carry "Only visible
  to staff." under their label, and private notes carries its own longer
  line. The set matches the server's public/staff split exactly, so a staff
  member filling the form can tell field by field what will be public
  without having to look elsewhere on the page.
- [x] Users cannot change item status except to request available items.
- [x] Users cancel a request while it is still `requested` or `reserved`.
- [x] Request-item lifecycle: `pending`, `approved`, `rejected`, `cancelled`,
  `returned`, with pickup-by and due-at timestamps.
- [x] Inventory status and edit logging (see §6).

## 13. Notifications

- [x] In-app notification system (notifications table, type/title/message/link,
  read state).
- [x] Notification bell in the site header.
- [x] Used to inform users when an inventory request status changes.
- [x] Overdue and past-pickup notices, written lazily on read rather than by a
  scheduler, and deduplicated so a re-read does not repeat one. When a
  request and the hold on its item name two different people, both are
  notified: the requester is accountable for the request, and the collector
  is the one holding the thing.
- [x] Used for project proposer notifications (skipped when a project has no
  linked account).
- [x] Outbound email, four messages in total. Two for accounts: verification on
  sign-up, and password reset. Two for project review: a notice to the capstone
  review inbox when a project is submitted, carrying the title, the proposer,
  the description and a link; and the outcome to the proposer when staff
  approve or request changes, carrying the staff note. The approval message
  says the project will be published later and that no further email follows,
  which is true because publishing deliberately emails nobody.
- [x] Staff can skip the proposer email per action from the transition dialog,
  which names the recipient so the decision is visible rather than implicit.
- [x] Email is sent after the transaction commits, never inside it, and its
  failure is swallowed. A rejected email must not undo an approval.
- [x] Every other signal in the app is in-app only, a row in `notifications`
  rendered by the bell, and never reaches an inbox.

## 14. User Administration

- [x] Admin overview (`/admin`): project, published, awaiting-review, inventory
  request, and user counts. The "Awaiting review" and "Inventory requests"
  tiles turn into colored, clickable alerts that deep-link to the filtered work
  queues (`/admin/projects?status=submitted`,
  `/admin/inventory/requests?tab=pending`) when items are pending.
- [x] Admin-only user list at `/admin/users` (instructors are redirected to
  `/admin`).
- [x] Text search (email + name), role filter, include-banned toggle.
- [x] User detail at `/admin/users/$id`: profile block, sign-in source (account
  providers such as GitHub or email/password), a mentor indicator (opt-in state
  and team count), project + bookmark counts, five most recent projects, role
  select, ban form.
- [x] Mentors page at `/admin/mentors`, open to all staff (admins and
  instructors, unlike the admin-only user list): lists users who opted in to
  mentoring with their affiliation, and lets staff adjust each mentor's opt-in
  state and team capacity. Surfaced from the admin overview.
- [x] Self-action guards: admins cannot change their own role or ban themselves;
  the server refuses self-actions.
- [x] Ban atomically updates the user row and revokes that user's sessions in
  one transaction (banned user is signed out on next request).

## 15. Branding / Theming

- [x] Centralized brand config (institution name, short name, program name,
  logos, favicon, support email, color tokens) applied at runtime via a brand
  provider. Defaults to Oregon State University / EECS Capstone with Beaver
  Orange.

## 16. Landing Page

- [x] Index page leads with the whole value proposition (propose, manage through
  review, browse, borrow equipment) rather than framing proposals as
  student-only, and links to Projects.
- [x] Four feature cards: browse, propose, manage review, borrow equipment.
- [x] Inventory linked from the site header.
- [ ] Partial: Handbook is currently a separate Astro site; not yet linked or integrated.

## 17. Project Bidding & Assignment (Stretch)

- [ ] Partial: Schema scaffolded (`project_bids`, `project_assignments`) but no UI or
  server logic yet.
- [ ] Students bid on preferred projects (top 5) at the start of the year for a
  specific program, with motivation and qualifications. Bids visible to admins
  and project proposers, not to other students.
- [ ] Admins assign students to projects from bids and preferences
  (automatic or manual).

## 18. Analytics Dashboard

- [x] Staff dashboard at `/admin/analytics` over the app's own data (#34):
  headline stocks as of now (published team slots against each program's
  `expected_teams`, submitted projects and the age of the oldest wait,
  projects needing a mentor, mentor capacity offered and unassigned, overdue
  items and pending request lines with the age of the oldest, published
  projects with no bookmark since publication), flows over a date range with
  a previous-period comparison (submitted, published, inventory requests,
  and new users for admins), and breakdowns by status, program and category.
  A program selector governs the figures marked per program; every card
  names its scope. No charting library: numbers and small grouped counts.
- [ ] Second pass: conversion from submitted to published, stale drafts,
  repeat proposers, category demand against bookmarks, median review latency.
- [ ] Site traffic (#18) is separate: this counts what is in the database.
- [ ] Projects published per academic year; projects submitted per period.
- [ ] Customizable date ranges (academic year definition; recruitment starting
  before the academic year).

## 19. Handbook Integration

- [ ] Integrate the separate Astro handbook into this app as a set of static
  pages, linked from the landing page.
