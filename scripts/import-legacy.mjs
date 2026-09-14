/**
 * Production importer for the legacy PHP capstone portal's archived projects.
 *
 * Run as a one-off ECS task, the way `promote-admin.mjs` is:
 *
 *   node scripts/import-legacy.mjs                 # import, or refresh a prior run
 *   node scripts/import-legacy.mjs --undo          # delete exactly the imported rows
 *   node scripts/import-legacy.mjs --skip-existing # add only rows not already imported
 *
 * The only thing that writes the imported rows to the database, and plain
 * `.mjs` so it runs from the production image: that installs with
 * `--omit=dev`, so there is no `tsx`, and it ships `.output` without `src/`,
 * so nothing under `#/lib` or `../src/db` resolves. Only `pg` and
 * `@aws-sdk/client-s3` are used, both production dependencies the server
 * already ships, the way `migrate.mjs` relies on `pg` alone.
 *
 * `scripts/import-legacy-images.ts` is the other half, and the split is by
 * responsibility rather than by runtime: it converts the images on a
 * workstation, reusing the app's own `processImage` and `projectImageKeys`,
 * and writes the `image-keys.json` this reads. Three things are duplicated
 * between them and cannot be imported across the boundary: `NAMESPACE`, the
 * `uuidv5` body, and that filename. `src/test/import-legacy-parity.test.ts`
 * pins all three.
 *
 * Image bytes are NOT handled here. They go to the bucket with `aws s3 sync`
 * from a workstation (see `import-legacy-images.ts` and the runbook in
 * DEPLOYMENT.md); this reads the small `image-keys.json` that step emits and
 * sets `image_url` from it.
 *
 * Inputs: `archived-projects-clean.jsonl` and, optionally, `image-keys.json`.
 *
 * They are read at runtime from a PRIVATE S3 prefix named by
 * `LEGACY_DATA_S3_URI` (for example `s3://eecs-capstone-ops/legacy/`), using
 * the task role. They are deliberately NOT committed and NOT baked into the
 * image: the JSONL names 299 real proposers and their email addresses, and
 * this repo is public and mirrors to GitLab. The prefix must not be the
 * app's asset bucket either, whose policy grants `s3:GetObject` to `*`.
 *
 * `LEGACY_DATA_DIR` reads the same two files from a local directory instead,
 * which is what a local dry run against a tunnelled database uses.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import pg from "pg";

/**
 * MUST match `NAMESPACE` in `scripts/import-legacy-images.ts` exactly. Every row's
 * primary key is derived from it, so a different value here re-keys all 547
 * rows and orphans everything a previous run wrote, including the image
 * objects already in the bucket.
 */
const NAMESPACE = "6f2a1c84-0d3e-4b57-9a6f-1e8c5d40b213";

/**
 * The archived set by default. Overridable because the same pipeline brings
 * across the projects still live in the old portal: that export goes to a
 * different filename so the two sets stay separable, and each row's
 * `target_status` already says where it lands. Without this the runbook's own
 * "write the result to a different filename" step has no way to be read.
 */
// `||` rather than `??`: `.env.example` ships this key blank, and a blank
// value is "unset" here, not "read a file with no name". Every LEGACY_DATA_*
// read in this file uses `||` or a truthiness check for that reason.
const PROJECTS_NAME =
  process.env.LEGACY_DATA_PROJECTS_FILE || "archived-projects-clean.jsonl";
const IMAGE_KEYS_NAME = "image-keys.json";

/**
 * Reads one input from `LEGACY_DATA_S3_URI` if set, else from
 * `LEGACY_DATA_DIR`. Returns null when the object or file is absent, which
 * only `image-keys.json` is allowed to be.
 */
async function readInput(name) {
  const uri = process.env.LEGACY_DATA_S3_URI;
  if (uri) {
    const { GetObjectCommand, S3Client } = await import("@aws-sdk/client-s3");
    const match = uri.match(/^s3:\/\/([^/]+)\/?(.*)$/);
    if (!match) {
      throw new Error(`LEGACY_DATA_S3_URI is not an s3:// URI: ${uri}`);
    }
    const [, bucket, rawPrefix] = match;
    const prefix = rawPrefix && !rawPrefix.endsWith("/") ? `${rawPrefix}/` : rawPrefix;
    // Its own region var: the private ops bucket holding this data need not
    // sit in the same region as the app's asset bucket, and GetObject against
    // the wrong region fails with a redirect, not the NoSuchKey handled below.
    // `||` throughout, for the same reason as PROJECTS_NAME: `.env.example`
    // ships both keys blank, and a blank value means unset.
    const region =
      process.env.LEGACY_DATA_S3_REGION || process.env.S3_REGION || "us-west-2";
    const client = new S3Client({ region });
    try {
      const out = await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: `${prefix}${name}` })
      );
      return await out.Body.transformToString();
    } catch (error) {
      if (error?.name === "NoSuchKey") {
        return null;
      }
      throw error;
    }
  }
  const dir = process.env.LEGACY_DATA_DIR;
  if (!dir) {
    throw new Error(
      "Set LEGACY_DATA_S3_URI (production) or LEGACY_DATA_DIR (local dry run)"
    );
  }
  const path = `${dir}/${name}`;
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

/** RFC 4122 v5 (SHA-1, name-based). Same input always yields the same uuid. */
function uuidv5(name) {
  const ns = Buffer.from(NAMESPACE.replaceAll("-", ""), "hex");
  const hash = createHash("sha1")
    .update(Buffer.concat([ns, Buffer.from(name, "utf8")]))
    .digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

/**
 * The four programs production carries, and which legacy course each maps
 * onto.
 *
 * Matched on `courseId` alone, which is the stable identifier: it is unique
 * and carries the campus, while all three 3-term rows share the display name
 * "Capstone (3-term)". Matching on the name, or on the pair, would break the
 * moment staff rename a course in the UI, and a failed match creates a
 * duplicate program rather than erroring. `courseName` is used only when
 * creating a row that is absent.
 *
 * `course_id` is not unique at the database level, so `resolvePrograms`
 * refuses an ambiguous match rather than picking a row: an earlier production
 * layout had two rows both called `CS46x`, and taking the first would have
 * silently attached 181 projects to the wrong campus.
 *
 * `term_count` is stated by the course name and only written on create.
 * `expected_teams` is never written: it is the denominator the analytics
 * dashboard compares published team slots against (#34), and a made-up value
 * there corrupts a real metric.
 */
const PROGRAMS = {
  "CS46X On Campus (9 Month)": {
    courseId: "CS46X-CORVALLIS",
    courseName: "Capstone (3-term)",
    termCount: 3,
  },
  "CS46X Online (9-month)": {
    courseId: "CS46X-ECAMPUS",
    courseName: "Capstone (3-term)",
    termCount: 3,
  },
  "ECE44X (9 Month)": {
    courseId: "ECE44X-CORVALLIS",
    courseName: "Capstone (3-term)",
    termCount: 3,
  },
  "CS467 (3 Month)": {
    courseId: "CS467",
    courseName: "Capstone (1-term) (Ecampus)",
    termCount: 1,
  },
};

/**
 * The statuses this importer will write. A guard rather than a pass-through:
 * the value arrives from a SQL file, and an unrecognised one would otherwise
 * fail against the enum halfway through the transaction.
 */
const IMPORTABLE_STATUSES = ["archived", "published"];

function statusOf(row) {
  // Absent means an export made before `target_status` existed, and every one
  // of those selected `cp_archived = 1`.
  const value = row.target_status ?? "archived";
  if (!IMPORTABLE_STATUSES.includes(value)) {
    throw new Error(
      `Row ${row.legacy_id} has target_status "${value}", expected one of ${IMPORTABLE_STATUSES.join(", ")}`
    );
  }
  return value;
}

async function readRows() {
  const text = await readInput(PROJECTS_NAME);
  if (text === null) {
    throw new Error(`Could not read ${PROJECTS_NAME}`);
  }
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

/** Absent means the image step has not run yet; the rows import imageless. */
async function readImageKeys() {
  const text = await readInput(IMAGE_KEYS_NAME);
  return text === null ? {} : JSON.parse(text);
}

/**
 * Staff-only provenance. There is no `legacy_id` column, so the original id
 * goes here: it is what lets a human find the row in the dump, and it says
 * plainly that the record was imported rather than proposed in this app.
 *
 * `contact_emails` lands here and nowhere public. The old portal rendered
 * `cp_additional_emails` on no page, staff or public, so this is the only
 * place it can go without disclosing more than the source system did.
 */
function buildNotes(row) {
  const parts = [];
  if (row.notes) {
    parts.push(row.notes);
  }
  if (row.proposer_comments) {
    parts.push(`Proposer comments (legacy): ${row.proposer_comments}`);
  }
  if (row.contact_emails) {
    parts.push(`Additional contacts (legacy): ${row.contact_emails}`);
  }
  parts.push(`Imported from the legacy portal, cp_id ${row.legacy_id}.`);
  return parts.join("\n\n");
}

/**
 * `projects.proposer_email` is stored trimmed and lowercase (ADR-0015, and
 * docs/QUIRKS.md "Addresses are lowercase in the four columns we write").
 * This importer writes the column directly rather than through a server
 * function, so like the two direct writers QUIRKS already names, it folds by
 * hand. `export.sql` applies LOWER() too; this also trims.
 */
function proposerEmailOf(row) {
  return row.proposer_email.trim().toLowerCase();
}

function contactNameOf(row) {
  const name = [row.proposer_first, row.proposer_last]
    .filter(Boolean)
    .join(" ")
    .trim();
  return name || null;
}

/**
 * Resolves every program in `PROGRAMS`, not only the ones this import uses, so
 * the Corvallis/Ecampus pair exists as a choice for new proposals even though
 * no legacy project ever used the Ecampus section.
 *
 * Creates a row only when the id is absent. In production all four exist, so a
 * correct run creates nothing; a CREATED line there means an identifier
 * drifted and the row it just made is a duplicate, which is why each decision
 * is printed.
 */
async function resolvePrograms(client, createMissingPrograms) {
  const byCourse = new Map();
  for (const [course, spec] of Object.entries(PROGRAMS)) {
    const found = await client.query(
      "SELECT id, course_name FROM programs WHERE course_id = $1",
      [spec.courseId]
    );
    if (found.rows.length > 1) {
      throw new Error(
        `${found.rows.length} programs share course_id "${spec.courseId}". ` +
          "Refusing to guess which one these projects belong to; " +
          "give them distinct course ids first."
      );
    }
    if (found.rows.length === 1) {
      byCourse.set(course, found.rows[0].id);
      console.log(`  matched ${spec.courseId} "${found.rows[0].course_name}"`);
      continue;
    }
    // Absent is an error by default. In production all four exist, so a miss
    // means an id drifted, and inserting would attach projects to a brand new
    // program that merely looks right. Creating is opt-in for a fresh local
    // database, where nothing is there to match.
    if (!createMissingPrograms) {
      throw new Error(
        `No program with course_id "${spec.courseId}" (for legacy course "${course}"). ` +
          "Create it first, or pass --create-missing-programs on an empty database."
      );
    }
    const created = await client.query(
      "INSERT INTO programs (course_id, course_name, term_count) VALUES ($1, $2, $3) RETURNING id",
      [spec.courseId, spec.courseName, spec.termCount]
    );
    byCourse.set(course, created.rows[0].id);
    console.log(`  CREATED ${spec.courseId} "${spec.courseName}"`);
  }
  return byCourse;
}

/** Every legacy course string in the data must have a mapping above. */
function assertEveryCourseIsMapped(rows) {
  const unmapped = [
    ...new Set(
      rows
        .map((r) => r.program_course)
        .filter(Boolean)
        .filter((c) => !(c in PROGRAMS))
    ),
  ];
  if (unmapped.length > 0) {
    throw new Error(
      `No program mapping for legacy course(s): ${unmapped.join(", ")}`
    );
  }
}

/**
 * Link to an account only where one already exists for that address. No
 * `user` rows are created: ADR 0007 keys the proposer by email, and
 * `adminProjectSummarySelect` coalesces `user.email` to the stored
 * `proposer_email`, so an unlinked row is a supported steady state. Creating
 * placeholder accounts would put unverified addresses into the auth table
 * years before their owners sign in.
 *
 * Unlike the local run, this one will match: production has real accounts.
 */
async function resolveProposers(client, rows) {
  const emails = [...new Set(rows.map(proposerEmailOf))];
  const found = await client.query(
    'SELECT id, email FROM "user" WHERE lower(email) = ANY($1)',
    [emails]
  );
  return new Map(found.rows.map((u) => [u.email.toLowerCase(), u.id]));
}

const UPSERT = `
INSERT INTO projects (
  id, title, description, problem_statement, objectives,
  min_qualifications, pref_qualifications, url,
  contact_name, contact_email, license_restrictions,
  requires_nda_ip, is_sponsored, accepting_applicants, teams_supported,
  notes, proposer_id, proposer_email, program_id, status,
  published_at, archived_at, created_at, updated_at, image_url
) VALUES (
  $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
  $16, $17, $18, $19, $20, $21, $22, $23, $24, $25
)
ON CONFLICT (id) DO UPDATE SET
  title = excluded.title,
  description = excluded.description,
  problem_statement = excluded.problem_statement,
  objectives = excluded.objectives,
  min_qualifications = excluded.min_qualifications,
  pref_qualifications = excluded.pref_qualifications,
  url = excluded.url,
  contact_name = excluded.contact_name,
  contact_email = excluded.contact_email,
  license_restrictions = excluded.license_restrictions,
  requires_nda_ip = excluded.requires_nda_ip,
  is_sponsored = excluded.is_sponsored,
  accepting_applicants = excluded.accepting_applicants,
  teams_supported = excluded.teams_supported,
  notes = excluded.notes,
  proposer_id = excluded.proposer_id,
  proposer_email = excluded.proposer_email,
  program_id = excluded.program_id,
  status = excluded.status,
  published_at = excluded.published_at,
  archived_at = excluded.archived_at,
  created_at = excluded.created_at,
  updated_at = excluded.updated_at,
  -- COALESCE, not a plain overwrite: the image-keys file is optional, so a
  -- re-run without it binds null here and would otherwise wipe image_url on
  -- all 547 rows while the objects stayed in the bucket. A row keeps the image
  -- it has unless this run actually carries a key for it.
  image_url = COALESCE(excluded.image_url, projects.image_url)
`;

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL environment variable is not set");
  }
  const undo = process.argv.includes("--undo");
  const skipExisting = process.argv.includes("--skip-existing");
  const createMissingPrograms = process.argv.includes("--create-missing-programs");
  const rows = await readRows();
  const ids = rows.map((r) => uuidv5(r.legacy_id));

  const pool = new pg.Pool({ connectionString });
  const client = await pool.connect();
  try {
    if (undo) {
      // Most child tables cascade, but `project_bids` and
      // `project_assignments` reference `projects.id` with no `onDelete`, so
      // Postgres restricts. One bid on one legacy project fails the whole
      // batch, and the raw FK error names a constraint rather than a project.
      // Say which rows block, and stop.
      const blocked = await client.query(
        `SELECT p.id, p.title,
                (SELECT count(*) FROM project_bids b WHERE b.project_id = p.id)::int AS bids,
                (SELECT count(*) FROM project_assignments a WHERE a.project_id = p.id)::int AS assignments
         FROM projects p
         WHERE p.id = ANY($1)
           AND (EXISTS (SELECT 1 FROM project_bids b WHERE b.project_id = p.id)
             OR EXISTS (SELECT 1 FROM project_assignments a WHERE a.project_id = p.id))`,
        [ids]
      );
      if (blocked.rows.length > 0) {
        console.error(
          `Refusing to undo: ${blocked.rows.length} imported project(s) have bids or assignments.`
        );
        for (const r of blocked.rows) {
          console.error(`  ${r.id} ${r.title} (${r.bids} bids, ${r.assignments} assignments)`);
        }
        console.error(
          "Remove those first, or archive the import in place instead of deleting it."
        );
        process.exitCode = 1;
        return;
      }
      const deleted = await client.query(
        "DELETE FROM projects WHERE id = ANY($1) RETURNING id",
        [ids]
      );
      console.log(`Deleted ${deleted.rowCount} imported projects`);
      return;
    }

    console.log(`Read ${rows.length} rows`);
    const imageKeys = await readImageKeys();
    console.log(`Read ${Object.keys(imageKeys).length} image keys`);

    // One transaction: a partial import is worse than none, because the rows
    // that landed are indistinguishable from a complete run without counting.
    await client.query("BEGIN");
    assertEveryCourseIsMapped(rows);
    const programIds = await resolvePrograms(client, createMissingPrograms);
    const proposerIds = await resolveProposers(client, rows);
    console.log(
      `  ${proposerIds.size} of ${new Set(rows.map(proposerEmailOf)).size} proposer emails match an existing account`
    );

    // A re-run REPLACES every column on a row that already exists, including
    // anything staff edited in this app since the last import. Right for
    // correcting a bad mapping, wrong for a routine top-up, so say which rows
    // are about to be overwritten and offer --skip-existing for the top-up.
    const present = await client.query(
      "SELECT id FROM projects WHERE id = ANY($1)",
      [ids]
    );
    const existing = new Set(present.rows.map((r) => r.id));
    console.log(
      `  ${rows.length - existing.size} new, ${existing.size} already imported` +
        (skipExisting ? " (skipped)" : " (will be overwritten)")
    );

    for (const row of rows) {
      if (skipExisting && existing.has(uuidv5(row.legacy_id))) {
        continue;
      }
      await client.query(UPSERT, [
        uuidv5(row.legacy_id),
        row.title,
        row.description,
        row.problem_statement,
        row.objectives,
        row.min_qualifications,
        row.pref_qualifications,
        row.url,
        // The proposer's NAME was published by the old portal and their EMAIL
        // was not: an anonymous GET of viewSingleProject.php returns 200 with
        // the name in the HTML and no address anywhere in it. So the public
        // contact email stays null and the address lives in proposer_email,
        // which is staff-only on both read paths.
        contactNameOf(row),
        null,
        row.license_restrictions,
        row.requires_nda_ip,
        row.is_sponsored,
        // True, because that is what the source says: the legacy schema has
        // no closed-to-applicants column, every one of the 547 carries status
        // 4 ("Accepting Applicants") which is what this import selects on,
        // and `capstone_application` is empty. The flag means "published but
        // not closed", not "students can apply"; archived settles the latter.
        true,
        row.teams_supported,
        buildNotes(row),
        proposerIds.get(proposerEmailOf(row)) ?? null,
        proposerEmailOf(row),
        row.program_course
          ? (programIds.get(row.program_course) ?? null)
          : null,
        statusOf(row),
        // Null where the legacy event log has nothing, which is every project
        // whose lifecycle finished before its first row (2022-08-03). Not
        // backfilled: that would erase the difference between a date we know
        // and one we guessed. `search.ts` orders on
        // coalesce(published_at, created_at) so the nulls still sort sanely.
        row.published_at,
        row.archived_at,
        row.created_at,
        row.updated_at ?? row.created_at,
        imageKeys[row.legacy_id] ?? null,
      ]);
    }
    await client.query("COMMIT");

    const check = await client.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE published_at IS NULL)::int AS no_publish,
              count(*) FILTER (WHERE image_url IS NOT NULL)::int AS with_image
       FROM projects WHERE id = ANY($1)`,
      [ids]
    );
    const { total, no_publish, with_image } = check.rows[0];
    console.log(
      `Imported ${total} projects (${no_publish} with no publish date, ${with_image} with an image)`
    );
    // An image key naming a cp_id this run did not import would otherwise be
    // invisible: the object is in the bucket and no row points at it. Says so
    // rather than leaving it to a count comparison by eye.
    const imported = new Set(rows.map((r) => r.legacy_id));
    const orphanKeys = Object.keys(imageKeys).filter(
      (legacyId) => !imported.has(legacyId)
    );
    if (orphanKeys.length > 0) {
      console.log(
        `  ${orphanKeys.length} image key(s) name a project not in this import: ${orphanKeys.slice(0, 5).join(", ")}${orphanKeys.length > 5 ? ", ..." : ""}`
      );
    }
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {
      // The connection may already be gone; the original error is what matters.
    });
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

await main();
