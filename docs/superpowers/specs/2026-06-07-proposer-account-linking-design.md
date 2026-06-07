# Proposer Account Linking by Email

Date: 2026-06-07
Status: Approved design, ready for implementation planning

## Summary

Today a project's proposer is always the account that created it: `projects.proposerId`
is `NOT NULL`, an FK to `user.id`, and is hardcoded to the current user in
`createProjectAs`. Staff cannot reassign a proposer, and a project cannot exist without a
real account behind it.

This change decouples "who proposed a project" from "who has an account yet." A project
gains an optional proposer email that serves as the link key, while `proposerId` becomes
nullable and remains the canonical foreign key once an account exists. Staff can search
for and attach an existing account on the project edit form, or leave the proposer
unlinked and enter contact details by hand. When a person later signs in with an email
that matches an unlinked project's proposer email, the project back-links to their
account automatically.

This is split into two phases. Phase A (this design) is fully buildable and testable now:
the schema groundwork, the null-safety sweep, the staff user-search, the manual-contact
path, and the public-visibility note. Phase B wires the OSU ONID provider and the live
auto-link; it is sketched in "Future work" and is out of scope for this release because
ONID is not yet configured (auth currently offers only GitHub and email/password).

## Goals

- Let staff attach a project's proposer to an existing account by searching for the user.
- Let a project keep manually entered contact details when no account exists, with the
  proposer left blank.
- Store a proposer email as a stable reconciliation key so projects imported from the
  previous system, or created before the person has an account, can be back-linked later.
- Tell proposers, on the form, that contact information is publicly visible, so they can
  choose to leave it blank.
- Change nothing about the public-facing behavior of already-linked projects.

## Non-goals (out of scope for this release)

- The OSU ONID OIDC provider, `account.accountLinking` configuration, and live sign-in
  auto-link. These land in Phase B.
- Self-service proposer reassignment by non-staff. Only staff may set or change the
  proposer link.
- A bulk legacy-import runner. The schema and back-fill logic are designed to support it,
  but the import script itself is Phase B.
- Auto-populating the public contact email from a linked account (explicitly rejected,
  see Decisions).

## Decisions

- **`proposerId` becomes nullable; email is the link key, the account is canonical.**
  `user.id` is stable and unique; email is mutable and may not yet resolve to an account.
  We store both: `proposerEmail` (the key) and `proposerId` (the canonical link, set once
  the account exists). `user.email` is already `.notNull().unique()`, so an email resolves
  to at most one account.
- **`proposerEmail` is a separate column from the existing public `contactEmail`.** They
  are different concerns: `proposerEmail` is a matching key and need not be public;
  `contactEmail` is opt-in public display. They are never conflated.
- **`proposerEmail` is retained after back-linking** (user decision). Keeping it provides
  an audit trail and allows re-linking if the account is later deleted. It is never shown
  publicly.
- **The public `contactEmail` is always entered manually** (user decision). It is never
  auto-populated from a linked account, so an account email is never published unless
  someone explicitly types it into the contact field.
- **Only staff may set or change the proposer link.** The proposer controls are staff-only
  on the form, mirroring the existing staff-only `notes` field.
- **`onDelete` for `proposerId` moves from `restrict` to `set null`.** With the email key
  retained, a deleted account nulls `proposerId` while `proposerEmail` preserves the
  relationship for re-linking. (Confirm against existing delete flows during planning.)

## Schema changes

`projects` table (`src/db/schema.ts`):

- `proposerId`: drop `.notNull()`, change `onDelete` from `"restrict"` to `"set null"`.
- `proposerEmail`: new `text("proposer_email")`, nullable. Add an index for back-fill
  lookups (`projects_proposer_email_idx`).

A Drizzle migration is generated with `npm run db:generate` and applied with
`npm run db:migrate`. Existing rows keep their `proposerId`; `proposerEmail` is null for
them and can be back-filled from `user.email` in the same migration if desired.

## Null-safety sweep (must land with the nullable change)

A null `proposerId` is safe for the ownership checks, which fail closed: non-staff callers
comparing `proposerId !== viewer.id` are simply denied, and the hard-delete owner check is
null-safe. The one path that breaks is notifications: the helpers in
`src/server/_internal/notify.ts` (`recordStatusChangeNotifications`,
`recordSoftDeleteNotification`) insert into `notifications.userId`, which is a `NOT NULL`
FK to `user.id`. They are called with `proposerId` as the recipient. When `proposerId` is
null they must skip the proposer notification rather than insert a null row. This guard is
mandatory and is covered by an integration test.

## Server functions

- **Staff user-search.** Add a `searchUsers` server function (and its `_internal`
  implementation) gated to staff, not just admin. It accepts a query string and returns a
  small capped list of `{ id, name, email }` matching by email or name (reusing the
  `ilike` pattern already in `listUsersImpl`). The existing `listUsers` stays admin-only
  and untouched.
- **Create/update accept proposer fields (staff-gated).** `projectInputSchema` in
  `src/server/projects.ts` gains optional `proposerId` (uuid/text, nullable) and
  `proposerEmail` (email, nullable). In `createProjectAs` and `updateProjectAs`, these
  are honored only when the viewer is staff (mirroring the `notes` gating); for non-staff,
  `createProjectAs` keeps defaulting `proposerId` to `viewer.id` and ignores any supplied
  proposer fields. `proposerEmail` and `proposerId` are added to the edit field-diff and
  edit-log so staff changes are recorded.
- **Normalization.** When staff set a `proposerEmail` that already matches an account, the
  write resolves and sets `proposerId` at the same time (the create/update path performs
  the same email-to-account lookup the Phase B hook will use, so linking is immediate when
  the account already exists).

## Frontend

- **Proposer picker (staff only).** A combobox at the top of the staff project form lets
  staff type to search accounts (debounced call to `searchUsers`) and select one, which
  sets `proposerId` and shows the selected name/email with a clear/unlink control. Leaving
  it empty means no linked account. This control is rendered under the same condition as
  the existing staff-only `notes` field.
- **Manual contact path.** The existing `contactName` / `contactEmail` fields remain and
  are the fallback when no account is linked. No change to their inputs beyond the note
  below.
- **Public-visibility note.** A muted caption near the contact fields states that contact
  information is publicly visible and may be left blank. This is plain helper text, not a
  new control.
- The non-staff form is unchanged: proposer stays implicit (the creator), and the proposer
  picker is not shown.

## Auth gating

All proposer-mutating paths require an authenticated session and a staff viewer, reusing
the existing `isStaff` check that already guards `notes` and the staff-only transitions.
`searchUsers` requires staff. Non-staff requests that include proposer fields have them
ignored server-side, not honored, so the gate cannot be bypassed by crafting a request.

## Testing

- Integration: staff can set `proposerId` via search; staff can set `proposerEmail` with
  no account and the project persists with a null `proposerId`; a non-staff update that
  includes proposer fields leaves them unchanged.
- Integration: a status transition or soft-delete on a project with a null `proposerId`
  does not throw and writes no proposer notification (the null-safety guard).
- Integration: setting a `proposerEmail` that matches an existing account resolves and
  sets `proposerId` in the same write.
- Unit/component: the proposer combobox renders only for staff, calls `searchUsers`, and
  the public-visibility note renders near the contact fields.

## Future work (Phase B, seams left in place)

- **OSU ONID provider.** Configure ONID as an OIDC provider (Better Auth `genericOAuth`),
  with `account.accountLinking.enabled` and ONID in `trustedProviders`. ONID is an
  institutional, email-verified identity, which is what makes trusted auto-linking safe;
  auto-linking by unverified email would be an account-takeover vector and is not done.
- **Live project back-fill hook.** A Better Auth `databaseHook` on user create/sign-in
  that looks up unlinked projects by `proposerEmail` matching the new account's email and
  sets their `proposerId`. This is the same email-to-account resolution the Phase A
  create/update path already performs, so the logic is shared.
- **Legacy bulk import.** A one-time script that inserts projects from the previous system
  with `proposerEmail` set and `proposerId` null; the hook above then links them as those
  people first sign in with ONID.
