import { describe, expect, it } from "vitest";
import { type AiRefreshAttempt, currentAttempt } from "#/lib/ai-refresh";

const stored = new Date("2026-10-05T22:47:27.411Z");

function attemptAt(offsetMs: number): AiRefreshAttempt {
  return {
    at: new Date(stored.getTime() + offsetMs),
    outcome: "failed",
    trigger: "automatic",
  };
}

describe("currentAttempt", () => {
  it("drops an attempt older than what is stored", () => {
    expect(currentAttempt(attemptAt(-1), stored)).toBeNull();
  });

  it("keeps an attempt that ties what is stored", () => {
    // A writer stamps its output, then records its attempt, often in the same
    // millisecond; dropping the tie would hide the attempt that just wrote.
    expect(currentAttempt(attemptAt(0), stored)).toEqual(attemptAt(0));
  });

  it("keeps an attempt newer than what is stored", () => {
    expect(currentAttempt(attemptAt(1), stored)).toEqual(attemptAt(1));
  });

  it("keeps any attempt when nothing is stored", () => {
    expect(currentAttempt(attemptAt(-1), null)).toEqual(attemptAt(-1));
  });

  it("returns null with no attempt", () => {
    expect(currentAttempt(null, stored)).toBeNull();
  });
});
