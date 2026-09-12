/**
 * A pull request that changes what a page looks like carries a screenshot,
 * or says why not (#342). The code-review skill reads a diff, not a rendered
 * page, and the accessibility smoke asserts axe rules, not appearance, so a
 * stranded toggle or a select that overflows a phone reaches `main` with
 * green checks unless a person looks. This is the rule that makes them.
 *
 * Satisfied when the body has a `## Screenshots` heading and, under it,
 * either one image (markdown `![...](...)` or an `<img ...>` tag) or a line
 * `Screenshots: none, because <reason>` with a non-empty reason. A pull
 * request that touches no UI path is exempt, and may still carry the
 * section. The template asks for a desktop and a phone image per changed
 * page; the script counts one, because it cannot tell widths apart, and the
 * second is a code-review item.
 *
 * One implementation, two callers: the `pr-text` workflow runs it over the
 * PR body and the changed-file list, and the Claude Code `gh` hook runs it
 * over the body of a `gh pr create` and the branch's diff, as a warning.
 *
 * Usage:
 *   node scripts/check-pr-screenshots.mjs --files <path>... < body
 *   node scripts/check-pr-screenshots.mjs --files-stdin --body <file>
 *
 * The body arrives on stdin (the `pr-text` convention, so it is data and
 * never shell), the paths as arguments; or the paths on stdin, one per line,
 * and the body from a file. Exits 1 with a one-line reason.
 */
import { readFileSync } from "node:fs";

const UI_PATH = /^(?:src\/routes\/|src\/components\/|src\/styles\.css$)/;
// `src/test/**` is excluded too, by never matching UI_PATH in the first
// place, so only the two forms that can sit under a UI root are named here.
const EXCLUDED = /(?:\/__tests__\/|\.test\.[^/]+$)/;

/** Whether a changed file is one whose change a reader should look at. */
export function isUiPath(path) {
  return UI_PATH.test(path) && !EXCLUDED.test(path);
}

const HEADING = /^##\s+Screenshots\s*$/m;
const NEXT_HEADING = /^#{1,6}\s/m;
const IMAGE = /!\[[^\]]*\]\([^)]+\)|<img\b[^>]*>/;
const OPT_OUT = /^\s*Screenshots:\s*none,\s*because\s+(\S.*)$/m;

/**
 * The problem with `body` for a change to `paths`, or null when it passes.
 * A pure function over the two inputs, so it unit-tests without GitHub.
 */
export function checkPrScreenshots(body, paths) {
  if (!paths.some(isUiPath)) {
    return null;
  }
  const heading = HEADING.exec(body);
  if (!heading) {
    return "the diff touches a UI path (src/routes/, src/components/ or src/styles.css) but the body has no `## Screenshots` section; add one with an image, or the line `Screenshots: none, because <reason>`";
  }
  const start = heading.index + heading[0].length;
  const rest = body.slice(start);
  const next = NEXT_HEADING.exec(rest);
  const section = next ? rest.slice(0, next.index) : rest;
  if (IMAGE.test(section)) {
    return null;
  }
  const optOut = OPT_OUT.exec(section);
  if (optOut?.[1]?.trim()) {
    return null;
  }
  if (/^\s*Screenshots:\s*none/m.test(section)) {
    return "the `## Screenshots` section opts out without a reason; write `Screenshots: none, because <reason>`";
  }
  return "the `## Screenshots` section has no image; add one (markdown or <img>), or the line `Screenshots: none, because <reason>`";
}

function main(argv) {
  let body;
  let paths;
  const filesAt = argv.indexOf("--files");
  const bodyAt = argv.indexOf("--body");
  if (argv.includes("--files-stdin")) {
    paths = readFileSync(0, "utf8").split("\n");
    body = readFileSync(argv[bodyAt + 1], "utf8");
  } else if (filesAt >= 0) {
    paths = argv.slice(filesAt + 1);
    body = readFileSync(0, "utf8");
  } else {
    process.stderr.write(
      "usage: check-pr-screenshots.mjs --files <path>... < body, or --files-stdin --body <file>\n"
    );
    process.exit(2);
  }
  const problem = checkPrScreenshots(
    body,
    paths.map((p) => p.trim()).filter(Boolean)
  );
  if (problem) {
    process.stderr.write(`pull request body: ${problem}\n`);
    process.exit(1);
  }
}

if (
  process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].split("/").pop())
) {
  main(process.argv.slice(2));
}
