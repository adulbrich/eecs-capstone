import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACCESS_CONTRACT } from "./access-contract";

/**
 * Holds `access-contract.ts` to the code. It does not infer any endpoint's
 * access level: inferring is what #108 rules out, because a grep for the guard
 * names mislabelled seven of seventeen endpoints and could not tell a
 * correctly ungated public read from a gate it failed to recognise.
 *
 * What it enforces is that the two lists agree, so a new endpoint cannot ship
 * without someone answering what it allows.
 */

const SERVER_DIR = join(process.cwd(), "src/server");

/**
 * `^export const <name> = createServerFn`. Anchored to the line start on
 * purpose: every one of the 86 endpoints is a top-level exported const, and
 * anchoring keeps the count reconcilable by hand against
 * `grep -c '^export const .* = createServerFn' src/server/*.ts`.
 */
const SERVER_FN = /^export const (\w+) = createServerFn/gm;

function liveEndpoints(): string[] {
  const found: string[] = [];
  for (const file of readdirSync(SERVER_DIR).filter((name) =>
    name.endsWith(".ts")
  )) {
    const source = readFileSync(join(SERVER_DIR, file), "utf8");
    for (const match of source.matchAll(SERVER_FN)) {
      found.push(`${file}:${match[1]}`);
    }
  }
  return found.sort();
}

describe("the server function access contract", () => {
  it("finds endpoints to check, so a regex that stops matching fails loudly", () => {
    // Without this, changing how endpoints are declared leaves both assertions
    // below comparing two empty lists and reporting green.
    expect(liveEndpoints().length).toBeGreaterThan(80);
  });

  it("declares a level for every endpoint that exists", () => {
    const undeclared = liveEndpoints().filter(
      (endpoint) => !(endpoint in ACCESS_CONTRACT)
    );
    expect(undeclared).toEqual([]);
  });

  it("declares no endpoint that has been removed or renamed", () => {
    const live = new Set(liveEndpoints());
    const stale = Object.keys(ACCESS_CONTRACT).filter(
      (endpoint) => !live.has(endpoint)
    );
    expect(stale).toEqual([]);
  });
});
