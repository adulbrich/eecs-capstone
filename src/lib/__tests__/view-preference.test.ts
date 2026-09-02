// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readStoredView,
  VIEW_STORAGE_KEY,
  writeStoredView,
} from "#/lib/view-preference";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("view-preference", () => {
  it("round-trips a written view", () => {
    writeStoredView("table");
    expect(readStoredView()).toBe("table");
  });

  it("reads null for a garbage stored value", () => {
    localStorage.setItem(VIEW_STORAGE_KEY, "banana");
    expect(readStoredView()).toBeNull();
  });

  it("reads null for the retired row value", () => {
    // `row` was a valid mode until the table mode replaced it. It is dropped
    // rather than aliased: a browser still holding it falls back to the
    // default once, and the next click writes a current value.
    localStorage.setItem(VIEW_STORAGE_KEY, "row");
    expect(readStoredView()).toBeNull();
  });

  it("reads null (without throwing) when storage access fails", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(() => readStoredView()).not.toThrow();
    expect(readStoredView()).toBeNull();
  });
});
