import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/**
 * What a finished piece of work leaves behind in a checkout, reported so the
 * next session is told rather than finding out. `scripts/` sits outside the
 * TypeScript project, so the CLI is the seam rather than an import, as for the
 * other rule scripts.
 *
 * Every case runs in a throwaway repository with its own bare remote, because
 * the two signals this reads (a registered worktree, an upstream that is gone)
 * cannot be staged in this checkout without disturbing whoever is working in
 * it.
 */
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))
);
const cwd = process.cwd();
const temp: string[] = [];
afterAll(() => {
  for (const dir of temp) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function run(dir: string, ...args: string[]) {
  return spawnSync("git", ["-C", dir, ...args], { encoding: "utf8", env });
}

/** A repository on `main` with a bare origin it has pushed to. */
function repoWithRemote() {
  const base = mkdtempSync(join(tmpdir(), "workspace-"));
  temp.push(base);
  const remote = join(base, "remote.git");
  const dir = join(base, "work");
  spawnSync("git", ["init", "-q", "--bare", "-b", "main", remote], { env });
  spawnSync("git", ["init", "-q", "-b", "main", dir], { env });
  run(dir, "config", "user.email", "t@example.com");
  run(dir, "config", "user.name", "t");
  writeFileSync(join(dir, "a"), "a");
  run(dir, "add", "a");
  run(dir, "commit", "-q", "-m", "chore: seed");
  run(dir, "remote", "add", "origin", remote);
  run(dir, "push", "-q", "-u", "origin", "main");
  return { base, dir, remote };
}

/** The report for `dir`, with the port probe off: no test binds a port. */
function report(dir: string) {
  const result = spawnSync(
    process.execPath,
    [join(cwd, "scripts/check-workspace.mjs"), "--root", dir],
    { encoding: "utf8", env }
  );
  return { status: result.status, stdout: result.stdout };
}

describe("check-workspace", () => {
  it("says there is nothing to clean up in a tidy checkout", () => {
    const { dir } = repoWithRemote();
    const result = report(dir);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Leftovers: none");
  });

  it("names a worktree and the branch it holds", () => {
    const { base, dir } = repoWithRemote();
    run(dir, "branch", "feat/side");
    run(dir, "worktree", "add", "-q", join(base, "side"), "feat/side");

    const result = report(dir);
    expect(result.stdout).toContain("side");
    expect(result.stdout).toContain("feat/side");
    expect(result.stdout).not.toContain("Leftovers: none");
  });

  it("does not count the checkout itself as a worktree left behind", () => {
    const { dir } = repoWithRemote();
    expect(report(dir).stdout).toContain("Leftovers: none");
  });

  it("names a branch whose upstream is gone, with the command that removes it", () => {
    const { dir, remote } = repoWithRemote();
    run(dir, "checkout", "-q", "-b", "feat/merged");
    run(dir, "push", "-q", "-u", "origin", "feat/merged");
    run(dir, "checkout", "-q", "main");
    spawnSync(
      "git",
      ["-C", remote, "update-ref", "-d", "refs/heads/feat/merged"],
      {
        env,
      }
    );
    run(dir, "fetch", "-q", "--prune", "origin");

    const result = report(dir);
    expect(result.stdout).toContain("feat/merged");
    // Force, because a squash merge leaves the branch "not fully merged" and
    // plain -d refuses it. The report says so rather than leaving the reader
    // to find out.
    expect(result.stdout).toContain("git branch -D");
  });

  it("leaves a branch that was never pushed alone", () => {
    const { dir } = repoWithRemote();
    run(dir, "branch", "wip/never-pushed");
    const result = report(dir);
    expect(result.stdout).not.toContain("wip/never-pushed");
  });
});
