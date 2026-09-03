/**
 * SessionStart: the facts every session used to have to be told, printed into
 * context. Branch and whether it is main, uncommitted changes, the Node in
 * use against `.nvmrc`, and which compose services are up. No network.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { cleanEnv, currentBranch, readInput, repoRoot } from "./lib.mjs";

/**
 * A probe worth waiting on, and one that is not.
 *
 * The git ones read local files. The compose probe talks to a daemon that can
 * be busy, wedged or absent, and every second it takes is a second before a
 * session starts, for an answer that is a convenience. So it is capped short,
 * and every caller passes its own number: a default here would be named after
 * whichever probe was written first.
 */
const GIT_TIMEOUT = 5000;
const COMPOSE_TIMEOUT = 1500;

/** The output, or "" for anything that went wrong, timeouts included. */
function run(file, args, cwd, timeout) {
  try {
    return execFileSync(file, args, {
      cwd,
      encoding: "utf8",
      env: cleanEnv,
      stdio: ["ignore", "pipe", "ignore"],
      timeout,
    }).trim();
  } catch {
    return "";
  }
}

/**
 * Which compose services are up, as a line.
 *
 * Separate from `run` because a timeout has to stay distinguishable here. An
 * empty answer and an answer that never came look identical to `run` and mean
 * opposite things, and with the cap this short the timeout is reachable on a
 * cold daemon. Telling a session to `docker compose up -d` when the stack is
 * already running is worse advice than admitting the check did not finish.
 */
function composeLine(cwd) {
  const NOTHING =
    "Compose: nothing running. `docker compose up -d` before the integration, smoke or accessibility suites.";
  let out = "";
  try {
    out = execFileSync(
      "docker",
      ["compose", "ps", "--status", "running", "--format", "{{.Service}}"],
      {
        cwd,
        encoding: "utf8",
        env: cleanEnv,
        stdio: ["ignore", "pipe", "ignore"],
        timeout: COMPOSE_TIMEOUT,
      }
    ).trim();
  } catch (error) {
    // Anything else (no docker on PATH, no daemon) really is nothing running.
    return error?.code === "ETIMEDOUT"
      ? `Compose: no answer in ${COMPOSE_TIMEOUT}ms. Check with \`docker compose ps\` before the integration, smoke or accessibility suites.`
      : NOTHING;
  }
  const services = out.split("\n").filter(Boolean);
  return services.length === 0
    ? NOTHING
    : `Compose: ${services.join(", ")} running.`;
}

const input = readInput();
const cwd = input.cwd ?? process.cwd();
const lines = [];

const branch = currentBranch(cwd) || "(detached)";
lines.push(
  branch === "main"
    ? "Branch: main. Do not commit here: fetch, then branch from origin/main first (AGENTS.md)."
    : `Branch: ${branch}.`
);

const dirty = run("git", ["status", "--porcelain"], cwd, GIT_TIMEOUT)
  .split("\n")
  .filter(Boolean).length;
lines.push(
  dirty === 0
    ? "Working tree: clean."
    : `Working tree: ${dirty} uncommitted path(s). Stage by name; they may be someone else's work in progress.`
);

let wanted = "";
try {
  wanted = readFileSync(`${repoRoot(cwd)}/.nvmrc`, "utf8").trim();
} catch {
  // No .nvmrc in this checkout.
}
const node = process.version.replace(/^v/, "");
if (wanted && !node.startsWith(wanted.replace(/^v/, ""))) {
  lines.push(
    `Node: ${node} on PATH, .nvmrc wants ${wanted}. Run the tests on the .nvmrc Node (docs/QUIRKS.md, Vitest).`
  );
} else {
  lines.push(`Node: ${node}.`);
}

lines.push(composeLine(cwd));

lines.push(
  "Gates: lefthook.yml at commit and push, the hooks under .claude/hooks in this session. CONTRIBUTING.md has the table."
);

process.stdout.write(`${lines.join("\n")}\n`);
