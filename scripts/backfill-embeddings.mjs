/**
 * Production sweeper: gives every published or archived project an embedding
 * built from the text it carries now, filling a missing vector and replacing
 * one whose text has moved on since.
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
 * Re-running is safe and cheap: a row whose stored hash still matches its
 * text is skipped before the Bedrock call, so it costs no paid call. A
 * failure leaves that row as it was, does not stop the run, and exits the
 * process non-zero, so a partial run is resumable by re-running.
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
 * Which drift matters and why is in that test's header, next to the pins that
 * catch it, and is not restated here.
 *
 * Keep every pinned body free of comments and of TypeScript annotations: the
 * comparison collapses whitespace but strips neither. Explain above the
 * function.
 *
 * Two more constraints follow from that test READING THIS FILE AS TEXT, and
 * they bind the whole file rather than any one copy:
 *
 * - No URL anywhere, in a string or a comment. The test strips comments by
 *   regex before matching, and the two slashes in a scheme, inside a string
 *   literal, would make the strip eat real code. Cite a doc by path or by ADR
 *   number, the way the paragraphs above do.
 * - Keep `await main();` at the end and at least one `//` comment at the start
 *   of a line. The test looks for both to prove the two strips ran and kept
 *   the code they removed the comments from.
 *
 * `src/lib/embedding-source.ts` and `src/server/_internal/project-embeddings.ts`
 * carry the same note, for the same reason: the constraint lives in a test in
 * another directory and is invisible from the file it binds.
 */
import { createHash } from "node:crypto";
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import pg from "pg";

/** Politeness delay between Bedrock calls, so a 547 row run does not burst. */
const DELAY_MS = 200;

/**
 * MUST match `EMBEDDING_SOURCE_LIMIT` in `src/lib/embedding-source.ts`, which
 * carries why it is 20,000: Titan refuses an input over 8,192 tokens, and a
 * row that trips it stays at a null vector this sweep can never fill.
 */
const EMBEDDING_SOURCE_LIMIT = 20_000;

/** MUST match `DEFAULT_REGION` in `src/lib/_internal/bedrock.ts`. */
const DEFAULT_REGION = "us-east-1";

/** MUST match `section` in `src/lib/embedding-source.ts`. */
function section(label, value) {
  const trimmed = value?.trim();
  return trimmed ? `${label}: ${trimmed}` : null;
}

/** MUST match `buildProjectEmbeddingSource` in `src/lib/embedding-source.ts`. */
function buildProjectEmbeddingSource(project) {
  const parts = [
    section("Title", project.title),
    section("Description", project.description),
    section("Problem", project.problemStatement),
    section("Objectives", project.objectives),
    section("Minimum qualifications", project.minQualifications),
    section("Preferred qualifications", project.prefQualifications),
    section("License", project.licenseRestrictions),
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
 * Selects every embeddable row, not only the ones with no vector, and decides
 * per row by comparing the stored hash to the one it computes. That is
 * `refreshProjectEmbedding`'s own rule, and `scripts/backfill-embeddings.ts`
 * inherits it by calling that function; this copy is the only one that used
 * to diverge, and the divergence was load-bearing in the wrong direction.
 *
 * An earlier version filtered on `embedding IS NULL`, which made a second run
 * free but also made a stale vector permanently unreachable. Refreshing on
 * edit is `refreshProjectEmbedding`'s job, so for anything a person edits in
 * the app that filter was harmless. It is not harmless for a writer that does
 * not go through that function at all: `scripts/import-legacy.mjs` upserts
 * project text and deliberately leaves the three embedding columns alone, so
 * after a re-import the affected rows held a vector built from text that no
 * longer existed, and no writer anywhere would ever correct it.
 *
 * A second run is still nearly free. The hash comparison happens before the
 * Bedrock call, so an unchanged row costs no further query at all, no paid
 * call, and no `DELAY_MS`: everything the source string is built from comes
 * back in this one select.
 *
 * `hasEmbedding` is selected rather than the vector itself: 1024 floats per
 * row are not needed to decide, and the skip below must test it for the
 * reason `refreshProjectEmbedding` gives, that a current hash beside a null
 * vector would otherwise be unreachable forever.
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
         embedding_source_hash AS "embeddingSourceHash",
         embedding IS NOT NULL AS "hasEmbedding"
  FROM projects
  WHERE status IN ('published', 'archived')
    AND deleted_at IS NULL
  ORDER BY created_at
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
  const tally = { failed: 0, unchanged: 0, updated: 0 };

  try {
    const { rows } = await db.query(SELECT_SQL);
    process.stdout.write(
      `${rows.length} published or archived project(s) to check.\n`
    );

    for (const project of rows) {
      let calledBedrock = false;
      try {
        const source = buildProjectEmbeddingSource(project);
        const hash = embeddingHash(
          source,
          EMBEDDING_MODEL_ID,
          EMBEDDING_DIMENSIONS
        );
        // MUST match the skip in `refreshProjectEmbedding`. Both halves
        // matter: the hash says the text has not moved, and `hasEmbedding`
        // says there is a vector to keep. A current hash beside a null vector
        // means an interrupted write, and it must land here as work to do
        // rather than as nothing to do.
        if (project.embeddingSourceHash === hash && project.hasEmbedding) {
          tally.unchanged += 1;
          continue;
        }

        calledBedrock = true;
        const vector = await embed(bedrock, source);
        await db.query(UPDATE_SQL, [toSqlVector(vector), hash, project.id]);
        tally.updated += 1;
        process.stdout.write(`updated ${project.title}\n`);
      } catch (error) {
        // Per project, so one bad row does not cost the other 546. The row is
        // left as it was and the next run picks it up again.
        tally.failed += 1;
        process.stdout.write(`FAILED  ${project.title}: ${error.message}\n`);
      } finally {
        // After the failures too, and that is the point: throttling is what
        // the delay exists for, and a throttled call fails in milliseconds.
        // Sleeping only on success would let exactly the run that is being
        // throttled burst through all 547 rows at full speed.
        //
        // `calledBedrock` is set immediately before the call, so a throttled
        // failure still waits. What it excludes is a row that never called
        // Bedrock at all, which since ADR-0025 means one skipped on its hash.
        // Throttling that is not the point, and without this a sweep of rows
        // that are nearly all unchanged would spend `DELAY_MS` on every one of
        // them. It is also where the two sweepers differ:
        // `backfill-embeddings.ts` sleeps after a failure of any kind.
        if (calledBedrock) {
          await sleep(DELAY_MS);
        }
      }
    }

    process.stdout.write(
      `\n${rows.length} project(s) checked: ${tally.updated} updated, ` +
        `${tally.unchanged} already current, ${tally.failed} failed.\n`
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
