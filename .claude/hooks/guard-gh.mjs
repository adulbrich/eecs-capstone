/**
 * PreToolUse on Bash: the text a `gh` command would publish gets the checks a
 * commit message gets, before it reaches the remote.
 *
 * This is the one place the session-link rule can be enforced: a link in a
 * PR body or an issue comment lands on a public repo and its GitLab mirror,
 * and lefthook never sees `gh` text. A PR title is also the squash-merge
 * subject, so `pr create`, `pr edit` and `pr merge --subject` get the
 * Conventional Commits check.
 *
 * A PR body an agent sets with `pr create` or `pr edit`, when the hook can read
 * it, carries the `Assisted-by: Claude Code` trailer above its `---` line, the
 * part a squash merge keeps (#852). Only agents run this hook, so a PR a person
 * opens alone is never asked for it.
 *
 * Exit 2 blocks; stderr is the reason the model reads. The screenshots rule
 * (#342) only warns: a `--body-file` may not exist yet in every flow, and
 * `pr-text` is the gate that refuses.
 */
import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import {
  changedFiles,
  deny,
  loadRuleScripts,
  readInput,
  repoRoot,
} from "./lib.mjs";

const PUBLISHES =
  /\bgh\s+(?:(?:pr|issue)\s+(?:create|edit|comment|review|close|merge)|release\s+(?:create|edit))\b/u;
const API_WITH_BODY = /\bgh\s+api\b[\s\S]*\bbody\b/u;
const TITLED = /\bgh\s+pr\s+(?:create|edit|merge)\b/u;
const TITLE_FLAG =
  /(?:^|\s)(?:-t|--title|--subject)(?:=|\s+)(?:"((?:[^"\\]|\\.)*)"|'([^']*)')/u;
const BODIED = /\bgh\s+pr\s+(?:create|edit)\b/u;
// Quoted values only, like TITLE_FLAG: a bare `--body word` is legal but a
// body worth checking has spaces, and a miss here is a warning not given.
const BODY_FLAG =
  /(?:^|\s)(?:-b|--body)(?:=|\s+)(?:"((?:[^"\\]|\\.)*)"|'([^']*)')/u;
const BODY_FILE_FLAG =
  /(?:^|\s)(?:-F|--body-file)(?:=|\s+)(?:"([^"]+)"|'([^']+)'|([^\s;&|)]+))/u;
const OLD_FOOTER = "Generated with [Claude Code]";
// Optionally after `VAR=value` prefixes, `(`, or a `$(` that captures the URL.
const PR_CALL =
  /^\s*(?:\w+=\S*\s+)*(?:\w+=)?\$?\(?\s*gh\s+pr\s+(?:create|edit)\b/u;
const CALL_BREAK = new Set([";", "\n", "&", "|"]);
// A heredoc: the `<<` line keeps its tail; the lines up to the delimiter go.
const HEREDOC =
  /<<-?[ \t]*(['"]?)([\w.-]+)\1([^\n]*)\n[\s\S]*?^\t*\2[ \t]*$/gmu;
const SHELL_EXPANDS = /[$`]/u;
const QUOTE_SPLICE = "'\\''";
const TRAILER = "Assisted-by: Claude Code";
const TRAILER_LINE = /^Assisted-by: Claude Code[ \t]*$/mu;
const CUT_LINE = /^---[ \t]*$/mu;

/**
 * The PR body a `gh pr create` or `gh pr edit` would send, from `--body` or
 * `--body-file`, or null when the command carries neither (an edit of the
 * title alone, a body typed into the editor).
 */
function prBody(text, dir) {
  if (BODY_FILE_FLAG.test(text)) {
    return bodyFileText(text, dir);
  }
  const inline = BODY_FLAG.exec(text);
  return inline ? (inline[1] ?? inline[2]) : null;
}

/**
 * The text of the `--body-file` (or `-F`) a command names, or null when it
 * names none or the file cannot be read yet. A throw here would exit 1, which
 * lets the command through, so an unreadable path is null instead.
 */
function bodyFileText(text, dir) {
  const file = BODY_FILE_FLAG.exec(text);
  if (!file) {
    return null;
  }
  const given = file[1] ?? file[2] ?? file[3];
  if (given === "-") {
    return null;
  }
  const path = isAbsolute(given) ? given : join(dir, given);
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/**
 * What `text` breaks of the rules all published text shares: the session
 * link, the old Claude Code footer, an emdash or an emoji.
 */
function textProblems(text, where) {
  const found = [];
  if (text.includes("claude.ai/code/session")) {
    found.push(
      `${where}contains a claude.ai/code/session link; never publish one (AGENTS.md)`
    );
  }
  if (text.includes(OLD_FOOTER)) {
    found.push(
      `${where}contains the "${OLD_FOOTER}" footer; replace it with an "Assisted-by: Claude Code" trailer (AGENTS.md)`
    );
  }
  for (const { line, kind, snippet } of findProseViolations(text)) {
    found.push(`${where}line ${line} has an ${kind}: ${snippet}`);
  }
  return found;
}

/**
 * Whether the inline `--body` is text the shell rewrites before `gh` sees it:
 * an expansion inside double quotes, or a `'\''` splice. Such a body cannot be
 * read from the command line, so it is not checked for the trailer.
 */
function shellRewritesBody(call) {
  if (BODY_FILE_FLAG.test(call)) {
    return false;
  }
  const inline = BODY_FLAG.exec(call);
  if (!inline) {
    return false;
  }
  return inline[1] === undefined
    ? call.includes(QUOTE_SPLICE)
    : SHELL_EXPANDS.test(inline[1]);
}

/**
 * Whether a PR body has the trailer on a line of its own above the first
 * `---` line. A body with no `---` is all commit body.
 */
function hasTrailer(body) {
  const cut = CUT_LINE.exec(body);
  return TRAILER_LINE.test(cut ? body.slice(0, cut.index) : body);
}

/**
 * `raw` split into the commands it chains, at `;`, `&`, `|` and newlines
 * outside quotes, with heredoc bodies dropped first, so a `gh pr create`
 * quoted in an issue body or written in a heredoc, or a title that says "gh",
 * never starts or ends a call.
 */
function shellCalls(raw) {
  const text = raw.replace(HEREDOC, "<<$2$3");
  const calls = [];
  let quote = null;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === "\\" && quote === '"') {
        i += 1;
      } else if (ch === quote) {
        quote = null;
      }
    } else if (ch === "\\") {
      i += 1;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
    } else if (CALL_BREAK.has(ch)) {
      calls.push(text.slice(start, i));
      start = i + 1;
    }
  }
  calls.push(text.slice(start));
  return calls;
}

const input = readInput();
const command = input.tool_input?.command ?? "";
const cwd = input.cwd ?? process.cwd();

if (!(PUBLISHES.test(command) || API_WITH_BODY.test(command))) {
  process.exit(0);
}

const { checkCommitMessage, checkPrScreenshots, findProseViolations } =
  await loadRuleScripts(repoRoot(cwd));
const problems = textProblems(command, "");

// A body file is published text too: read it, since the command line only
// names it. A file not written yet is pr-text's to refuse.
const bodyFile = PUBLISHES.test(command) ? bodyFileText(command, cwd) : null;
if (bodyFile) {
  problems.push(...textProblems(bodyFile, "the body file: "));
}

// Each PR call's own body, never a chained call's. A merge is left out: its
// body is the one create or edit already set, or a Dependabot body cut to its
// first line, which carries no trailer.
for (const prCall of shellCalls(command).filter((c) => PR_CALL.test(c))) {
  const body = shellRewritesBody(prCall) ? null : prBody(prCall, cwd);
  if (body !== null && !hasTrailer(body)) {
    problems.push(
      `the PR body has no "${TRAILER}" line above its --- line; end the commit-body part with it`
    );
  }
}

const title = TITLED.test(command) ? TITLE_FLAG.exec(command) : null;
if (title) {
  for (const problem of checkCommitMessage(title[1] ?? title[2])) {
    if (problem.startsWith("subject")) {
      problems.push(`PR title is the squash-merge subject: ${problem}`);
    }
  }
}

if (problems.length > 0) {
  deny(
    `This gh command would publish text that breaks a rule (AGENTS.md):\n${problems.map((p) => `- ${p}`).join("\n")}`
  );
}

// A warning, not a refusal: pr-text refuses the same thing on the remote,
// where the body and the file list are both certain.
if (BODIED.test(command) && checkPrScreenshots) {
  const body = prBody(command, cwd);
  const problem = body
    ? checkPrScreenshots(body, changedFiles(repoRoot(cwd)))
    : null;
  if (problem) {
    const warning = `pr-text will fail this pull request: ${problem} (CONTRIBUTING.md, the gates table).`;
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          additionalContext: warning,
        },
        systemMessage: warning,
      })
    );
  }
}
