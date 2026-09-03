/**
 * SessionStart: the facts every session used to have to be told, printed into
 * context. Branch and whether it is main, uncommitted changes, the Node in
 * use against `.nvmrc`, and which compose services are up. No network.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { cleanEnv, currentBranch, readInput } from "./lib.mjs";

function run(file, args, cwd) {
  try {
    return execFileSync(file, args, {
      cwd,
      encoding: "utf8",
      env: cleanEnv,
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
    }).trim();
  } catch {
    return "";
  }
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

const dirty = run("git", ["status", "--porcelain"], cwd)
  .split("\n")
  .filter(Boolean).length;
lines.push(
  dirty === 0
    ? "Working tree: clean."
    : `Working tree: ${dirty} uncommitted path(s). Stage by name; they may be someone else's work in progress.`
);

let wanted = "";
try {
  wanted = readFileSync(`${cwd}/.nvmrc`, "utf8").trim();
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

const services = run(
  "docker",
  ["compose", "ps", "--status", "running", "--format", "{{.Service}}"],
  cwd
)
  .split("\n")
  .filter(Boolean);
lines.push(
  services.length === 0
    ? "Compose: nothing running. `docker compose up -d` before the integration, smoke or accessibility suites."
    : `Compose: ${services.join(", ")} running.`
);

lines.push(
  "Gates: lefthook.yml at commit and push, the hooks under .claude/hooks in this session. CONTRIBUTING.md has the table."
);

process.stdout.write(`${lines.join("\n")}\n`);
