# Self-service account deletion

Date: 2026-09-02
Status: Design approved in chat, implementing on `feat/delete-account`.
Issue: #84. Depends on #91 (merged, the policy the dialog promises) and #75 (merged, the
`mentor_email` column this scrubs). #29 is the admin-executed version and stays parked.

## Summary

A signed-in user closes their own account from `/profile`. Deletion anonymizes the `user`
row in place: nine `onDelete: "restrict"` edges into `user.id` are authorship and audit
records, so the row survives and its contents go. Irreversible and immediate; no grace
window, no soft-delete-then-purge.

## The rule for every other table

`src/db/schema.ts` decides, not a hand-kept list. For each foreign key into `user.id`:

| `onDelete` | What deletion does | Why |
| --- | --- | --- |
| `cascade` | delete the rows | a real DELETE would have taken them; they are the person's own data |
| `restrict` | keep, pointing at the anonymized row | audit and authorship, the reason the row survives |
| `set null` | keep, pointing at the anonymized row | same, and `proposer_id` staying set is what makes projects unclaimable |

Cascade edges today: `session`, `account`, `user_interests`, `program_instructors`,
`project_collaborators`, `project_bookmarks`, `inventory_cart_items`, `notifications`,
`ai_review_usage`. The integration test pins this list against the schema so a new
cascade edge without a matching delete fails the build rather than leaking.

## The `user` row

| Column | Action |
| --- | --- |
| `id`, `created_at`, `updated_at` | keep |
| `name` | `"Deleted user"` |
| `email` | `deleted-<id>@invalid` (RFC 2606, unique, undeliverable) |
| `email_verified` | `false` |
| `image` | `null`, and the S3 object is deleted after the commit |
| `role` | `"user"` |
| `banned`, `ban_reason`, `ban_expires` | `false`, `null`, `null` |
| `affiliation`, `linkedin` | `null` |
| `wants_to_mentor`, `mentor_team_count` | `false`, `1` |
| `deleted_at` | now |

`deleted_at` is a new `timestamp with time zone`, nullable, added to both
`src/db/auth-schema.ts` and `user.additionalFields` in `src/lib/auth.ts` with
`type: "date"`, `required: false`, `input: false`. Migration 0018.

## Projects

- `proposer_id` stays. Attribution reads "Deleted user" for free, and
  `claimProjectsForVerifiedUser` claims only `proposer_id IS NULL`, so a re-registered
  address gets nothing back. Structural, not a promise.
- `proposer_email` is nulled where `proposer_id` is this user: account information.
- `contact_email` and `contact_name` stay: project content the proposer typed to publish.
- `mentor_email` is nulled wherever it matches the user's address, case-insensitively. The
  project reverts to "Seeking mentor" when student-proposed. No notification.

## Inventory

Nothing scrubbed. `inventory_item_status_history` keeps holder email, name and program:
chain of custody for departmental property, and the policy says so. The outstanding-item
precondition means `current_holder_*` is already clear for anyone who reaches the button.

## Preconditions that block

1. An item the user holds (`inventory_items.status` in `reserved`, `checked_out` where
   `current_holder_id` is the user or `current_holder_email` matches their address), or a
   request line of theirs in `approved`. The block names the items and links `/my/items`.
2. The user is the only `admin`.

Being a program instructor does not block; those rows cascade and the dialog names the
programs.

## Server functions, in `src/server/account.ts` with seams in `_internal/account.ts`

- `getAccountDeletionPreview()` returns `{ blockers: { items: {id, name}[]; lastAdmin:
  boolean }, programs: {id, courseId, courseName}[], email }`. Authenticated.
- `deleteAccount({ confirmEmail })`. Authenticated. Re-checks both preconditions,
  requires `confirmEmail` to equal the current address case-insensitively, then in one
  transaction: scrub the row, delete every cascade-edge row, null `proposer_email` and
  matching `mentor_email`. After the commit, `deleteOwnedObject(previousImage,
  avatarKeys(id))`, which logs and never throws: an orphaned object is a sweep problem, a
  half-deleted account is a broken promise.

Both `*As(viewer, ...)` seams take the session user (`id`, `email`, `image`, `role`).

## The dialog

`AlertDialog` built directly, like the inventory hard delete, because `ConfirmDialog` has
no typed gate. Before it acts it states: projects stay published at their URLs; your name
on them becomes "Deleted user"; contact details typed into a project stay; borrowed
equipment records stay; you will be removed from these programs (list, when non-empty);
this cannot be undone, and a new account cannot be linked back to old projects. The
destructive button enables only when the typed email matches. When blocked, the dialog
shows the block instead of the gate. On success: `window.location.href = "/"`; the
sessions are gone, so the cookie is dead.

Lives beside Sign out and the privacy link on `/profile`, in a "Danger zone" section.

## Visibility

Only the account's owner can reach either function; both scope to the session user and
take no id. `deleted_at` is not surfaced anywhere yet; `/admin/users` shows the
anonymized name and address and keeps sorting by `created_at`.

## Tests

Integration, `src/server/__tests__/account.integration.test.ts`:

- every column in the table above, `id` intact, `deleted_at` set
- sessions, accounts, interests, bookmarks, cart, notifications, collaborators, usage rows
  gone; the cascade-edge list matches the schema
- a project by the deleted user still resolves publicly, attributed "Deleted user",
  `proposer_email` null, `contact_*` intact
- `claimProjectsForVerifiedUser` claims nothing for the re-registered address
- `mentor_email` nulled, case-insensitively; a non-matching one untouched
- blocked with a held item; blocked with an approved line; blocked as the last admin;
  not blocked as an instructor, and the instructor rows are gone
- status history untouched
- wrong `confirmEmail` refused, nothing changed
- a failing S3 delete does not abort the deletion (storage mocked to throw)

Unit: the dialog gates on the typed email, lists programs, and shows the block.
