import { describe, expect, it } from "vitest";
import { diffProjectFields } from "../project-edit-diff";

describe("diffProjectFields", () => {
  it("skips a field the caller never offered", () => {
    // The rule worth protecting. A viewer who may not write `notes` never
    // contributes one, and `.set()` leaves the column alone. Diffing it anyway
    // would log a phantom "changed to null" against a value still in the row.
    const out = diffProjectFields(
      { notes: "staff only", title: "A" },
      { title: "A" }
    );
    expect(out.changedFields).toEqual([]);
    expect(out.oldDiff).toEqual({});
    expect(out.newDiff).toEqual({});
  });

  it("reports a field that changed, with both sides", () => {
    const out = diffProjectFields(
      { description: "old", title: "A" },
      { description: "new", title: "A" }
    );
    expect(out.changedFields).toEqual(["description"]);
    expect(out.oldDiff).toEqual({ description: "old" });
    expect(out.newDiff).toEqual({ description: "new" });
  });

  it("treats undefined and null as the same absence", () => {
    const out = diffProjectFields(
      { description: null, title: "A" },
      { description: undefined, title: "A" }
    );
    expect(out.changedFields).toEqual([]);
  });

  it("follows the declared field order, not key insertion order", () => {
    // changedFields is stored on the edit log and rendered in the staff panel,
    // so its order is observable.
    const out = diffProjectFields(
      { objectives: "a", title: "A", url: "u" },
      { objectives: "b", title: "B", url: "v" }
    );
    expect(out.changedFields).toEqual(["title", "objectives", "url"]);
  });

  it("ignores keys that are not editable fields", () => {
    const out = diffProjectFields(
      { searchVector: "old", title: "A" },
      { searchVector: "new", title: "A" }
    );
    expect(out.changedFields).toEqual([]);
  });
});
