import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
/**
 * A git hook exports GIT_DIR to everything it runs, and pre-push runs this
 * suite, so every spawn here gets an environment without the GIT_* keys
 * (docs/QUIRKS.md, "A test that spawns git under a hook").
 */
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))
);

function run(
  script: string,
  args: string[],
  stdin?: string,
  cwd = process.cwd()
) {
  const result = spawnSync(
    process.execPath,
    [`${process.cwd()}/scripts/${script}`, ...args],
    { cwd, encoding: "utf8", env, input: stdin }
  );
  return { status: result.status, stderr: result.stderr };
}

/**
 * A throwaway repository with the given commit subjects, oldest first, and
 * a `git` bound to it. Remove `dir` when done.
 */
function repoWith(subjects: string[]) {
  const dir = mkdtempSync(join(tmpdir(), "range-"));
  const git = (...args: string[]) =>
    spawnSync("git", ["-C", dir, ...args], { encoding: "utf8", env });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  for (const [index, subject] of subjects.entries()) {
    writeFileSync(join(dir, `f${index}`), subject);
    git("add", `f${index}`);
    git("commit", "-q", "-m", subject);
  }
  return { dir, git };
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

  it("rejects an uppercase subject after the colon, and only that", () => {
    expect(commit("fix(x): Stop it").status).toBe(1);
    expect(commit("fix(x): \u00dcber alles").status).toBe(1);
    expect(commit("fix(x): 404 page gets a body").status).toBe(0);
    expect(commit('fix(x): "foo" is not a status').status).toBe(0);
  });

  it("accepts Dependabot's capitalized Bump on a deps scope", () => {
    expect(
      commit("chore(deps): Bump actions/checkout from 6 to 7").status
    ).toBe(0);
    expect(commit("build(deps-dev): Bump vitest from 3 to 4").status).toBe(0);
    expect(commit("fix(x): Bump nothing").status).toBe(1);
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

  it("ignores git's comment lines and the scissors block in a message file", () => {
    const dir = mkdtempSync(join(tmpdir(), "msg-"));
    const file = join(dir, "COMMIT_EDITMSG");
    writeFileSync(
      file,
      [
        "fix(x): y",
        "# Please enter the commit message \u2014 lines starting with # are ignored",
        "# ------------------------ >8 ------------------------",
        "diff --git a/x b/x",
        "+ \u2014 in the diff",
      ].join("\n")
    );
    try {
      expect(run("check-commit-message.mjs", [file]).status).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("checks a markdown heading in a PR body, which is not a comment", () => {
    expect(commit("fix(x): y\n\n## Docs \u2014 none\n").status).toBe(1);
    expect(commit("fix(x): y\n\n## Docs\n\nnone\n").status).toBe(0);
  });

  it("checks every commit in a range and names the one that fails", () => {
    const bad = repoWith(["chore: seed", "Add the thing", "fix(x): fine"]).dir;
    const good = repoWith(["chore: seed", "fix(x): fine"]).dir;
    try {
      const result = run(
        "check-commit-message.mjs",
        ["--range", "HEAD~2..HEAD"],
        undefined,
        bad
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Add the thing");
      expect(result.stderr).not.toContain("fix(x): fine");
      expect(
        run(
          "check-commit-message.mjs",
          ["--range", "HEAD~1..HEAD"],
          undefined,
          good
        ).status
      ).toBe(0);
    } finally {
      rmSync(bad, { recursive: true, force: true });
      rmSync(good, { recursive: true, force: true });
    }
  });

  it("still checks the body of a merge commit in a range", () => {
    const { dir, git } = repoWith(["chore: seed"]);
    try {
      git("checkout", "-q", "-b", "topic");
      writeFileSync(join(dir, "t"), "t");
      git("add", "t");
      git("commit", "-q", "-m", "fix(x): topic");
      git("checkout", "-q", "main");
      git(
        "merge",
        "--no-ff",
        "-q",
        "-m",
        "Merge branch 'topic'\n\nClaude-Session: https://claude.ai/code/session/abc",
        "topic"
      );
      const result = run(
        "check-commit-message.mjs",
        ["--range", "HEAD~1..HEAD"],
        undefined,
        dir
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("claude.ai/code/session");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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
    try {
      const result = wrapper(["node", "--version"], {
        cwd: dir,
        env: { ...process.env, HOME: dir, NVM_DIR: join(dir, "none") },
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(".nvmrc wants 99.0.0");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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
    expect(prose("\u{23F0} alarm").status).toBe(1);
    expect(prose("\u{2139}\u{FE0F} info").status).toBe(1);
  });

  it("passes the keyboard and details glyphs a doc uses", () => {
    expect(
      prose("Press \u2318K or \u2325\u23CE\n\u25B6 Details\n").status
    ).toBe(0);
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
