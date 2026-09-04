# Deleting an account anonymizes the row; the schema decides what else goes

Nine `onDelete: "restrict"` edges into `user.id` (comments, status history, edit logs, request lines, bids, assignments) are audit records the row exists to anchor, so an account is never hard-deleted. The row stays with `deleted_at` set and every personal column scrubbed, and what else goes is exactly what a real `DELETE` would have cascaded, read off the schema: every table whose foreign key into `user.id` says `cascade` is deleted by user id, and a test pins that list against the schema files so a new cascade edge without a matching delete is red. `set null` edges keep pointing at the row on purpose. Sessions and credentials go, which is what makes a later sign-in at the same address a fresh user; the scrubbed email is what frees the address for it.

## Consequences

`/privacy` promises exactly this, so the policy copy and the deletion dialog move together. Deletion is refused while the person holds an item or has an approved request, and for the only admin. A ban is the tool for a real user who has to go.
