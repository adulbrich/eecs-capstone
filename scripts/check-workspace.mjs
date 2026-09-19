/**
 * What finished work left behind in a checkout, as a report.
 *
 * Three leftovers, and each one has cost a session real time. A worktree under
 * `.claude/worktrees/` outlives the branch it was made for, and until #515 the
 * unit suite walked into it and ran that copy's tests against that copy's
 * `node_modules`. A dev server started inside one keeps a port. And a branch
 * whose remote is gone piles up: `git branch -d` refuses it, because a squash
 * merge leaves it "not fully merged", so the pile never clears by itself.
 *
 * The two ports fail differently, which is why `DEV_PORTS` carries a sentence
 * each rather than one line for both. Only the accessibility suite reuses a
 * server it did not start (`playwright.a11y.config.ts`, `reuseExistingServer:
 * !CI` on 3000), so only there does a foreign server mean a green run against
 * code that is not on the branch. The smoke suite already defends itself:
 * `playwright.e2e.config.ts` never reuses, and `src/test/e2e/constants.ts`
 * moved it to 3001 for this exact reason, so a foreign server there fails the
 * run loudly instead.
 *
 * This reports; it never removes, and not only because of the branch rule.
 * A worktree or a server can belong to a session that is still running: this
 * repo is worked from several at once, and killing the process another session
 * is mid-suite on would be a worse bug than the one being prevented. The
 * branch case is the hard one on top of that: deleting a merged branch here
 * means force-deleting it, and `.claude/hooks/guard-git.mjs` reserves that for
 * the user on purpose.
 *
 * What it cannot see: a leftover made after the report ran. The SessionStart
 * hook calls this once, at the first message, so it catches what the last
 * session left, never what this one is about to. That is what step 6 of
 * CONTRIBUTING.md's process is for.
 *
 * Usage:
 *   node scripts/check-workspace.mjs                report on the cwd's checkout
 *   node scripts/check-workspace.mjs --root <dir>   report on another checkout
 *   node scripts/check-workspace.mjs --ports        also probe 3000 and 3001
 *   node scripts/check-workspace.mjs --ports 3000   probe the ports named
 *
 * The list form of `--ports` is there so the probe can be tested against a
 * port the kernel just handed out, rather than against whatever happens to be
 * on 3000 on the machine running the suite. Nothing in this repo passes it;
 * say so rather than let it read as a workflow somebody uses.
 */
import { execFileSync } from "node:child_process";

/**
 * The ports this project pins, each with what a foreign server on it does to
 * a run. Kept together so the two cannot drift apart: the consequence is the
 * reason the port is listed at all.
 */
const DEV_PORTS = [
  {
    port: 3000,
    why: "the accessibility suite reuses a server it did not start, so a run would scan that code and report green",
  },
  {
    port: 3001,
    why: "the smoke suite never reuses a server, so it cannot bind this port and the run fails to start",
  },
];
const PROBE_TIMEOUT = 1500;
/**
 * The whole port probe's budget, not one call's.
 *
 * `composeLine` in the session hook caps a single subprocess and says why: a
 * convenience must fail visibly rather than stall a session. This runs up to
 * one `lsof` per port plus two per listening pid, so a per-call cap alone
 * bounds nothing. When the budget runs out the report names the ports it did
 * not reach, because silence would read as "no foreign server", which is the
 * answer this exists to avoid getting wrong, and naming 3000 when 3001 was
 * the one skipped is the same mistake with extra confidence.
 */
const PROBE_BUDGET = 2500;

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
export function foreignServers(root, ports) {
  const wanted = (ports ?? DEV_PORTS.map((p) => p.port)).map((port) => ({
    port,
    why:
      DEV_PORTS.find((p) => p.port === port)?.why ??
      "a suite that expects this port would reach that code instead",
  }));
  const found = [];
  const deadline = Date.now() + PROBE_BUDGET;
  /** Ports still to check, so a cut-short probe can name what it skipped. */
  const left = (from) => wanted.slice(from).map((p) => p.port);
  for (const [index, { port, why }] of wanted.entries()) {
    if (Date.now() > deadline) {
      return { servers: found, unchecked: left(index) };
    }
    const pids = run("lsof", ["-ti", `:${port}`]).split("\n").filter(Boolean);
    for (const pid of pids) {
      if (Date.now() > deadline) {
        // This port counts as unchecked: a pid whose directory was never read
        // is a server this run cannot speak for.
        return { servers: found, unchecked: left(index) };
      }
      // -Fn prints the field-prefixed form: an `n` line carries the path.
      const cwdLine = run("lsof", ["-a", "-p", pid, "-d", "cwd", "-Fn"])
        .split("\n")
        .find((l) => l.startsWith("n"));
      const dir = cwdLine ? cwdLine.slice(1) : "";
      if (dir && dir !== root) {
        found.push({ dir, pid, port, why });
      }
    }
  }
  return { servers: found, unchecked: [] };
}

/** The report, as lines. Pure, so the shapes above are what the tests drive. */
export function workspaceLines({ worktrees, gone, servers, unchecked }) {
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
      `Leftover dev server: pid ${s.pid} holds port ${s.port} from ${s.dir}, not this checkout. Stop it before a browser suite, because ${s.why}.`
    );
  }
  if (unchecked && unchecked.length > 0) {
    lines.push(
      `Port probe: out of budget after ${PROBE_BUDGET}ms, so this says nothing about ${unchecked.join(" or ")}. Check with \`lsof -ti :${unchecked[0]}\` before a browser suite.`
    );
  }
  return lines.length > 0 ? lines : ["Leftovers: none."];
}

/** `--ports` alone means the pinned pair; `--ports 3000,4000` means those. */
function portsFrom(argv) {
  const at = argv.indexOf("--ports");
  if (at === -1) {
    return null;
  }
  const next = argv[at + 1];
  if (!next || next.startsWith("--")) {
    return DEV_PORTS.map((p) => p.port);
  }
  return next.split(",").map(Number).filter(Number.isInteger);
}

function main(argv) {
  const rootFlag = argv.indexOf("--root");
  const root =
    rootFlag === -1 ? process.cwd() : (argv[rootFlag + 1] ?? process.cwd());
  const top = git(root, ["rev-parse", "--show-toplevel"]) || root;
  const ports = portsFrom(argv);
  const probe = ports
    ? foreignServers(top, ports)
    : { servers: [], unchecked: [] };
  const lines = workspaceLines({
    gone: goneBranches(top),
    servers: probe.servers,
    unchecked: probe.unchecked,
    worktrees: otherWorktrees(top),
  });
  process.stdout.write(`${lines.join("\n")}\n`);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  main(process.argv.slice(2));
}
