import { describe, expect, it, vi } from "vitest";
import { createSweepTrigger } from "#/lib/_internal/sweep-trigger";

function harness(run: () => Promise<unknown>) {
  let clock = 1_000_000;
  const onError = vi.fn();
  const trigger = createSweepTrigger({
    everyMs: 60_000,
    now: () => clock,
    onError,
    run,
  });
  return {
    advance: (ms: number) => {
      clock += ms;
    },
    onError,
    trigger,
  };
}

/** Lets the trigger's promise chain, `finally` included, run to the end. */
async function flush() {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
}

describe("createSweepTrigger", () => {
  it("starts a run on the first request and not again within the interval", async () => {
    const run = vi.fn(() => Promise.resolve());
    const { advance, trigger } = harness(run);
    trigger();
    await flush();
    advance(59_999);
    trigger();
    expect(run).toHaveBeenCalledTimes(1);
    advance(1);
    trigger();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("never starts a second run while one is in flight", async () => {
    let finish: () => void = () => undefined;
    const run = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    const { advance, trigger } = harness(run);
    trigger();
    advance(5 * 60_000);
    trigger();
    expect(run).toHaveBeenCalledTimes(1);
    finish();
    await flush();
    trigger();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("returns before the run settles", () => {
    const run = vi.fn(() => new Promise<void>(() => undefined));
    const { trigger } = harness(run);
    expect(trigger()).toBeUndefined();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("hands a rejected run to onError and runs again after the interval", async () => {
    const run = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("db down"))
      .mockResolvedValue(undefined);
    const { advance, onError, trigger } = harness(run);
    trigger();
    await flush();
    expect(onError).toHaveBeenCalledWith(new Error("db down"));
    advance(60_000);
    trigger();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("catches a run that throws before returning a promise", async () => {
    const run = vi.fn(() => {
      throw new Error("sync");
    });
    const { onError, trigger } = harness(run);
    expect(() => trigger()).not.toThrow();
    await flush();
    expect(onError).toHaveBeenCalledWith(new Error("sync"));
  });
});
