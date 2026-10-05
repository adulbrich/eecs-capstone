# The role vocabulary lives with the statuses, not beside the staff predicate

`USER_ROLES` lives in `src/lib/vocabularies.ts` beside the status tuples (ADR-0014), not next to `STAFF_ROLES` in `src/lib/viewer.ts`, so `vocabulary-scan.ts` checks it without learning a second file; `user.role` is Better Auth's `text` column, so the tuple is a role's only anchor. `STAFF_ROLES` and the role names in `admin()` are held to it with `satisfies` rather than derived, so a new role never becomes staff by arriving.
