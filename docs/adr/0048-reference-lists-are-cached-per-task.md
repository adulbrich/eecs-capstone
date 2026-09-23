# The listing's filter options are cached per task, for a minute

The project listing's loader reads its category and program filter options
through one server function, `listProjectFilterOptions`, which keeps the result
in process for `REFERENCE_LIST_CACHE_TTL_MS`, 60 seconds in production. A staff
write through the category or program `*As` functions clears the cache only on
the task that handled it. The #524 load test found the connection pool, not
CPU, is what fails under a term start burst (#558), and the loader read these
two small tables beside the search on every visit, so two of its three database
reads were for rows that change a few times a term. The cache removes both
whether the loader runs in process during SSR or as RPCs on a client
navigation, and it holds the promise rather than the rows, so a cold burst on
one task shares one read. The cost is staleness across tasks: a category or
program edited on one task can be missing or out of date in the listing's
filters on the others for up to a minute. That is accepted because a minute's
delay on a filter option harms nobody, while the alternative that removes it,
invalidation shared across tasks, needs a channel the fleet does not have (a
table to poll or a pub/sub), which would itself cost connections. The cache
sits in front of the listing and nowhere else. It was first placed inside
`listCategoriesImpl` and `listProgramsImpl`, which also serve the staff
pickers, and review found that a category created from a project form then
refetched on another task, came back without the new row, and left the picker
showing no box for an id the form would still save; staleness in an edit form
is a defect, not a trade. The listing-only read has one key, so no caller can
grow it. Chosen by the maintainer on 2026-09-22.

## Consequences

The TTL is off unless the variable is set, and only `infra/ecs.tf` sets it, so
it reaches production through `terraform apply` followed by a deploy; the
deploy workflow copies the latest task definition, and a deploy alone leaves
the cache off without any error. The
E2E and accessibility suites insert categories and programs straight into the
database behind a running server, the same "other task" case the trade accepts,
and would read a stale listing; turning the cache on for them would need a way
to clear another process's memory, which is the thing this decision declines
to build. The integration suite turns it on, and `resetDatabase()` clears it.
Every new writer to `categories` or `programs` must call
`clearAllReferenceListCaches()`. A one-off script that edits either table in
production, such as `scripts/import-legacy.mjs`, takes up to a minute to show
in the listing's filters.
