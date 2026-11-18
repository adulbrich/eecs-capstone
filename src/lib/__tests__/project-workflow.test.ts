import { describe, expect, it } from "vitest";
import { PROJECT_STATUSES, type ProjectStatus } from "#/lib/vocabularies";
import {
  type ActorRole,
  assertTransitionAllowed,
  BATCH_TARGETS,
  BATCH_TRANSITIONS,
  canTransition,
  PROJECT_STATUS_DESCRIPTION,
  PROJECT_STATUS_DISPLAY_RANK,
  PROJECT_STATUS_LABEL,
  PROJECT_STATUSES_IN_DISPLAY_ORDER,
  splitBatchCandidates,
} from "../project-workflow";

const allowedCases: [ProjectStatus, ProjectStatus, ActorRole][] = [
  ["draft", "submitted", "owner"],
  ["draft", "submitted", "staff"],
  ["draft", "approved", "staff"],
  ["submitted", "draft", "owner"],
  ["submitted", "draft", "staff"],
  ["submitted", "approved", "staff"],
  ["submitted", "changes_requested", "staff"],
  ["changes_requested", "submitted", "owner"],
  ["changes_requested", "submitted", "staff"],
  ["changes_requested", "approved", "staff"],
  ["approved", "published", "staff"],
  ["approved", "changes_requested", "staff"],
  ["published", "archived", "staff"],
  ["archived", "published", "staff"],
];

const forbiddenCases: [ProjectStatus, ProjectStatus, ActorRole][] = [
  ["draft", "approved", "owner"],
  ["draft", "published", "owner"],
  ["draft", "published", "staff"],
  ["submitted", "published", "owner"],
  ["submitted", "published", "staff"],
  ["approved", "published", "owner"],
  ["approved", "draft", "staff"],
  ["published", "draft", "staff"],
  ["archived", "draft", "staff"],
  ["archived", "submitted", "staff"],
];

describe("canTransition", () => {
  it.each(allowedCases)("%s -> %s is allowed for %s", (from, to, role) => {
    expect(canTransition(from, to, role)).toBe(true);
  });

  it.each(forbiddenCases)("%s -> %s is forbidden for %s", (from, to, role) => {
    expect(canTransition(from, to, role)).toBe(false);
  });

  it("returns false for self-transition", () => {
    expect(canTransition("draft", "draft", "owner")).toBe(false);
    expect(canTransition("published", "published", "staff")).toBe(false);
  });
});

describe("assertTransitionAllowed", () => {
  it("does not throw on an allowed transition", () => {
    expect(() =>
      assertTransitionAllowed("draft", "submitted", "owner")
    ).not.toThrow();
  });

  it("throws on a forbidden transition with a message naming from, to, role", () => {
    expect(() =>
      assertTransitionAllowed("draft", "published", "owner")
    ).toThrow(/draft.*published.*owner/u);
  });
});

describe("status copy", () => {
  it("labels every status once, in sentence case, with no abbreviation", () => {
    const labels = PROJECT_STATUSES.map((s) => PROJECT_STATUS_LABEL[s]);
    expect(new Set(labels).size).toBe(PROJECT_STATUSES.length);
    for (const label of labels) {
      expect(label).toMatch(/^[A-Z][a-z]+( [a-z]+)*$/u);
    }
    // The spelling the glossary uses, which three components used to disagree
    // on: the badge said "changes requested", the stepper "Changes Req.".
    expect(PROJECT_STATUS_LABEL.changes_requested).toBe("Changes requested");
  });

  it("describes every status in one sentence or two, ending in a full stop", () => {
    for (const s of PROJECT_STATUSES) {
      expect(PROJECT_STATUS_DESCRIPTION[s]).toMatch(/^[A-Z].*\.$/u);
    }
  });

  it("ranks every status for display, with changes requested beside submitted", () => {
    expect(PROJECT_STATUSES_IN_DISPLAY_ORDER).toEqual([
      "draft",
      "submitted",
      "changes_requested",
      "approved",
      "published",
      "archived",
    ]);
    for (const s of PROJECT_STATUSES) {
      expect(PROJECT_STATUS_DISPLAY_RANK[s]).toBe(
        PROJECT_STATUSES_IN_DISPLAY_ORDER.indexOf(s)
      );
    }
  });
});

describe("splitBatchCandidates", () => {
  const row = (status: ProjectStatus, deletedAt: Date | null = null) => ({
    deletedAt,
    status,
  });

  it("puts a published row in archive's eligible set and an approved row in publish's", () => {
    expect(
      splitBatchCandidates([row("published")], "archived").eligible
    ).toHaveLength(1);
    expect(
      splitBatchCandidates([row("approved")], "published").eligible
    ).toHaveLength(1);
  });

  it("puts every other status in other status", () => {
    for (const target of BATCH_TARGETS) {
      const source = BATCH_TRANSITIONS[target];
      const others = PROJECT_STATUSES.filter((s) => s !== source).map((s) =>
        row(s)
      );
      const split = splitBatchCandidates(others, target);
      expect(split.eligible).toEqual([]);
      expect(split.softDeleted).toEqual([]);
      expect(split.otherStatus).toEqual(others);
    }
  });

  it("puts a soft-deleted row of any status in soft-deleted, eligible status included", () => {
    const deleted = PROJECT_STATUSES.map((s) => row(s, new Date()));
    for (const target of BATCH_TARGETS) {
      const split = splitBatchCandidates(deleted, target);
      expect(split.softDeleted).toEqual(deleted);
      expect(split.eligible).toEqual([]);
      expect(split.otherStatus).toEqual([]);
    }
  });

  it("offers only archive published and publish approved, each a transition staff may make", () => {
    expect(BATCH_TRANSITIONS).toEqual({
      archived: "published",
      published: "approved",
    });
    for (const target of BATCH_TARGETS) {
      expect(canTransition(BATCH_TRANSITIONS[target], target, "staff")).toBe(
        true
      );
    }
  });
});
