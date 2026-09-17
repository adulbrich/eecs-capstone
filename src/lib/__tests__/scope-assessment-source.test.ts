import { describe, expect, it } from "vitest";
import { buildScopeSource, scopeSourceHash } from "../scope-assessment-source";

const project = {
  title: "Trail camera classifier",
  description: "Classify species.",
  problemStatement: null,
  objectives: "- Train a model\n- Build a review tool",
  minQualifications: "Python",
  prefQualifications: null,
  teamsSupported: 2,
};

/**
 * The zero and single program cases must stay byte identical through #462,
 * or every stored verdict reads as stale and staff re-run them at Bedrock
 * cost each. Pinned in full rather than with `toContain`, and the
 * term-count-unset case is here because it is the branch that gets
 * forgotten: `programLine` has three outputs, not two.
 */
describe("buildScopeSource holds its existing output byte for byte", () => {
  const pinned = {
    title: "Trail camera classifier",
    description: "Classify species.",
    problemStatement: null,
    objectives: "- Train a model",
    minQualifications: null,
    prefQualifications: null,
    teamsSupported: 2,
  };
  const body = [
    "Teams supported: 2",
    '<field name="title" label="Title">\nTrail camera classifier\n</field>',
    '<field name="description" label="Description">\nClassify species.\n</field>',
    '<field name="objectives" label="Objectives / deliverables">\n- Train a model\n</field>',
  ].join("\n\n");

  it("renders no program as it always has", () => {
    expect(buildScopeSource(pinned, [])).toBe(
      `<program>\nThis proposal names no program.\n</program>\n\n${body}`
    );
  });

  it("renders one program with a term count as it always has", () => {
    expect(
      buildScopeSource(pinned, [{ label: "CS 461 Capstone", termCount: 3 }])
    ).toBe(`<program>\nCS 461 Capstone (runs 3 terms).\n</program>\n\n${body}`);
  });

  it("renders one program with no term count as it always has", () => {
    expect(
      buildScopeSource(pinned, [{ label: "CS 462 Capstone", termCount: null }])
    ).toBe(
      `<program>\nCS 462 Capstone (term count not set).\n</program>\n\n${body}`
    );
  });

  it("singularizes one term", () => {
    expect(
      buildScopeSource(pinned, [{ label: "CS 463", termCount: 1 }])
    ).toContain("CS 463 (runs 1 term).");
  });
});

describe("buildScopeSource", () => {
  it("names the program's term count when it is set, and says so when not", () => {
    const set = buildScopeSource(project, [
      {
        label: "CS 461 Senior Software Engineering Project I",
        termCount: 3,
      },
    ]);
    expect(set).toContain("<program>");
    expect(set).toContain("runs 3 terms");
    const unset = buildScopeSource(project, [
      { label: "CS 462", termCount: null },
    ]);
    expect(unset).toContain("term count not set");
    const none = buildScopeSource(project, []);
    expect(none).toContain("no program");
  });

  it("names every program a project runs in, with its own term count", () => {
    const both = buildScopeSource(project, [
      { label: "CS 461 Corvallis", termCount: 3 },
      { label: "CS 46X Ecampus", termCount: null },
    ]);
    expect(both).toContain(
      "This proposal runs in 2 programs: CS 461 Corvallis (runs 3 terms); CS 46X Ecampus (term count not set)."
    );
  });

  // The hash is what marks a verdict stale, so the order staff happened to
  // click the checkboxes in must not reach it.
  it("does not let the caller's order move the output", () => {
    const a = { label: "CS 461 Corvallis", termCount: 3 };
    const b = { label: "CS 46X Ecampus", termCount: 2 };
    expect(buildScopeSource(project, [a, b])).toBe(
      buildScopeSource(project, [b, a])
    );
  });

  it("skips empty fields and wraps the rest in tags", () => {
    const source = buildScopeSource(project, []);
    expect(source).toContain('<field name="objectives"');
    expect(source).not.toContain('name="problemStatement"');
    expect(source).toContain("Teams supported: 2");
  });
});

describe("scopeSourceHash", () => {
  it("changes with the text, the program line and the model", () => {
    const a = scopeSourceHash("one", "model-a");
    expect(scopeSourceHash("one", "model-a")).toBe(a);
    expect(scopeSourceHash("two", "model-a")).not.toBe(a);
    expect(scopeSourceHash("one", "model-b")).not.toBe(a);
  });
});
