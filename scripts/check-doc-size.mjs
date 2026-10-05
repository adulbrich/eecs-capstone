/**
 * The size rules for the reference docs, as a check. Each one was prose for
 * a year and none of them held: "one paragraph per ADR" sat beside ADRs of
 * eighteen paragraphs, and "one-paragraph explanation" per quirk beside a
 * QUIRKS.md of 210 KB. Every byte here is read by an agent on every task that
 * greps for it, so an entry that grows a history section costs every reader,
 * not the one who wrote it.
 *
 * Three units, each measured in UTF-8 bytes with LF line endings:
 *
 * - A quirk: a `###` heading in `docs/QUIRKS.md` through the line before the
 *   next `#`, `##` or `###` heading. A `####` under it is part of the quirk.
 * - A UI convention: a `##` or `###` heading in `docs/UI-CONVENTIONS.md`
 *   through the line before the next `#`, `##` or `###` heading, `####` and
 *   deeper included the same way.
 * - An ADR: a `docs/adr/NNNN-*.md` file without its `# ` title line. An ADR
 *   whose first line is not that title fails, since the title is what the
 *   count leaves out.
 *
 * Code blocks and table rows do not count toward a quirk or a UI convention.
 * An example is the cheapest way to state a rule exactly, and capping it
 * would push authors to describe code in prose instead; a table row is
 * reference data (one row per directory, per token), not an explanation that
 * grew. An ADR is one paragraph, so it has neither to exclude. A fence closes
 * the CommonMark way, on the same character at least as long as the one that
 * opened it, and a fence that never closes fails the file: everything after
 * it would otherwise go unmeasured.
 *
 * One implementation, two callers: lefthook runs it on staged files at
 * pre-commit, and CI runs it over every capped doc (`--all`). Paths resolve
 * against the repository root, so either works from any directory in it.
 *
 * Usage:
 *   node scripts/check-doc-size.mjs <file>...   check the named files
 *   node scripts/check-doc-size.mjs --all       check every capped doc
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

export const QUIRK_CAP = 1000;
export const ADR_CAP = 1300;
export const UI_CAP = 2000;

const HEADING = /^(#{1,6})\s/;
const FENCE_OPEN = /^\s*(`{3,}|~{3,})/;
const FENCE_CLOSE = /^\s*(`{3,}|~{3,})\s*$/;
const TABLE_ROW = /^\s*\|/;
const ADR_PATH = /^docs\/adr\/\d{4}-[^/]+\.md$/;
const ADR_TITLE = /^# \S/;
/** The deepest heading that ends an entry; anything deeper belongs to it. */
const ENTRY_DEPTH = 3;

/** A file's lines, CRLF or LF, so a Windows checkout measures the same. */
const linesOf = (text) => text.split(/\r?\n/);

/**
 * The lines of `text` with each one's heading level, or 0, and whether it
 * sits inside a fenced code block, plus the line of a fence left open. A
 * fence line counts as inside, so the markers are excluded with the code
 * they hold, and a `#` comment inside a shell block is never a heading.
 */
function scan(text) {
  const out = [];
  let fence = null;
  for (const [index, line] of linesOf(text).entries()) {
    const at = index + 1;
    if (fence) {
      const close = FENCE_CLOSE.exec(line);
      if (
        close &&
        close[1][0] === fence.marker[0] &&
        close[1].length >= fence.marker.length
      ) {
        fence = null;
      }
      out.push({ code: true, level: 0, line: at, text: line });
      continue;
    }
    const open = FENCE_OPEN.exec(line);
    if (open) {
      fence = { line: at, marker: open[1] };
      out.push({ code: true, level: 0, line: at, text: line });
      continue;
    }
    const heading = HEADING.exec(line);
    out.push({
      code: false,
      level: heading ? heading[1].length : 0,
      line: at,
      text: line,
    });
  }
  return { lines: out, unclosed: fence ? fence.line : null };
}

/** UTF-8 bytes of `lines`, joined with LF, trailing blank lines cut. */
function bytesOf(lines) {
  return Buffer.byteLength(lines.join("\n").trimEnd(), "utf8");
}

/**
 * Every entry headed at one of `levels`, as `{ heading, line, bytes }`, its
 * code blocks and table rows left out. An entry runs to the next heading of
 * level 1 to 3, so a `##` section's intro paragraph is not charged to the
 * `###` above it, and a `####` under an entry is charged to it.
 */
export function measureEntries(text, { levels }) {
  const entries = [];
  let current = null;
  for (const entry of scan(text).lines) {
    if (entry.level > 0 && entry.level <= ENTRY_DEPTH) {
      if (current) {
        entries.push(current);
      }
      current = levels.includes(entry.level)
        ? { heading: entry.text, kept: [], line: entry.line }
        : null;
    }
    if (!current || entry.code || TABLE_ROW.test(entry.text)) {
      continue;
    }
    current.kept.push(entry.text);
  }
  if (current) {
    entries.push(current);
  }
  return entries.map(({ heading, kept, line }) => ({
    bytes: bytesOf(kept),
    heading,
    line,
  }));
}

/** An ADR's body: everything after the title line, blank lines at the ends cut. */
export function measureAdr(text) {
  const [, ...body] = linesOf(text);
  return Buffer.byteLength(body.join("\n").trim(), "utf8");
}

/**
 * What a file is held to, by its path from the repository root, or null when
 * the file has no cap.
 */
function ruleFor(path) {
  if (path === "docs/QUIRKS.md") {
    return { cap: QUIRK_CAP, unit: "quirk" };
  }
  if (path === "docs/UI-CONVENTIONS.md") {
    return { cap: UI_CAP, unit: "UI convention" };
  }
  if (ADR_PATH.test(path)) {
    return { cap: ADR_CAP, unit: "ADR" };
  }
  return null;
}

/**
 * What is wrong with a capped file, as `{ line, message, size }`. `size` is
 * true for an entry over its cap and false for a file the check cannot
 * measure, which fails too, since passing it would pass whatever it hides.
 */
export function problems(path, text) {
  const rule = ruleFor(path);
  if (!rule) {
    return [];
  }
  if (rule.unit === "ADR") {
    const title = linesOf(text)[0];
    if (!ADR_TITLE.test(title)) {
      return [
        {
          line: 1,
          message:
            "an ADR starts with its `# ` title line, which the count leaves out",
          size: false,
        },
      ];
    }
    const bytes = measureAdr(text);
    return bytes > rule.cap
      ? [{ line: 1, message: `${title.trim()}: ${bytes} bytes, cap ${rule.cap}`, size: true }]
      : [];
  }
  const { unclosed } = scan(text);
  if (unclosed !== null) {
    return [
      {
        line: unclosed,
        message:
          "this code fence never closes, so nothing after it can be measured",
        size: false,
      },
    ];
  }
  const levels = rule.unit === "quirk" ? [3] : [2, 3];
  return measureEntries(text, { levels })
    .filter((e) => e.bytes > rule.cap)
    .map((e) => ({
      line: e.line,
      message: `${e.heading.trim()}: ${e.bytes} bytes, cap ${rule.cap}`,
      size: true,
    }));
}

/**
 * The repository root, so a path means the same from any directory in it.
 * Outside a repository, the working directory stands in for it.
 */
function repoRoot() {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return process.cwd();
  }
}

/** A path as the repository names it, whatever form the caller passed. */
function repoPath(root, path) {
  return relative(root, resolve(path)).split(sep).join("/");
}

function allCapped(root) {
  try {
    return execFileSync("git", ["-C", root, "ls-files", "docs"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split("\n")
      .filter((path) => ruleFor(path) !== null);
  } catch {
    return [];
  }
}

const RULE = `Doc size rule: a quirk is at most ${QUIRK_CAP} bytes and a UI convention at most ${UI_CAP}, heading included, code blocks and table rows not counted; an ADR is at most ${ADR_CAP} bytes after its title line. History belongs in git and the PR; the rule belongs in the doc. Cut the story of how it was found, keep what a reader must do. See docs/QUIRKS.md, "When you add a quirk".\n`;

function main(argv) {
  const root = repoRoot();
  const all = argv[0] === "--all";
  const paths = all ? allCapped(root) : argv.map((p) => repoPath(root, p));
  if (all && paths.length === 0) {
    // A run that measured nothing is not a pass: it is a check pointed at
    // the wrong directory, or a repository the docs moved out of.
    process.stderr.write(
      `Doc size: no capped docs found under ${root}/docs, so nothing was checked.\n`
    );
    process.exit(1);
  }
  const hits = [];
  let checked = 0;
  for (const path of paths) {
    if (!ruleFor(path)) {
      continue;
    }
    let text;
    try {
      text = readFileSync(join(root, path), "utf8");
    } catch {
      // Deleted in the index but still listed. Not a violation.
      continue;
    }
    checked += 1;
    hits.push(...problems(path, text).map((p) => ({ ...p, path })));
  }
  for (const { path, line, message } of hits) {
    process.stderr.write(`${path}:${line}: ${message}\n`);
  }
  if (hits.length > 0) {
    if (hits.some((h) => h.size)) {
      process.stderr.write(RULE);
    }
    process.exit(1);
  }
  process.stdout.write(
    `Doc size: ${checked} ${checked === 1 ? "file" : "files"} within the caps.\n`
  );
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  main(process.argv.slice(2));
}
