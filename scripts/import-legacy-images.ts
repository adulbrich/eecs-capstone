// Convert the legacy portal's project images and emit the key map the
// database importer applies.
//
//   tsx --env-file=.env.local scripts/import-legacy-images.ts prepare <src-dir> <out-dir>
//   tsx --env-file=.env.local scripts/import-legacy-images.ts upload <out-dir>
//
// Workstation only, and deliberately so. This is the half that cannot run in
// the production container, because it reuses the app's own `processImage`
// and `projectImageKeys`: an imported image then comes out byte-identical to
// one a proposer uploads, and the key-space guard is the same predicate the
// delete path and the write guard read, rather than a second spelling of it.
//
// It never touches the database. `scripts/import-legacy.mjs` is the only
// writer, and it reads the `image-keys.json` written here. The split is by
// responsibility rather than by runtime: an earlier version duplicated the
// whole database import into a `.ts` and a `.mjs`, and every constant they
// shared was a chance to diverge silently.
//
// `<src-dir>` is the Box copy of `submission/images/` plus
// `legacy-images-manifest.jsonl`, not the NFS export: that tree is a live
// production site whose permissions IT has already broken once.
//
// Legacy files carry NO extension. The portal named each one by its `cpi_id`,
// which is why the directory looks empty of images in Finder. Sharp sniffs
// the bytes, so the missing extension costs nothing here.
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { processImage } from "../src/lib/_internal/image-processing";
import {
  getObjectStorage,
  projectImageKeys,
} from "../src/lib/_internal/storage";

/**
 * MUST match `NAMESPACE` in `scripts/import-legacy.mjs`. A project's row id
 * and its image key prefix both derive from it, so a different value here
 * writes objects under keys no imported row points at.
 *
 * Three things are shared with that file and cannot be imported across the
 * runtime boundary: this constant, the `uuidv5` body below, and the
 * `image-keys.json` filename. `src/test/import-legacy-parity.test.ts` pins
 * all three, because each fails silently: a drifted filename makes the
 * importer read nothing, which it is allowed to do, and land every row with
 * no image and no error.
 */
const NAMESPACE = "6f2a1c84-0d3e-4b57-9a6f-1e8c5d40b213";

/** RFC 4122 v5 (SHA-1, name-based). Same input always yields the same uuid. */
function uuidv5(name: string): string {
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

type ImageRow = { legacy_id: string; image_id: string; name: string };

function readManifest(dir: string): ImageRow[] {
  const path = join(dir, "legacy-images-manifest.jsonl");
  if (!existsSync(path)) {
    throw new Error(`No legacy-images-manifest.jsonl in ${dir}`);
  }
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

/**
 * Derived from the legacy ids rather than `newKey()`, which mints a random
 * uuid: a re-run would then write a second object and orphan the first.
 * Asserted to be inside the row's key space, because `owns` is what both the
 * delete path and the write guard read.
 */
function imageKeyFor(legacyId: string, imageId: string): string {
  const keys = projectImageKeys(uuidv5(legacyId));
  const key = `${keys.prefix}${uuidv5(`image:${imageId}`)}.webp`;
  if (!keys.owns(key)) {
    throw new Error(`derived key outside the project key space: ${key}`);
  }
  return key;
}

/**
 * Writes each converted image to a local tree whose paths ARE its object
 * storage keys, plus `image-keys.json` mapping legacy `cp_id` to key.
 *
 * Converting here rather than in the cluster keeps 100 MB out of the
 * container image and does not depend on Sharp working under arm64 Fargate.
 * The keys are fully derived, so this produces exactly what an in-cluster run
 * would.
 */
async function prepare(srcDir: string, outDir: string) {
  const rows = readManifest(srcDir);
  // Before the loop, so a run where every row fails still writes an empty
  // key map and prints the failures rather than throwing ENOENT on the last
  // line.
  mkdirSync(outDir, { recursive: true });
  const keys: Record<string, string> = {};
  const failures: { image_id: string; name: string; reason: string }[] = [];

  for (const row of rows) {
    const source = join(srcDir, "legacy-images", row.image_id);
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

/** Every file under `dir`, as paths relative to it. */
function walk(dir: string, base = dir): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory()
      ? walk(full, base)
      : [relative(base, full)];
  });
}

/**
 * Pushes a prepared tree into the configured object storage, for a local
 * stack. Production uses `aws s3 sync` instead, so the bytes never pass
 * through a one-off task; see DEPLOYMENT.md section 7a.
 */
async function upload(outDir: string) {
  const storage = getObjectStorage();
  const projectsDir = join(outDir, "projects");
  if (!existsSync(projectsDir)) {
    throw new Error(`No projects/ directory in ${outDir}; run prepare first`);
  }
  let count = 0;
  const skipped: string[] = [];
  for (const rel of walk(projectsDir, outDir)) {
    // `owns` rather than a bare extension check, because it is the one
    // predicate the delete path and the write guard also read. Anything the
    // filesystem contributed on its own, a .DS_Store above all, fails it and
    // is named rather than uploaded as an image nothing points at.
    //
    // The production route is `aws s3 sync` and does not pass through here,
    // so the runbook pairs it with `--include "*.webp"` to the same end.
    const projectId = rel.split("/")[1] ?? "";
    if (!projectImageKeys(projectId).owns(rel)) {
      skipped.push(rel);
      continue;
    }
    await storage.put(rel, readFileSync(join(outDir, rel)), "image/webp");
    count++;
  }
  process.stdout.write(`uploaded ${count} objects\n`);
  for (const rel of skipped) {
    process.stdout.write(`  skipped ${rel}: outside the project key space\n`);
  }
}

async function main() {
  const [mode, ...args] = process.argv.slice(2);
  if (mode === "prepare") {
    const [srcDir, outDir] = args;
    if (!(srcDir && outDir)) {
      throw new Error(
        "Usage: tsx scripts/import-legacy-images.ts prepare <src-dir> <out-dir>"
      );
    }
    await prepare(srcDir, outDir);
    return;
  }
  if (mode === "upload") {
    const [outDir] = args;
    if (!outDir) {
      throw new Error(
        "Usage: tsx scripts/import-legacy-images.ts upload <out-dir>"
      );
    }
    await upload(outDir);
    return;
  }
  throw new Error(
    "Usage: tsx scripts/import-legacy-images.ts prepare <src-dir> <out-dir>\n" +
      "       tsx scripts/import-legacy-images.ts upload <out-dir>"
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    process.stderr.write(`${error}\n`);
    process.exit(1);
  });
