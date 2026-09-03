/**
 * PreToolUse on Bash: the text a `gh` command would publish gets the checks a
 * commit message gets, before it reaches the remote.
 *
 * This is the one place the session-link rule can be enforced: a link in a
 * PR body or an issue comment lands on a public repo and its GitLab mirror,
 * and lefthook never sees `gh` text. A `gh pr create` title is also the
 * squash-merge subject, so it gets the Conventional Commits check.
 *
 * Exit 2 blocks; stderr is the reason the model reads.
 */
import { deny, loadRuleScripts, readInput } from "./lib.mjs";

const input = readInput();
const command = input.tool_input?.command ?? "";
const cwd = input.cwd ?? process.cwd();

const publishes =
  /\bgh\s+(?:pr|issue)\s+(?:create|edit|comment|review|close|merge)\b/.test(
    command
  ) ||
  (/\bgh\s+api\b/.test(command) && /\bbody\b/.test(command));

if (!publishes) {
  process.exit(0);
}

const { checkCommitMessage, findProseViolations } = await loadRuleScripts(cwd);
const problems = [];

if (command.includes("claude.ai/code/session")) {
  problems.push(
    "contains a claude.ai/code/session link; never publish one (AGENTS.md)"
  );
}

for (const { line, kind, snippet } of findProseViolations(command)) {
  problems.push(`line ${line} has an ${kind}: ${snippet}`);
}

const create = /\bgh\s+pr\s+create\b/.test(command);
const title =
  /(?:^|\s)(?:-t|--title)(?:=|\s+)(?:"((?:[^"\\]|\\.)*)"|'([^']*)')/.exec(
    command
  );
if (create && title) {
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
