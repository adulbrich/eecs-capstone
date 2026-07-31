import { describe, expect, it } from "vitest";
import { isUuid } from "../is-uuid";

describe("isUuid", () => {
  it("accepts a canonical lowercase uuid", () => {
    expect(isUuid("d461dc1c-0ad9-4fe2-bcb9-65f48e6d6011")).toBe(true);
  });

  it("accepts uppercase, since Postgres round-trips either case", () => {
    expect(isUuid("D461DC1C-0AD9-4FE2-BCB9-65F48E6D6011")).toBe(true);
  });

  it("accepts the nil uuid", () => {
    expect(isUuid("00000000-0000-0000-0000-000000000000")).toBe(true);
  });

  it("rejects the values that actually reach a route param", () => {
    // The literal route segment that sits beside /inventory/$itemId.
    expect(isUuid("new")).toBe(false);
    // A truncated copy-paste.
    expect(isUuid("d461dc1c-0ad9-4fe2-bcb9")).toBe(false);
    // A trailing character, which a naive "contains" check would let through.
    expect(isUuid("d461dc1c-0ad9-4fe2-bcb9-65f48e6d6011x")).toBe(false);
    // A leading character, likewise.
    expect(isUuid("xd461dc1c-0ad9-4fe2-bcb9-65f48e6d6011")).toBe(false);
    // Non-hex in an otherwise correct shape.
    expect(isUuid("g461dc1c-0ad9-4fe2-bcb9-65f48e6d6011")).toBe(false);
    // Right length, no dashes.
    expect(isUuid("d461dc1c0ad94fe2bcb965f48e6d6011")).toBe(false);
  });

  it("rejects empty and nullish input without throwing", () => {
    expect(isUuid("")).toBe(false);
    expect(isUuid(null)).toBe(false);
    expect(isUuid(undefined)).toBe(false);
  });

  it("is not stateful across calls", () => {
    // A regex literal with /g would alternate results via lastIndex; this
    // guards against someone adding the flag later.
    const id = "d461dc1c-0ad9-4fe2-bcb9-65f48e6d6011";
    expect(isUuid(id)).toBe(true);
    expect(isUuid(id)).toBe(true);
  });
});
