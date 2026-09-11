import { describe, expect, it } from "vitest";
import { PROJECT_STATUSES, type ProjectStatus } from "#/lib/vocabularies";
import {
  type ActorRole,
  assertTransitionAllowed,
  canTransition,
  PROJECT_STATUS_DESCRIPTION,
  PROJECT_STATUS_DISPLAY_RANK,
  PROJECT_STATUS_LABEL,
  PROJECT_STATUSES_IN_DISPLAY_ORDER,
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
    ).toThrow(/draft.*published.*owner/);
  });
});

describe("status copy", () => {
  it("labels every status once, in sentence case, with no abbreviation", () => {
    const labels = PROJECT_STATUSES.map((s) => PROJECT_STATUS_LABEL[s]);
    expect(new Set(labels).size).toBe(PROJECT_STATUSES.length);
    for (const label of labels) {
      expect(label).toMatch(/^[A-Z][a-z]+( [a-z]+)*$/);
    }
    // The spelling the glossary uses, which three components used to disagree
    // on: the badge said "changes requested", the stepper "Changes Req.".
    expect(PROJECT_STATUS_LABEL.changes_requested).toBe("Changes requested");
  });

  it("describes every status in one sentence or two, ending in a full stop", () => {
    for (const s of PROJECT_STATUSES) {
      expect(PROJECT_STATUS_DESCRIPTION[s]).toMatch(/^[A-Z].*\.$/);
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
