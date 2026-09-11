import { describe, expect, it } from "vitest";
import { errorMessage } from "#/lib/error-message";

describe("errorMessage", () => {
  it("returns the message of an Error that has one", () => {
    expect(errorMessage(new Error("boom"), "fallback")).toBe("boom");
  });

  it("returns the fallback for an Error with an empty message", () => {
    const blank = new Error("blank");
    blank.message = "";
    expect(errorMessage(blank, "fallback")).toBe("fallback");
  });

  it("passes a thrown string through", () => {
    expect(errorMessage("boom", "fallback")).toBe("boom");
  });

  it("returns the fallback for anything else", () => {
    expect(errorMessage({ status: 500 }, "fallback")).toBe("fallback");
    expect(errorMessage("", "fallback")).toBe("fallback");
  });
});
