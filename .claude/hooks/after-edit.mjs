/**
 * PostToolUse on Edit and Write: Biome and the prose rule on the one file
 * just written, reported on the edit that caused the problem rather than at
 * commit time.
 *
 * PostToolUse cannot block, but stderr on exit 2 is shown to the model, which
 * is the point: the same finding lefthook would make at pre-commit, a few
 * minutes earlier and one file at a time.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { loadRuleScripts, readInput, repoRelative } from "./lib.mjs";

const BIOME_EXTENSIONS = /\.(?:[cm]?jsx?|tsx?|jsonc?|css)$/;
/** Mirrors `files.includes` in biome.json. */
const BIOME_EXCLUDED =
  /^(?:src\/routeTree\.gen\.ts|src\/styles\.css|scripts\/|drizzle\/)/;

const input = readInput();
const cwd = input.cwd ?? process.cwd();
const path = repoRelative(cwd, input.tool_input?.file_path ?? "");

if (!path || path.startsWith("../") || !existsSync(`${cwd}/${path}`)) {
  process.exit(0);
}

let failed = false;
const { isCheckedPath } = await loadRuleScripts(cwd);

if (isCheckedPath(path)) {
  const prose = spawnSync(process.execPath, ["scripts/check-prose.mjs", path], {
    cwd,
    encoding: "utf8",
  });
  if (prose.status !== 0) {
    failed = true;
    process.stderr.write(prose.stderr);
  }
}

const biome = `${cwd}/node_modules/.bin/biome`;
if (
  BIOME_EXTENSIONS.test(path) &&
  !BIOME_EXCLUDED.test(path) &&
  existsSync(biome)
) {
  const result = spawnSync(biome, ["check", path], { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    failed = true;
    process.stderr.write(
      `Biome reports on ${path} (run \`npm run format\` for the safe fixes):\n${result.stdout}${result.stderr}`
    );
  }
}

process.exit(failed ? 2 : 0);
