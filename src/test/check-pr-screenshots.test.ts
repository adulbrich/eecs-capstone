import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/**
 * The rule from #342, driven the way `pr-text` and the `gh` hook drive it:
 * as a process with an exit code. `scripts/` sits outside the TypeScript
 * project, so the CLI is the seam rather than an import, as for the other
 * two rule scripts in `check-scripts.test.ts`.
 */
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))
);
const script = `${process.cwd()}/scripts/check-pr-screenshots.mjs`;

function check(body: string, paths: string[]) {
  const result = spawnSync(process.execPath, [script, "--files", ...paths], {
    encoding: "utf8",
    env,
    input: body,
  });
  return { status: result.status, stderr: result.stderr };
}

const UI = ["src/components/foo.tsx"];
const SERVER = ["src/server/_internal/projects.ts", "docs/QUIRKS.md"];

const withImage = `Closes #1

## Screenshots

![desktop](https://example.test/a.png)

## Review loop
`;
const withTag = `## Screenshots\n<img src="https://example.test/a.png" width="600">\n`;
const optOut =
  "## Screenshots\n\nScreenshots: none, because only a comment changed.\n";
const emptyOptOut = "## Screenshots\n\nScreenshots: none, because\n";
const imageElsewhere =
  "## What changed\n\n![a](https://example.test/a.png)\n\n## Screenshots\n\nsee above\n";
const noSection = "Closes #1\n\n## Review loop\n";

describe("check-pr-screenshots", () => {
  it("passes a change outside the UI with no section", () => {
    expect(check(noSection, SERVER).status).toBe(0);
    expect(check(noSection, ["src/lib/day-range.ts"]).status).toBe(0);
  });

  it("fails a UI change with no section, naming the section and the opt-out", () => {
    for (const path of [
      "src/routes/projects/index.tsx",
      "src/components/foo.tsx",
      "src/styles.css",
    ]) {
      const result = check(noSection, [path]);
      expect(result.status, path).toBe(1);
      expect(result.stderr).toContain("## Screenshots");
      expect(result.stderr).toContain("Screenshots: none, because");
    }
  });

  it("passes one image, markdown or img tag", () => {
    expect(check(withImage, UI).status).toBe(0);
    expect(check(withTag, UI).status).toBe(0);
  });

  it("passes the opt-out line with a reason and fails it without one", () => {
    expect(check(optOut, UI).status).toBe(0);
    const empty = check(emptyOptOut, UI);
    expect(empty.status).toBe(1);
    expect(empty.stderr).toContain("without a reason");
  });

  it("fails an image outside the section", () => {
    const result = check(imageElsewhere, UI);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("no image");
  });

  it("exempts test-only changes under a UI path", () => {
    expect(
      check(noSection, [
        "src/components/__tests__/foo.test.tsx",
        "src/routes/projects/index.test.tsx",
        "src/test/a11y/admin.a11y.test.ts",
      ]).status
    ).toBe(0);
  });
});

describe("the hook's shape: files on stdin, body from a file", () => {
  const dirs: string[] = [];
  afterAll(() => {
    for (const dir of dirs) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reads the files one per line and the body from the path given", () => {
    const dir = mkdtempSync(join(tmpdir(), "shots-"));
    dirs.push(dir);
    const body = join(dir, "body.md");
    writeFileSync(body, optOut);
    const pass = spawnSync(
      process.execPath,
      [script, "--files-stdin", "--body", body],
      { encoding: "utf8", env, input: "src/styles.css\n\n" }
    );
    expect(pass.status).toBe(0);
    writeFileSync(body, noSection);
    const fail = spawnSync(
      process.execPath,
      [script, "--files-stdin", "--body", body],
      { encoding: "utf8", env, input: "src/styles.css\n" }
    );
    expect(fail.status).toBe(1);
  });
});
