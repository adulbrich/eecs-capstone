import { describe, expect, it } from "vitest";
import {
  DEFAULT_ADMIN_STATUSES,
  isDefaultStatusSelection,
  statusSelectionLabel,
  toggleStatus,
} from "#/lib/admin-project-filters";
import { PROJECT_STATUSES } from "#/lib/vocabularies";

describe("the default status set", () => {
  it("is the vocabulary minus archived, whatever order it arrives in", () => {
    expect(DEFAULT_ADMIN_STATUSES).not.toContain("archived");
    expect(DEFAULT_ADMIN_STATUSES).toHaveLength(PROJECT_STATUSES.length - 1);
    expect(
      isDefaultStatusSelection([...DEFAULT_ADMIN_STATUSES].reverse())
    ).toBe(true);
    expect(isDefaultStatusSelection(["published"])).toBe(false);
    expect(isDefaultStatusSelection([...PROJECT_STATUSES])).toBe(false);
  });
});

describe("the trigger label", () => {
  it("names the default set, the whole vocabulary, one status, or a count", () => {
    expect(statusSelectionLabel(DEFAULT_ADMIN_STATUSES)).toBe(
      "All but archived"
    );
    expect(statusSelectionLabel([...PROJECT_STATUSES])).toBe("All statuses");
    expect(statusSelectionLabel(["changes_requested"])).toBe(
      "Changes requested"
    );
    expect(statusSelectionLabel(["draft", "published"])).toBe("2 statuses");
    expect(statusSelectionLabel(["draft", "published", "archived"])).toBe(
      "3 statuses"
    );
  });
});

describe("toggling a status", () => {
  it("checks and unchecks, keeping vocabulary order", () => {
    expect(toggleStatus(["published"], "draft")).toEqual([
      "draft",
      "published",
    ]);
    expect(toggleStatus(["draft", "published"], "draft")).toEqual([
      "published",
    ]);
  });

  it("refuses to uncheck the last checked status", () => {
    expect(toggleStatus(["published"], "published")).toEqual(["published"]);
  });
});
