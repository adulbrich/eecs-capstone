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

function run(paths: string[]) {
  const result = spawnSync(process.execPath, [script, ...paths], {
    cwd: root,
    encoding: "utf8",
    env,
  });
  return { status: result.status, stderr: result.stderr };
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
});
