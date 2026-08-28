import { describe, expect, it } from "vitest";
import { ACCESS_CONTRACT } from "./access-contract";
import { scan, scanFile } from "./server-fn-scan";

/**
 * Holds `access-contract.ts` to the code. The two lists have to name the same
 * endpoints, no use of `createServerFn` may escape the scan, and the public
 * surface has to be exactly the one written down.
 *
 * No assertion here reads an access level out of the source. #108 exists
 * because that cannot be done reliably, so the level is declared and this only
 * checks that something was declared for everything that exists.
 */

function declaredAt(level: string): string[] {
  return Object.entries(ACCESS_CONTRACT)
    .filter(([, declaration]) => declaration.level === level)
    .map(([endpoint]) => endpoint)
    .sort();
}

describe("the server function access contract", () => {
  it("recognizes every use of createServerFn", () => {
    // The guard that makes the other assertions trustworthy. They compare the
    // recognized list against ACCESS_CONTRACT, so a use the scan cannot read is
    // absent from both sides and reports nothing at all rather than reporting
    // as undeclared.
    //
    // If this fails it names the file and line. Teach the scan that shape; do
    // not add it to an ignore list.
    expect(scan().unparsed).toEqual([]);
  });

  it("declares a level for every endpoint that exists", () => {
    const undeclared = scan().declared.filter(
      (endpoint) => !(endpoint in ACCESS_CONTRACT)
    );
    expect(undeclared).toEqual([]);
  });

  it("declares no endpoint that has been removed or renamed", () => {
    const live = new Set(scan().declared);
    const stale = Object.keys(ACCESS_CONTRACT).filter(
      (endpoint) => !live.has(endpoint)
    );
    expect(stale).toEqual([]);
  });

  it("keeps the public surface to exactly these endpoints", () => {
    // A speed bump rather than a check: it compares two literals and reads no
    // source, so it cannot tell you a level is wrong. What it does is make
    // widening the public surface cost a second, visible edit, on the one level
    // where a careless declaration is itself the bug. Every other value fails
    // closed when it is too generous by a step; a wrong `public` ships the data.
    //
    // If you are here because this failed, the question is whether the new
    // endpoint should be reachable with no session at all.
    expect(declaredAt("public")).toEqual([
      "lib/auth-guards.ts:getSession",
      "server/categories.ts:getCategory",
      "server/categories.ts:listCategories",
      "server/categories.ts:listCategoryTypes",
      "server/categories.ts:listProjectCategories",
      "server/inventory.ts:getInventoryItem",
      "server/inventory.ts:getInventoryItemDetail",
      "server/inventory.ts:listInventory",
      "server/inventory.ts:listInventoryCategories",
      "server/programs.ts:listPrograms",
      "server/projects-queries.ts:getProject",
      "server/projects-queries.ts:listProjectComments",
      "server/search.ts:searchProjects",
    ]);
  });
});

describe("the scan the contract is checked with", () => {
  /**
   * The assertions above read `src/`, so they can only show the scan and the
   * contract agree on the endpoints that exist today. These feed it endpoints
   * that do not, because every defect found in this file so far has been a
   * check that could not fail on the thing it was written to catch.
   *
   * The invariant is not that every shape is recognized. It is that no shape
   * lands in neither list: an endpoint the scan cannot read has to surface as
   * an unrecognized use, so it fails the suite instead of passing unseen.
   */
  const scanOf = (source: string) => scanFile("probe.ts", source);

  it("reads an endpoint declared through the normal import", () => {
    const { declared, unparsed } = scanOf(
      'import { createServerFn } from "@tanstack/react-start";\n' +
        "export const listThings = createServerFn().handler(() => []);\n"
    );

    expect(declared).toEqual(["listThings"]);
    expect(unparsed).toEqual([]);
  });

  it("reads an endpoint declared through a renamed import", () => {
    // The shape that escaped both halves of the check: the only occurrence of
    // `createServerFn` sits inside the import, where the unrecognized-use guard
    // suppresses it, and no call site spells the name at all.
    const { declared, unparsed } = scanOf(
      'import { createServerFn as make } from "@tanstack/react-start";\n' +
        "export const listThings = make().handler(() => []);\n"
    );

    expect(declared).toEqual(["listThings"]);
    expect(unparsed).toEqual([]);
  });

  it("reports every other shape rather than passing it over", () => {
    // Each of these is a use the scan does not turn into a declared endpoint,
    // and none of them may go quiet: an unrecognized use fails the first
    // assertion in this file by name and line.
    //
    // Asserting the exact pair, not that the two lists sum to one. A sum is
    // satisfied by the inverse too, so widening the search to recurse into call
    // arguments would move `wrap(...)` from reported to declared, leave the sum
    // at one, and quietly key a contract line on an endpoint whose gate belongs
    // to `wrap`.
    const shapes: [string, string][] = [
      [
        "namespace import, so the call is a property access, not a bound name",
        'import * as start from "@tanstack/react-start";\n' +
          "export const a = start.createServerFn().handler(() => []);\n",
      ],
      [
        "declared, then exported in a separate statement the scan does not walk",
        'import { createServerFn } from "@tanstack/react-start";\n' +
          "const a = createServerFn().handler(() => []);\nexport { a };\n",
      ],
      [
        "default export, which carries no name to key a declaration on",
        'import { createServerFn } from "@tanstack/react-start";\n' +
          "export default createServerFn().handler(() => []);\n",
      ],
      [
        "wrapped, so the exported binding is the wrapper's return value",
        'import { createServerFn } from "@tanstack/react-start";\n' +
          "export const a = wrap(createServerFn().handler(() => []));\n",
      ],
      [
        "import-equals, which binds a name without being a module import",
        'import * as start from "@tanstack/react-start";\n' +
          "import make = start.createServerFn;\n" +
          "export const a = make().handler(() => []);\n",
      ],
      [
        "computed access, which hides the name from an identifier visitor",
        'import * as start from "@tanstack/react-start";\n' +
          'const make = start["createServerFn"];\n' +
          "export const a = make().handler(() => []);\n",
      ],
      [
        "imported from somewhere that is not the real module",
        'import { createServerFn } from "./not-tanstack";\n' +
          "export const a = createServerFn().handler(() => []);\n",
      ],
      [
        "aliased out of a near-miss specifier, so the real name is only in the import",
        'import { createServerFn as make } from "@tanstack/react-start/server";\n' +
          "export const a = make().handler(() => []);\n",
      ],
    ];

    for (const [what, source] of shapes) {
      const { declared, unparsed } = scanOf(source);
      // Both halves matter. `declared` empty says the shape was not mistaken
      // for an endpoint, which is what a bare sum would also allow the inverse
      // of; a non-empty `unparsed` says it was reported instead of skipped.
      expect({ declared, reported: unparsed.length > 0, what }).toEqual({
        declared: [],
        reported: true,
        what,
      });
    }
  });

  it("refuses a file it cannot parse instead of reading it as empty", () => {
    expect(() =>
      scanOf(
        'import { createServerFn } from "@tanstack/react-start";\n' +
          "export const a = createServerFn().handler(() => {\n"
      )
    ).toThrow(/did not parse/);
  });
});
