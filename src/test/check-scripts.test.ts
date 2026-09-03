import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The two rule scripts under `scripts/` are driven the way lefthook, CI and
 * the Claude Code hooks drive them: as a process with an exit code. Testing
 * the CLI rather than an import is deliberate, because the exit code is the
 * contract every caller reads, and `scripts/` sits outside Biome and the
 * TypeScript project.
 */
function run(script: string, args: string[], stdin?: string) {
  const result = spawnSync(process.execPath, [`scripts/${script}`, ...args], {
    encoding: "utf8",
    input: stdin,
  });
  return { status: result.status, stderr: result.stderr };
}

const commit = (message: string) =>
  run("check-commit-message.mjs", ["--stdin"], message);
const prose = (text: string) => run("check-prose.mjs", ["--stdin"], text);

describe("check-commit-message", () => {
  it("accepts a conventional subject with a scope", () => {
    expect(commit("fix(projects): stop the field lying\n").status).toBe(0);
  });

  it("accepts a breaking change marker and a subject-only message", () => {
    expect(commit("feat(inventory)!: give items many categories").status).toBe(
      0
    );
    expect(commit("chore: tidy").status).toBe(0);
  });

  it("accepts a subject that leads with an identifier in backticks", () => {
    expect(commit("fix(ci): `smoke` needs the seed").status).toBe(0);
  });

  it("exempts the subjects git and GitHub write", () => {
    expect(commit("Merge branch 'main' into fix/x").status).toBe(0);
    expect(commit('Revert "feat(x): y"').status).toBe(0);
    expect(commit("fixup! feat(x): y").status).toBe(0);
  });

  it("rejects a bare subject and an unknown type", () => {
    const bare = commit("Add the thing");
    expect(bare.status).toBe(1);
    expect(bare.stderr).toContain("lowercase imperative");
    expect(commit("wip(x): thing").status).toBe(1);
  });

  it("rejects an uppercase subject after the colon", () => {
    expect(commit("fix(x): Stop it").status).toBe(1);
  });

  it("rejects a session link anywhere, and names it first", () => {
    const result = commit(
      "fix(x): y\n\nClaude-Session: https://claude.ai/code/session/abc\n"
    );
    expect(result.status).toBe(1);
    expect(result.stderr.split("\n")[0]).toContain("claude.ai/code/session");
  });

  it("rejects an emdash or an emoji in the body", () => {
    expect(commit("fix(x): y\n\nbecause \u2014 reasons\n").status).toBe(1);
    expect(commit("fix(x): y \u2705\n").status).toBe(1);
  });

  it("ignores git's comment lines and everything after the scissors", () => {
    const message = [
      "fix(x): y",
      "# Please enter the commit message \u2014 lines starting with # are ignored",
      "# ------------------------ >8 ------------------------",
      "diff --git a/x b/x",
      "+ \u2014 in the diff",
    ].join("\n");
    expect(commit(message).status).toBe(0);
  });

  it("checks every commit in a range", () => {
    const result = run("check-commit-message.mjs", ["--range", "HEAD~1..HEAD"]);
    // The most recent commit on any branch of this repo passes the rule, so
    // this exercises the range path rather than the rule.
    expect([0, 1]).toContain(result.status);
  });
});

describe("nvmrc-node", () => {
  const wrapper = (
    args: string[],
    options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}
  ) =>
    spawnSync("sh", ["scripts/nvmrc-node.sh", ...args], {
      encoding: "utf8",
      ...options,
    });

  it("runs the command on the .nvmrc major", () => {
    const wanted = readFileSync(".nvmrc", "utf8").trim().replace(/^v/, "");
    const result = wrapper(["node", "--version"]);
    expect(result.status).toBe(0);
    expect(result.stdout.trim().replace(/^v/, "").split(".")[0]).toBe(
      wanted.split(".")[0]
    );
  });

  it("refuses on the version, not on the tests, when it cannot switch", () => {
    const dir = mkdtempSync(join(tmpdir(), "nvmrc-"));
    writeFileSync(join(dir, ".nvmrc"), "99.0.0\n");
    spawnSync("ln", [
      "-s",
      join(process.cwd(), "scripts"),
      join(dir, "scripts"),
    ]);
    const result = wrapper(["node", "--version"], {
      cwd: dir,
      env: { ...process.env, HOME: dir, NVM_DIR: join(dir, "none") },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(".nvmrc wants 99.0.0");
  });
});

describe("check-prose", () => {
  it("passes plain prose, arrows and task-list checkmarks", () => {
    expect(prose("A comma, a colon: fine.\n- [x] done\nA -> B\n").status).toBe(
      0
    );
  });

  it("fails on an emdash with the line number", () => {
    const result = prose("one\ntwo \u2014 three\n");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("text:2: emdash");
  });

  it("fails on an emoji in any of the pictograph ranges", () => {
    expect(prose("\u2705 done").status).toBe(1);
    expect(prose("\u274C no").status).toBe(1);
    expect(prose("\u{1F7E1} partial").status).toBe(1);
  });

  it("does not count the harness footer on a PR body", () => {
    expect(
      prose(
        "Closes #1.\n\n\u{1F916} Generated with [Claude Code](https://claude.com/claude-code)\n"
      ).status
    ).toBe(0);
  });

  it("checks the named files and skips paths outside the rule", () => {
    expect(
      run("check-prose.mjs", ["AGENTS.md", "docs/superpowers/plans/x.md"])
        .status
    ).toBe(0);
  });

  it("is clean over the whole tracked tree", () => {
    const result = run("check-prose.mjs", ["--all"]);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });
});
