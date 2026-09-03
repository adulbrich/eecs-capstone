/**
 * PreToolUse on Bash: the git rules from AGENTS.md, enforced before the
 * command runs rather than remembered.
 *
 * - Stage by name: no `git add -A`, `git add .`, `git commit -a`.
 * - Never commit on main.
 * - No force push at main, no `reset --hard`, `clean -f`, `branch -D`, or a
 *   working-tree wipe through `checkout .` and `restore .`.
 * - A commit message that would fail `commit-msg` fails here first, so a
 *   `--no-verify` cannot get it past lefthook.
 *
 * Everything else, including a plain push, a rebase and a stash, goes through.
 * Exit 2 blocks; stderr is the reason the model reads.
 */
import { currentBranch, deny, loadRuleScripts, readInput } from "./lib.mjs";

const input = readInput();
const command = input.tool_input?.command ?? "";
const cwd = input.cwd ?? process.cwd();

if (!/\bgit\b/.test(command)) {
  process.exit(0);
}

/**
 * The individual commands in a compound line, so `cd x && git add -A` is seen
 * as a `git add`. Heredoc bodies stay attached to the command that opens them.
 */
const segments = command.split(/\s*(?:&&|\|\||;|\n)\s*/);

const gitAdd = /\bgit\s+add\b(.*)/;
const gitCommit = /\bgit\s+commit\b(.*)/;
const gitPush = /\bgit\s+push\b(.*)/;
const branchBeforeCommit =
  /\bgit\s+(?:checkout\s+-b|switch\s+-c|worktree\s+add)\b/;
const heredocBody = /<<-?\s*'?([A-Za-z_]+)'?\n([\s\S]*?)\n\1\b/;
const messageFlag =
  /(?:^|\s)(?:-m|--message)(?:=|\s+)(?:"((?:[^"\\]|\\.)*)"|'([^']*)')/g;

for (const segment of segments) {
  const add = gitAdd.exec(segment);
  if (add) {
    const args = add[1].split(/\s+/).filter(Boolean);
    if (args.some((arg) => arg === "-A" || arg === "--all" || arg === ".")) {
      deny(
        "Stage files by name (AGENTS.md): `git add -A` and `git add .` sweep up unrelated work in progress. Name the paths."
      );
    }
  }

  const commit = gitCommit.exec(segment);
  if (commit && /(^|\s)(-a|--all|-am|-a[m]?\b)/.test(commit[1])) {
    deny(
      "Stage files by name (AGENTS.md): `git commit -a` commits every modified file. Stage the paths, then commit."
    );
  }

  const push = gitPush.exec(segment);
  if (push && /(^|\s)(-f|--force|--force-with-lease)\b/.test(push[1])) {
    const targetsMain =
      /\bmain\b/.test(push[1]) || currentBranch(cwd) === "main";
    if (targetsMain) {
      deny("No force push at main. The ruleset would reject it anyway.");
    }
  }

  if (/\bgit\s+reset\s+(?:\S+\s+)*--hard\b/.test(segment)) {
    deny(
      "No `git reset --hard` from an agent: it discards uncommitted work the user may want. Ask them to run it."
    );
  }
  if (/\bgit\s+clean\s+(?:\S+\s+)*-[a-zA-Z]*f/.test(segment)) {
    deny("No `git clean -f` from an agent. Ask the user to run it.");
  }
  if (/\bgit\s+branch\s+(?:\S+\s+)*-D\b/.test(segment)) {
    deny(
      "No `git branch -D` from an agent. Use `-d`, or ask the user to force-delete."
    );
  }
  if (/\bgit\s+(?:checkout|restore)\s+(?:--\s+)?\.(?:\s|$)/.test(segment)) {
    deny(
      "No working-tree wipe (`git checkout .`, `git restore .`) from an agent. Name the paths to restore."
    );
  }
}

if (gitCommit.test(command)) {
  if (!branchBeforeCommit.test(command) && currentBranch(cwd) === "main") {
    deny(
      "Never commit on main (AGENTS.md). Fetch, branch from origin/main, then commit."
    );
  }

  const message = extractCommitMessage(command);
  if (message !== null) {
    const { checkCommitMessage } = await loadRuleScripts(cwd);
    const problems = checkCommitMessage(message);
    if (problems.length > 0) {
      deny(
        `Commit message fails the rule (AGENTS.md):\n${problems.map((p) => `- ${p}`).join("\n")}`
      );
    }
  }
}

/**
 * The message a `git commit` would record, from its `-m` strings and heredoc
 * body, or null when it comes from a file or an editor and cannot be read
 * here. `git commit -m "$(cat <<'EOF' ... EOF)"` is the shape the harness
 * writes, so the heredoc is read before the quoted `-m` argument, which for
 * that shape holds only the substitution.
 */
function extractCommitMessage(text) {
  const heredoc = heredocBody.exec(text);
  if (heredoc) {
    return heredoc[2];
  }
  const parts = [];
  for (const match of text.matchAll(messageFlag)) {
    parts.push(match[1] ?? match[2]);
  }
  if (parts.length === 0) {
    return null;
  }
  return parts.join("\n\n").replaceAll("\\n", "\n");
}
