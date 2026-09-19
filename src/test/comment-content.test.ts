import { describe, expect, it } from "vitest";
import { COMMENT_MAX_LENGTH, commentContent } from "#/lib/comment-content";

describe("commentContent", () => {
  it("refuses an empty body", () => {
    expect(commentContent.safeParse("").success).toBe(false);
  });

  it("refuses a body that is only whitespace", () => {
    expect(commentContent.safeParse("   \n\t ").success).toBe(false);
  });

  it("trims what it accepts, so a padded body is stored without the padding", () => {
    expect(commentContent.parse("  hello  ")).toBe("hello");
  });

  it("accepts a body at the ceiling and refuses one character more", () => {
    expect(
      commentContent.safeParse("x".repeat(COMMENT_MAX_LENGTH)).success
    ).toBe(true);
    expect(
      commentContent.safeParse("x".repeat(COMMENT_MAX_LENGTH + 1)).success
    ).toBe(false);
  });

  it("measures the ceiling after the trim, not before", () => {
    // A body padded past the ceiling is the same comment once trimmed, so the
    // reader who typed it should not be told it is too long.
    const padded = `  ${"x".repeat(COMMENT_MAX_LENGTH)}  `;
    expect(commentContent.safeParse(padded).success).toBe(true);
  });
});
