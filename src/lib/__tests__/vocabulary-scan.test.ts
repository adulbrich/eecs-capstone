import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  scan,
  scanFile,
  scannedFileCount,
  type Vocabulary,
  vocabulariesIn,
} from "./vocabulary-scan";

/**
 * The scan, run against `src/` and against sources written to break it.
 *
 * #102 gave each status vocabulary one home and swept twenty-one consumers
 * onto it by hand. Nothing stopped the twenty-second, which is #271. This is
 * what stops it, and it covers every vocabulary in the file rather than the
 * status ones: `USER_ROLES` arrived with five copies already written and the
 * scan is what named them (#274).
 *
 * The second half is the point. Running the scan over a tree it already
 * agrees with proves they agree today; it cannot show the scan would notice
 * anything new, and a check that quietly notices nothing is worse than none.
 */

const VOCABULARIES_FILE = join(process.cwd(), "src", "lib", "vocabularies.ts");

const ITEM: Vocabulary = {
  name: "INVENTORY_ITEM_STATUSES",
  members: new Set([
    "available",
    "requested",
    "reserved",
    "checked_out",
    "maintenance",
    "retired",
  ]),
};

const VOCABULARIES = [ITEM];

function copiesIn(source: string, file = "probe.ts") {
  return scanFile(file, source, VOCABULARIES).map((copy) => copy.vocabulary);
}

describe("scan over src/", () => {
  it("finds no hand-written vocabulary copy", () => {
    // The failure message is the whole value of this assertion: it names the
    // file, the line and the vocabulary. If it fires, derive the list from
    // src/lib/vocabularies.ts rather than adding an exception here.
    expect(scan()).toEqual([]);
  });

  it("reads the real vocabularies.ts, so the assertion above is not vacuous", () => {
    // scan() passing would mean nothing if it were looking at no files or no
    // vocabularies. It throws on the second, and this pins the first: the
    // three tuples src/db/schema.ts hands to pgEnum, and the roles, which no
    // column constrains and which therefore rely on the scan for more.
    expect(
      vocabulariesIn(
        VOCABULARIES_FILE,
        readFileSync(VOCABULARIES_FILE, "utf8")
      ).map((vocabulary) => vocabulary.name)
    ).toEqual([
      "PROJECT_STATUSES",
      "INVENTORY_ITEM_STATUSES",
      "INVENTORY_REQUEST_ITEM_STATUSES",
      "USER_ROLES",
    ]);
  });

  it("scans a plausible number of files, so an empty walk cannot pass", () => {
    // scan() throws when vocabularies.ts yields nothing, but a walk that
    // returned no files would report a clean tree just as convincingly.
    expect(scannedFileCount()).toBeGreaterThan(100);
  });

  it("discovers the vocabularies rather than being told them", () => {
    // Listing them in the scan would be a fourth copy of exactly the thing it
    // forbids, and a new vocabulary would arrive unscanned.
    const names = vocabulariesIn(
      "vocabularies.ts",
      `export const A_STATUSES = ["one", "two"] as const;
       export const B_STATUSES = ["x", "y", "z"] as const;
       const NOT_EXPORTED = ["p", "q"] as const;
       export const NOT_LITERALS = [1, 2] as const;
       export const NOT_AS_CONST = ["m", "n"];
       export const MIXED = ["a", 1] as const;
       export const SATISFIES = ["s", "t"] as const satisfies readonly string[];`
    ).map((vocabulary) => vocabulary.name);
    // SATISFIES is the shape ACTIVE_STATUSES used until #271: `as const
    // satisfies readonly T[]` parses as a SatisfiesExpression wrapping the
    // AsExpression, so matching only the latter would let a vocabulary
    // written that way arrive unscanned.
    expect(names).toEqual(["A_STATUSES", "B_STATUSES", "SATISFIES"]);
  });
});

describe("what counts as a copy", () => {
  it("catches a whole vocabulary in an array literal", () => {
    expect(
      copiesIn(
        `const all = ["available", "requested", "reserved", "checked_out", "maintenance", "retired"];`
      )
    ).toEqual(["INVENTORY_ITEM_STATUSES"]);
  });

  it("catches a whole vocabulary written out as a union", () => {
    expect(
      copiesIn(
        `type Status = "available" | "requested" | "reserved" | "checked_out" | "maintenance" | "retired";`
      )
    ).toEqual(["INVENTORY_ITEM_STATUSES"]);
  });

  it("catches a whole vocabulary written out as a tuple type", () => {
    // Neither an array literal nor a union, so it needs its own arm. A
    // written-out list is a copy whichever of the three shapes it wears.
    expect(
      copiesIn(
        `type Ordered = ["available", "requested", "reserved", "checked_out", "maintenance", "retired"];`
      )
    ).toEqual(["INVENTORY_ITEM_STATUSES"]);
  });

  it("catches a tuple type whose members are named", () => {
    // A NamedTupleMember wraps the literal, so reading the element directly
    // finds no string and the copy passes. False negatives are the direction
    // that matters here: a copy nobody is told about.
    expect(
      copiesIn(
        `type Ordered = [a: "available", b: "requested", c: "reserved", d: "checked_out", e: "maintenance", f: "retired"];`
      )
    ).toEqual(["INVENTORY_ITEM_STATUSES"]);
  });

  it("catches one inside a z.enum, which is the shape #102 could not", () => {
    expect(
      copiesIn(
        `const schema = z.enum(["available", "requested", "reserved", "checked_out", "maintenance", "retired"]);`
      )
    ).toEqual(["INVENTORY_ITEM_STATUSES"]);
  });

  it("catches a reordered copy, since a set is not a sequence", () => {
    expect(
      copiesIn(
        `const all = ["retired", "maintenance", "checked_out", "reserved", "requested", "available"];`
      )
    ).toEqual(["INVENTORY_ITEM_STATUSES"]);
  });

  it("catches a copy carrying extra members", () => {
    // A superset still names the whole vocabulary, so it goes stale the same
    // way. `lost` here is a member no column has.
    expect(
      copiesIn(
        `const all = ["available", "requested", "reserved", "checked_out", "maintenance", "retired", "lost"];`
      )
    ).toEqual(["INVENTORY_ITEM_STATUSES"]);
  });
});

describe("what does not count", () => {
  it("passes a subset one member short", () => {
    // The threshold. "One short" would catch ACTIVE_STATUSES, which #271
    // derived from the tuple instead, and would cost a false positive budget
    // forever after.
    expect(
      copiesIn(
        `const active = ["available", "requested", "reserved", "checked_out", "maintenance"];`
      )
    ).toEqual([]);
  });

  it("passes a deliberate narrow subset in a union", () => {
    // sendToProposer's `target: "approved" | "changes_requested"`.
    expect(copiesIn(`type Target = "reserved" | "checked_out";`)).toEqual([]);
  });

  it("passes an inArray filter over two statuses", () => {
    expect(
      copiesIn(
        `const rows = inArray(items.status, ["reserved", "checked_out"]);`
      )
    ).toEqual([]);
  });

  it("passes a Record keyed by the whole vocabulary", () => {
    // The shape that works: the type forces it to be total, so a new status
    // fails to compile here rather than silently rendering nothing. Examining
    // these would flag every label and style table in the app.
    expect(
      copiesIn(
        `const LABELS: Record<ItemStatus, string> = {
           available: "Available",
           requested: "Requested",
           reserved: "Reserved",
           checked_out: "Checked out",
           maintenance: "Maintenance",
           retired: "Retired",
         };`
      )
    ).toEqual([]);
  });

  it("passes a switch that handles every status", () => {
    expect(
      copiesIn(
        `switch (status) {
           case "available": return 0;
           case "requested": return 1;
           case "reserved": return 2;
           case "checked_out": return 3;
           case "maintenance": return 4;
           case "retired": return 5;
         }`
      )
    ).toEqual([]);
  });

  it("passes a chain of equality comparisons", () => {
    expect(
      copiesIn(
        `const x = s === "available" || s === "requested" || s === "reserved" ||
                   s === "checked_out" || s === "maintenance" || s === "retired";`
      )
    ).toEqual([]);
  });

  it("passes a spread of the tuple, which is the derivation it asks for", () => {
    expect(copiesIn("const all = [...INVENTORY_ITEM_STATUSES];")).toEqual([]);
  });

  it("passes single literals scattered through a file", () => {
    expect(
      copiesIn(
        `const a = "available";
         const b = "requested";
         const c = "reserved";
         const d = "checked_out";
         const e = "maintenance";
         const f = "retired";`
      )
    ).toEqual([]);
  });
});

describe("a node naming two vocabularies reports both", () => {
  it("does not stop at the first match", () => {
    // The four real vocabularies are disjoint, so nothing exercises this
    // today. A future pair sharing members would otherwise have one copy
    // reported and the other hidden.
    const overlapping = [
      { name: "FIRST", members: new Set(["a", "b"]) },
      { name: "SECOND", members: new Set(["b", "c"]) },
    ];
    expect(
      scanFile("probe.ts", `const all = ["a", "b", "c"];`, overlapping).map(
        (copy) => copy.vocabulary
      )
    ).toEqual(["FIRST", "SECOND"]);
  });
});

describe("a file it cannot read fails rather than passing", () => {
  it("throws on a syntax error instead of reporting nothing", () => {
    // The defect this guards against is the one server-fn-scan.ts records: a
    // tree the parser gave up on is empty, and an empty tree looks exactly
    // like a clean file.
    expect(() => copiesIn("const x = (((;")).toThrow(/did not parse/);
  });

  it("finds no vocabulary in a file that declares none", () => {
    // The companion to the assertion above: scan() throws when this returns
    // empty for the real file, rather than reporting a clean tree it never
    // had anything to compare against.
    expect(vocabulariesIn("empty.ts", "export const x = 1;")).toEqual([]);
  });
});
