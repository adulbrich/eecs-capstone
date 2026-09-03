/**
 * Report, and on request null, image_url values this app did not mint.
 *
 * `assertOwnedKey` guards a change to image_url, not what a row already
 * holds, so a row written before the upload flow existed (the dev seed writes
 * Unsplash links) or before #162 (any URL at all) keeps its value and keeps
 * rendering it. Nothing in the column tells a working image somebody chose
 * from a planted third-party URL, so this script never classifies: the
 * default run prints every such row in full for a person to read, and a
 * second run nulls exactly the ids that person names.
 *
 *   ... run-task ... --overrides '{"containerOverrides":[{
 *     "name":"app",
 *     "command":["node","scripts/image-url-legacy.mjs"]
 *   }]}'
 *
 * then, for the rows to clear,
 *
 *     "environment":[{"name":"CONFIRM","value":"NULL"},
 *                    {"name":"TARGET_IDS","value":"<id>,<id>"}]
 *
 * No flag nulls everything, and an id that is not in the report is refused.
 *
 * Uses nothing but the production `pg` dependency, like promote-admin.mjs: the
 * container image carries the built server, not TypeScript, so nothing under
 * src/ is importable here. The ownership test below therefore restates
 * `KeySpace.owns` from src/lib/_internal/storage.ts as SQL, and the
 * integration test asserts the two agree on every row it seeds.
 */
import pg from "pg";

/**
 * A key this app minted: the row's own prefix, then one plain filename with
 * one dot. The same shape `OWNED_FILENAME` accepts in storage.ts, as a
 * Postgres regex. A bare prefix match would call `projects/<id>/../x.webp`
 * owned, and `owns` does not.
 */
const TABLES = [
  { table: "projects", prefix: "projects" },
  { table: "inventory_items", prefix: "inventory" },
];

function ownedPattern(prefix) {
  return `'^${prefix}/' || id::text || '/[A-Za-z0-9_-]+\\.[A-Za-z0-9]+$'`;
}

/**
 * Every row whose image_url is set and is not a key the row owns. Writes
 * nothing.
 */
export async function findLegacyImageUrls(db) {
  const rows = [];
  for (const { table, prefix } of TABLES) {
    const result = await db.query(
      `SELECT id, image_url
         FROM ${table}
        WHERE image_url IS NOT NULL
          AND image_url <> ''
          AND image_url !~ (${ownedPattern(prefix)})
        ORDER BY created_at, id`
    );
    for (const row of result.rows) {
      rows.push({ table, id: row.id, imageUrl: row.image_url });
    }
  }
  return rows;
}

/**
 * Null image_url on exactly the named rows, and only where the report would
 * have listed them: an id that names a healthy row, or nothing, is returned
 * as `refused` and left alone. One transaction, so the report and the writes
 * see the same rows.
 */
export async function nullImageUrls(pool, ids) {
  const wanted = new Set(ids);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const legacy = await findLegacyImageUrls(client);
    const nulled = legacy.filter((row) => wanted.has(row.id));
    const found = new Set(nulled.map((row) => row.id));
    const refused = ids.filter((id) => !found.has(id));
    for (const row of nulled) {
      await client.query(
        `UPDATE ${row.table} SET image_url = NULL, updated_at = now() WHERE id = $1`,
        [row.id]
      );
    }
    await client.query("COMMIT");
    return { nulled, refused };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function formatRow(row) {
  return `${row.table} ${row.id} ${row.imageUrl}`;
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL environment variable is not set");
  }
  const confirm = process.env.CONFIRM === "NULL";
  const ids = (process.env.TARGET_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (confirm && ids.length === 0) {
    throw new Error("CONFIRM=NULL needs TARGET_IDS, a comma-separated list of ids from the report");
  }
  if (!confirm && ids.length > 0) {
    throw new Error("TARGET_IDS does nothing without CONFIRM=NULL; run once without either to read the report");
  }

  const pool = new pg.Pool({ connectionString });
  let failed = false;
  try {
    if (confirm) {
      const { nulled, refused } = await nullImageUrls(pool, ids);
      console.log(`CONFIRM=NULL. Nulled ${nulled.length} image_url value${nulled.length === 1 ? "" : "s"}.`);
      for (const row of nulled) {
        console.log(`  ${formatRow(row)}`);
      }
      if (refused.length > 0) {
        failed = true;
        console.log(`Refused ${refused.length}, not in the report: ${refused.join(", ")}`);
      }
    } else {
      const rows = await findLegacyImageUrls(pool);
      console.log(`REPORT. Nothing written. ${rows.length} row${rows.length === 1 ? "" : "s"} hold an image_url this app did not mint.`);
      for (const row of rows) {
        console.log(`  ${formatRow(row)}`);
      }
      if (rows.length > 0) {
        console.log("Read each value. A stock photo somebody chose is a working image; a URL nobody recognises is what #162 is about. Run again with CONFIRM=NULL and TARGET_IDS=<id>,<id> to clear the ones that should go.");
      }
    }
  } finally {
    await pool.end();
  }

  if (failed) {
    process.exit(1);
  }
}

if (import.meta.main) {
  await main();
}
