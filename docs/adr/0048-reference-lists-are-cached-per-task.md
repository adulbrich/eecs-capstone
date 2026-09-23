# The public category and program lists are cached per task, for a minute

`listCategoriesImpl` and `listProgramsImpl` keep their result in process for
`REFERENCE_LIST_CACHE_TTL_MS`, 60 seconds in production, and a staff write
through the `*As` functions clears the cache only on the task that handled it.
The #524 load test found the connection pool, not CPU, is what fails under a
term start burst (#558), and the project listing's loader reads these two small
tables beside the search on every visit, so two of the loader's three database reads were for
rows that change a few times a term. Caching
them removes those two reads per render whether the loader's three server
functions run in process during SSR or arrive as three RPCs on a client
navigation. The cache holds the promise rather than the rows, so a cold burst
on one task shares one query. The cost is staleness across tasks: a category or
program edited on one task can be missing or out of date on the others for up
to a minute, and the editor sees it at once only when their next request lands
on the same task. That is accepted because both tables are staff-edited,
rarely, and a minute's delay on a filter option harms nobody, while the
alternative that removes it, invalidation shared across tasks, needs a channel
the fleet does not have (a table to poll or a pub/sub), which would itself cost
connections. Longer TTLs were not taken because the gain past a minute is
small; at 60 seconds a task reads each list at most once a minute, a rounding
error beside the listing's own search. Chosen by the maintainer on 2026-09-22.

## Consequences

The TTL is off unless the variable is set, and only `infra/ecs.tf` sets it. The
E2E and accessibility suites insert categories and programs straight into the
database behind a running server, the same "other task" case the trade accepts,
and would read a stale list; turning the cache on for them would need a way to
clear another process's memory, which is the thing this decision declines to
build. The integration suite turns it on, so a lister test that writes through
a `*As` function and then lists also tests that the write cleared the cache.
Every new writer to `categories` or `programs` must clear the matching cache;
`docs/QUIRKS.md` says so where the next writer will look. A one-off script that
edits either table in production, such as `scripts/import-legacy.mjs`, takes up
to a minute to show.
