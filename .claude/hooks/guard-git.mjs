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
 *
 * The command line is tokenized rather than matched as text: git's global
 * options (`git -C dir add`, `git -c k=v commit`) sit between `git` and the
 * subcommand, flags come in short, long and clustered forms (`-f`, `--force`,
 * `-fd`), and a refspec can carry the force as a `+`. Quoted strings and
 * heredoc bodies are blanked before parsing, so a commit message that
 * mentions `git add -A` is not a `git add -A`. There is no `if` filter on
 * the hook in settings.json on purpose: `cd x && git add -A` starts with `cd`.
 */
import {
  currentBranch,
  deny,
  loadRuleScripts,
  readInput,
  repoRoot,
} from "./lib.mjs";

const HEREDOC = /<<-?\s*(["']?)([A-Za-z_][A-Za-z0-9_]*)\1\n([\s\S]*?)\n\2\b/;
const QUOTED = /"(?:[^"\\]|\\.)*"|'[^']*'/g;
const MESSAGE_FLAG =
  /(?:^|\s)(?:-m|--message)(?:=|\s+)(?:"((?:[^"\\]|\\.)*)"|'([^']*)')/g;
const SEGMENT = /\s*(?:&&|\|\||;|\|)\s*|\n/;
const SHORT_CLUSTER = /^-[A-Za-z]+$/;
const WHITESPACE = /\s+/;
const MAIN_REF = /(?:^|[:+])main$/;
/** Global options that take a separate argument. */
const GLOBAL_WITH_ARG = new Set([
  "-C",
  "-c",
  "--git-dir",
  "--work-tree",
  "--exec-path",
  "--namespace",
]);

const input = readInput();
const command = input.tool_input?.command ?? "";
const cwd = input.cwd ?? process.cwd();

if (!/\bgit\b/.test(command)) {
  process.exit(0);
}

/**
 * `{ sub, args }` for the git invocation in one shell segment, or null.
 */
function parseGit(segment) {
  const tokens = segment.trim().split(WHITESPACE);
  const at = tokens.findIndex((t) => t === "git" || t.endsWith("/git"));
  if (at === -1) {
    return null;
  }
  let i = at + 1;
  while (i < tokens.length && tokens[i].startsWith("-")) {
    i += GLOBAL_WITH_ARG.has(tokens[i]) ? 2 : 1;
  }
  return { sub: tokens[i] ?? "", args: tokens.slice(i + 1) };
}

const isDot = (t) => t === "." || t === "./";
/** A short flag cluster carrying `letter`, as `-f` or `-fd` carry `f`. */
const shortFlag = (t, letter) =>
  SHORT_CLUSTER.test(t) && t.slice(1).includes(letter);

function stagingRule(sub, args) {
  if (
    sub === "add" &&
    args.some((t) => t === "-A" || t === "--all" || isDot(t))
  ) {
    return "Stage files by name (AGENTS.md): `git add -A` and `git add .` sweep up unrelated work in progress. Name the paths.";
  }
  if (
    sub === "commit" &&
    args.some((t) => t === "--all" || shortFlag(t, "a"))
  ) {
    return "Stage files by name (AGENTS.md): `git commit -a` commits every modified file. Stage the paths, then commit.";
  }
  return null;
}

function pushRule(args) {
  const forced = args.some(
    (t) =>
      t === "--force" ||
      t.startsWith("--force-with-lease") ||
      t === "--force-if-includes" ||
      shortFlag(t, "f") ||
      t.startsWith("+")
  );
  if (!forced) {
    return null;
  }
  const atMain =
    args.some((t) => MAIN_REF.test(t)) || currentBranch(cwd) === "main";
  return atMain
    ? "No force push at main. The ruleset would reject it anyway."
    : null;
}

function destructiveRule(sub, args) {
  switch (sub) {
    case "reset":
      return args.includes("--hard")
        ? "No `git reset --hard` from an agent: it discards uncommitted work the user may want. Ask them to run it."
        : null;
    case "clean":
      return args.some((t) => t === "--force" || shortFlag(t, "f"))
        ? "No `git clean -f` from an agent. Ask the user to run it."
        : null;
    case "branch": {
      const deleting = args.some((t) => t === "--delete" || shortFlag(t, "d"));
      const forcing = args.some((t) => t === "--force" || shortFlag(t, "f"));
      return args.some((t) => shortFlag(t, "D")) || (deleting && forcing)
        ? "No `git branch -D` from an agent. Use `-d`, or ask the user to force-delete."
        : null;
    }
    case "checkout":
      return args.some(isDot)
        ? "No working-tree wipe (`git checkout .`) from an agent. Name the paths to restore."
        : null;
    case "restore": {
      const indexOnly =
        args.includes("--staged") &&
        !args.some((t) => t === "--worktree" || shortFlag(t, "W"));
      return args.some(isDot) && !indexOnly
        ? "No working-tree wipe (`git restore .`) from an agent. Name the paths to restore."
        : null;
    }
    default:
      return null;
  }
}

function ruleBroken(sub, args, branched) {
  if (sub === "commit" && !branched && currentBranch(cwd) === "main") {
    const staging = stagingRule(sub, args);
    return (
      staging ??
      "Never commit on main (AGENTS.md). Fetch, branch from origin/main, then commit."
    );
  }
  if (sub === "push") {
    return pushRule(args);
  }
  return stagingRule(sub, args) ?? destructiveRule(sub, args);
}

function branches(sub, args) {
  return (
    (sub === "checkout" && args.some((t) => t === "-b" || t === "-B")) ||
    (sub === "switch" && args.some((t) => t === "-c" || t === "-C")) ||
    (sub === "worktree" && args[0] === "add")
  );
}

/**
 * The message a `git commit` would record, from its heredoc body or `-m`
 * strings, or null when it comes from a file or an editor and cannot be read
 * here. `git commit -m "$(cat <<'EOF' ... EOF)"` is the shape the harness
 * writes, so the heredoc is read before the quoted `-m` argument, which for
 * that shape holds only the substitution.
 */
function extractCommitMessage(text) {
  const heredoc = HEREDOC.exec(text);
  if (heredoc) {
    return heredoc[3];
  }
  const parts = [];
  for (const match of text.matchAll(MESSAGE_FLAG)) {
    parts.push(match[1] ?? match[2]);
  }
  return parts.length === 0 ? null : parts.join("\n\n").replaceAll("\\n", "\n");
}

const detectable = command.replace(HEREDOC, "<<HEREDOC").replace(QUOTED, '""');
let branched = false;
let commits = false;

for (const segment of detectable.split(SEGMENT)) {
  const call = parseGit(segment);
  if (!call) {
    continue;
  }
  const reason = ruleBroken(call.sub, call.args, branched);
  if (reason) {
    deny(reason);
  }
  if (branches(call.sub, call.args)) {
    branched = true;
  }
  if (call.sub === "commit") {
    commits = true;
  }
}

if (commits) {
  const message = extractCommitMessage(command);
  if (message !== null) {
    const { checkCommitMessage } = await loadRuleScripts(repoRoot(cwd));
    const problems = checkCommitMessage(message);
    if (problems.length > 0) {
      deny(
        `Commit message fails the rule (AGENTS.md):\n${problems.map((p) => `- ${p}`).join("\n")}`
      );
    }
  }
}
