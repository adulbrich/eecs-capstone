/**
 * Production sweeper: gives an embedding to every published or archived
 * project that has none.
 *
 * Run as a one-off ECS task, the way `import-legacy.mjs` is:
 *
 *   node scripts/backfill-embeddings.mjs
 *
 * Plain `.mjs` so it runs from the production image, which installs with
 * `--omit=dev` (no `tsx`) and ships `.output` without `src/`, so nothing under
 * `#/lib` resolves. Only `pg` and `@aws-sdk/client-bedrock-runtime` are used,
 * both production dependencies the server already ships.
 * `scripts/backfill-embeddings.ts` is the workstation equivalent and calls the
 * app's own writer instead.
 *
 * Re-running is safe and cheap: a row that already has a vector is not
 * selected. A Bedrock failure leaves that row null, does not stop the run, and
 * exits the process non-zero, so a partial run is resumable by re-running.
 *
 * ## The duplication, and what it costs
 *
 * Everything below carrying a `MUST match` comment is copied from `src/` and
 * cannot be imported across the image boundary. That is the accepted cost of
 * shipping an `.mjs` rather than compiling the TypeScript sweeper into the
 * image; `docs/adr/0024-ops-scripts-are-plain-mjs.md` has the reasoning and the
 * rules the copies follow.
 *
 * `src/test/backfill-embeddings-parity.test.ts` is the inventory of which ones
 * are pinned: its `it` names say, and it is the only list worth trusting,
 * because a prose list here goes stale and nothing fails when it does. What is
 * pinned is whatever drifts silently or expensively, which is why the copies
 * whose drift throws or fails to connect (`parseEmbedResponse`,
 * `buildBedrockConfig`, `toSqlVector`, `DEFAULT_REGION`) are left out.
 *
 * The three failures worth naming, worst first:
 *
 * - The text that gets embedded drifts. The script stores vectors computed
 *   from text the app would never produce for that project. Nothing errors,
 *   the stored hash still looks valid to the app, so nothing recomputes them,
 *   and recommendations quietly get worse. The only silent one.
 * - The hash inputs drift. Every row looks stale to whichever side did not
 *   change, so runs re-embed rows that were already correct at one paid
 *   Bedrock call each, and the two sides can flip-flop a row indefinitely.
 * - The dimension default drifts. pgvector rejects the insert, because the
 *   column is fixed at 1024. Loud, and so the least dangerous.
 *
 * Keep every pinned body free of comments and of TypeScript annotations: the
 * comparison collapses whitespace but strips neither. Explain above the
 * function.
 */
import { createHash } from "node:crypto";
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import pg from "pg";

/** Politeness delay between Bedrock calls, so a 550 row run does not burst. */
const DELAY_MS = 200;

/** MUST match `EMBEDDING_SOURCE_LIMIT` in `src/lib/embedding-source.ts`. */
const EMBEDDING_SOURCE_LIMIT = 45_000;

/** MUST match `DEFAULT_REGION` in `src/lib/_internal/bedrock.ts`. */
const DEFAULT_REGION = "us-east-1";

/** MUST match `buildProgramLabel` in `src/lib/embedding-source.ts`. */
function buildProgramLabel(courseId, courseName) {
  return `${courseId} ${courseName}`;
}

/** MUST match `section` in `src/lib/embedding-source.ts`. */
function section(label, value) {
  const trimmed = value?.trim();
  return trimmed ? `${label}: ${trimmed}` : null;
}

/** MUST match `buildProjectEmbeddingSource` in `src/lib/embedding-source.ts`. */
function buildProjectEmbeddingSource(project, categoryNames, programLabel) {
  const parts = [
    section("Title", project.title),
    section("Description", project.description),
    section("Problem", project.problemStatement),
    section("Objectives", project.objectives),
    section("Minimum qualifications", project.minQualifications),
    section("Preferred qualifications", project.prefQualifications),
    section("License", project.licenseRestrictions),
    section("Program", programLabel),
    section(
      "Categories",
      categoryNames.length > 0 ? categoryNames.join(", ") : null
    ),
  ].filter((part) => part !== null);
  return parts.join("\n\n").slice(0, EMBEDDING_SOURCE_LIMIT);
}

/** MUST match `embeddingHash` in `src/lib/embedding-source.ts`. */
function embeddingHash(source, modelId, dimensions) {
  return createHash("sha256")
    .update(`${modelId}:${dimensions}:${source}`)
    .digest("hex");
}

/**
 * MUST match `buildEmbedConfig` in `src/lib/_internal/bedrock-embed.ts`,
 * including the blank case: `Number("")` is `0`, not the default, so
 * `BEDROCK_EMBEDDING_DIMENSIONS=""` yields dimensions of zero. It is a wart,
 * but it is the wart the stored hashes were computed with, and tidying it here
 * alone would re-key every row.
 */
function buildEmbedConfig(env = process.env) {
  return {
    dimensions: Number(env.BEDROCK_EMBEDDING_DIMENSIONS ?? "1024"),
    modelId: env.BEDROCK_EMBEDDING_MODEL_ID ?? "amazon.titan-embed-text-v2:0",
  };
}

const { dimensions: EMBEDDING_DIMENSIONS, modelId: EMBEDDING_MODEL_ID } =
  buildEmbedConfig();

/** MUST match `buildEmbedRequestBody` in `src/lib/_internal/bedrock-embed.ts`. */
function buildEmbedRequestBody(text) {
  return JSON.stringify({
    inputText: text,
    dimensions: EMBEDDING_DIMENSIONS,
    normalize: true,
  });
}

/**
 * MUST match `parseEmbedResponse` in `src/lib/_internal/bedrock-embed.ts`.
 * Not compared by the parity test: the TypeScript body carries a cast an
 * `.mjs` cannot hold. Drift here is loud, either this throw or a pgvector
 * dimension error on the insert.
 */
function parseEmbedResponse(payload) {
  const parsed = JSON.parse(new TextDecoder().decode(payload));
  if (!Array.isArray(parsed.embedding)) {
    throw new Error("Bedrock returned no embedding");
  }
  return parsed.embedding;
}

/**
 * MUST match `buildBedrockConfig` in `src/lib/_internal/bedrock.ts`. Not
 * compared by the parity test: its TypeScript body carries a typed return an
 * `.mjs` cannot hold. In production no static keys are set, so we omit
 * `credentials` and let the SDK's default chain use the ECS task role, and
 * drift shows up as a failure to reach Bedrock at all.
 */
function buildBedrockConfig(env = process.env) {
  const accessKeyId = env.BEDROCK_ACCESS_KEY;
  const secretAccessKey = env.BEDROCK_SECRET_KEY;
  return {
    region: env.BEDROCK_REGION ?? DEFAULT_REGION,
    ...(accessKeyId && secretAccessKey
      ? { credentials: { accessKeyId, secretAccessKey } }
      : {}),
  };
}

/**
 * MUST match `toSqlVector` in `src/server/_internal/project-embeddings.ts`.
 * pgvector's text input format, e.g. `[0.1,0.2]`.
 */
function toSqlVector(values) {
  return `[${values.join(",")}]`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * MUST match `EMBEDDABLE_STATUSES` in
 * `src/server/_internal/project-embeddings.ts` for its status set, and
 * `EmbeddableProject` in `src/lib/embedding-source.ts` for its column list.
 * Both are pinned; the second is the subtle one, because the body comparison
 * forces the copied builder to read a key nothing here makes the query fetch,
 * and `section` reads an absent key as an empty one.
 *
 * Aliased to the camelCase keys `buildProjectEmbeddingSource` reads, so the
 * copied body stays byte-identical to the one in `src/` instead of needing a
 * remapping step here.
 *
 * `embedding IS NULL` is what makes a second run free: a row that already has
 * a vector is not selected, so it costs no Bedrock call. That also means this
 * never refreshes a stale vector, which is `refreshProjectEmbedding`'s job on
 * edit and is deliberately out of scope here.
 */
const SELECT_SQL = `
  SELECT id,
         title,
         description,
         problem_statement   AS "problemStatement",
         objectives,
         min_qualifications  AS "minQualifications",
         pref_qualifications AS "prefQualifications",
         license_restrictions AS "licenseRestrictions",
         program_id          AS "programId"
  FROM projects
  WHERE status IN ('published', 'archived')
    AND deleted_at IS NULL
    AND embedding IS NULL
  ORDER BY created_at
`;

/**
 * One query per project, mirroring `refreshProjectEmbedding` rather than
 * batching, because the category order decides the source string and so the
 * hash. Neither side sorts, so matching the app's query shape is the closest
 * thing to matching its order; a mismatch costs one re-embed the next time
 * somebody edits that project, not a wrong vector.
 */
const CATEGORIES_SQL = `
  SELECT c.name
  FROM project_categories pc
  JOIN categories c ON c.id = pc.category_id
  WHERE pc.project_id = $1
`;

/** The aliases MUST match what `buildProgramLabel` is handed in `src/`. */
const PROGRAM_SQL = `
  SELECT course_id AS "courseId", course_name AS "courseName"
  FROM programs
  WHERE id = $1
`;

/**
 * Writes the same three columns the app writes, and deliberately not
 * `updated_at`: the app's embedding write does not bump it either, so an
 * embedding is not an edit.
 */
const UPDATE_SQL = `
  UPDATE projects
  SET embedding = $1::vector,
      embedding_source_hash = $2,
      embedding_updated_at = now()
  WHERE id = $3
`;

async function embed(client, text) {
  const response = await client.send(
    new InvokeModelCommand({
      modelId: EMBEDDING_MODEL_ID,
      contentType: "application/json",
      accept: "application/json",
      body: buildEmbedRequestBody(text),
    })
  );
  return parseEmbedResponse(response.body);
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL environment variable is not set");
  }

  const pool = new pg.Pool({ connectionString });
  const bedrock = new BedrockRuntimeClient(buildBedrockConfig());
  const db = await pool.connect();
  const tally = { failed: 0, updated: 0 };

  try {
    const { rows } = await db.query(SELECT_SQL);
    process.stdout.write(
      `${rows.length} published or archived project(s) with no embedding.\n`
    );

    for (const project of rows) {
      try {
        const categories = await db.query(CATEGORIES_SQL, [project.id]);
        let programLabel = null;
        if (project.programId) {
          const programs = await db.query(PROGRAM_SQL, [project.programId]);
          const program = programs.rows[0];
          programLabel = program
            ? buildProgramLabel(program.courseId, program.courseName)
            : null;
        }

        const source = buildProjectEmbeddingSource(
          project,
          categories.rows.map((row) => row.name),
          programLabel
        );
        const hash = embeddingHash(
          source,
          EMBEDDING_MODEL_ID,
          EMBEDDING_DIMENSIONS
        );
        const vector = await embed(bedrock, source);
        await db.query(UPDATE_SQL, [toSqlVector(vector), hash, project.id]);
        tally.updated += 1;
        process.stdout.write(`updated ${project.title}\n`);
        await sleep(DELAY_MS);
      } catch (error) {
        // Per project, so one bad row does not cost the other 549. The row
        // stays null and the next run picks it up again.
        tally.failed += 1;
        process.stdout.write(`FAILED  ${project.title}: ${error.message}\n`);
      }
    }

    process.stdout.write(
      `\n${rows.length} project(s) needed an embedding: ` +
        `${tally.updated} updated, ${tally.failed} failed.\n`
    );
  } finally {
    db.release();
    await pool.end();
    bedrock.destroy();
  }

  if (tally.failed > 0) {
    process.stdout.write(
      "Failures are safe to retry: re-run this script once Bedrock access is working.\n"
    );
    process.exit(1);
  }
  process.exit(0);
}

await main();
