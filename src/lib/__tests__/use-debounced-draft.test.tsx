// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDebouncedDraft } from "../use-debounced-draft";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("useDebouncedDraft", () => {
  it("commits after the delay and not before", () => {
    const commit = vi.fn();
    const { result } = renderHook(() => useDebouncedDraft("", commit));

    act(() => result.current[1]("ard"));
    expect(result.current[0]).toBe("ard");
    act(() => vi.advanceTimersByTime(290));
    expect(commit).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(20));
    expect(commit).toHaveBeenCalledWith("ard");
  });

  it("coalesces rapid changes into one commit", () => {
    const commit = vi.fn();
    const { result } = renderHook(() => useDebouncedDraft("", commit));

    act(() => result.current[1]("a"));
    act(() => vi.advanceTimersByTime(100));
    act(() => result.current[1]("ar"));
    act(() => vi.advanceTimersByTime(100));
    act(() => result.current[1]("ard"));
    act(() => vi.advanceTimersByTime(310));

    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith("ard");
  });

  it("resets the draft when the value changes underneath", () => {
    const commit = vi.fn();
    const { result, rerender } = renderHook(
      ({ v }) => useDebouncedDraft(v, commit),
      { initialProps: { v: "old" } }
    );

    rerender({ v: "new" });
    expect(result.current[0]).toBe("new");
  });

  it("does not write the old draft back when the value changes underneath", () => {
    // The regression. This is browser Back: the URL's q changes, and a draft
    // holding the previous value must not be committed over the top of it
    // 300ms later. inventory-filter-bar did exactly that.
    const commit = vi.fn();
    const { rerender } = renderHook(({ v }) => useDebouncedDraft(v, commit), {
      initialProps: { v: "old" },
    });

    rerender({ v: "new" });
    act(() => vi.advanceTimersByTime(500));
    expect(commit).not.toHaveBeenCalled();
  });

  it("keeps a key typed while its own commit is still loading", () => {
    // The router hands `q` back only once the loader resolves, so a commit
    // lands a round trip after it fires. Resyncing to that echo dropped every
    // key typed in between, and the next search ran on the mangled text (#501).
    const commit = vi.fn();
    const { result, rerender } = renderHook(
      ({ v }) => useDebouncedDraft(v, commit),
      { initialProps: { v: "" } }
    );

    act(() => result.current[1]("ard"));
    act(() => vi.advanceTimersByTime(300));
    expect(commit).toHaveBeenLastCalledWith("ard");
    act(() => result.current[1]("ardu"));
    rerender({ v: "ard" });
    expect(result.current[0]).toBe("ardu");
    act(() => vi.advanceTimersByTime(300));
    expect(commit).toHaveBeenLastCalledWith("ardu");
  });

  it("still resyncs on Back and Forward once its own commits have landed", () => {
    const commit = vi.fn();
    const { result, rerender } = renderHook(
      ({ v }) => useDebouncedDraft(v, commit),
      { initialProps: { v: "" } }
    );

    act(() => result.current[1]("ard"));
    act(() => vi.advanceTimersByTime(300));
    rerender({ v: "ard" });
    act(() => result.current[1]("arduino"));
    act(() => vi.advanceTimersByTime(300));
    rerender({ v: "arduino" });

    rerender({ v: "ard" });
    expect(result.current[0]).toBe("ard");
    // Forward returns to a value this hook once committed, and is still a
    // change underneath rather than an echo.
    rerender({ v: "arduino" });
    expect(result.current[0]).toBe("arduino");
    act(() => vi.advanceTimersByTime(500));
    expect(commit).toHaveBeenCalledTimes(2);
  });

  it("resyncs on Forward to a commit that Back cancelled before it landed", () => {
    // Back while the loader runs aborts the commit, and `value` never moves,
    // so the hook sees nothing. Clearing the box must still reach the URL, or
    // Forward reads as the cancelled commit coming back and gets overwritten.
    const commit = vi.fn();
    const { result, rerender } = renderHook(
      ({ v }) => useDebouncedDraft(v, commit),
      { initialProps: { v: "" } }
    );

    act(() => result.current[1]("arduino"));
    act(() => vi.advanceTimersByTime(300));
    act(() => result.current[1](""));
    act(() => vi.advanceTimersByTime(300));
    expect(commit).toHaveBeenLastCalledWith("");

    rerender({ v: "arduino" });
    expect(result.current[0]).toBe("arduino");
    act(() => vi.advanceTimersByTime(500));
    expect(commit).toHaveBeenCalledTimes(2);
  });

  it("does not commit when the draft already equals the value", () => {
    const commit = vi.fn();
    const { result } = renderHook(() => useDebouncedDraft("same", commit));

    act(() => result.current[1]("same"));
    act(() => vi.advanceTimersByTime(500));
    expect(commit).not.toHaveBeenCalled();
  });
});
