import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

function hook(name: string, input: Record<string, unknown>) {
  const result = spawnSync(process.execPath, [`.claude/hooks/${name}.mjs`], {
    encoding: "utf8",
    env,
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
 * A throwaway repository on `main`, for the rules that read the branch. The
 * rule scripts are loaded from the session's checkout through a symlink.
 */
function repoOnMain() {
  const dir = mkdtempSync(join(tmpdir(), "hooks-"));
  temp.push(dir);
  const git = (...args: string[]) =>
    spawnSync("git", ["-C", dir, ...args], { encoding: "utf8", env });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  writeFileSync(join(dir, "a"), "a");
  git("add", "a");
  git("commit", "-q", "-m", "chore: seed");
  spawnSync("ln", ["-s", join(cwd, "scripts"), join(dir, "scripts")]);
  return dir;
}

describe("guard-git", () => {
  it("lets ordinary git through", () => {
    for (const command of [
      "git status && git add src/x.ts",
      "git push -u origin fix/x",
      "git push --force-with-lease origin fix/x",
      "git restore src/x.ts",
      "git restore --staged .",
      "git add -A.md",
      "git branch -d fix/x",
      "ls -la",
    ]) {
      expect(bash("guard-git", command).status, command).toBe(0);
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
      const result = bash("guard-git", command);
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
      expect(bash("guard-git", command).status, command).toBe(2);
    }
  });

  it("does not read a quoted string as a command", () => {
    expect(
      bash("guard-git", 'git commit -m "fix(x): stop using git add -A"').status
    ).toBe(0);
    expect(bash("guard-git", 'echo "git branch -D foo"').status).toBe(0);
  });

  it("denies a commit on main unless the command branches first", () => {
    const main = repoOnMain();
    const onMain = bash("guard-git", 'git commit -m "fix(x): y"', {
      cwd: main,
    });
    expect(onMain.status).toBe(2);
    expect(onMain.stderr).toContain("Never commit on main");
    expect(
      bash("guard-git", 'git checkout -b fix/x && git commit -m "fix(x): y"', {
        cwd: main,
      }).status
    ).toBe(0);
    expect(
      bash("guard-git", 'git commit -m "fix(x): y" && git checkout -b fix/x', {
        cwd: main,
      }).status
    ).toBe(2);
  });

  it("denies a force push at main in every spelling", () => {
    const main = repoOnMain();
    for (const command of [
      "git push --force origin main",
      "git push -f origin HEAD:main",
      "git push origin +main",
      "git push origin +HEAD:main",
    ]) {
      expect(bash("guard-git", command).status, command).toBe(2);
    }
    expect(
      bash("guard-git", "git push --force-with-lease", { cwd: main }).status
    ).toBe(2);
  });

  it("checks the message of a -m commit", () => {
    const bad = bash("guard-git", 'git commit -m "Add the thing"');
    expect(bad.status).toBe(2);
    expect(bad.stderr).toContain("lowercase imperative");
    expect(
      bash("guard-git", "git commit -m 'fix(x): y \u2014 because'").status
    ).toBe(2);
    expect(bash("guard-git", 'git commit -m "fix(x): y"').status).toBe(0);
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
    const result = bash("guard-git", withTrailer);
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
    expect(bash("guard-git", doubleQuoted).status).toBe(0);
  });

  it("works from a subdirectory of the checkout", () => {
    const result = bash("guard-git", 'git commit -m "Add the thing"', {
      cwd: join(cwd, "src"),
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

  it("passes a clean PR with the harness footer, on its own line or inline", () => {
    const heredoc = [
      'gh pr create --title "fix(x): y" --body "$(cat <<\'EOF\'',
      "Closes #1.",
      "",
      "\u{1F916} Generated with [Claude Code](https://claude.com/claude-code)",
      "EOF",
      ')"',
    ].join("\n");
    expect(bash("guard-gh", heredoc).status).toBe(0);
    expect(
      bash(
        "guard-gh",
        'gh pr create --title "fix(x): y" --body "Closes #1. \u{1F916} Generated with [Claude Code](https://claude.com/claude-code)"'
      ).status
    ).toBe(0);
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

  it("is quiet on a clean file, and on a file Biome excludes", () => {
    expect(edited("scripts/check-prose.mjs").status).toBe(0);
    expect(edited("src/routeTree.gen.ts").status).toBe(0);
  });

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
  it("prints the branch, tree, node and compose lines", () => {
    const result = hook("session-context", {});
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^Branch: /);
    expect(result.stdout).toContain("Working tree:");
    expect(result.stdout).toContain("Node:");
    expect(result.stdout).toContain("Compose:");
  });
});
