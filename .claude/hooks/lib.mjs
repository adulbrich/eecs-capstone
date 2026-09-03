/**
 * Shared plumbing for the Claude Code hooks in this directory.
 *
 * A hook is a process that reads one JSON object on stdin and answers with an
 * exit code: 0 lets the tool call through, 2 blocks it and hands stderr to the
 * model as the reason. The `cwd` field, not `CLAUDE_PROJECT_DIR`, is where the
 * session is: inside a worktree the project dir still points at the main
 * checkout.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { relative } from "node:path";

/**
 * `process.env` without the `GIT_*` keys a git hook exports. A hook that runs
 * git on the session's `cwd` with `GIT_DIR` still set gets an answer about
 * the wrong repository (docs/QUIRKS.md, "A test that spawns git under a hook").
 */
export const cleanEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))
);

export function readInput() {
  return JSON.parse(readFileSync(0, "utf8"));
}

/**
 * Block the tool call with a reason the model will read.
 */
export function deny(reason) {
  process.stderr.write(`${reason}\n`);
  process.exit(2);
}

export function currentBranch(cwd) {
  try {
    return execFileSync("git", ["-C", cwd, "branch", "--show-current"], {
      encoding: "utf8",
      env: cleanEnv,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

/**
 * A path as the repo scripts expect it: relative to the session's checkout.
 */
export function repoRelative(cwd, path) {
  return relative(cwd, path).replaceAll("\\", "/");
}

/**
 * The repo's own rule scripts, loaded from the session's checkout so a
 * worktree checks against the code it carries.
 */
export async function loadRuleScripts(cwd) {
  const [prose, commit] = await Promise.all([
    import(`${cwd}/scripts/check-prose.mjs`),
    import(`${cwd}/scripts/check-commit-message.mjs`),
  ]);
  return { ...prose, ...commit };
}
