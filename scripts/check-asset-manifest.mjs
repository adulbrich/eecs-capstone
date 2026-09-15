/**
 * Build assertion: every asset URL the server bundle names must exist in the
 * client output it will be served from.
 *
 * `vite build` runs the client pass and the SSR pass separately, and only the
 * client pass writes `.output/public/assets`. The SSR pass hashes its own
 * `?url` imports (the stylesheet in `src/routes/__root.tsx` above all) and
 * emits nothing, so when the two passes disagree about the bytes of an asset
 * the SSR HTML links a file that does not exist, every page paints unstyled,
 * and nothing in the build says so. #397 is the case that shipped: Tailwind's
 * source scan read `.output/` during the SSR pass inside the Docker build,
 * where `.dockerignore` had dropped the `.gitignore` that excludes it locally.
 *
 * That is why the Dockerfile runs this right after `npm run build`, not only
 * CI: the divergence exists only in the image's build context. CI builds a
 * checkout that still carries `.gitignore`, so the CI run is a cheap extra
 * signal, not the gate.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";

const args = process.argv.slice(2);
const outputIndex = args.indexOf("--output");
const OUTPUT_DIR = outputIndex === -1 ? ".output" : args[outputIndex + 1];
const SERVER_DIR = join(OUTPUT_DIR, "server");
const ASSET_DIR = join(OUTPUT_DIR, "public", "assets");

/**
 * A quoted URL under `/assets/`. The lookbehind excludes Nitro's own public
 * asset manifest, whose entries are `../public/assets/<name>` file paths that
 * exist by construction.
 */
const ASSET_URL = /(?<=["'`])\/assets\/([A-Za-z0-9._-]+)(?=["'`])/g;

async function* serverModules(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") {
      continue;
    }
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* serverModules(path);
    } else if (entry.name.endsWith(".mjs")) {
      yield path;
    }
  }
}

const onDisk = new Set(
  await readdir(ASSET_DIR).catch(() => {
    throw new Error(`${ASSET_DIR} not found. Run \`npm run build\` first.`);
  })
);

if (!(await stat(SERVER_DIR).catch(() => null))?.isDirectory()) {
  throw new Error(`${SERVER_DIR} not found. Run \`npm run build\` first.`);
}

const referenced = new Map();
for await (const path of serverModules(SERVER_DIR)) {
  const source = await readFile(path, "utf8");
  for (const match of source.matchAll(ASSET_URL)) {
    const name = match[1];
    if (!referenced.has(name)) {
      referenced.set(name, relative(OUTPUT_DIR, path));
    }
  }
}

if (referenced.size === 0) {
  throw new Error(
    `No /assets/ URL found under ${SERVER_DIR}; that is not a Start build.`
  );
}

const missing = [...referenced].filter(([name]) => !onDisk.has(name));

if (missing.length > 0) {
  throw new Error(
    `${missing.length} of ${referenced.size} assets the server names are ` +
      `not in ${ASSET_DIR}:\n` +
      missing.map(([name, from]) => `  ${name} (from ${from})`).join("\n") +
      "\nThe SSR and client passes disagreed about an asset's bytes. See " +
      "the Tailwind source() note in docs/QUIRKS.md."
  );
}

console.log(`OK: ${referenced.size} assets the server names are on disk.`);
