// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSeedViewFromStorage } from "#/lib/use-seed-view";
import { writeStoredView } from "#/lib/view-preference";

afterEach(() => {
  localStorage.clear();
});

describe("useSeedViewFromStorage", () => {
  it("seeds from storage when the current view is unset", () => {
    writeStoredView("table");
    const seed = vi.fn();
    renderHook(() => useSeedViewFromStorage(undefined, seed));
    expect(seed).toHaveBeenCalledWith("table");
  });

  it("does not seed when the current view is already set", () => {
    writeStoredView("table");
    const seed = vi.fn();
    renderHook(() => useSeedViewFromStorage("card", seed));
    expect(seed).not.toHaveBeenCalled();
  });

  it("does not seed when nothing is stored", () => {
    const seed = vi.fn();
    renderHook(() => useSeedViewFromStorage(undefined, seed));
    expect(seed).not.toHaveBeenCalled();
  });
});
