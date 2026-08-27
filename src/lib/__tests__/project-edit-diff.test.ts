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

  it("follows the writer's field order", () => {
    // changedFields is stored on the edit log and rendered in the staff panel,
    // so its order is observable. It is the order `buildProjectValues` builds
    // its object in, which is why reordering that literal is a visible change
    // and this test fails when it happens.
    const out = diffProjectFields(
      { objectives: "a", title: "A", url: "u" },
      { title: "B", objectives: "b", url: "v" }
    );
    expect(out.changedFields).toEqual(["title", "objectives", "url"]);
  });

  it("reports a boolean that is the only change", () => {
    // The regression. These two columns are written by `buildProjectValues`
    // and were absent from the hand-maintained field list, so an edit that
    // moved only one of them diffed to nothing and was dropped before the
    // UPDATE ran.
    const out = diffProjectFields(
      { isSponsored: false, requiresNdaIp: true, title: "A" },
      { isSponsored: true, requiresNdaIp: true, title: "A" }
    );
    expect(out.changedFields).toEqual(["isSponsored"]);
    expect(out.oldDiff).toEqual({ isSponsored: false });
    expect(out.newDiff).toEqual({ isSponsored: true });
  });

  it("ignores a column the writer did not offer", () => {
    // Replaces an older case that passed a non-column key in `next` and
    // expected it skipped. Membership now comes from the writer, so the
    // guarantee moved to the type: `next` is `Partial<T>` of the row, and a
    // key that is not a column no longer typechecks.
    const out = diffProjectFields(
      { searchVector: "old", title: "A" },
      { title: "A" }
    );
    expect(out.changedFields).toEqual([]);
  });
});
