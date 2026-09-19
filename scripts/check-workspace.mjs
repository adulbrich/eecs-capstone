/**
 * What finished work left behind in a checkout, as a report.
 *
 * Three leftovers, and each one has cost a session real time. A worktree under
 * `.claude/worktrees/` outlives the branch it was made for, and until #515 the
 * unit suite walked into it and ran that copy's tests against that copy's
 * `node_modules`. A dev server started inside one keeps port 3000, and both
 * Playwright configs reuse an existing server outside CI, so a browser suite
 * attaches to it and scans a different branch's app while reporting green. And
 * a branch whose remote is gone piles up: `git branch -d` refuses it, because
 * a squash merge leaves it "not fully merged", so the pile never clears by
 * itself.
 *
 * This reports; it never removes. Deleting a branch is force-deleting it here,
 * and `.claude/hooks/guard-git.mjs` reserves that for the user on purpose.
 *
 * Usage:
 *   node scripts/check-workspace.mjs              report on the cwd's checkout
 *   node scripts/check-workspace.mjs --root <dir> report on another checkout
 *   node scripts/check-workspace.mjs --ports      also probe 3000 and 3001
 */
import { execFileSync } from "node:child_process";

/** The ports the dev server and the smoke suite's server use. */
const DEV_PORTS = [3000, 3001];
const PROBE_TIMEOUT = 1500;

const cleanEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))
);

function run(file, args, timeout = PROBE_TIMEOUT) {
  try {
    return execFileSync(file, args, {
      encoding: "utf8",
      env: cleanEnv,
      stdio: ["ignore", "pipe", "ignore"],
      timeout,
    }).trim();
  } catch {
    return "";
  }
}

const git = (root, args) => run("git", ["-C", root, ...args], 5000);

/**
 * Every worktree but the checkout itself, with the branch each holds.
 *
 * `git worktree list --porcelain` prints a stanza per worktree; the `branch`
 * line is a full ref, and a detached one has none.
 */
export function otherWorktrees(root) {
  const out = [];
  let current = null;
  for (const line of git(root, ["worktree", "list", "--porcelain"]).split("\n")) {
    if (line.startsWith("worktree ")) {
      current = { path: line.slice("worktree ".length), branch: "detached" };
      out.push(current);
    } else if (line.startsWith("branch ") && current) {
      current.branch = line.slice("branch refs/heads/".length);
    }
  }
  const top = git(root, ["rev-parse", "--show-toplevel"]) || root;
  return out.filter((w) => w.path !== top);
}

/**
 * Branches that had a remote and no longer do, which is what a merge with
 * `--delete-branch` leaves. A branch that was never pushed has no upstream at
 * all and is not this: it is unpushed work, and saying "leftover" about it is
 * how someone loses it.
 */
export function goneBranches(root) {
  return git(root, [
    "for-each-ref",
    "--format=%(refname:short)|%(upstream)|%(upstream:track)",
    "refs/heads/",
  ])
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split("|"))
    .filter(([, upstream, track]) => upstream && track === "[gone]")
    .map(([name]) => name);
}

/**
 * A dev server on one of the ports this project pins, owned by a directory
 * that is not this checkout. Its own server is not a leftover; somebody
 * else's is, because reusing it silently tests the wrong code.
 */
export function foreignServers(root) {
  const found = [];
  for (const port of DEV_PORTS) {
    const pids = run("lsof", ["-ti", `:${port}`]).split("\n").filter(Boolean);
    for (const pid of pids) {
      // -Fn prints the field-prefixed form: an `n` line carries the path.
      const cwdLine = run("lsof", ["-a", "-p", pid, "-d", "cwd", "-Fn"])
        .split("\n")
        .find((l) => l.startsWith("n"));
      const dir = cwdLine ? cwdLine.slice(1) : "";
      if (dir && dir !== root) {
        found.push({ dir, pid, port });
      }
    }
  }
  return found;
}

/** The report, as lines. Pure, so the shapes above are what the tests drive. */
export function workspaceLines({ worktrees, gone, servers }) {
  const lines = [];
  for (const w of worktrees) {
    lines.push(
      `Leftover worktree: ${w.path} on ${w.branch}. Remove it with \`git worktree remove ${w.path}\` once its branch has merged.`
    );
  }
  if (gone.length > 0) {
    lines.push(
      `Leftover branches (${gone.length}), remote already deleted: ${gone.join(", ")}.`
    );
    lines.push(
      `  A squash merge leaves each one "not fully merged", so \`git branch -d\` refuses it. Ask the user to run: git branch -D ${gone.join(" ")}`
    );
  }
  for (const s of servers) {
    lines.push(
      `Leftover dev server: pid ${s.pid} holds port ${s.port} from ${s.dir}, not this checkout. Both Playwright configs reuse it, so a browser suite would scan that code and pass. Stop it before any browser suite.`
    );
  }
  return lines.length > 0 ? lines : ["Leftovers: none."];
}

function main(argv) {
  const rootFlag = argv.indexOf("--root");
  const root =
    rootFlag === -1 ? process.cwd() : (argv[rootFlag + 1] ?? process.cwd());
  const top = git(root, ["rev-parse", "--show-toplevel"]) || root;
  const lines = workspaceLines({
    gone: goneBranches(top),
    servers: argv.includes("--ports") ? foreignServers(top) : [],
    worktrees: otherWorktrees(top),
  });
  process.stdout.write(`${lines.join("\n")}\n`);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  main(process.argv.slice(2));
}
