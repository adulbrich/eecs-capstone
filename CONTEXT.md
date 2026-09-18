# EECS Capstone

The Oregon State University EECS Capstone app: people propose capstone projects,
staff review and publish them, students browse them, and everyone borrows shared
equipment from an inventory. One context; this file is the glossary for all of it.
Decisions live in `docs/adr/`, gotchas in `docs/QUIRKS.md`, and this file holds
neither.

Where the code's identifier and the user-facing name differ, the entry names both
and says which one this file uses. Where a definition here differs from what the
code does, the code is right and the entry is wrong: fix the entry. Where a term
here differs from an older doc, this file wins.

## People and roles

**User**:
An account. Also the default role, which is what every account has until an admin
changes it; a user browses, bookmarks and proposes projects and borrows items.
_Avoid_: member, student (as a role: there is no student role)

**Instructor**:
The role with staff powers over projects, categories and inventory, but not over
accounts.
_Avoid_: teacher, faculty (as a role)

**Admin**:
The role with every power, including user administration.
_Avoid_: administrator, superuser

**Staff**:
An instructor or an admin. Every staff-only rule in the app is a rule about this
union, never about one of the two roles alone.
_Avoid_: reviewer, moderator, manager

**Viewer**:
Whoever a permission question is being asked about, including an anonymous visitor
with no account. A viewer may be nobody; a user never is.
_Avoid_: current user (when the anonymous case matters), requester (that is
inventory's word)

**Proposer**:
The person a project belongs to. Linked to an account when one exists at that
address, pending until then. A project has at most one.
_Avoid_: owner (the code's name for the proposer acting on their own project, not a
public term), author, submitter, sponsor

**Student**:
A person taking a capstone course. Not a role: a student is a user. The word appears
on a project that a student proposed and on the analytics that count teams.
_Avoid_: learner

**Mentor**:
A professional or faculty member who has offered, on their profile, to mentor one or
more student teams, and whom staff may record as the mentor of a project.
_Avoid_: advisor, supervisor, sponsor

**Program**:
A capstone course: its course id, name, description, instructors, and the two
staff-only numbers that size it (how many terms it runs, how many teams are
expected). A project runs in a set of programs: zero, one or many.
_Avoid_: course (the column names and some copy still say it; use program in
anything new), section, class, cohort

## Projects

**Project**:
The one record a proposal, a review, a listing entry and an archived project all are.
A project has exactly one status at a time, at most one proposer, and runs in a
set of programs: zero, one or many, since one proposal can be offered under two
courses at once.
_Avoid_: idea, listing, posting, capstone (on its own)

**Proposal**:
A project as its proposer sees it before it is published. The same record, not a
second one; the word names a stage of the project's life, not a thing.
_Avoid_: submission (except for the act of submitting), application, pitch

**Status**:
Where a project is in its review. Exactly one of the six below, spelled as the code
spells it. A full team and a soft delete are not statuses.

- **Draft**: written and not yet handed to staff. Visible to its proposer and staff.
- **Submitted**: handed to staff for review. The only status that mails the review
  inbox.
- **Changes requested**: staff sent it back with a note; the proposer edits and
  resubmits.
- **Approved**: accepted by staff and not yet published. Nobody but staff and the
  proposer sees it.
- **Published**: in the public catalog.
- **Archived**: out of the catalog's default view, still public by URL, and
  reachable through the archived-only filter. Staff may republish it.

_Avoid_: pending (for submitted), in review, rejected (there is no rejected status;
a project goes back to changes requested or to draft), active, live (for
published), closed (for archived; see below), any abbreviation of a label such as
"changes req."

**Transition**:
A change of a project's status by a person with the right to make it. The proposer
may submit and withdraw; staff may move a project between any two statuses the rules
join. Every transition writes status history and may carry a comment.
_Avoid_: state change, promotion, move

**Status history**:
The record of every transition a project has had, with who made it and when. Visible
to staff and the proposer only.
_Avoid_: audit log, timeline (as a term; the UI may call it that)

**Team is full**:
A published project with no room left on its team. It stays in the catalog, marked
"Team is full" on its card, page and the Badges column of table view, and the
public listing hides it by default; the "are looking for team members" switch is
what shows it. A flag on the project, edited by staff alone from the staff
panel's Programs and teams section, orthogonal to status.

The app never records who would join, only whether there is room: bidding and
assignment happen outside it, which is why there is no word here for the student on
the other side of the flag.

The stored column keeps its old name, `projects.accepting_applicants`, as do the
`acceptingApplicants` field on every wire schema and the `acceptingOnly` search
param. It is stored as the inverse of what the badge says, and it defaults to true.
Renaming it would cost a migration and break pasted links without buying a reader
anything, so the code's word and the reader's word differ here on purpose.
_Avoid_: applicant, applicants, accepting applicants, closed to applicants,
archived (a full project is still published), inactive

**Soft delete**:
Hiding a non-draft project from everyone but staff while keeping its row, so staff
can restore it. A draft is hard-deleted instead: it has nothing to keep.
_Avoid_: archive (that is a status), trash, remove

**Comment**:
A message on a project's review, threaded. Staff and the proposer see the thread;
the public never does.
_Avoid_: reply (that is a comment with a parent), note, message

**Internal comment**:
A comment only staff can see. A reply to an internal comment is always internal;
staff may leave an internal reply under a comment the proposer can see.
_Avoid_: private comment, staff-only comment, hidden comment

**Review**:
What staff do to a submitted project: read it, comment, and transition it. Also
the name of the AI-assisted pass a proposer can run on the form, which is a review
of the writing, not a staff decision.
_Avoid_: approval (one outcome of a review), moderation, evaluation

**Scope assessment**:
A staff-only, AI-generated verdict on whether a project is sized for its program,
never shown to the proposer. It goes stale, rather than being redone, when the text
or the program's term count changes.
_Avoid_: sizing, feasibility, review (it is not one)

**Student proposed**:
A project that a student proposed rather than an industry partner or faculty member.
Marked by staff in the Proposer section of the staff panel, saved with the proposer
link; shown publicly as a badge on the card, the project page and the Badges
column of table view, and as a filter on the listing. Says nothing about
mentorship: a student-proposed project may or may not have a mentor recorded,
and one without is the staff to-do.
_Avoid_: student project, student-led, self-proposed, student team managed

**Requires an NDA or IP agreement**:
A project whose partner asks the team to sign a non-disclosure or intellectual
property agreement before work starts. A public flag set by the proposer or staff on
the project form, with optional notes beside it; shown as the badge "NDA/IP required"
on the card, the project page and the Badges column of table view, and offered as
the listing filter "Requiring an NDA or IP agreement" on both listings.
_Avoid_: confidential, restricted, proprietary project

**Mentorship**:
The link between a project and its mentor: a recorded address and the name it
resolves to, granting no permission over the project. Nothing else: no state beside
the address, no "seeking" mark and no "no mentor needed" mark, so a project either has
an address on file or it does not, and an instructor who runs a team without an
outside mentor records their own. Staff set the address from the Mentor section of
the staff panel; the public sees nothing about the mentor, name included. Saving a
new address emails it, and staff can skip that email from the confirm the save opens.
A person whose account address matches the recorded one sees those projects under
Mentoring on My Projects, and nothing more. "Without a mentor" is the staff listing's
switch for no address on file, and with "Student proposed" it is the to-do the
mentors page is matched against.
_Avoid_: assignment, sponsorship, seeking mentor, no mentor needed, unmentored,
needs mentor, mentor state

**Teams supported**:
How many student teams a project can take on, one to five. Set by staff.
_Avoid_: capacity, slots, team count (that is the mentor's number)

**Bookmark**:
A project a signed-in user has saved to come back to. Private to that user.
_Avoid_: shortlist, favourite, save, star, watch

**Interests**:
A user's private, free-text statement of what they want to work on, which drives the
"recommended for you" sort of the catalog. Never leaves the server and never reaches
staff.
_Avoid_: profile text, bio, preferences, skills

**Recommendation**:
The catalog ordered by how close each published project is to the viewer's
interests. A sort, not a separate list, and unavailable until the viewer has written
interests and those interests have embedded. It is also where the listing lands for
a viewer who has a vector and has not chosen an order, so writing interests is what
turns it on rather than picking it each visit.
_Avoid_: suggestion, match, personalization

**Staff inbox**:
The one staff mailbox every email addressed to staff goes to, set by
`EMAIL_STAFF_INBOX`: a project submitted or resubmitted, a borrow list or custom
request submitted, and a comment from a proposer. Never fanned out per staff member
(ADR-0019). Every other staff signal is an in-app count.
_Avoid_: review inbox (its old name), admin email, notifications address

**Proposer email**:
The address a project was proposed for, kept so the project can link to that
person's account once one exists at the address. Staff-only; not the public contact
address. Saving a new one emails it and writes the new proposer's notification;
staff can skip the email from the confirm the save opens.
_Avoid_: contact email (a separate, public, hand-typed field), owner email

**Claim**:
A project linking itself to a newly verified account at its proposer email. Only a
verified address claims; registering alone never does.
_Avoid_: link (the resulting state, not the act), transfer, adopt

## Both domains

**Visibility**:
Who may see what: the public, staff, the proposer, or the viewer whose own rows
they are. Decided per field and per row, never per page: a page shows a viewer what
the rules let that viewer see, at one URL for everyone.
_Avoid_: permissions (that is who may act), access level (the code's name for what
an endpoint requires), privacy

**Category**:
A tag from a fixed list that classifies a project or an item. Every category belongs
to one domain, project or inventory, for life. Project categories also carry a type,
a free-text facet such as technology or industry that groups them in the picker;
inventory categories are flat. Staff manage categories. Filtering by several
categories means all of them, not any.
_Avoid_: tag, label (that is an inventory field), topic, keyword, facet (that is
the type, not the category)

**Private notes**:
Free text on a project that only staff and the proposer can read or write; the
proposer writes it on the submission page. The same name and rule serve an item,
for locker codes and storage quirks, except that an item has no proposer, so there
they are staff-only.
_Avoid_: notes (unqualified), internal notes, staff notes, comments

**Edit log**:
The record of every edit to a project or an item: which fields changed, from what,
to what, by whom. Staff-only, in both domains.
_Avoid_: history (that is status history), changelog, audit trail

**Notification**:
An in-app message to one user, rendered by the bell. Projects notify the proposer of
transitions, deletions, comments and reassignment; inventory notifies requesters and
holders. Some events also go by email, to the same person or to the staff inbox; the
table in PRD section 13 says which, and every email is mandatory for its recipient
(ADR-0019). An email is not a notification: the word here means the bell row.
_Avoid_: alert, push, email (for an in-app row), message

## Inventory

**Item**:
One physical thing the department lends: a board, a sensor, a kit. It has exactly
one status, at most one hold, and any number of inventory categories.
_Avoid_: equipment (the collective noun is fine; an item is one thing), asset,
product, part, device

**Item status**:
Where an item is in its lending life. Exactly one of the six below, spelled as the
code spells it.

- **Available**: on the shelf and requestable.
- **Requested**: on a submitted borrow list and awaiting staff. The requester is
  already recorded as its holder, so a request is always on a person.
- **Reserved**: approved and waiting to be picked up by its pickup deadline.
- **Checked out**: collected and out, due back by its due date.
- **Maintenance**: withdrawn from lending until staff move it on.
- **Retired**: out of the inventory for good, kept for its history. The archive,
  and staff-only.

_Avoid_: in stock (for available), pending (for requested; that is a line status),
on loan, borrowed, lent (for checked out), out of service (for maintenance),
deleted, archived (for retired)

**Borrow list**:
The items a signed-in user has gathered and not yet submitted as a request. One per
user; submitting it empties it. The code calls it a cart, and every user-facing
string calls it a borrow list.
_Avoid_: cart, basket, wishlist, bag

**Request**:
A borrow list, submitted. One envelope with an optional note, holding one request
line per item that was still available when it was submitted.
_Avoid_: order, booking, reservation (that is a status), checkout

**Request line**:
One item within one request, with its own status, deadlines, reviewer and closing
reason. Staff decide lines, not requests. The code's tables and columns say request
item; the types and the prose say line.
_Avoid_: request item (outside the column names), line item, entry

**Line status**:
Where a request line is. Exactly one of the five below.

- **Pending**: awaiting a staff decision.
- **Approved**: granted; the item is reserved or checked out for it.
- **Rejected**: refused by staff, with a reason the requester sees.
- **Cancelled**: withdrawn by the requester, or released by staff without a
  return.
- **Returned**: the item came back from a checkout.

_Avoid_: declined, denied (for rejected), closed (that is any of the last three),
done, complete, fulfilled (for a request line; it is the custom line's own status)

**Requester**:
The user who submitted the request a line belongs to. Accountable for the request
whether or not they are the one carrying the item.
_Avoid_: borrower (ambiguous between requester and holder), user, student

**Hold**:
Who or what an item that is requested, reserved or checked out is with, or is for.
A hold is on a person or on a thing, never both and never neither. A hold can exist
without a request line: staff can reserve or check out an item nobody carted.
_Avoid_: assignment, loan, allocation, booking

**Holder**:
The person or thing a hold is on. A person holder is an account, or a walk-in when
the address matched none; a thing holder is a label.
_Avoid_: borrower, owner, custodian, assignee

**Address hold**:
A hold assigned to an email address. Resolves to the account at that address when
one exists, and records a typed name and program when none does. An address that
later gets an account is linked at the next transition that keeps the hold.
_Avoid_: email hold, user hold, manual hold

**Walk-in**:
A person holder with no account: an address, plus the name and program staff typed
at the counter. Identified by the address.
_Avoid_: guest, anonymous holder, external

**Label hold**:
A hold on a thing rather than a person, named by a free-text label such as a room or
a bench. Notifies nobody.
_Avoid_: location hold, place, thing (the code's discriminator, not a term)

**Collector**:
The person holding an item that someone else requested, because a teammate came to
pick it up. The request keeps its requester; the hold names the collector; both are
notified about it.
_Avoid_: pickup person, teammate (as a term), holder (when the distinction from the
requester matters)

**Pickup deadline**:
When a reserved item must be collected by. Set by staff on approval, kept on the
item for the current hold and on the line for the request. Informational: nothing
happens when it passes except that the item becomes overdue.
_Avoid_: pickup date, expiry, reservation deadline

**Due date**:
When a checked-out item must be returned by. Same shape as the pickup deadline, on
the other side of collection.
_Avoid_: return date, deadline (unqualified), due by

**Overdue**:
A reserved item past its pickup deadline, or a checked-out item past its due date.
Derived from the dates whenever someone looks, never stored, and the one thing that
raises an overdue notification.
_Avoid_: late, expired, past due, delinquent

**Release**:
A transition that takes an item out of a hold, to available, maintenance or
retired, closing whatever line it was held for as returned, cancelled or rejected.
_Avoid_: return (one kind of release), free, check in, unassign

**Retire**:
The transition that takes an item out of the inventory for good. The only way to
remove an item that has ever been requested; a hard delete is reserved for an item
with no request history.
_Avoid_: delete, archive, decommission, remove

**Transition** (inventory):
A change of an item's status, with the hold, deadlines and line decision that go
with it. Staff make transitions; a user makes the two under Self-service and no
other.
_Avoid_: status change, update, move

**Self-service**:
The two transitions a user may make on their own behalf, submitting a borrow list
and cancelling their own line. Everything else is staff.
_Avoid_: user action, student transition

**Label** (inventory field):
The tag physically on an item, such as an asset sticker. Staff-only, along with the
serial and the location. Not the label of a label hold.
_Avoid_: tag, sticker, asset id

**Item history**:
The record of every transition an item has had: status, holder, deadlines, who made
it, and the line it was about. Staff read it on the item page; it is how a
collector is told apart from a requester after the return clears the hold.
_Avoid_: status log, audit log, history (unqualified)

**Request queue**:
The staff page listing pending lines of both kinds, grouped by the request they
arrived in, with approve and reject on a request line and start sourcing, fulfil
and reject on a custom line. The count of requests with a pending line is what the
admin overview turns into an alert.
_Avoid_: inbox, approvals, pending requests (as a name)

**Custom request**:
An ask for equipment the inventory does not hold. One envelope with an optional
note, holding one custom line per thing asked for. Visible to its requester and to
staff, never to anyone else. It reuses the request's envelope table, and an
envelope holds one kind of line, never both.
_Avoid_: wishlist, purchase order, acquisition, suggestion

**Custom line**:
One thing within one custom request, with its own status, a sourcing note, an
outcome note, and the items it eventually produced. Staff decide lines, not
requests, the same way they do for a borrow list. Nothing on a submitted line is
editable; a requester who got it wrong cancels it and files another.
_Avoid_: wanted item, custom item, wish

**Custom line status**:
Where a custom line is. Exactly one of the five below.

- **Pending**: awaiting a staff decision.
- **Sourcing**: staff accepted it and are getting it. Nothing physical exists yet.
- **Fulfilled**: the thing now exists and is linked to the line. Terminal.
- **Rejected**: refused by staff, with a reason the requester sees.
- **Cancelled**: withdrawn by the requester.

_Avoid_: approved (that hands over a physical thing, which a custom line has none
of), ordered, on order, delivered, done, returned (a custom line never lends)
