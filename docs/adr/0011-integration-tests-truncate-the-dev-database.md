# Integration tests run against the dev database and truncate it

The integration suite uses the same `DATABASE_URL` as development and truncates every table before each test, so `npm run test:integration` deletes dev data and `npm run db:seed:dev` puts it back. The alternative, a dedicated `eecs_capstone_test` database behind a `TEST_DATABASE_URL`, is the intended end state and is not built; until it is, one database is the trade the repo has accepted for a suite that needs no second container and no second migration run.

## Consequences

Reseed after an integration run before a browser suite, and apply a new migration before the suite passes. The smoke and accessibility suites share the same database locally and sweep their own rows by prefix.
