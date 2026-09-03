/**
 * The two characters of the prose rule in AGENTS.md, as a check: no emdash
 * and no emoji in anything tracked, be it docs, comments, or string literals.
 * The rule's third case, a `--` standing in for a sentence dash, is not
 * checked here: `--no-verify` and every other flag would trip it.
 *
 * One implementation, three callers. lefthook runs it on staged files at
 * pre-commit, CI runs it over the whole tree (`--all`), and the Claude Code
 * hooks run it on the text of a `gh` command (`--text`) and on each edited
 * file. A rule that is stated in a doc and checked nowhere is a rule every
 * agent learns is soft, which is how six tracked files came to break it.
 *
 * Session links are not this script's business for files: AGENTS.md names
 * the rule and therefore contains the string. `check-commit-message.mjs`
 * covers commit messages, and the `gh` hook covers PR and issue text.
 *
 * Usage:
 *   node scripts/check-prose.mjs <file>...     check the named files
 *   node scripts/check-prose.mjs --all         check every tracked text file
 *   node scripts/check-prose.mjs --text <str>  check a string (exit 1 on a hit)
 *   node scripts/check-prose.mjs --stdin       check stdin as one string
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const EMDASH = "\u2014";

/**
 * The blocks emoji are drawn from: the astral range from Mahjong tiles up
 * through the extended pictographs, Miscellaneous Symbols and Dingbats (the
 * check and cross marks, the warning sign, stars), Miscellaneous Technical
 * (hourglass, alarm clock, the media buttons), the play and reverse
 * triangles, the information source, and the few squares and circles from
 * Miscellaneous Symbols and Arrows that keyboards offer as emoji. Arrows
 * (U+2190 to U+21FF) and box drawing are deliberately not in here: the rule
 * is about emoji, and a diagram in a doc is not one.
 */
const EMOJI =
  /[\u{1F000}-\u{1FAFF}\u{2300}-\u{23FF}\u{2600}-\u{27BF}\u{2139}\u{25B6}\u{25C0}\u{2B05}-\u{2B07}\u{2B1B}\u{2B1C}\u{2B50}\u{2B55}]/u;

/**
 * Extensions that are prose or source. Anything else `git ls-files` reports
 * (images, fonts, lockfiles without an extension) is skipped rather than
 * read as UTF-8 and misjudged.
 */
const TEXT_EXTENSIONS = new Set([
  "md",
  "ts",
  "tsx",
  "js",
  "mjs",
  "cjs",
  "json",
  "jsonc",
  "yml",
  "yaml",
  "css",
  "tf",
  "sh",
  "sql",
  "txt",
]);

/**
 * Paths the rule does not reach. `docs/superpowers/` is history from before
 * the rule and is not rewritten; `drizzle/` is generated; the lockfile and the
 * Playwright MCP scratch are machine output.
 */
const EXCLUDED_PREFIXES = [
  "docs/superpowers/",
  "drizzle/",
  ".playwright-mcp/",
  "node_modules/",
];
const EXCLUDED_FILES = new Set(["package-lock.json"]);

/**
 * The one line the harness appends to every PR body and nothing here can
 * change. Stripped before checking so the footer is not what fails the PR.
 */
const HARNESS_FOOTER = /^\u{1F916} Generated with \[Claude Code\]\(.*\)\s*$/mu;

/**
 * Every hit in `text`, as `{ line, kind, snippet }`. `kind` is `emdash` or
 * `emoji`. Exported for the commit-message check, which adds its own rules on
 * top; the CLI below is the same function with a report.
 */
export function findProseViolations(text) {
  const violations = [];
  const lines = text.replace(HARNESS_FOOTER, "").split("\n");
  for (const [index, line] of lines.entries()) {
    if (line.includes(EMDASH)) {
      violations.push({ line: index + 1, kind: "emdash", snippet: line.trim() });
    }
    const emoji = EMOJI.exec(line);
    if (emoji) {
      violations.push({
        line: index + 1,
        kind: "emoji",
        snippet: line.trim(),
      });
    }
  }
  return violations;
}

export function isCheckedPath(path) {
  if (EXCLUDED_FILES.has(path)) {
    return false;
  }
  if (EXCLUDED_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    return false;
  }
  const dot = path.lastIndexOf(".");
  if (dot === -1) {
    return false;
  }
  return TEXT_EXTENSIONS.has(path.slice(dot + 1));
}

export function gitLines(args) {
  return execFileSync("git", args, { encoding: "utf8" })
    .split("\n")
    .filter((line) => line.length > 0);
}

function report(label, violations) {
  for (const { line, kind, snippet } of violations) {
    const excerpt = snippet.length > 100 ? `${snippet.slice(0, 100)}...` : snippet;
    process.stderr.write(`${label}:${line}: ${kind}: ${excerpt}\n`);
  }
}

function checkFiles(paths) {
  let failed = false;
  for (const path of paths) {
    let text;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      // Deleted in the index but still listed, or unreadable. Not a violation.
      continue;
    }
    const violations = findProseViolations(text);
    if (violations.length > 0) {
      failed = true;
      report(path, violations);
    }
  }
  return failed;
}

function main(argv) {
  const [mode, ...rest] = argv;
  let failed = false;

  if (mode === "--text" || mode === "--stdin") {
    const text =
      mode === "--text" ? rest.join(" ") : readFileSync(0, "utf8");
    const violations = findProseViolations(text);
    failed = violations.length > 0;
    report("text", violations);
  } else if (mode === "--all") {
    failed = checkFiles(gitLines(["ls-files"]).filter(isCheckedPath));
  } else {
    failed = checkFiles(argv.filter(isCheckedPath));
  }

  if (failed) {
    process.stderr.write(
      "Prose rule: no emdash (U+2014) and no emoji. Use a comma, colon, or a new sentence; use words for a status mark. See AGENTS.md.\n"
    );
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  main(process.argv.slice(2));
}
