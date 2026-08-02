/**
 * Build assertion: the client bundle must ship precompressed.
 *
 * `compressPublicAssets` in vite.config.ts is a build-time flag with no
 * runtime signature. If a dependency bump changes its behavior, nothing
 * fails, nothing looks different in local development, and production
 * quietly returns to serving ~98 KB of raw CSS on the render-blocking
 * path. CI runs this after `npm run build` so that regression is loud.
 *
 * Nitro skips files below 1 KB and skips .map files, so this only asserts
 * on bundles at or above that floor.
 */
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

const ASSET_DIR = ".output/public/assets";
const MIN_COMPRESSED_BYTES = 1024;

const entries = await readdir(ASSET_DIR).catch(() => {
  throw new Error(`${ASSET_DIR} not found. Run \`npm run build\` first.`);
});

const candidates = entries.filter(
  (name) => name.endsWith(".css") || name.endsWith(".js")
);

if (candidates.length === 0) {
  throw new Error(`No .css or .js bundles found in ${ASSET_DIR}.`);
}

const missing = [];
let checked = 0;

for (const name of candidates) {
  const { size } = await stat(join(ASSET_DIR, name));
  if (size < MIN_COMPRESSED_BYTES) {
    continue;
  }
  checked += 1;
  if (!entries.includes(`${name}.br`)) {
    missing.push(name);
  }
}

if (missing.length > 0) {
  throw new Error(
    `${missing.length} of ${checked} bundles have no .br sibling ` +
      `(first: ${missing[0]}). Check compressPublicAssets in vite.config.ts.`
  );
}

console.log(`OK: ${checked} bundles ship precompressed.`);
