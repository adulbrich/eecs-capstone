// Import the archived projects from the legacy PHP capstone portal.
//
//   tsx --env-file=.env.local scripts/import-legacy.ts <path-to-jsonl>
//   tsx --env-file=.env.local scripts/import-legacy.ts <path> --undo
//
// Reads `archived-projects-clean.jsonl`, the 547 rows the export pipeline
// marks as "import as archived". The other two files it writes are NOT read
// here: `archived-hidden-projects.jsonl` (141 rows hidden in the old portal,
// held pending a deliberate visibility decision) and `excluded-projects.jsonl`
// (11 rows of one proposer's working notes).
//
// Touches no schema and no application code. Idempotent because each row's
// primary key is derived from its legacy `cp_id` rather than generated, so a
// second run updates the same 547 rows and `--undo` can delete exactly them.
// That is also why there is no `legacy_id` column: the ids are recomputable.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { eq, inArray, sql } from "drizzle-orm";
import { processImage } from "../src/lib/_internal/image-processing";
import { getObjectStorage, projectImageKeys } from "../src/lib/_internal/storage";
import { db } from "../src/db";
import { programs, projects, user } from "../src/db/schema";

// Any fixed UUID works; this one is arbitrary and must never change, because
// changing it re-keys all 547 rows and orphans the previously imported set.
const NAMESPACE = "6f2a1c84-0d3e-4b57-9a6f-1e8c5d40b213";

/** RFC 4122 v5 (SHA-1, name-based). Same input always yields the same uuid. */
function uuidv5(name: string): string {
  const ns = Buffer.from(NAMESPACE.replace(/-/g, ""), "hex");
  const hash = createHash("sha1")
    .update(Buffer.concat([ns, Buffer.from(name, "utf8")]))
    .digest();
  hash[6] = (hash[6] & 0x0f) | 0x50; // version 5
  hash[8] = (hash[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = hash.subarray(0, 16).toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

type LegacyRow = {
  legacy_id: string;
  title: string;
  description: string | null;
  problem_statement: string | null;
  objectives: string | null;
  min_qualifications: string | null;
  pref_qualifications: string | null;
  proposer_comments: string | null;
  url: string | null;
  teams_supported: number;
  is_sponsored: boolean;
  requires_nda_ip: boolean;
  license_restrictions: string | null;
  program_course: string | null;
  legacy_program_course?: string | null;
  notes: string | null;
  proposer_email: string;
  proposer_first: string | null;
  proposer_last: string | null;
  contact_emails: string | null;
  created_at: string;
  updated_at: string | null;
  published_at: string | null;
  archived_at: string | null;
  target_status?: string | null;
};

/**
 * The statuses this importer will write. A guard rather than a cast: the
 * value arrives from a SQL file, and an unrecognised one would otherwise hit
 * the enum as a runtime error halfway through a 547-row insert.
 */
const IMPORTABLE_STATUSES = ["archived", "published"] as const;
type ImportableStatus = (typeof IMPORTABLE_STATUSES)[number];

function statusOf(row: LegacyRow): ImportableStatus {
  // Absent means an export made before `target_status` existed, and every one
  // of those selected `cp_archived = 1`.
  const value = row.target_status ?? "archived";
  if (!(IMPORTABLE_STATUSES as readonly string[]).includes(value)) {
    throw new Error(
      `Row ${row.legacy_id} has target_status "${value}", expected one of ${IMPORTABLE_STATUSES.join(", ")}`
    );
  }
  return value as ImportableStatus;
}

/**
 * The four programs production carries, and which legacy course each maps
 * onto.
 *
 * Matched on `courseId` alone, which is the stable identifier: it is unique
 * and now carries the campus, while all three 3-term rows share the display
 * name "Capstone (3-term)". Matching on the name, or on the pair, would break
 * the moment staff rename a course in the UI, and a failed match creates a
 * duplicate program rather than erroring, so the looser key is the safer one.
 * `courseName` below is only used when creating a row that is absent.
 *
 * `courseId` is not unique at the database level, so `resolvePrograms` refuses
 * an ambiguous match rather than picking a row: an earlier production layout
 * had two rows both called `CS46x`, and taking the first would have silently
 * attached 181 projects to the wrong campus.
 *
 * The campus split is what the legacy vocabulary already encoded, separating
 * `CS46X On Campus (9 Month)` from `CS46X Online (9-month)`. Every project in
 * this import is on-campus by its own label, so they land on Corvallis.
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
} satisfies Record<
  string,
  { courseId: string; courseName: string; termCount: number }
>;

function parseDate(value: string | null): Date | null {
  return value ? new Date(value) : null;
}

/**
 * Staff-only provenance. There is no `legacy_id` column, so the original id
 * goes here: it is what lets a human find the row in the dump, and it says
 * plainly that the record was imported rather than proposed in this app.
 */
function buildNotes(row: LegacyRow): string {
  const parts: string[] = [];
  if (row.notes) {
    parts.push(row.notes);
  }
  if (row.proposer_comments) {
    parts.push(`Proposer comments (legacy): ${row.proposer_comments}`);
  }
  // Staff-only, like everything else in `notes` (schema.ts: "never returned
  // in public queries"). The old portal rendered `cp_additional_emails` on no
  // page at all, staff or public, so this is the only place it can go without
  // disclosing more than the source system did.
  if (row.contact_emails) {
    parts.push(`Additional contacts (legacy): ${row.contact_emails}`);
  }
  parts.push(`Imported from the legacy portal, cp_id ${row.legacy_id}.`);
  return parts.join("\n\n");
}

/**
 * `projects.proposer_email` is stored trimmed and lowercase (ADR-0015, and
 * docs/QUIRKS.md "Addresses are lowercase in the four columns we write").
 * This importer writes the column directly rather than through
 * `createProjectAs`, so like the two direct writers QUIRKS already names, it
 * folds by hand. `export.sql` applies `LOWER()` too; this is the belt to that
 * brace, and it is the half that also trims.
 */
function proposerEmailOf(row: LegacyRow): string {
  return row.proposer_email.trim().toLowerCase();
}

function contactNameOf(row: LegacyRow): string | null {
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
async function resolvePrograms() {
  const byCourse = new Map<string, string>();
  for (const [course, spec] of Object.entries(PROGRAMS)) {
    const found = await db
      .select({ id: programs.id, courseName: programs.courseName })
      .from(programs)
      .where(eq(programs.courseId, spec.courseId));
    if (found.length > 1) {
      throw new Error(
        `${found.length} programs share course_id "${spec.courseId}". ` +
          "Refusing to guess which one these projects belong to; " +
          "give them distinct course ids first."
      );
    }
    const [existing] = found;
    if (existing) {
      byCourse.set(course, existing.id);
      process.stdout.write(
        `  matched ${spec.courseId} "${existing.courseName}"\n`
      );
      continue;
    }
    const [created] = await db
      .insert(programs)
      .values({
        courseId: spec.courseId,
        courseName: spec.courseName,
        termCount: spec.termCount,
      })
      .returning({ id: programs.id });
    byCourse.set(course, created.id);
    process.stdout.write(
      `  CREATED ${spec.courseId} "${spec.courseName}" (absent, check this is not a duplicate)\n`
    );
  }
  return byCourse;
}

/** Every legacy course string in the data must have a mapping above. */
function assertEveryCourseIsMapped(rows: LegacyRow[]) {
  const unmapped = [
    ...new Set(
      rows
        .map((r) => r.program_course)
        .filter((c): c is string => !!c)
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
 * Link a project to an account only where one already exists for that address.
 * No `user` rows are created: ADR 0007 keys the proposer by email, and
 * `projectSummarySelect` already coalesces `user.email` to the stored
 * `proposerEmail`, so an unlinked row is a supported steady state rather than
 * a gap. Creating 299 placeholder accounts would instead put unverified
 * addresses into the auth table years before their owners sign in.
 */
async function resolveProposers(rows: LegacyRow[]) {
  const emails = [...new Set(rows.map(proposerEmailOf))];
  const found = await db
    .select({ id: user.id, email: user.email })
    .from(user)
    .where(inArray(sql`lower(${user.email})`, emails));
  return new Map(found.map((u) => [u.email.toLowerCase(), u.id]));
}

type ImageRow = { legacy_id: string; image_id: string; name: string };

/**
 * Copy the legacy default images into object storage and point the imported
 * rows at them.
 *
 * `<dir>` is the Box copy of `submission/images/` plus the manifest, not the
 * NFS export: that tree is a live production site, and it is the one whose
 * permissions IT has already broken once.
 *
 * Legacy files carry NO extension. The portal named each one by its `cpi_id`,
 * so `file` is the only way to know what a given one holds. Sharp sniffs the
 * bytes the same way, so the missing extension costs nothing here, but it is
 * why the directory looks empty of images in Finder.
 */
/**
 * Convert the legacy images and write them to a local tree whose paths ARE
 * their object-storage keys, plus `image-keys.json` mapping legacy `cp_id` to
 * key.
 *
 * This is the production path. The key layout is fully derived from the
 * manifest, so converting on a laptop produces exactly the keys an in-cluster
 * run would, and the 100 MB of images can then go up with `aws s3 sync`
 * instead of being baked into a container image or streamed through a
 * one-off task. It also sidesteps having to trust Sharp on arm64 Fargate.
 *
 * `import-legacy.mjs` reads the small `image-keys.json` this step emits from
 * a private S3 prefix at runtime and applies it to the database. It is never
 * committed or baked into an image.
 */
async function prepareImages(dir: string, outDir: string) {
  const rows = readManifest(dir);
  const keys: Record<string, string> = {};
  const failures: { image_id: string; name: string; reason: string }[] = [];

  for (const row of rows) {
    const source = join(dir, "legacy-images", row.image_id);
    if (!existsSync(source)) {
      failures.push({ ...row, reason: "file missing" });
      continue;
    }
    try {
      const { buffer } = await processImage(readFileSync(source), {
        maxWidth: 1600,
        maxHeight: 900,
      });
      const key = imageKeyFor(row.legacy_id, row.image_id);
      const target = join(outDir, key);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, buffer);
      keys[row.legacy_id] = key;
    } catch (error) {
      failures.push({
        ...row,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  writeFileSync(
    join(outDir, "image-keys.json"),
    `${JSON.stringify(keys, null, 2)}\n`
  );
  process.stdout.write(
    `wrote ${Object.keys(keys).length} webp files under ${outDir}\n`
  );
  process.stdout.write(`wrote ${join(outDir, "image-keys.json")}\n`);
  for (const f of failures) {
    process.stdout.write(`  skipped ${f.image_id} (${f.name}): ${f.reason}\n`);
  }
}

function readManifest(dir: string): ImageRow[] {
  const manifestPath = join(dir, "legacy-images-manifest.jsonl");
  if (!existsSync(manifestPath)) {
    throw new Error(`No legacy-images-manifest.jsonl in ${dir}`);
  }
  return readFileSync(manifestPath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

/**
 * Derived from the legacy ids rather than `newKey()`, which mints a random
 * uuid: a re-run would then write a second object and orphan the first. Still
 * inside the row's key space, which both the delete path and the write guard
 * read.
 */
function imageKeyFor(legacyId: string, imageId: string): string {
  const keys = projectImageKeys(uuidv5(legacyId));
  const key = `${keys.prefix}${uuidv5(`image:${imageId}`)}.webp`;
  if (!keys.owns(key)) {
    throw new Error(`derived key outside the project key space: ${key}`);
  }
  return key;
}

async function importImages(dir: string) {
  const rows = readManifest(dir);
  process.stdout.write(`read ${rows.length} default images\n`);

  const storage = getObjectStorage();
  let uploaded = 0;
  const failures: { image_id: string; name: string; reason: string }[] = [];

  for (const row of rows) {
    const source = join(dir, "legacy-images", row.image_id);
    if (!existsSync(source)) {
      failures.push({ ...row, reason: "file missing" });
      continue;
    }
    const projectId = uuidv5(row.legacy_id);
    try {
      const { buffer, contentType } = await processImage(readFileSync(source), {
        maxWidth: 1600,
        maxHeight: 900,
      });
      const key = imageKeyFor(row.legacy_id, row.image_id);
      await storage.put(key, buffer, contentType);
      // Counted on the UPDATE, not the put: an object written to a key no row
      // points at is invisible, and counting the put would report success for
      // an image nobody can reach.
      const updated = await db
        .update(projects)
        .set({ imageUrl: key })
        .where(eq(projects.id, projectId))
        .returning({ id: projects.id });
      if (updated.length === 0) {
        failures.push({
          ...row,
          reason: `no imported project for cp_id ${row.legacy_id}`,
        });
        continue;
      }
      uploaded++;
    } catch (error) {
      failures.push({
        ...row,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  process.stdout.write(`uploaded ${uploaded} images\n`);
  for (const f of failures) {
    process.stdout.write(`  skipped ${f.image_id} (${f.name}): ${f.reason}\n`);
  }
}

async function main() {
  const [path, ...flags] = process.argv.slice(2);
  const skipExisting = flags.includes("--skip-existing");
  if (!path) {
    throw new Error(
      "Usage: tsx scripts/import-legacy.ts <clean.jsonl> [--undo] [--skip-existing]\n" +
        "       tsx scripts/import-legacy.ts --images <dir-with-legacy-images-and-manifest>"
    );
  }
  if (path === "--images") {
    const [dir] = flags;
    if (!dir) {
      throw new Error("Usage: tsx scripts/import-legacy.ts --images <dir>");
    }
    await importImages(dir);
    return;
  }
  if (path === "--prepare-images") {
    const [dir, outDir] = flags;
    if (!(dir && outDir)) {
      throw new Error(
        "Usage: tsx scripts/import-legacy.ts --prepare-images <dir> <out-dir>"
      );
    }
    await prepareImages(dir, outDir);
    return;
  }
  const rows: LegacyRow[] = readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const ids = rows.map((r) => uuidv5(r.legacy_id));

  if (flags.includes("--undo")) {
    const deleted = await db
      .delete(projects)
      .where(inArray(projects.id, ids))
      .returning({ id: projects.id });
    process.stdout.write(`deleted ${deleted.length} imported projects\n`);
    return;
  }

  process.stdout.write(`read ${rows.length} rows from ${path}\n`);
  assertEveryCourseIsMapped(rows);
  const programIds = await resolvePrograms();
  const proposerIds = await resolveProposers(rows);
  process.stdout.write(
    `  ${proposerIds.size} of ${new Set(rows.map(proposerEmailOf)).size} proposer emails match an existing account\n`
  );

  const values = rows.map((row) => ({
    id: uuidv5(row.legacy_id),
    title: row.title,
    description: row.description,
    problemStatement: row.problem_statement,
    objectives: row.objectives,
    minQualifications: row.min_qualifications,
    prefQualifications: row.pref_qualifications,
    url: row.url,
    // The proposer's NAME was published by the old portal and their EMAIL was
    // not, so only the name carries forward to a public column.
    //
    // Verified against the live legacy portal rather than inferred: an
    // anonymous GET of pages/viewSingleProject.php returns 200 with no login
    // redirect, prints the proposer's name at line 256, and contains no
    // address and no mailto anywhere in the HTML. The only read of
    // getProposer()->getEmail() is in cards.php's renderAdminProjectCard,
    // which is the staff card. `cp_additional_emails` was never rendered at
    // all.
    //
    // So `contactEmail` stays null: publishing those addresses now would
    // disclose what the source system deliberately kept to staff, for people
    // who have had no say in it and some of whom left years ago. The address
    // survives in `proposerEmail`, which is staff-only on both paths
    // (`projectDetailView` omits it by name, and the listing carries it only
    // through `adminProjectSummarySelect`), matching the legacy posture.
    contactName: contactNameOf(row),
    contactEmail: null,
    licenseRestrictions: row.license_restrictions,
    requiresNdaIp: row.requires_nda_ip,
    isSponsored: row.is_sponsored,
    // True, because that is what the source says. The legacy schema has no
    // closed-to-applicants column at all: the nearest thing is `cp_cps_id`,
    // and every one of the 547 carries status 4, "Accepting Applicants",
    // which is the condition this import selects on. `capstone_application`
    // is empty, so no roster ever filled either.
    //
    // This flag does not mean "students can apply". Archived already settles
    // that. It means "published but not closed", so forcing it false would
    // put `ApplicantsBadge`'s red hard-stop on 547 retired projects and give
    // the wrong reason for why they are unavailable.
    acceptingApplicants: true,
    teamsSupported: row.teams_supported,
    notes: buildNotes(row),
    proposerId: proposerIds.get(proposerEmailOf(row)) ?? null,
    proposerEmail: proposerEmailOf(row),
    programId: row.program_course
      ? (programIds.get(row.program_course) ?? null)
      : null,
    status: statusOf(row),
    // Null where the legacy event log has nothing, which is every project
    // whose lifecycle finished before the log's first row (2022-08-03). Not
    // backfilled from createdAt: that would erase the difference between a
    // date we know and one we guessed.
    publishedAt: parseDate(row.published_at),
    archivedAt: parseDate(row.archived_at),
    createdAt: new Date(row.created_at),
    updatedAt: parseDate(row.updated_at) ?? new Date(row.created_at),
  }));

  // A re-run REPLACES every column on a row that already exists, including
  // anything staff edited in this app since the last import. That is the right
  // default for correcting a bad mapping and the wrong one for a routine
  // top-up, so say which rows are about to be overwritten, and offer
  // `--skip-existing` for the top-up case.
  const existing = new Set(
    (
      await db
        .select({ id: projects.id })
        .from(projects)
        .where(inArray(projects.id, ids))
    ).map((r) => r.id)
  );
  const toWrite = skipExisting
    ? values.filter((v) => !existing.has(v.id))
    : values;
  process.stdout.write(
    `  ${values.length - existing.size} new, ${existing.size} already imported` +
      `${skipExisting ? " (skipped)" : " (will be overwritten)"}\n`
  );

  // Upsert on the derived primary key, so a re-run refreshes the same rows.
  let written = 0;
  for (let i = 0; i < toWrite.length; i += 100) {
    const chunk = toWrite.slice(i, i + 100);
    const result = await db
      .insert(projects)
      .values(chunk)
      .onConflictDoUpdate({
        target: projects.id,
        set: {
          title: sql`excluded.title`,
          description: sql`excluded.description`,
          problemStatement: sql`excluded.problem_statement`,
          objectives: sql`excluded.objectives`,
          minQualifications: sql`excluded.min_qualifications`,
          prefQualifications: sql`excluded.pref_qualifications`,
          url: sql`excluded.url`,
          contactName: sql`excluded.contact_name`,
          contactEmail: sql`excluded.contact_email`,
          licenseRestrictions: sql`excluded.license_restrictions`,
          requiresNdaIp: sql`excluded.requires_nda_ip`,
          isSponsored: sql`excluded.is_sponsored`,
          acceptingApplicants: sql`excluded.accepting_applicants`,
          teamsSupported: sql`excluded.teams_supported`,
          notes: sql`excluded.notes`,
          proposerId: sql`excluded.proposer_id`,
          proposerEmail: sql`excluded.proposer_email`,
          programId: sql`excluded.program_id`,
          status: sql`excluded.status`,
          publishedAt: sql`excluded.published_at`,
          archivedAt: sql`excluded.archived_at`,
          createdAt: sql`excluded.created_at`,
          updatedAt: sql`excluded.updated_at`,
        },
      })
      .returning({ id: projects.id });
    written += result.length;
  }
  process.stdout.write(`upserted ${written} projects as archived\n`);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(projects)
    .where(inArray(projects.id, ids));
  const [{ noPublish }] = await db
    .select({ noPublish: sql<number>`count(*) filter (where published_at is null)::int` })
    .from(projects)
    .where(inArray(projects.id, ids));
  process.stdout.write(
    `verify: ${count} rows present, ${noPublish} with no publish date\n`
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    process.stderr.write(`${error}\n`);
    process.exit(1);
  });
