import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * Driven as a process, the way lefthook and CI drive it, because the exit
 * code is the contract every caller reads (`check-scripts.test.ts` says the
 * same about the other rule scripts). The script keys each cap on the path
 * from the repository root, so every fixture is a throwaway tree with the
 * capped docs at their real paths, and the script runs from its root.
 *
 * The caps are written out here rather than imported: raising one should be
 * a decision somebody makes in this file too, not a side effect.
 */
const QUIRK_CAP = 1000;
const ADR_CAP = 1300;
const UI_CAP = 2000;

const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))
);
const script = join(process.cwd(), "scripts/check-doc-size.mjs");

let root: string;
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** A tree holding `files`, keyed by their path from the repository root. */
function tree(files: Record<string, string>) {
  root = mkdtempSync(join(tmpdir(), "doc-size-"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return Object.keys(files);
}

function run(paths: string[], cwd = root) {
  const result = spawnSync(process.execPath, [script, ...paths], {
    cwd,
    encoding: "utf8",
    env,
  });
  return {
    status: result.status,
    stderr: result.stderr,
    stdout: result.stdout,
  };
}

/** Make the fixture tree a repository with every file in the index. */
function indexed() {
  const git = (...args: string[]) =>
    spawnSync("git", ["-C", root, ...args], { encoding: "utf8", env });
  git("init", "-q", "-b", "main");
  git("add", "--", ".");
}

/**
 * A heading entry of exactly `bytes`, heading line included, which is what
 * the script measures for a quirk and a UI convention. Filled with a
 * non-space character, since trailing whitespace is trimmed before counting.
 */
function entry(heading: string, bytes: number) {
  const head = `${heading}\n\n`;
  return `${head}${"x".repeat(bytes - Buffer.byteLength(head))}\n`;
}

/** An ADR whose body, after the title line, is exactly `bytes`. */
function adr(bytes: number) {
  return `# A decision\n\n${"x".repeat(bytes)}\n`;
}

describe("check-doc-size", () => {
  it("passes a quirk, an ADR and a UI convention each at its cap", () => {
    const paths = tree({
      "docs/QUIRKS.md": `# Quirks\n\n## Area\n\n${entry("### At the cap", QUIRK_CAP)}`,
      "docs/UI-CONVENTIONS.md": `# UI\n\n${entry("## At the cap", UI_CAP)}`,
      "docs/adr/0001-at-the-cap.md": adr(ADR_CAP),
    });
    const result = run(paths);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });

  it("fails a quirk one byte over, naming it, its size, the cap and the rule", () => {
    const paths = tree({
      "docs/QUIRKS.md": `# Quirks\n\n${entry("### Too long", QUIRK_CAP + 1)}### Short\n\nFine.\n`,
    });
    const result = run(paths);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      `docs/QUIRKS.md:3: ### Too long: ${QUIRK_CAP + 1} bytes, cap ${QUIRK_CAP}`
    );
    expect(result.stderr).not.toContain("### Short");
    expect(result.stderr).toContain(
      "History belongs in git and the PR; the rule belongs in the doc."
    );
  });

  it("fails an ADR one byte over, counting the body after its title", () => {
    const paths = tree({ "docs/adr/0002-too-long.md": adr(ADR_CAP + 1) });
    const result = run(paths);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      `docs/adr/0002-too-long.md:1: # A decision: ${ADR_CAP + 1} bytes, cap ${ADR_CAP}`
    );
  });

  it("fails a UI convention one byte over, at either heading level", () => {
    const paths = tree({
      "docs/UI-CONVENTIONS.md": `# UI\n\n${entry("## Section", UI_CAP + 1)}${entry("### Entry", UI_CAP + 1)}`,
    });
    const result = run(paths);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`## Section: ${UI_CAP + 1} bytes`);
    expect(result.stderr).toContain(`### Entry: ${UI_CAP + 1} bytes`);
  });

  it("does not count a quirk's code blocks or table rows", () => {
    // Each would put the entry well over the cap on its own.
    const code = `\`\`\`ts\n${"y".repeat(QUIRK_CAP)}\n\`\`\`\n`;
    const table = `| a | b |\n| --- | --- |\n| ${"z".repeat(QUIRK_CAP)} | c |\n`;
    const paths = tree({
      "docs/QUIRKS.md": `# Quirks\n\n${entry("### With an example", QUIRK_CAP)}\n${code}\n${table}`,
    });
    const result = run(paths);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });

  it("measures the prose after a code block in the same entry", () => {
    // The fence ends, and what follows is the entry's again. The `#` comment
    // inside it is not a heading: read as one, it would end the entry there
    // and leave the prose below unmeasured.
    const code = "```sh\n# a comment, not a heading\n```\n";
    const paths = tree({
      "docs/QUIRKS.md": `# Quirks\n\n### Split\n\n${code}\n${"x".repeat(QUIRK_CAP)}\n`,
    });
    expect(run(paths).status).toBe(1);
  });

  it("leaves a Markdown file with no cap alone", () => {
    const paths = tree({ "docs/OTHER.md": entry("### Long", QUIRK_CAP * 3) });
    expect(run(paths).status).toBe(0);
  });

  it("finds the docs from a subdirectory of the repository", () => {
    // Paths are the repository's, not the working directory's: run from
    // `docs/`, `--all` used to find nothing and pass.
    tree({
      "docs/QUIRKS.md": `# Quirks\n\n${entry("### Too long", QUIRK_CAP + 1)}`,
      "docs/adr/0001-fine.md": adr(10),
    });
    indexed();
    const fromDocs = join(root, "docs");
    expect(run(["--all"], fromDocs).stderr).toContain(
      `docs/QUIRKS.md:3: ### Too long: ${QUIRK_CAP + 1} bytes`
    );
    expect(run(["QUIRKS.md"], fromDocs).status).toBe(1);
  });

  it("fails --all when it finds no capped doc to check", () => {
    tree({ "README.md": "# Nothing capped\n" });
    indexed();
    const result = run(["--all"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("nothing was checked");
  });

  it("counts only the files it read", () => {
    // A staged deletion is still named by lefthook; it is skipped, not checked.
    tree({ "docs/adr/0001-here.md": adr(10) });
    const result = run(["docs/adr/0001-here.md", "docs/adr/0002-deleted.md"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("1 file within the caps");
  });

  it("measures CRLF line endings as LF", () => {
    const crlf = (text: string) => text.replaceAll("\n", "\r\n");
    const paths = tree({
      "docs/QUIRKS.md": crlf(
        `# Quirks\n\n${entry("### At the cap", QUIRK_CAP)}${entry("### Over", QUIRK_CAP + 1)}`
      ),
      "docs/adr/0001-at-the-cap.md": crlf(adr(ADR_CAP)),
    });
    const result = run(paths);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      `### Over: ${QUIRK_CAP + 1} bytes, cap ${QUIRK_CAP}`
    );
    expect(result.stderr).not.toContain("At the cap");
    expect(result.stderr).not.toContain("\r");
  });

  it("closes a fence only on the same character, at least as long", () => {
    // A ``` line inside a ~~~ block, and ```js inside a ```` block, are
    // content. Closing on either would count the rest of the block as prose.
    const tilde = `~~~md\n\`\`\`\n${"y".repeat(QUIRK_CAP)}\n~~~\n`;
    const longer = `\`\`\`\`md\n\`\`\`js\n${"y".repeat(QUIRK_CAP)}\n\`\`\`\`\n`;
    const paths = tree({
      "docs/QUIRKS.md": `# Quirks\n\n${entry("### Tilde", 100)}\n${tilde}\n${entry("### Longer", 100)}\n${longer}`,
    });
    const result = run(paths);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });

  it("does not read a fence indented four spaces as a fence", () => {
    // CommonMark makes it an indented code block. Read as a fence, it opened
    // one that the next real fence closed, and `### B` went unmeasured.
    const paths = tree({
      "docs/QUIRKS.md": `### A\n\n    \`\`\`\n\n### B\n${"x".repeat(1500)}\n\`\`\`sh\nls\n\`\`\`\n`,
    });
    const result = run(paths);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("### B: ");
  });

  it("fails a file with a fence that never closes, naming its line", () => {
    // Otherwise the rest of the file is code, and nothing in it is measured.
    const paths = tree({
      "docs/QUIRKS.md": `# Quirks\n\n### A\n\n\`\`\`ts\nconst a = 1;\n\n${entry("### B", QUIRK_CAP * 5)}`,
    });
    const result = run(paths);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "docs/QUIRKS.md:5: this code fence never closes"
    );
  });

  it("charges a #### subsection to the quirk above it", () => {
    const paths = tree({
      "docs/QUIRKS.md": `# Quirks\n\n${entry("### Parent", QUIRK_CAP - 10)}\n#### Child\n\n${"x".repeat(50)}\n`,
    });
    const result = run(paths);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("### Parent:");
  });

  it("fails an ADR whose first line is not its title", () => {
    const paths = tree({
      "docs/adr/0003-untitled.md": "Body first.\n\n# Late title\n",
    });
    const result = run(paths);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "docs/adr/0003-untitled.md:1: an ADR starts with its `# ` title line"
    );
  });
});
