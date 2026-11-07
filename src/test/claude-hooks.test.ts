import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/**
 * The Claude Code hooks under `.claude/hooks/` are processes that read one
 * JSON object on stdin and answer with an exit code (2 blocks) or a JSON
 * decision on stdout. These drive them exactly that way, from this checkout,
 * so a hook that silently stops firing is a red test rather than a rule
 * quietly back on the honor system.
 */
const cwd = process.cwd();

/**
 * A git hook exports GIT_DIR and friends to everything it runs, so under
 * pre-push a git spawned in a throwaway repo would answer for this checkout
 * instead. The hooks and the fixture repo get an environment without them.
 */
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))
);

const temp: string[] = [];
afterAll(() => {
  for (const dir of temp) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function hook(
  name: string,
  input: Record<string, unknown>,
  envOverrides: Record<string, string> = {}
) {
  const result = spawnSync(process.execPath, [`.claude/hooks/${name}.mjs`], {
    encoding: "utf8",
    env: { ...env, ...envOverrides },
    input: JSON.stringify({ cwd, ...input }),
  });
  return {
    status: result.status,
    stderr: result.stderr,
    stdout: result.stdout,
  };
}

const bash = (
  name: string,
  command: string,
  extra: Record<string, unknown> = {}
) => hook(name, { tool_name: "Bash", tool_input: { command }, ...extra });

/**
 * A throwaway repository on `branch`, with a `sub` directory, for the rules
 * that read the branch. The git guard's tests all run in one on a feature
 * branch rather than in this checkout: on a push to `main`, CI checks out
 * `main` itself, and a test that commits from there trips the very rule it
 * is not testing. The rule scripts are loaded from the session's checkout
 * through a symlink.
 */
function repoOn(branch: string) {
  const dir = mkdtempSync(join(tmpdir(), "hooks-"));
  temp.push(dir);
  const git = (...args: string[]) =>
    spawnSync("git", ["-C", dir, ...args], { encoding: "utf8", env });
  git("init", "-q", "-b", branch);
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  writeFileSync(join(dir, "a"), "a");
  git("add", "a");
  git("commit", "-q", "-m", "chore: seed");
  spawnSync("ln", ["-s", join(cwd, "scripts"), join(dir, "scripts")]);
  mkdirSync(join(dir, "sub"));
  return dir;
}

const feature = repoOn("fix/test");
const guardGit = (command: string, extra: Record<string, unknown> = {}) =>
  bash("guard-git", command, { cwd: feature, ...extra });

describe("guard-git", () => {
  it("lets ordinary git through", () => {
    for (const command of [
      "git status && git add src/x.ts",
      "git push -u origin fix/x",
      "git push --force-with-lease origin fix/x",
      "git restore src/x.ts",
      "git restore --staged .",
      "git restore -S .",
      "git add -A.md",
      "git branch -d fix/x",
      "ls -la",
    ]) {
      expect(guardGit(command).status, command).toBe(0);
    }
  });

  it("denies staging everything, in every spelling", () => {
    for (const command of [
      "git add -A",
      "git add .",
      "git add ./",
      "git add --all",
      "cd src && git add -A .",
      "git -C /tmp/x add -A",
      "git -c core.quotepath=off add --all .",
      "git commit -am 'fix(x): y'",
      "git commit --all -m 'fix(x): y'",
    ]) {
      const result = guardGit(command);
      expect(result.status, command).toBe(2);
      expect(result.stderr).toContain("Stage files by name");
    }
  });

  it("denies the destructive forms, long and short", () => {
    for (const command of [
      "git reset --hard HEAD~1",
      "git clean -fd",
      "git clean --force",
      "git branch -D fix/x",
      "git branch --delete --force fix/x",
      "git checkout .",
      "git checkout HEAD .",
      "git checkout -- .",
      "git restore .",
      "git restore --source=HEAD .",
      "git restore --staged --worktree .",
    ]) {
      expect(guardGit(command).status, command).toBe(2);
    }
  });

  it("does not read a quoted string as a command", () => {
    expect(
      guardGit('git commit -m "fix(x): stop using git add -A"').status
    ).toBe(0);
    expect(guardGit('echo "git branch -D foo"').status).toBe(0);
  });

  it("denies a commit on main unless the command branches first", () => {
    const main = repoOn("main");
    const onMain = guardGit('git commit -m "fix(x): y"', {
      cwd: main,
    });
    expect(onMain.status).toBe(2);
    expect(onMain.stderr).toContain("Never commit on main");
    expect(
      guardGit('git checkout -b fix/x && git commit -m "fix(x): y"', {
        cwd: main,
      }).status
    ).toBe(0);
    expect(
      guardGit('git commit -m "fix(x): y" && git checkout -b fix/x', {
        cwd: main,
      }).status
    ).toBe(2);
  });

  it("denies a force push at main in every spelling", () => {
    const main = repoOn("main");
    for (const command of [
      "git push --force origin main",
      "git push -f origin HEAD:main",
      "git push origin +main",
      "git push origin +HEAD:main",
      "git push --force origin HEAD:refs/heads/main",
      "git push --force-with-lease origin fix/x:refs/heads/main",
    ]) {
      expect(guardGit(command).status, command).toBe(2);
    }
    expect(guardGit("git push --force-with-lease", { cwd: main }).status).toBe(
      2
    );
  });

  it("checks the message of a -m commit", () => {
    const bad = guardGit('git commit -m "Add the thing"');
    expect(bad.status).toBe(2);
    expect(bad.stderr).toContain("lowercase imperative");
    expect(guardGit("git commit -m 'fix(x): y \u2014 because'").status).toBe(2);
    expect(guardGit('git commit -m "fix(x): y"').status).toBe(0);
  });

  it("checks a heredoc commit, with either quoting of the delimiter", () => {
    const withTrailer = [
      "git commit -m \"$(cat <<'EOF'",
      "fix(x): y",
      "",
      "Claude-Session: https://claude.ai/code/session/abc",
      "EOF",
      ')"',
    ].join("\n");
    const result = guardGit(withTrailer);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("claude.ai/code/session");

    const doubleQuoted = [
      'git commit -m "$(cat <<"EOF"',
      "fix(x): y",
      "",
      "Because.",
      "EOF",
      ')"',
    ].join("\n");
    expect(guardGit(doubleQuoted).status).toBe(0);
  });

  it("reads a message only from -m or the harness heredoc shape", () => {
    const elsewhere = [
      "cat > note.txt <<'EOF'",
      "Add the thing",
      "EOF",
      "git commit -m 'fix(x): y'",
    ].join("\n");
    expect(guardGit(elsewhere).status).toBe(0);
    const noteThenHarness = [
      "cat > note.txt <<'EOF'",
      "fix(x): fine note",
      "EOF",
      "git commit -m \"$(cat <<'MSG'",
      "fix(x): y",
      "",
      "Claude-Session: https://claude.ai/code/session/abc",
      "MSG",
      ')"',
    ].join("\n");
    expect(guardGit(noteThenHarness).status).toBe(2);
    expect(guardGit('git commit -m "$(printf fix)"').status).toBe(0);
    expect(
      guardGit('git commit -m "fix(x): y" -m "then \u2014 more"').status
    ).toBe(2);
  });

  it("lets a session outside this repository alone", () => {
    expect(
      guardGit('git commit -m "Add the thing"', { cwd: tmpdir() }).status
    ).toBe(0);
  });

  it("works from a subdirectory of the checkout", () => {
    const result = guardGit('git commit -m "Add the thing"', {
      cwd: join(feature, "sub"),
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("lowercase imperative");
  });
});

describe("guard-gh", () => {
  it("ignores reads and non-gh commands", () => {
    expect(bash("guard-gh", "gh pr view 12 --comments").status).toBe(0);
    expect(bash("guard-gh", "gh issue list").status).toBe(0);
  });

  it("denies a session link in a PR body", () => {
    const result = bash(
      "guard-gh",
      'gh pr create --title "fix(x): y" --body "See https://claude.ai/code/session/abc"'
    );
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("claude.ai/code/session");
  });

  it("denies an emdash in an issue comment, a release note, or an api body", () => {
    expect(
      bash("guard-gh", 'gh issue comment 5 --body "one \u2014 two"').status
    ).toBe(2);
    expect(
      bash("guard-gh", 'gh release create v1 --notes "one \u2014 two"').status
    ).toBe(2);
    expect(
      bash(
        "guard-gh",
        "gh api repos/x/y/issues/1/comments -f body=claude.ai/code/session/abc"
      ).status
    ).toBe(2);
  });

  it("checks the title of a PR create, edit and merge", () => {
    for (const command of [
      'gh pr create --title "Fix the thing" --body "ok"',
      'gh pr edit 5 --title "Fix the thing"',
      'gh pr merge 5 --squash --subject "Fix the thing"',
    ]) {
      const result = bash("guard-gh", command);
      expect(result.status, command).toBe(2);
      expect(result.stderr).toContain("squash-merge subject");
    }
  });

  it("denies the old harness footer, on its own line or inline", () => {
    const heredoc = [
      'gh pr create --title "fix(x): y" --body "$(cat <<\'EOF\'',
      "Closes #1.",
      "",
      "\u{1F916} Generated with [Claude Code](https://claude.com/claude-code)",
      "EOF",
      ')"',
    ].join("\n");
    expect(bash("guard-gh", heredoc).status).toBe(2);
    expect(
      bash(
        "guard-gh",
        'gh pr create --title "fix(x): y" --body "Closes #1. \u{1F916} Generated with [Claude Code](https://claude.com/claude-code)"'
      ).status
    ).toBe(2);
  });

  it("names Assisted-by when the old footer comes without its emoji", () => {
    const result = bash(
      "guard-gh",
      'gh pr create --title "fix(x): y" --body "Closes #1. Generated with [Claude Code](https://claude.com/claude-code)"'
    );
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Assisted-by: Claude Code");
  });

  it("checks the text of a body file, on a merge as on a create", () => {
    const dir = mkdtempSync(join(tmpdir(), "body-file-"));
    temp.push(dir);
    const dirty = join(dir, "dirty.md");
    const clean = join(dir, "clean.md");
    writeFileSync(dirty, "Closes #1\n\none \u2014 two\n");
    writeFileSync(clean, "Closes #1\n\nAssisted-by: Claude Code\n");
    const merge = bash(
      "guard-gh",
      `gh pr merge 5 --squash --subject "fix(x): y" --body-file ${dirty}`
    );
    expect(merge.status).toBe(2);
    expect(merge.stderr).toContain("the body file: line 3 has an emdash");
    expect(
      bash("guard-gh", `gh pr create --title "fix(x): y" -F ${dirty}`).status
    ).toBe(2);
    expect(
      bash(
        "guard-gh",
        `gh pr merge 5 --squash --subject "fix(x): y" --body-file ${clean}`
      ).status
    ).toBe(0);
  });

  it("still refuses the command text when the body file is a directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "body-dir-"));
    temp.push(dir);
    const result = bash(
      "guard-gh",
      `gh pr create --title "fix(x): y" --body "a \u2014 b" --body-file ${dir}`
    );
    expect(result.status).toBe(2);
  });
});

describe("guard-gh Assisted-by trailer", () => {
  const dir = mkdtempSync(join(tmpdir(), "trailer-"));
  temp.push(dir);
  const file = (name: string, text: string) => {
    const path = join(dir, name);
    writeFileSync(path, text);
    return path;
  };
  const clean = file(
    "clean.md",
    "Closes #1\n\n- x\n\nAssisted-by: Claude Code\n\n---\n\n## Ran locally\n"
  );
  const bare = file("bare.md", "Closes #1\n\n- x\n\n---\n\n## Ran locally\n");
  const below = file(
    "below.md",
    "Closes #1\n\n- x\n\n---\n\n## Ran locally\n\nAssisted-by: Claude Code\n"
  );
  const dashed = file(
    "dashed.md",
    "Closes #1\n\none \u{2014} two\n\nAssisted-by: Claude Code\n"
  );
  const T = '--title "fix(x): y"';

  it("lets a PR body through with the trailer above its --- line", () => {
    for (const command of [
      `gh pr create ${T} --body-file ${clean}`,
      `gh pr edit 5 -F ${clean}`,
      `gh pr create ${T} --body "Closes #1\n\nAssisted-by: Claude Code"`,
      `url=$(gh pr create ${T} --body-file ${clean})`,
      `url=$(gh pr create ${T} --body 'Closes #1\n\nAssisted-by: Claude Code')`,
    ]) {
      expect(bash("guard-gh", command).status, command).toBe(0);
    }
  });

  it("refuses a PR body without it, or with it only below ---", () => {
    for (const command of [
      `gh pr create ${T} --body-file ${bare}`,
      `gh pr create ${T} --body-file ${below}`,
      `gh pr edit 5 --body-file ${bare}`,
      `gh pr create ${T} --body "Closes #1"`,
      `gh pr edit 5 -b 'Closes #1'`,
    ]) {
      const result = bash("guard-gh", command);
      expect(result.status, command).toBe(2);
      expect(result.stderr).toContain(
        'no "Assisted-by: Claude Code" line above its --- line'
      );
    }
  });

  it("never asks a merge, an issue or a comment for it", () => {
    for (const command of [
      `gh pr merge 5 --squash --subject "fix(x): y" --body-file ${bare}`,
      "gh pr merge 5 --squash",
      `gh issue create --title "x" --body-file ${bare}`,
      `gh issue comment 3 --body-file ${bare}`,
      `gh pr comment 5 --body-file ${bare}`,
      'gh pr comment 5 --body "Fixed."',
      "gh pr edit 5 --add-label x",
    ]) {
      expect(bash("guard-gh", command).status, command).toBe(0);
    }
  });

  it("lets through a body it cannot read", () => {
    for (const command of [
      `gh pr create ${T}`,
      `gh pr create ${T} --body-file ${join(dir, "not-written-yet.md")}`,
      `gh pr create ${T} --body-file -`,
      `gh pr create ${T} --body "$BODY"`,
      `gh pr create ${T} --body "$(cat <<'EOF'\nfixes the "submit" button\n\nAssisted-by: Claude Code\nEOF\n)"`,
      `gh pr create ${T} --body 'It'\\''s done\n\nAssisted-by: Claude Code'`,
      `gh pr create ${T} --body 'don'"'"'t\n\nAssisted-by: Claude Code'`,
    ]) {
      expect(bash("guard-gh", command).status, command).toBe(0);
    }
  });

  it("reads only the PR call's own flags in a chain", () => {
    for (const command of [
      `gh pr merge 5 --squash && gh issue comment 3 --body "Merged in #5"`,
      `gh issue comment 3 --body "Done in #5" && gh pr edit 5 --add-label ready`,
      `gh pr create ${T} --body-file ${clean} && gh issue comment 3 --body "Opened"`,
      `gh issue comment 3 --body "Repro: gh pr create --body-file ${bare}"`,
      `gh pr comment 5 --body 'Try: gh pr edit 5 -b "x"'`,
      `cat > ${join(dir, "z.md")} <<'EOF'\nit's this:\ngh pr edit 5 --body "Closes #1"\nEOF\ngh issue comment 3 --body-file ${bare}`,
    ]) {
      expect(bash("guard-gh", command).status, command).toBe(0);
    }
    for (const command of [
      `gh issue comment 3 --body-file ${clean} && gh pr create ${T} --body-file ${bare}`,
      `gh pr edit 5 --add-label x && gh pr create ${T} --body-file ${bare}`,
      `gh pr create --title "fix(hooks): make guard-gh check bodies" --body-file ${bare}`,
      `gh pr edit 5 --body "Run gh pr view to check."`,
      `GH_PROMPT_DISABLED=1 gh pr create ${T} --body-file ${bare}`,
      `url=$(gh pr create ${T} --body-file ${bare})`,
    ]) {
      expect(bash("guard-gh", command).status, command).toBe(2);
    }
  });

  it("reads a bare body-file path up to the shell punctuation after it", () => {
    for (const command of [
      `gh issue comment 5 --body-file ${dashed}; echo done`,
      `url=$(gh pr create ${T} --body-file ${dashed}); echo "$url"`,
    ]) {
      const result = bash("guard-gh", command);
      expect(result.status, command).toBe(2);
      expect(result.stderr).toContain("the body file: line 3 has an emdash");
    }
  });
});

describe("guard-gh screenshots warning", () => {
  /**
   * A fixture branch one commit past `origin/main`, touching the paths the
   * argument names, so the hook's `git diff origin/main...HEAD` has an answer
   * that does not depend on what this checkout happens to be on.
   */
  function branchTouching(paths: string[]) {
    const dir = repoOn("feat/shots");
    const git = (...args: string[]) =>
      spawnSync("git", ["-C", dir, ...args], { encoding: "utf8", env });
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    for (const path of paths) {
      mkdirSync(join(dir, path, ".."), { recursive: true });
      writeFileSync(join(dir, path), "x");
      git("add", path);
    }
    git("commit", "-q", "-m", "feat(x): touch");
    return dir;
  }
  const ui = branchTouching(["src/components/foo.tsx"]);
  const server = branchTouching(["src/server/x.ts"]);
  // Every body carries the Assisted-by trailer, so the trailer refusal never
  // runs first and these see only the warning.
  const AB = "\n\nAssisted-by: Claude Code";
  const create = (body: string, from: string) =>
    bash(
      "guard-gh",
      `gh pr create --title "feat(x): y" --body "${body}${AB}"`,
      { cwd: from }
    );

  it("warns, without blocking, when a UI change has no screenshots section", () => {
    const result = create("Closes #1", ui);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("pr-text will fail");
    expect(result.stdout).toContain("## Screenshots");
    expect(JSON.parse(result.stdout).hookSpecificOutput.hookEventName).toBe(
      "PreToolUse"
    );
  });

  it("warns on a pr edit that sends a body inline, the other shape the issue names", () => {
    const result = bash(
      "guard-gh",
      `gh pr edit 5 --title "feat(x): y" --body "Closes #1${AB}"`,
      { cwd: ui }
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("pr-text will fail");
  });

  it("still warns on a heredoc body the trailer check cannot read", () => {
    const result = bash(
      "guard-gh",
      `gh pr create --title "feat(x): y" --body "$(cat <<'EOF'\nCloses #1${AB}\nEOF\n)"`,
      { cwd: ui }
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("pr-text will fail");
  });

  it("stays quiet for an image, the opt-out line, or a change outside the UI", () => {
    expect(
      create("## Screenshots\n![a](https://x.test/a.png)", ui).stdout
    ).toBe("");
    expect(
      create("## Screenshots\nScreenshots: none, because copy only.", ui).stdout
    ).toBe("");
    expect(create("Closes #1", server).stdout).toBe("");
  });

  it("reads a body file, and lets a missing one through", () => {
    writeFileSync(join(ui, "body.md"), `Closes #1${AB}\n`);
    const fromFile = bash(
      "guard-gh",
      'gh pr create --title "feat(x): y" --body-file body.md',
      { cwd: ui }
    );
    expect(fromFile.status).toBe(0);
    expect(fromFile.stdout).toContain("pr-text will fail");
    const missing = bash(
      "guard-gh",
      "gh pr edit 5 --body-file not-written-yet.md",
      { cwd: ui }
    );
    expect(missing.status).toBe(0);
    expect(missing.stdout).toBe("");
  });
});

describe("guard-edits", () => {
  const edit = (file: string, from = cwd) =>
    hook("guard-edits", {
      cwd: from,
      tool_name: "Edit",
      tool_input: { file_path: join(cwd, file) },
    });

  it("denies the generated and personal files with a reason", () => {
    for (const file of [
      "src/routeTree.gen.ts",
      "src/db/auth-schema.ts",
      "CLAUDE.md",
      ".env",
      ".env.local",
    ]) {
      const result = edit(file);
      expect(result.status, file).toBe(0);
      const decision = JSON.parse(result.stdout).hookSpecificOutput;
      expect(decision.permissionDecision).toBe("deny");
      expect(decision.permissionDecisionReason).toContain(file);
    }
  });

  it("still denies them from a subdirectory session", () => {
    const result = edit("src/routeTree.gen.ts", join(cwd, "src"));
    expect(
      JSON.parse(result.stdout).hookSpecificOutput.permissionDecision
    ).toBe("deny");
  });

  it("says nothing about an ordinary file", () => {
    expect(edit("AGENTS.md").stdout).toBe("");
  });
});

describe("after-edit", () => {
  const edited = (file: string) =>
    hook("after-edit", {
      tool_name: "Write",
      tool_input: { file_path: join(cwd, file) },
    });

  // Its own ceiling, for the reason the session-context test below has one:
  // this is the only test here that runs Biome, twice, and the full suite
  // spawns a worker per file, so two Biome starts on a loaded machine spend
  // the default 5000ms before either prints. Reproduced on `main` at load
  // average 14, where it failed three runs in a row and passed alone.
  it("is quiet on a clean file, and on a file Biome excludes", () => {
    expect(edited("scripts/check-prose.mjs").status).toBe(0);
    expect(edited("src/routeTree.gen.ts").status).toBe(0);
  }, 30_000);

  it("reports an emdash in a file it just saw written", () => {
    const dir = mkdtempSync(join(cwd, ".hooks-test-"));
    temp.push(dir);
    const file = join(dir, "note.md");
    writeFileSync(file, "one \u2014 two\n");
    const result = hook("after-edit", {
      tool_name: "Write",
      tool_input: { file_path: file },
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("emdash");
  });
});

describe("session-context", () => {
  // Vitest's default 5000ms is the same number as the hook's own cap on one
  // subprocess, so a single slow `docker compose ps` on a loaded runner spent
  // the whole test budget before the hook printed a line. This is the only
  // test here that shells out to anything but git, so it gets its own ceiling
  // rather than the global testTimeout moving for everything.
  it("prints the branch, tree, node and compose lines", () => {
    const result = hook("session-context", {});
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^Branch: /u);
    expect(result.stdout).toContain("Working tree:");
    expect(result.stdout).toContain("Node:");
    expect(result.stdout).toContain("Compose:");
  }, 30_000);

  it("reports what the last session left behind, in one form or the other", () => {
    // Either shape satisfies this: a checkout with leftovers names them, a
    // tidy one says so. What must not happen is silence, which is how a
    // worktree and the dev server inside it survived long enough to make a
    // browser suite scan the wrong branch and pass (#515).
    const result = hook("session-context", {});
    expect(result.stdout).toMatch(/Leftover/u);
  }, 30_000);

  it("says the compose check did not finish rather than that nothing runs", () => {
    // The cap is short enough to be reachable on a cold daemon, and an answer
    // that never came must not read as "nothing running": that would tell a
    // session to start a stack that is already up.
    const dir = mkdtempSync(join(tmpdir(), "slow-docker-"));
    temp.push(dir);
    const fake = join(dir, "docker");
    writeFileSync(fake, "#!/bin/sh\nsleep 30\n");
    chmodSync(fake, 0o755);

    const result = hook(
      "session-context",
      {},
      { PATH: `${dir}:${process.env.PATH}` }
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Compose: no answer in");
    expect(result.stdout).not.toContain("nothing running");
  }, 30_000);
});
