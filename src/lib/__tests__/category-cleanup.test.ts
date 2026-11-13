import { fc, test } from "@fast-check/vitest";
import { describe, expect, it } from "vitest";
import {
  buildCleanupTool,
  CLEANUP_MAX_OPERATIONS,
  type CleanupCategory,
  type CleanupProposal,
  describeCleanup,
} from "#/lib/category-cleanup";
import {
  strayBrackets,
  tagBreakingText,
  tagsIn,
} from "#/test/shared/arbitraries";

const CREATED = new Date("2026-11-12T00:00:00Z");

function category(
  id: string,
  type: string,
  name: string,
  extra: Partial<CleanupCategory> = {}
): CleanupCategory {
  return {
    id,
    type,
    name,
    description: `${name} work.`,
    createdAt: CREATED,
    usage: 0,
    publishedUsage: 0,
    sampleTitles: [],
    ...extra,
  };
}

const LIST: CleanupCategory[] = [
  category("k-new", "Kind of work", "New Build"),
  category("k-research", "Kind of work", "Research"),
  category("f-web", "Field", "Web Development", { usage: 16 }),
  category("f-xr", "Field", "AR / VR", { usage: 6 }),
  category("f-vr", "Field", "VR", { usage: 3 }),
  category("t-py", "Technology", "Python", { usage: 9 }),
  category("t-flutter", "Technology", "Flutter", { usage: 4 }),
];

function tool(list = LIST) {
  const built = buildCleanupTool(list);
  if (!built) {
    throw new Error("expected a tool");
  }
  return built;
}

/** The handle the catalog gave the category named `name`. */
function handle(name: string, from = tool()): string {
  const line = from.catalog
    .split("\n")
    .find((l) => /^c\d+ /u.test(l) && l.slice(l.indexOf(" ") + 1) === name);
  const found = line?.split(" ")[0];
  if (!found) {
    throw new Error(`no handle for ${name}`);
  }
  return found;
}

function answer(extra: Record<string, unknown> = {}) {
  return { merges: [], renames: [], moves: [], retires: [], ...extra };
}

const REASON = "One idea split across two checkboxes.";

describe("the cleanup tool", () => {
  it("maps a merge's handles back to the categories as the proposal saw them", () => {
    const { operations, dropped } = tool().parse(
      answer({
        merges: [
          {
            sources: [handle("VR")],
            target: handle("AR / VR"),
            reason: REASON,
          },
        ],
      })
    );
    expect(dropped).toBe(0);
    expect(operations).toEqual([
      {
        kind: "merge",
        target: {
          id: "f-xr",
          name: "AR / VR",
          type: "Field",
          description: "AR / VR work.",
        },
        sources: [
          { id: "f-vr", name: "VR", type: "Field", description: "VR work." },
        ],
        reason: REASON,
      },
    ]);
  });

  it("rejects a category that does not exist", () => {
    expect(() =>
      tool().parse(answer({ retires: [{ category: "c999", reason: REASON }] }))
    ).toThrow();
  });

  it("gives Kind of work no handle, so no change can name one", () => {
    const t = tool();
    expect(t.catalog).toContain("New Build");
    expect(t.catalog).toContain("no change may touch it");
    expect(() => handle("New Build", t)).toThrow();
    const enumOf = (
      t.parameters as never as {
        properties: {
          retires: { items: { properties: { category: { enum: string[] } } } };
        };
      }
    ).properties.retires.items.properties.category.enum;
    expect(enumOf).toHaveLength(LIST.length - 2);
  });

  it("rejects a move into Kind of work or into a type that does not exist", () => {
    const t = tool();
    for (const type of ["Kind of work", "Industry"]) {
      expect(() =>
        t.parse(
          answer({
            moves: [{ category: handle("Flutter", t), type, reason: REASON }],
          })
        )
      ).toThrow();
    }
  });

  it("rejects a new category and any field it does not know", () => {
    const t = tool();
    expect(() =>
      t.parse(
        answer({
          creates: [{ name: "Quantum", type: "Field", reason: REASON }],
        })
      )
    ).toThrow();
    expect(() =>
      t.parse(
        answer({
          renames: [
            {
              category: handle("VR", t),
              name: "Virtual Reality",
              description: null,
              type: "Technology",
              reason: REASON,
            },
          ],
        })
      )
    ).toThrow();
  });

  it("drops a merge across types and keeps the rest of the answer", () => {
    const t = tool();
    const { operations, dropped } = t.parse(
      answer({
        merges: [
          {
            sources: [handle("Flutter", t)],
            target: handle("Web Development", t),
            reason: REASON,
          },
        ],
        retires: [{ category: handle("VR", t), reason: REASON }],
      })
    );
    expect(dropped).toBe(1);
    expect(operations.map((o) => o.kind)).toEqual(["retire"]);
  });

  it("drops a merge whose target is among its sources", () => {
    const t = tool();
    const { operations, dropped } = t.parse(
      answer({
        merges: [
          {
            sources: [handle("VR", t), handle("AR / VR", t)],
            target: handle("AR / VR", t),
            reason: REASON,
          },
        ],
      })
    );
    expect(operations).toEqual([]);
    expect(dropped).toBe(1);
  });

  it("drops a rename or move that changes nothing", () => {
    const t = tool();
    const { operations, dropped } = t.parse(
      answer({
        renames: [
          {
            category: handle("VR", t),
            name: "VR",
            description: "VR work.",
            reason: REASON,
          },
          {
            category: handle("Python", t),
            name: "  ",
            description: null,
            reason: REASON,
          },
        ],
        moves: [
          {
            category: handle("Flutter", t),
            type: "Technology",
            reason: REASON,
          },
        ],
      })
    );
    expect(operations).toEqual([]);
    expect(dropped).toBe(3);
  });

  it("keeps a rename's unchanged half as null", () => {
    const t = tool();
    const { operations } = t.parse(
      answer({
        renames: [
          {
            category: handle("VR", t),
            name: "VR",
            description: "Virtual reality headsets and the apps for them.",
            reason: REASON,
          },
        ],
      })
    );
    expect(operations).toMatchObject([
      {
        kind: "rename",
        name: null,
        description: "Virtual reality headsets and the apps for them.",
      },
    ]);
  });

  it("keeps the first change to a category and drops a second", () => {
    const t = tool();
    const { operations, dropped } = t.parse(
      answer({
        merges: [
          {
            sources: [handle("VR", t)],
            target: handle("AR / VR", t),
            reason: REASON,
          },
        ],
        renames: [
          {
            category: handle("AR / VR", t),
            name: "Extended Reality",
            description: null,
            reason: REASON,
          },
        ],
        retires: [{ category: handle("VR", t), reason: REASON }],
      })
    );
    expect(operations.map((o) => o.kind)).toEqual(["merge"]);
    expect(dropped).toBe(2);
  });

  it(`stops at ${CLEANUP_MAX_OPERATIONS} changes`, () => {
    const many = Array.from({ length: CLEANUP_MAX_OPERATIONS + 3 }, (_, i) =>
      category(`t-${i}`, "Technology", `Tech ${i}`)
    );
    const t = tool(many);
    const { operations, dropped } = t.parse(
      answer({
        retires: many
          .slice(0, CLEANUP_MAX_OPERATIONS)
          .map((c) => ({ category: handle(c.name, t), reason: REASON })),
      })
    );
    expect(operations).toHaveLength(CLEANUP_MAX_OPERATIONS);
    expect(dropped).toBe(0);
  });

  it("is null when only Kind of work is left", () => {
    expect(buildCleanupTool(LIST.slice(0, 2))).toBeNull();
  });

  it("shows the model both counts, the creation date and the sample titles", () => {
    const t = tool([
      category("f-vr", "Field", "VR", {
        usage: 3,
        publishedUsage: 2,
        sampleTitles: ["Headset lab", "Museum\ntour"],
      }),
    ]);
    expect(t.catalog).toContain("VR work.");
    expect(t.catalog).toContain("2 published, 3 submitted or later");
    expect(t.catalog).toContain("created 2026-11-12");
    expect(t.catalog).toContain('"Headset lab"; "Museum tour"');
  });
});

const promptText = tagBreakingText(["<categories>", "</categories>"]);

describe("the cleanup catalog, on generated categories", () => {
  test.prop([
    fc.array(
      fc.record({
        name: promptText,
        description: fc.option(promptText),
        type: promptText,
        title: promptText,
      }),
      { minLength: 1, maxLength: 6 }
    ),
  ])("no name, definition, type or title adds a tag", (rows) => {
    const built = buildCleanupTool(
      rows.map((r, i) =>
        category(`id-${i}`, `x${r.type}`, r.name, {
          description: r.description,
          sampleTitles: [r.title],
        })
      )
    );
    expect(tagsIn(built?.catalog ?? "")).toEqual([]);
    expect(strayBrackets(built?.catalog ?? "")).toBe(0);
  });
});

function proposal(
  operation: CleanupProposal["operation"],
  effect: CleanupProposal["effect"]
): CleanupProposal {
  return { operation, effect };
}

const ref = (name: string, type = "Field") => ({
  id: name,
  name,
  type,
  description: null,
});

describe("describeCleanup", () => {
  it("reads a merge with its counts and overlap", () => {
    expect(
      describeCleanup(
        proposal(
          {
            kind: "merge",
            target: ref("AR / VR"),
            sources: [ref("VR")],
            reason: REASON,
          },
          {
            kind: "merge",
            targetUsage: 6,
            sourceUsage: [3],
            after: 8,
            shared: 1,
          }
        )
      )
    ).toBe(
      "Merge VR (3) into AR / VR (6): 8 projects after, 1 already carried both"
    );
  });

  it("names every source and leaves out an overlap of none", () => {
    expect(
      describeCleanup(
        proposal(
          {
            kind: "merge",
            target: ref("AR / VR"),
            sources: [ref("VR"), ref("AR"), ref("XR")],
            reason: REASON,
          },
          {
            kind: "merge",
            targetUsage: 6,
            sourceUsage: [3, 1, 0],
            after: 10,
            shared: 0,
          }
        )
      )
    ).toBe(
      "Merge VR (3), AR (1) and XR (0) into AR / VR (6): 10 projects after"
    );
  });

  it("reads a rename, a move and a retirement", () => {
    expect(
      describeCleanup(
        proposal(
          {
            kind: "rename",
            category: ref("ML"),
            name: "Machine Learning",
            description: null,
            reason: REASON,
          },
          { kind: "rename", usage: 11 }
        )
      )
    ).toBe("Rename ML to Machine Learning (11 projects)");
    expect(
      describeCleanup(
        proposal(
          {
            kind: "rename",
            category: ref("ML"),
            name: null,
            description: "Models that learn from data.",
            reason: REASON,
          },
          { kind: "rename", usage: 1 }
        )
      )
    ).toBe("Rewrite the description of ML (1 project)");
    expect(
      describeCleanup(
        proposal(
          {
            kind: "move",
            category: ref("Flutter"),
            type: "Technology",
            reason: REASON,
          },
          { kind: "move", usage: 4 }
        )
      )
    ).toBe("Move Flutter (4) from Field to Technology");
    expect(
      describeCleanup(
        proposal(
          { kind: "retire", category: ref("Blockchain"), reason: REASON },
          { kind: "retire", usage: 1 }
        )
      )
    ).toBe("Retire Blockchain: 1 project loses it");
  });
});
