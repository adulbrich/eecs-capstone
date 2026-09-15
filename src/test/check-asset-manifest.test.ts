import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * Driven as a process, the way the Dockerfile build stage and CI drive it,
 * because the exit code is the contract every caller reads
 * (`src/test/check-scripts.test.ts` says the same about the rule scripts).
 */
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))
);

function run(output: string) {
  const result = spawnSync(
    process.execPath,
    [`${process.cwd()}/scripts/check-asset-manifest.mjs`, "--output", output],
    { encoding: "utf8", env }
  );
  return {
    status: result.status,
    stderr: result.stderr,
    stdout: result.stdout,
  };
}

/**
 * The shape `vite build` leaves behind: the SSR bundle names the stylesheet
 * as a quoted URL, the Start manifest lists client chunks the same way, and
 * Nitro's public asset manifest names every file it copied with a relative
 * `../public/assets/` path, which is not a URL and must not be read as one.
 */
function fixtureOutput(options: { stylesheetOnDisk: string }) {
  const dir = mkdtempSync(join(tmpdir(), "output-"));
  mkdirSync(join(dir, "server", "_ssr"), { recursive: true });
  mkdirSync(join(dir, "public", "assets"), { recursive: true });
  writeFileSync(
    join(dir, "server", "_ssr", "router-abc.mjs"),
    'const _default = "/assets/styles-Server11.css";\n'
  );
  writeFileSync(
    join(dir, "server", "_tanstack-start-manifest_v-abc.mjs"),
    'export default { assets: ["/assets/index-Chunk111.js"] };\n'
  );
  writeFileSync(
    join(dir, "server", "index.mjs"),
    `const assets = { "/assets/${options.stylesheetOnDisk}": { path: "../public/assets/${options.stylesheetOnDisk}" } };\n`
  );
  writeFileSync(join(dir, "public", "assets", options.stylesheetOnDisk), "");
  writeFileSync(join(dir, "public", "assets", "index-Chunk111.js"), "");
  return dir;
}

describe("check-asset-manifest", () => {
  let dir: string;

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("passes when every asset the server names is on disk", () => {
    dir = fixtureOutput({ stylesheetOnDisk: "styles-Server11.css" });
    const result = run(dir);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });

  it("fails and names the stylesheet the SSR bundle links but the client build never wrote", () => {
    dir = fixtureOutput({ stylesheetOnDisk: "styles-Client11.css" });
    const result = run(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("styles-Server11.css");
    expect(result.stderr).not.toContain("index-Chunk111.js");
  });

  it("refuses to pass on an output directory with no build in it", () => {
    dir = mkdtempSync(join(tmpdir(), "output-"));
    expect(run(dir).status).toBe(1);
  });
});
