/**
 * The commit-message rules from AGENTS.md, as a check: a Conventional
 * Commits subject with a lowercase imperative, no emdash or emoji anywhere,
 * and never a `claude.ai/code/session` link.
 *
 * One implementation, three callers. lefthook runs it at `commit-msg`, CI runs
 * it over every commit a pull request adds (`--range`) and over the PR title
 * and body, which a squash merge turns into the `main` subject and body, and
 * the Claude Code `git` hook runs it on the text of a `git commit` before the
 * commit exists.
 *
 * The session-link rule is the hard one: the repo is public and mirrors to
 * GitLab, so a link that lands on a remote costs a history rewrite against a
 * protected branch. It is checked here first, before anything else can pass.
 *
 * Usage:
 *   node scripts/check-commit-message.mjs <file>        the COMMIT_EDITMSG path
 *   node scripts/check-commit-message.mjs --text <str>  a message as a string
 *   node scripts/check-commit-message.mjs --stdin       a message on stdin
 *   node scripts/check-commit-message.mjs --range <a..b>  every commit in a range
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { findProseViolations } from "./check-prose.mjs";

const TYPES = [
  "feat",
  "fix",
  "docs",
  "test",
  "refactor",
  "style",
  "perf",
  "build",
  "ci",
  "chore",
];

/**
 * `type(scope)!: subject`, scope optional, subject starting lowercase. A
 * backtick is allowed as the first character so a subject can lead with an
 * identifier, as in "fix(ci): `smoke` needs the seed".
 */
const SUBJECT = new RegExp(
  `^(?:${TYPES.join("|")})(?:\\([a-z0-9-]+\\))?!?: [a-z\`]`
);

/**
 * Subjects git and GitHub write for you and the rule does not reach.
 */
const EXEMPT_SUBJECT = /^(?:Merge |Revert |fixup! |squash! )/;

const SESSION_LINK = "claude.ai/code/session";
const SCISSORS = /^# -{8,} >8 -{8,}$/m;

/**
 * The message without git's comment lines and without anything after the
 * scissors line `git commit --verbose` adds.
 */
function stripCommentary(message) {
  const scissors = SCISSORS.exec(message);
  const body = scissors ? message.slice(0, scissors.index) : message;
  return body
    .split("\n")
    .filter((line) => !line.startsWith("#"))
    .join("\n");
}

/**
 * Every problem with `message`, as strings a committer can act on. Empty
 * means the message passes.
 */
export function checkCommitMessage(message) {
  const problems = [];
  const text = stripCommentary(message);

  if (text.includes(SESSION_LINK)) {
    problems.push(
      `contains a ${SESSION_LINK} link; drop it, keep the Co-Authored-By trailer`
    );
  }

  const subject = text.split("\n").find((line) => line.trim().length > 0) ?? "";
  if (subject.length === 0) {
    problems.push("the message is empty");
  } else if (!(EXEMPT_SUBJECT.test(subject) || SUBJECT.test(subject))) {
    problems.push(
      `subject "${subject}" is not "type(scope): lowercase imperative" with type one of ${TYPES.join(", ")}`
    );
  }

  for (const { line, kind, snippet } of findProseViolations(text)) {
    problems.push(`line ${line} has an ${kind}: ${snippet}`);
  }

  return problems;
}

function fail(label, problems) {
  for (const problem of problems) {
    process.stderr.write(`${label}: ${problem}\n`);
  }
  process.stderr.write(
    "Commit rule: type(scope): lowercase imperative subject, no emdash, no emoji, no session link. See AGENTS.md.\n"
  );
  process.exit(1);
}

function main(argv) {
  const [mode, ...rest] = argv;

  if (mode === "--range") {
    const shas = execFileSync("git", ["log", "--format=%H", rest[0]], {
      encoding: "utf8",
    })
      .split("\n")
      .filter((line) => line.length > 0);
    let failed = false;
    for (const sha of shas) {
      const message = execFileSync("git", ["log", "-1", "--format=%B", sha], {
        encoding: "utf8",
      });
      const problems = checkCommitMessage(message);
      if (problems.length > 0) {
        failed = true;
        for (const problem of problems) {
          process.stderr.write(`${sha.slice(0, 7)}: ${problem}\n`);
        }
      }
    }
    if (failed) {
      fail("range", []);
    }
    return;
  }

  let message;
  if (mode === "--text") {
    message = rest.join(" ");
  } else if (mode === "--stdin") {
    message = readFileSync(0, "utf8");
  } else {
    message = readFileSync(mode, "utf8");
  }

  const problems = checkCommitMessage(message);
  if (problems.length > 0) {
    fail("commit message", problems);
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  main(process.argv.slice(2));
}
