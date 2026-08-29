import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The answer to "what does this app need to run", derived rather than listed.
 *
 * `.env.example` is the only machine-readable inventory of this app's
 * configuration, and #105 exists because it is a hand-maintained second copy of
 * what the code reads, with nothing checking the two agree. A manifest here
 * would be a third copy with the same problem, so this scans the source
 * instead: it cannot drift, because it reads what the code actually does.
 *
 * It is deliberately a lint of the docs, not of the code. A variable read but
 * undocumented is the failure that matters, because an operator cannot set what
 * nothing tells them about.
 */

const SOURCE_ROOTS = ["src", "scripts"];
const ENV_READ = /(?:process\.)?env\.([A-Z][A-Z0-9_]*)/g;

/**
 * Variables the runtime or an SDK supplies, which are not this app's
 * configuration and so have no place in `.env.example`.
 */
const PLATFORM_VARS = new Set([
  // Set by the task definition, the Dockerfile, vitest and `vite dev`.
  "NODE_ENV",
  // The AWS SDK's own variable, present on ECS whether or not anyone sets it.
  // Read only as a fallback for SES_REGION, which is documented.
  "AWS_REGION",
]);

/**
 * Documented variables this codebase never reads itself, each for a reason
 * that is not "we forgot".
 */
const NOT_READ_BY_SRC = new Map([
  ["BETTER_AUTH_SECRET", "read by Better Auth internally, never by this code"],
  [
    "VITE_STORAGE_PUBLIC_BASE",
    "client-side, reached through import.meta.env at build time (src/lib/storage.ts)",
  ],
]);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      out.push(...sourceFiles(path));
      continue;
    }
    if (/\.tsx?$/.test(entry)) {
      out.push(path);
    }
  }
  return out;
}

function readsInSource(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const root of SOURCE_ROOTS) {
    for (const file of sourceFiles(root)) {
      // Tests set variables to exercise a builder; they are not the app's
      // requirements, so they would report variables nothing in production
      // reads.
      if (file.includes("__tests__") || file.includes("/test/")) {
        continue;
      }
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(ENV_READ)) {
        const name = match[1];
        if (!name || PLATFORM_VARS.has(name)) {
          continue;
        }
        found.set(name, [...(found.get(name) ?? []), file]);
      }
    }
  }
  return found;
}

function documentedKeys(): Set<string> {
  return new Set(
    readFileSync(".env.example", "utf8")
      .split("\n")
      .map((line) => /^([A-Z][A-Z0-9_]*)=/.exec(line)?.[1])
      .filter((key): key is string => Boolean(key))
  );
}

describe("the environment contract", () => {
  it("documents every variable the source reads", () => {
    const documented = documentedKeys();
    const undocumented = [...readsInSource().entries()]
      .filter(([name]) => !documented.has(name))
      .map(([name, files]) => `${name} (read in ${files.join(", ")})`);

    // An operator cannot set a variable nothing tells them about, and both
    // DEPLOYMENT.md and infra/ecs.tf are written from this file. A new read
    // belongs in .env.example with a comment saying what it is for.
    expect(undocumented).toEqual([]);
  });

  it("reads every variable it documents, or says why it does not", () => {
    const read = readsInSource();
    const unread = [...documentedKeys()].filter(
      (name) => !(read.has(name) || NOT_READ_BY_SRC.has(name))
    );

    // The other direction, which catches a variable that outlived the code
    // that read it. Deleting one is cheap; discovering later that production
    // sets something nothing consumes is not.
    expect(unread).toEqual([]);
  });

  it("keeps its own exemption lists honest", () => {
    // The exemptions are the part that rots: an entry that stops being true
    // silently re-hides the thing it was excusing. Each is cheap to verify,
    // so verify it.
    const read = readsInSource();
    for (const [name] of NOT_READ_BY_SRC) {
      expect(read.has(name)).toBe(false);
    }
    expect(documentedKeys().has("BETTER_AUTH_SECRET")).toBe(true);
  });
});
