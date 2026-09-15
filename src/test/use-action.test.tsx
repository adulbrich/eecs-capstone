// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAction } from "#/lib/use-action";

afterEach(cleanup);

/** A promise the test settles by hand, so the flight can be inspected. */
function deferred() {
  let settle: () => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const promise = new Promise<void>((res, rej) => {
    settle = res;
    reject = rej;
  });
  // Wrapped, so they read the binding the executor assigned rather than the
  // placeholder that existed when this returned.
  return {
    promise,
    reject: (reason: unknown) => reject(reason),
    settle: () => settle(),
  };
}

describe("useAction", () => {
  it("refuses a second call while the first is still in flight", async () => {
    const { promise, settle } = deferred();
    const action = vi.fn(() => promise);
    const { result } = renderHook(() => useAction());

    // Both calls in one tick. This is the case `disabled` cannot cover and
    // only the ref inside the hook can: a keyboard activation or a dropdown
    // item whose handler runs before React has re-rendered. It has to be
    // asserted here rather than through a component, because fireEvent
    // flushes state between two clicks, so a DOM-level double click is
    // refused by `disabled` whether the ref exists or not.
    let first: Promise<boolean> | undefined;
    let second: Promise<boolean> | undefined;
    await act(async () => {
      first = result.current.run(action);
      second = result.current.run(action);
      settle();
      await Promise.all([first, second]);
    });

    expect(action).toHaveBeenCalledTimes(1);
    expect(await first).toBe(true);
    expect(await second).toBe(false);
  });

  it("runs again once the first call has settled", async () => {
    const action = vi.fn(() => Promise.resolve());
    const { result } = renderHook(() => useAction());

    await act(() => result.current.run(action));
    await act(() => result.current.run(action));

    expect(action).toHaveBeenCalledTimes(2);
  });

  it("is busy for the length of the flight and not after", async () => {
    const { promise, settle } = deferred();
    const { result } = renderHook(() => useAction());

    let flight: Promise<boolean> | undefined;
    act(() => {
      flight = result.current.run(() => promise);
    });
    expect(result.current.busy).toBe(true);

    await act(async () => {
      settle();
      await flight;
    });
    expect(result.current.busy).toBe(false);
  });

  it("is not busy after a rejection either", async () => {
    const { result } = renderHook(() => useAction());
    await act(() => result.current.run(() => Promise.reject(new Error("No"))));
    expect(result.current.busy).toBe(false);
  });

  it("holds the rejection's message for the caller to render", async () => {
    const { result } = renderHook(() => useAction());

    let answer: boolean | undefined;
    await act(async () => {
      answer = await result.current.run(() =>
        Promise.reject(new Error("Cannot ban the last admin"))
      );
    });

    expect(answer).toBe(false);
    expect(result.current.error).toBe("Cannot ban the last admin");
  });

  it("falls back when the rejection carries no message", async () => {
    const { result } = renderHook(() => useAction({ fallback: "Save failed" }));
    // A server function can reject with anything; this is the shape that
    // rendered an empty paragraph before `errorMessage` existed.
    await act(() => result.current.run(() => Promise.reject({ status: 500 })));
    expect(result.current.error).toBe("Save failed");
  });

  it("prefers the fallback passed to run over the hook's", async () => {
    const { result } = renderHook(() => useAction({ fallback: "Save failed" }));
    await act(() =>
      result.current.run(() => Promise.reject({ status: 500 }), "Reject failed")
    );
    expect(result.current.error).toBe("Reject failed");
  });

  it("clears the previous error when the next attempt starts", async () => {
    const { result } = renderHook(() => useAction());
    await act(() => result.current.run(() => Promise.reject(new Error("No"))));
    expect(result.current.error).toBe("No");

    await act(() => result.current.run(() => Promise.resolve()));
    expect(result.current.error).toBeNull();
  });

  it("diverts to onError and holds nothing, for a caller with no panel", async () => {
    const onError = vi.fn();
    const { result } = renderHook(() => useAction({ onError }));

    await act(() =>
      result.current.run(() => Promise.reject(new Error("Gone")))
    );

    expect(onError).toHaveBeenCalledWith("Gone");
    expect(result.current.error).toBeNull();
  });

  it("lets the caller write a client-side refusal into the same slot", () => {
    const { result } = renderHook(() => useAction());
    act(() => result.current.setError("Reason required"));
    expect(result.current.error).toBe("Reason required");
  });

  it("accepts a synchronous action", async () => {
    const action = vi.fn();
    const { result } = renderHook(() => useAction());
    let answer: boolean | undefined;
    await act(async () => {
      answer = await result.current.run(action);
    });
    expect(answer).toBe(true);
    expect(action).toHaveBeenCalledTimes(1);
  });
});
