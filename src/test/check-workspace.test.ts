import { spawn, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

/** The report for `dir`. The port probe is off unless a case asks for it. */
function report(dir: string, ...extra: string[]) {
  const result = spawnSync(
    process.execPath,
    [join(cwd, "scripts/check-workspace.mjs"), "--root", dir, ...extra],
    { encoding: "utf8", env }
  );
  return { status: result.status, stdout: result.stdout };
}

/**
 * A process listening on a free port from `dir`, which is what the probe is
 * looking for: a server whose working directory is not this checkout. Its own
 * port is picked by the kernel, so the test never fights whatever is on 3000.
 */
function listenerIn(dir: string) {
  const child = spawn(
    process.execPath,
    [
      "-e",
      "const s=require('net').createServer();s.listen(0,'127.0.0.1',()=>console.log(s.address().port));setInterval(()=>{},1e6)",
    ],
    { cwd: dir, env, stdio: ["ignore", "pipe", "ignore"] }
  );
  const port = new Promise<number>((resolve, reject) => {
    child.stdout.on("data", (chunk: Buffer) =>
      resolve(Number(chunk.toString().trim()))
    );
    child.on("error", reject);
  });
  return { child, port };
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

  it("names a server on a probed port whose directory is not this checkout", async () => {
    const { dir } = repoWithRemote();
    const outside = mkdtempSync(join(tmpdir(), "elsewhere-"));
    temp.push(outside);
    const { child, port } = listenerIn(outside);
    try {
      const result = report(dir, "--ports", String(await port));
      expect(result.stdout).toContain(`port ${await port}`);
      expect(result.stdout).toContain(String(child.pid));
      expect(result.stdout).toContain("Stop it before a browser suite");
    } finally {
      child.kill();
    }
  }, 20_000);

  it("says nothing about a port nobody is listening on", async () => {
    const { dir } = repoWithRemote();
    // Bind a port, learn its number, then give it back: the odds of anything
    // else taking it inside this test are what make this a free port rather
    // than a guess at one.
    const outside = mkdtempSync(join(tmpdir(), "elsewhere-"));
    temp.push(outside);
    const { child, port } = listenerIn(outside);
    const free = await port;
    child.kill();
    await new Promise((r) => setTimeout(r, 200));

    expect(report(dir, "--ports", String(free)).stdout).toContain(
      "Leftovers: none"
    );
  }, 20_000);

  it("says which ports it could not check when the probe runs out of budget", async () => {
    // A fake `lsof` that never answers, the way the session-context test fakes
    // a slow `docker`. An answer that never came and an answer of "nobody is
    // listening" are the same empty string to the caller, and they mean
    // opposite things: reporting none of the second when it was the first is
    // how a stray dev server stays invisible.
    const bin = mkdtempSync(join(tmpdir(), "slow-lsof-"));
    temp.push(bin);
    writeFileSync(join(bin, "lsof"), "#!/bin/sh\nsleep 30\n");
    chmodSync(join(bin, "lsof"), 0o755);
    const { dir } = repoWithRemote();

    const result = spawnSync(
      process.execPath,
      [
        join(cwd, "scripts/check-workspace.mjs"),
        "--root",
        dir,
        "--ports",
        "3000,3001",
      ],
      { encoding: "utf8", env: { ...env, PATH: `${bin}:${process.env.PATH}` } }
    );

    expect(result.stdout).toContain("3000");
    expect(result.stdout).not.toContain("Leftovers: none");
  }, 30_000);

  it("leaves a branch that was never pushed alone", () => {
    const { dir } = repoWithRemote();
    run(dir, "branch", "wip/never-pushed");
    const result = report(dir);
    expect(result.stdout).not.toContain("wip/never-pushed");
  });
});
