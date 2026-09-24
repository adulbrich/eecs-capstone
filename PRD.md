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
    (review projects, manage programs, manage categories, manage inventory)
    but not the user administration that is reserved for admins.
  - `admin`: full access, including user administration.
- [x] "Staff" is the union of `instructor` and `admin`; staff-only UI and data
  (internal comments, edit logs, transition actions, proposer email, inventory
  private notes) are gated on it. Project private notes are the one shared
  surface: staff and the project's proposer both see and edit them (§3).
- [x] Role assignment is performed by admins from the user admin surface.

## 2. Authentication & Accounts

- [x] Sign up, log in, log out (Better Auth).
- [x] Sign-in by a six digit code mailed to the address and typed back into the
  tab that asked for it (#576, ADR-0047). No account row exists until the code
  is redeemed, so a new account is verified from the start; a new address is
  asked for a name before its code is spent. There is no password: email and
  password sign-in, email verification links and password reset were removed
  in #576.
- [x] A project proposed for someone before they have an account links to that
  account once they prove the address, by a code, ONID or a GitHub-verified
  email. Only proof does this, never a row alone, so nobody can claim another
  person's projects by registering at their address.
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
- [x] Privacy policy at `/privacy`: a short public page, static in the repo,
  stating what the app collects, that published projects stay public, and what
  closing an account removes and keeps. Linked from `/sign-in` and its code
  form's name step (as a notice, not a checkbox; nothing is recorded), and the
  profile page. No footer and no separate terms document. (#91, #586)
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
  objectives, minimum qualifications, preferred qualifications,
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
  a `proposerEmail` link key for proposers without an account yet. The creator
  is the proposer on create; staff link, reassign or unlink from the Proposer
  section of the staff panel on the project page, never from the form (#322).
- [x] Program association: which programs a project runs in, set by staff from
  the Programs section of the staff panel and never from the form (#450,
  [ADR-0026](./docs/adr/0026-the-program-is-staff-placed-not-proposed.md)). A
  project is created unplaced and staff place it during review. A project can
  run in several programs at once (#462,
  [ADR-0028](./docs/adr/0028-a-project-runs-in-many-programs.md)): one
  proposal offered both in Corvallis and on Ecampus is one record filed under
  two courses.
- [x] Teams supported: how many student teams the project can take on (1-5,
  default 1), on the project form, where anyone who may edit the project sets
  it, and from the Programs and teams section of the staff panel, so staff can
  raise it in the same motion as placing a project in a second program. The one
  field with two writers, which ADR-0032 records. Shown as a badge above one
  team. (#468)
- [x] Student-proposed marker and mentor: staff mark a project as student-proposed
  from the Proposer section of the staff panel, saved with the link, and record a
  mentor's email from the Mentor section. Mentorship is that address and nothing
  else: no state beside it, so a project either has a mentor on file or it does
  not, and an instructor who runs a team without an outside mentor records their
  own. The public sees a "Student proposed" badge on the card, in the
  Badges column of table view and on the project page, and can filter the
  listing on it; nothing about the mentor is public. The address
  and the resolved name stay on staff reads, the staff list and the CSV export, and
  `/admin/projects` filters "Without a mentor", which beside "Student proposed" is
  the staff to-do. (#75, #304, #336, #402)
- [x] `/my/bookmarks` is a small decision table: title with thumbnail, program,
  status, badges, teams supported, and saved-on date, with the
  listing's own bookmark toggle in the title cell rather than a remove button,
  so un-bookmarking leaves the row in place until the next load (#336, #420);
  the badge cluster carries "Team is full", "Student proposed" and "NDA/IP
  required" in one column, and a dash where a row has none (#434).
  Sorted newest save first, no view toggle and no column picker. Visibility is
  re-checked on read, and one line says how many saved projects dropped out
  rather than letting the list shrink silently. (#106)
- [x] Team-is-full flag: a published project with a full roster stays listed,
  marked "Team is full" on its page, its card and its table row. The public
  listing hides such projects by default; the "are looking for team members"
  switch is what shows them, and `/admin/projects` starts with it off so staff
  see everything. Staff edit the flag from the Programs and teams section of
  the staff panel, riding that section's one Save, and the edit log records it.
  A boolean, not a status, so it stays orthogonal to the review workflow.
  (#72, #419, #491)
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
- [x] A comment's author can edit its text until someone replies, and the
  comment then reads "(edited)" with the time of the edit. Only the text: the
  internal flag is fixed once posted. An edit sends no email and writes no notification, so the bell entry
  and the inbox keep the words the recipient was actually told.

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
  user's own created/proposed/submitted projects, and a Mentoring section,
  hidden when empty, listing the projects whose mentor address is the
  viewer's own, every status, each linking to the public project page (#380).
- [x] Authenticated project create (`/projects/new`) and edit
  (`/projects/$id/edit`).
- [x] Staff project list (`/admin/projects`) with a status set (a multi-select
  that opens on every status but archived and never empties), a date range on
  Created, Published or Updated read as Pacific calendar days, program and
  proposer filters, a show-soft-deleted switch, the public listing's three
  narrowing switches under the same param names (looking for team
  members, student-proposed, requiring an NDA or IP agreement) and its own "Without a
  mentor" switch, all held in URL search params;
  the CSV export and the proposer dropdown follow the same filter (#335, #340).
  The range only helps
  on legacy rows if the import (#216) writes real dates: `publishedAt` as the
  start of the term the project ran and `archivedAt` as its end, with
  `createdAt` free to be the import time. That is why Published is the
  default field.
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
- [x] Sort control on the public listing: most relevant, newest, and
  "recommended for you". Which one an unchosen listing lands in depends on the
  viewer: "recommended for you" for anyone with an interest vector, most
  relevant for everyone else.
- [x] Personalized recommendations: signed-in users write an interests statement
  on their profile; it and every published project are embedded with Amazon
  Titan Text Embeddings V2 (pgvector), and the recommended sort ranks projects
  by cosine similarity to the interests vector. It is also the order the listing
  defaults to once they have a vector, so the interests they wrote take effect
  without them finding the sort on every visit; an explicit choice in the URL
  still wins. Falls back to relevance ordering when a viewer has no interest
  vector yet, including one whose interests saved but failed to embed; interest
  vectors never leave the server.
- [x] Similar projects on the project page: up to five published projects that
  accept applicants and share a program with the one being viewed, nearest by
  embedding; a sticky aside from `xl`, a collapsible floating card between `md`
  and `xl`, and a bottom sheet behind an icon button on a phone (#614).
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
- [x] Categories created/edited/deleted by staff (`/admin/categories`).
- [x] Categories assigned by staff only, many per record, through a
  multi-select in the project page's staff panel (#322) and on the item form.
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
- [x] One Sort select orders the inventory listing in both modes: available
  first (the default), name A-Z, or recently updated. The table headers do not
  sort; see [ADR-0030](./docs/adr/0030-one-ordering-control-on-the-public-listing.md).
- [x] Users cannot see who has requested/reserved/checked out an item.
- [x] Staff add, edit, and delete inventory items. Every item-scoped surface
  lives under `/inventory` (`/inventory/new`, `/inventory/$itemId`,
  `/inventory/$itemId/edit`), with staff-only routes guarded individually;
  `/admin/inventory` keeps only the cross-item management table and the
  request queue. This mirrors how projects are laid out.
- [x] One item detail page for everyone: every viewer sees image, name,
  status, category, and description; signed-in users additionally see
  a Borrow button when the item is available; staff additionally render two
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
  The queue groups lines by the request they arrived in, with Approve all over a
  borrow list, and a line sheet holding each line's timeline.
- [x] Custom requests: a signed-in user asks for equipment the inventory does not
  hold (`/inventory/request`), one line per thing with a reason, a quantity and an
  optional link. Staff work the lines in the same queue: start sourcing with a
  note, rewrite that note while sourcing, fulfil by linking items that exist
  (reserving them to the requester by default), or reject with a reason. The
  requester sees the request as a group on `/my/items`, with the items a
  fulfilment produced nested under their line, and is notified in-app at each
  step. Nothing is public and nothing on a submitted line is editable.
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

Two channels: an in-app row rendered by the bell, and outbound email through
SES. This section is the one page that says what fires on each, what is silent
on purpose, and where the operator and developer detail lives. #289 was the
catalogue that decided the matrix below; #288 shipped it.

### In-app

- [x] `notifications` table: user, type, title, message, optional link, read
  flag, created at. `type` is a `pgEnum` over `NOTIFICATION_TYPES` in
  `src/lib/vocabularies.ts`, which the decisions in
  `src/lib/project-notifications.ts` and `src/lib/inventory-notifications.ts`
  emit.
- [x] Bell in the site header, on desktop and in the mobile bar: unread count
  capped at 9+, the newest ten rows, click marks read and follows the link, mark
  all read. Polls every minute and on window focus. There is no notifications
  page, no pagination and no delete.
- [x] Project events to the proposer: every status change, soft delete and
  restore, a non-internal comment on the project (a reply also notifies the
  parent comment's author), being made the proposer of a project by staff, and
  the projects linked to a newly verified account. Skipped when the project has
  no linked account or when the proposer is the actor. Internal comments notify
  nobody.
- [x] Inventory events to the requester or holder: request approved (with the
  pickup-by date), rejected, checked out (with the due date), returned, closed
  by staff; on a custom line, sourcing started, sourcing note edited, rejected,
  fulfilled. Cart submission, custom request submission and self-cancel write
  no row; the admin overview tile is the staff signal in the app, and the staff
  inbox gets the email.
- [x] Overdue and past-pickup notices, written lazily on read rather than by a
  scheduler, and deduplicated so a re-read does not repeat one. When a
  request and the hold on its item name two different people, both are
  notified: the requester is accountable for the request, and the collector
  is the one holding the thing. The scan runs only when the affected user opens
  their own items page (ADR 0005).
- [x] Silent on purpose: AI review completion (it is synchronous in the form),
  new accounts, unban, mentor status, account deletion. Hard delete writes no
  row because the link would point at nothing; it is email only.

### Email

- [x] Transport behind the `EmailSender` interface in `src/lib/email/`:
  `console` writes every message to stderr (the default, used in dev and by
  every test suite), `ses` sends through SES v2. Configured by `EMAIL_TRANSPORT`,
  `EMAIL_FROM`, `EMAIL_REPLY_TO`, `EMAIL_STAFF_INBOX` and `SES_REGION`. A
  misconfigured `ses` transport fails boot (README, "Email transport"),
  including a missing staff inbox; under `console` a missing inbox only logs
  a warning and drops the staff-facing message.
- [x] Every email is mandatory for its recipient. There are no notification
  preferences, no unsubscribe link and none planned; every message is
  transactional (ADR 0019). Staff can still skip any email their own action
  would send, per action, from the dialog or popover that action already has,
  which names the recipient so the decision is visible rather than implicit;
  the skip suppresses the email alone, and the server ignores that flag from
  a non-staff actor (#379).
- [x] One shared staff inbox for every staff-facing message: project submitted
  or resubmitted, a borrow list or custom request submitted, and a comment
  from the proposer. No per-staff fan-out.
- [x] The proposer address is the linked account's email, else the stored
  proposer email, else nothing is sent. An inventory holder with an address
  and no account receives the pickup and due emails at that address, which is
  the one case where email is the only channel that can reach them.
- [x] Every email is sent after the transaction commits, never inside it, and
  its failure is swallowed and logged. A rejected email must not undo an
  approval, and a slow one must not hold an item's row lock.
- [x] The channel per event. The rule: email when the recipient must act away
  from the app, in-app only for confirmations and the audit trail. Every row
  is covered by an integration test through the `send` seam on the `*As`
  function.

  | Recipient | Event | In-app | Email |
  | --- | --- | --- | --- |
  | Account | Sign-in code (asked for at `/sign-in`) | no | yes |
  | Proposer | Changes requested | yes | yes |
  | Proposer | Approved | yes | yes |
  | Proposer | Returned to draft by staff | yes | yes, comment required (the force override is exempt) |
  | Proposer | Published, archived, restored from archive | yes | no |
  | Proposer | Soft deleted, restored | yes | no |
  | Proposer | Hard deleted by staff | no | yes, no link |
  | New proposer | Proposer reassigned | yes | yes |
  | Mentor | Named on a project | no account needed | yes |
  | Proposer | Non-internal staff comment on the project | yes | yes |
  | Proposer | Projects claimed on verification | yes | no |
  | Proposer | AI review completed | no | no |
  | Staff inbox | Project submitted or resubmitted | no | yes |
  | Staff inbox | Borrow list submitted | tile | yes |
  | Staff inbox | Custom request submitted | tile | yes |
  | Staff inbox | Comment from the proposer | no | yes |
  | Staff inbox | New account | no | no |
  | Holder | Request approved, pick up by date | yes | yes |
  | Requester | Request rejected | yes | yes |
  | Holder | Checked out, due date | yes | yes |
  | Holder | Returned, closed by staff | yes | no |
  | Requester | Custom line fulfilled or rejected | yes | yes |
  | Requester | Custom line sourcing started or note edited | yes | no |
  | User | Role changed | no | yes |
  | User | Banned | no | yes |
  | User | Unbanned, mentor status, account deletion | no | no |

  The actor is never told: a proposer withdrawing their own submission, or
  deleting their own draft, or staff assigning a project to themselves, emails
  nobody. Approving a cart of six lines sends six emails, one per line, the
  same as the bell.

### Planned

- [ ] Blocked by ADR 0005 until it is reopened with a scheduler: a due-soon
  warning, overdue by email, and any staff view of overdue items. An overdue
  email triggered by the lazy scan would arrive only when the affected user
  already has the page open.
- Deferred, not planned: a notifications page beyond the bell's ten rows, an
  outbound email log, per-staff fan-out of staff mail, digests, coalescing a
  batch approval into one email.

### Where the rest is written

- [`README.md`](./README.md), "Email transport": operator setup, the email
  table, and the SES production state.
- [`CONTEXT.md`](./CONTEXT.md): the entries for Notification, Staff inbox,
  Proposer email and Submitted.
- [`docs/QUIRKS.md`](./docs/QUIRKS.md): the console transport in dev, the
  render functions and their escaping, the two notification rules that look
  wrong, and the custom-line transition table.
- [`DEPLOYMENT.md`](./DEPLOYMENT.md), section 9: SES identity, DKIM, sandbox exit
  and cutover.
- [`docs/adr/0005-lazy-deadlines-no-scheduler.md`](./docs/adr/0005-lazy-deadlines-no-scheduler.md):
  why overdue is lazy and there is no cron.
- [`docs/adr/0019-every-email-is-mandatory-and-staff-share-one-inbox.md`](./docs/adr/0019-every-email-is-mandatory-and-staff-share-one-inbox.md):
  why there are no preferences and no per-staff fan-out.

## 14. User Administration

- [x] Admin overview (`/admin`): project, published, awaiting-review, inventory
  request, and user counts. The "Awaiting review" and "Inventory requests"
  tiles turn into colored, clickable alerts that deep-link to the filtered work
  queues (`/admin/projects` with the status set narrowed to submitted,
  `/admin/inventory/requests?tab=pending`) when items are pending.
- [x] Admin-only user list at `/admin/users` (instructors are redirected to
  `/admin`).
- [x] Text search (email + name), role filter, include-banned toggle.
- [x] User detail at `/admin/users/$id`: profile block, sign-in methods (the
  emailed code, which every account has, plus any linked ONID or GitHub
  identity), a mentor indicator (opt-in state
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

- [x] Index page leads with the whole value proposition (propose, review, browse,
  borrow equipment) rather than framing proposals as student-only.
- [x] Two panels matching the header nav, Projects (browse, propose) and
  Inventory (borrow), each carrying its links, and a strip that walks the
  proposal statuses from draft to published (#393). Nothing on the page looks
  pressable without being a link.
- [x] Inventory linked from the site header.
- [ ] Partial: Handbook is currently a separate Astro site; not yet linked or integrated.

## 16a. Link Sharing & Search Visibility

- [x] Open Graph and Twitter card metadata on every page, with brand defaults on
  the root route and per-project title, description and type on
  `/projects/$projectId` (#498). Server rendered, since a scraper runs no
  JavaScript.
- [x] One static 1200x630 brand card shared by every page, committed rather than
  built, with `og:image:alt` so the text baked into it is not lost to a screen
  reader. `scripts/generate-social-card.mjs` regenerates it.
- [x] `rel=canonical` on the project and inventory detail pages, so a link shared
  with filter or tracking params unfurls as one page.
- [x] The catalog is kept out of search results with `noindex, follow` while
  `robots.txt` stays permissive, which is what keeps previews working
  ([ADR-0055](./docs/adr/0055-the-catalog-is-shareable-but-not-indexed.md)).
  The landing and privacy pages stay indexable.
- [x] A model-written one-line social summary per project, generated from the
  title, description and problem statement at the same two call sites as the
  embedding, with its own kill switch and its own usage limit pair.
- [x] Staff read and correct that summary in a Social preview panel section, and
  a corrected one is never overwritten by the automatic path.
- [x] `og:description` falls back through the summary, the description, the
  problem statement and a site sentence, so a page unfurls correctly with no
  model involved at all.
- [ ] Per-project card images, so two project links do not unfurl with the same
  picture (#533).

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
  student-proposed projects with no mentor address on file, mentor
  capacity offered and unassigned, overdue items and pending request lines
  with the age of the oldest, published projects with no bookmark since
  publication), flows over a date range with
  a previous-period comparison (submitted, published, inventory requests,
  and new users for admins), and breakdowns by status, program and category.
  A program selector governs the figures marked per program; every card
  names its scope. No charting library on this page: numbers and small
  grouped counts. `/admin/traffic` has the app's one chart (ADR-0049).
- [ ] Second pass: conversion from submitted to published, stale drafts,
  repeat proposers, category demand against bookmarks, median review latency.
- [ ] Site traffic (#18) is separate: this counts what is in the database.
  - [x] Cookieless traffic writer on the public routes (#591): one
    `traffic_events` row per page view or search change, keyed by a visitor
    hash whose salt is replaced daily; no cookie, no browser storage, no
    account link, no stored address. Described on `/privacy`.
  - [x] Traffic reports for staff on `/admin/traffic` (#592): page views,
    visits, average daily visitors and bounce rate against the previous
    period; page views and visits per day as the app's one chart; views per
    published project with zeros; pages, entry pages, referring sites,
    countries, devices and browsers; filter use on `/projects` and
    `/inventory`. Closed days read from a rollup of visits (ADR-0050).
- [ ] Projects published per academic year; projects submitted per period.
- [ ] Customizable date ranges (academic year definition; recruitment starting
  before the academic year).

## 19. Handbook Integration

- [ ] Integrate the separate Astro handbook into this app as a set of static
  pages, linked from the landing page.
