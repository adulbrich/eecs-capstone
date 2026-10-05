/**
 * The size rules for the reference docs, as a check. Each one was prose for
 * a year and none of them held: "one paragraph per ADR" sat beside ADRs of
 * eighteen paragraphs, and "one-paragraph explanation" per quirk beside a
 * QUIRKS.md of 210 KB. Every byte here is read by an agent on every task that
 * greps for it, so an entry that grows a history section costs every reader,
 * not the one who wrote it.
 *
 * Three units, each measured in UTF-8 bytes:
 *
 * - A quirk: a `###` heading in `docs/QUIRKS.md` through the line before the
 *   next heading of any level.
 * - A UI convention: a `##` or `###` heading in `docs/UI-CONVENTIONS.md`
 *   through the line before the next heading of any level.
 * - An ADR: a `docs/adr/NNNN-*.md` file without its title line.
 *
 * Code blocks and table rows do not count toward a quirk or a UI convention.
 * An example is the cheapest way to state a rule exactly, and capping it
 * would push authors to describe code in prose instead; a table row is
 * reference data (one row per directory, per token), not an explanation that
 * grew. An ADR is one paragraph, so it has neither to exclude.
 *
 * One implementation, two callers: lefthook runs it on staged files at
 * pre-commit, and CI runs it over every capped doc (`--all`).
 *
 * Usage:
 *   node scripts/check-doc-size.mjs <file>...   check the named files
 *   node scripts/check-doc-size.mjs --all       check every capped doc
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

export const QUIRK_CAP = 1000;
export const ADR_CAP = 1300;
export const UI_CAP = 2000;

const HEADING = /^(#{1,6})\s/;
const FENCE = /^\s*(```|~~~)/;
const TABLE_ROW = /^\s*\|/;
const ADR_PATH = /^docs\/adr\/\d{4}-[^/]+\.md$/;

/**
 * The lines of `text` with each one's heading level, or 0, and whether it
 * sits inside a fenced code block. A fence line counts as inside, so the
 * fence markers are excluded with the code they hold, and a `#` comment
 * inside a shell block is never read as a heading.
 */
function scan(text) {
  const lines = text.split("\n");
  const out = [];
  let fenced = false;
  for (const [index, line] of lines.entries()) {
    if (FENCE.test(line)) {
      out.push({ code: true, level: 0, line: index + 1, text: line });
      fenced = !fenced;
      continue;
    }
    const heading = fenced ? null : HEADING.exec(line);
    out.push({
      code: fenced,
      level: heading ? heading[1].length : 0,
      line: index + 1,
      text: line,
    });
  }
  return out;
}

/** UTF-8 bytes of `lines`, joined as they were, trailing blank lines cut. */
function bytesOf(lines) {
  return Buffer.byteLength(lines.join("\n").trimEnd(), "utf8");
}

/**
 * Every entry headed at one of `levels`, as `{ heading, line, bytes }`, its
 * code blocks and table rows left out. An entry runs to the next heading of
 * any level, so a `##` section's intro paragraph is not charged to the `###`
 * above it.
 */
export function measureEntries(text, { levels }) {
  const lines = scan(text);
  const entries = [];
  let current = null;
  for (const entry of lines) {
    if (entry.level > 0) {
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
  const [, ...body] = text.split("\n");
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

/** Each entry in the file over its cap, as `{ path, line, label, bytes, cap }`. */
export function oversized(path, text) {
  const rule = ruleFor(path);
  if (!rule) {
    return [];
  }
  if (rule.unit === "ADR") {
    const bytes = measureAdr(text);
    const label = text.split("\n")[0].trim();
    return bytes > rule.cap ? [{ bytes, cap: rule.cap, label, line: 1, path }] : [];
  }
  const levels = rule.unit === "quirk" ? [3] : [2, 3];
  const entries = measureEntries(text, { levels });
  return entries
    .filter((e) => e.bytes > rule.cap)
    .map((e) => ({
      bytes: e.bytes,
      cap: rule.cap,
      label: e.heading.trim(),
      line: e.line,
      path,
    }));
}

/** A path as the repository names it, whatever form the caller passed. */
function repoPath(path) {
  return relative(process.cwd(), resolve(path)).split(sep).join("/");
}

function allCapped() {
  return execFileSync("git", ["ls-files", "docs"], { encoding: "utf8" })
    .split("\n")
    .filter((path) => ruleFor(path) !== null);
}

const RULE = `Doc size rule: a quirk is at most ${QUIRK_CAP} bytes and a UI convention at most ${UI_CAP}, heading included, code blocks and table rows not counted; an ADR is at most ${ADR_CAP} bytes after its title line. History belongs in git and the PR; the rule belongs in the doc. Cut the story of how it was found, keep what a reader must do. See docs/QUIRKS.md, "When you add a quirk".\n`;

function main(argv) {
  const paths = argv[0] === "--all" ? allCapped() : argv.map(repoPath);
  const hits = [];
  for (const path of paths) {
    if (!ruleFor(path)) {
      continue;
    }
    let text;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      // Deleted in the index but still listed. Not a violation.
      continue;
    }
    hits.push(...oversized(path, text));
  }
  for (const { path, line, label, bytes, cap } of hits) {
    process.stderr.write(`${path}:${line}: ${label}: ${bytes} bytes, cap ${cap}\n`);
  }
  if (hits.length > 0) {
    process.stderr.write(RULE);
    process.exit(1);
  }
  const checked = paths.filter(ruleFor).length;
  process.stdout.write(
    `Doc size: ${checked} ${checked === 1 ? "file" : "files"} within the caps.\n`
  );
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  main(process.argv.slice(2));
}
