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

describe("buildScopeSource", () => {
  it("names the program's term count when it is set, and says so when not", () => {
    const set = buildScopeSource(project, {
      label: "CS 461 Senior Software Engineering Project I",
      termCount: 3,
    });
    expect(set).toContain("<program>");
    expect(set).toContain("runs 3 terms");
    const unset = buildScopeSource(project, {
      label: "CS 462",
      termCount: null,
    });
    expect(unset).toContain("term count not set");
    const none = buildScopeSource(project, { label: null, termCount: null });
    expect(none).toContain("no program");
  });

  it("skips empty fields and wraps the rest in tags", () => {
    const source = buildScopeSource(project, { label: null, termCount: null });
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
