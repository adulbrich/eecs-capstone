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
 * Exit 2 blocks; stderr is the reason the model reads. The screenshots rule
 * (#342) only warns: a `--body-file` may not exist yet in every flow, and
 * `pr-text` is the gate that refuses.
 */
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import {
  changedFiles,
  deny,
  loadRuleScripts,
  readInput,
  repoRoot,
} from "./lib.mjs";

const PUBLISHES =
  /\bgh\s+(?:(?:pr|issue)\s+(?:create|edit|comment|review|close|merge)|release\s+(?:create|edit))\b/;
const API_WITH_BODY = /\bgh\s+api\b[\s\S]*\bbody\b/;
const TITLED = /\bgh\s+pr\s+(?:create|edit|merge)\b/;
const TITLE_FLAG =
  /(?:^|\s)(?:-t|--title|--subject)(?:=|\s+)(?:"((?:[^"\\]|\\.)*)"|'([^']*)')/;
const BODIED = /\bgh\s+pr\s+(?:create|edit)\b/;
// Quoted values only, like TITLE_FLAG: a bare `--body word` is legal but a
// body worth checking has spaces, and a miss here is a warning not given.
const BODY_FLAG =
  /(?:^|\s)(?:-b|--body)(?:=|\s+)(?:"((?:[^"\\]|\\.)*)"|'([^']*)')/;
const BODY_FILE_FLAG =
  /(?:^|\s)(?:-F|--body-file)(?:=|\s+)(?:"([^"]+)"|'([^']+)'|(\S+))/;

/**
 * The PR body a `gh pr create` or `gh pr edit` would send, from `--body` or
 * `--body-file`, or null when the command carries neither (an edit of the
 * title alone, a body typed into the editor).
 */
function prBody(text, dir) {
  const file = BODY_FILE_FLAG.exec(text);
  if (file) {
    const given = file[1] ?? file[2] ?? file[3];
    const path = isAbsolute(given) ? given : join(dir, given);
    return existsSync(path) ? readFileSync(path, "utf8") : null;
  }
  const inline = BODY_FLAG.exec(text);
  return inline ? (inline[1] ?? inline[2]) : null;
}

const input = readInput();
const command = input.tool_input?.command ?? "";
const cwd = input.cwd ?? process.cwd();

if (!(PUBLISHES.test(command) || API_WITH_BODY.test(command))) {
  process.exit(0);
}

const { checkCommitMessage, checkPrScreenshots, findProseViolations } =
  await loadRuleScripts(repoRoot(cwd));
const problems = [];

if (command.includes("claude.ai/code/session")) {
  problems.push(
    "contains a claude.ai/code/session link; never publish one (AGENTS.md)"
  );
}

for (const { line, kind, snippet } of findProseViolations(command)) {
  problems.push(`line ${line} has an ${kind}: ${snippet}`);
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
