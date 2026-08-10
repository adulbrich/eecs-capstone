# Delete user script

An operator tool for removing a test account and its content from production,
run as a one-off ECS task. Not the admin UI feature from the README roadmap.

## Goal

1. Remove a test account created in production, along with the projects and
   inventory requests it made, in a way that leaves the rest of the data
   coherent.
2. Refuse, with a report naming what stopped it, whenever the account acted on
   records it does not own. That case means the account touched real data and a
   purge is the wrong tool.
3. Report before it writes. The default run is a dry run.
4. Correct the FK-rules table in `docs/QUIRKS.md`, which is wrong in three ways
   and is the table anyone reasoning about deletion will read.

## Context

### Why not the admin UI feature

`README.md` carries a roadmap item for admin-only user deletion behind a
confirmation modal. That is a different operation and it stays on the roadmap.

A real user's content must survive them: nine of the ten `ON DELETE RESTRICT`
edges into `user.id` are authorship or audit records, and the reason they are
`RESTRICT` is that project history must outlive the person. So the UI feature
has to anonymize rather than purge, which does not clean up a test account: the
test projects stay in the listing and the account becomes a tombstone.

A test account's content is garbage and the operator wants it gone. That is a
purge, it is destructive, and it belongs in a script an operator runs
deliberately rather than a button in the app.

The root cause is separately on the roadmap: a preview deployment stops test
accounts reaching production at all.

### Why a script, and why plain `pg`

RDS is not publicly accessible (`DEPLOYMENT.md` section 3), so the database is
reachable only from inside the VPC. `scripts/promote-admin.mjs` established the
pattern: a `.mjs` script using nothing but the production `pg` dependency, run
as a one-off Fargate task that reuses the running service's task definition and
network configuration.

The script cannot import anything under `src/`. The container image carries the
built server, not TypeScript, so the logic lives in the `.mjs` file itself.

### What the schema already decides

Deleting the `user` row cascades `session`, `account`, `notifications`,
`user_interests`, `project_bookmarks`, `inventory_cart_items`,
`project_collaborators`, and `program_instructors`. Deleting a project cascades
its categories, collaborators, comments, status history, edit log, and
bookmarks.

Two columns are `ON DELETE SET NULL` and need thought rather than acceptance:

- `projects.proposer_id` nulls out while `proposer_email` survives. This script
  deletes the account's own projects outright, so the case does not arise for
  them.
- `inventory_items.current_holder_id` nulls out. This one is a trap: an item
  the account has checked out would stay in `checked_out` with no holder, and
  nothing in the app can return it from there.

## Design

### `scripts/delete-user.mjs`

Inputs, all environment variables, with the email also accepted as the first
CLI argument:

| Variable | Meaning |
| --- | --- |
| `TARGET_EMAIL` | One address, or several separated by commas. Matched case-insensitively. |
| `CONFIRM` | Must be exactly `DELETE` to write anything. Absent means dry run. |
| `ALLOW_ADMIN` | Must be `1` to act on an account whose role is `admin`. |
| `DATABASE_URL` | As every other script. |

The dry run default is the confirmation step. The operator runs the task, reads
the report in CloudWatch, and runs it again with `CONFIRM=DELETE`.

Two exported functions and a CLI entry guarded by `import.meta.main`, so the
functions are reachable from an integration test. `.nvmrc` pins Node 24.16.0
and `import.meta.main` landed in 24.2.0.

```
inspectUser(db, email) -> { user, blockers, willDelete }
purgeUser(db, email)   -> { deleted: true, ... } | { deleted: false, blockers }
```

`db` is anything with a `query(text, params)` method, which both `pg.Pool` and
a pooled client satisfy.

### Blockers

`purgeUser` refuses when any of these is non-zero, and names each with its
count. "Their project" means a project whose `proposer_id` is the target.

| Check | Why it blocks |
| --- | --- |
| `project_comments` authored on a project that is not theirs | Removing them edits another person's thread |
| `project_status_history.changed_by` on a project that is not theirs | They reviewed real work |
| `project_edit_log.editor_id` on a project that is not theirs | They edited real work |
| Any `inventory_item_status_history.changed_by` row | Items are never user-owned, so every such row is an action on shared data |
| Any `inventory_item_edit_log.editor_id` row | Same |
| `projects.program_manager_id` on a project that is not theirs | `RESTRICT`, and a real assignment |
| Any `project_bids` or `project_assignments` row naming them, in any column | `RESTRICT`, and neither table has a UI to clean up through |
| Bids or assignments by anyone on one of their projects | Would block deleting that project |
| Any inventory item whose `current_holder_id` is them | Deleting would strand the item with no holder |

An account whose role is `admin` also refuses unless `ALLOW_ADMIN=1`.

### What a clean purge deletes

One transaction per account, in this order:

1. `projects` where `proposer_id` is the target.
2. `inventory_requests` where `user_id` is the target.
3. The `user` row.

Everything else goes by cascade. The dry run lists the projects by title and
status so a published one is visible before the operator confirms, and reports
the counts that will cascade.

### Exit codes and multiple accounts

Each address is inspected and purged independently, in its own transaction, so
one blocked account does not stop the others. Exit code is 1 if any address was
blocked or matched no account, 0 otherwise.

## Testing

`src/server/__tests__/delete-user-script.integration.test.ts` imports the
`.mjs` and runs against the integration Postgres, which the vitest integration
config already provides. It covers:

- Each blocker in isolation refuses, and names that relation.
- A clean account purges: its projects, inventory requests, bookmarks,
  notifications, sessions, and accounts are gone, and another user's project is
  untouched.
- A dry run writes nothing.
- An unknown address reports not found rather than throwing.
- An admin target refuses without `ALLOW_ADMIN`, and purges with it.

## Documentation

`DEPLOYMENT.md` gains a runbook subsection beside the `promote-admin` one, with
the `run-task` invocation for both the dry run and the confirmed run.

`docs/QUIRKS.md`'s FK-rules table is corrected in its own commit. It currently
lists four `RESTRICT` columns where the schema has ten, lists
`inventory_requests.reviewed_by` which is not a column (`reviewed_by` and
`closed_by` are on `inventory_request_items`, both `SET NULL`), and omits
`inventory_items.current_holder_id`.

`README.md` is unchanged. The admin delete-user roadmap item stands.
