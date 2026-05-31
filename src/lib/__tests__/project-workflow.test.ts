import { describe, expect, it } from "vitest";
import {
  type ActorRole,
  assertTransitionAllowed,
  canTransition,
  type Status,
} from "../project-workflow";

const allowedCases: [Status, Status, ActorRole][] = [
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

const forbiddenCases: [Status, Status, ActorRole][] = [
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
