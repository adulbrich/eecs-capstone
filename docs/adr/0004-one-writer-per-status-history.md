# `transitionItem` is the only inventory writer; `commitTransition` the only project status writer

Every inventory status change goes through `transitionItem` in `src/server/_internal/inventory-transitions.ts`: it is the only writer of `inventory_item_status_history` and the only thing that syncs the `current_holder_*` columns with the status. Approve, reject, cancel and submit all route through it, passing what is theirs (who may act, which line, which outcome) as `authority` and `lineDecision`. The rule earned its shape: an earlier exemption for reject and cancel meant two new hold columns were added and only two of four writers learned about them.

Projects make the narrower claim on purpose. `commitTransition` in `src/server/_internal/projects.ts` is the only writer of `project_status_history` and owns the ordering that matters: notifications inside the transaction, the embedding refresh strictly after commit (called inside, it silently skips), the email strictly after commit so a failed send cannot undo an approval. `projects.status` itself has several legitimate non-transition writers, and soft delete and restore are outside the rule because they are not transitions.

## Consequences

Both counts are checkable by grep, and the grep is the invariant rather than the file names, which have moved once already. The dev seed drives the real write path for the same reason: a second writer that disagreed quietly produced holds with no deadlines, lines, history or notifications.
