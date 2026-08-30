/**
 * Deletes the rows the end-to-end suite leaves behind, without running it.
 *
 * `sweepOrphans` runs at the start of an end-to-end run, which is what makes a
 * retry meaningful but also means the database is dirty for whatever runs next.
 * Locally the accessibility suite is usually what runs next, and it goes red on
 * those leftovers rather than on anything accessible: see the "smoke and
 * accessibility suites share one local database" entry in `docs/QUIRKS.md`.
 *
 * `db:seed:dev` is not an alternative. It creates and updates rows; it removes
 * nothing, so the leftovers survive it.
 */
import { openDb, sweepOrphans } from "../src/test/e2e/fixtures";

const { db, close } = openDb();
try {
  await sweepOrphans(db);
  console.log("swept E2E- rows, notifications, accounts and avatars");
} finally {
  await close();
}
