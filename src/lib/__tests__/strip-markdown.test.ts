import { describe, expect, it } from "vitest";
import { stripMarkdown } from "#/lib/strip-markdown";

describe("stripMarkdown", () => {
  it("returns an empty string for nullish input", () => {
    expect(stripMarkdown(null)).toBe("");
    expect(stripMarkdown(undefined)).toBe("");
    expect(stripMarkdown("")).toBe("");
  });

  it("leaves plain text untouched", () => {
    expect(stripMarkdown("A plain description.")).toBe("A plain description.");
  });

  it("flattens bullet lists", () => {
    expect(stripMarkdown("- ingests sensor data\n- stores it")).toBe(
      "ingests sensor data stores it"
    );
  });

  it("flattens numbered lists", () => {
    expect(stripMarkdown("1. first\n2. second")).toBe("first second");
  });

  it("removes emphasis markers", () => {
    expect(stripMarkdown("a **telemetry** pipeline")).toBe(
      "a telemetry pipeline"
    );
    expect(stripMarkdown("an *italic* word")).toBe("an italic word");
    expect(stripMarkdown("~~struck~~ out")).toBe("struck out");
  });

  it("keeps link text and drops the target", () => {
    expect(stripMarkdown("see [the docs](https://example.com/x)")).toBe(
      "see the docs"
    );
  });

  it("drops images entirely, alt text included", () => {
    expect(stripMarkdown("![a rover](rover.png) here")).toBe("here");
  });

  it("removes heading markers", () => {
    expect(stripMarkdown("# Heading\n\nBody")).toBe("Heading Body");
  });

  it("removes blockquote markers", () => {
    expect(stripMarkdown("> quoted\nplain")).toBe("quoted plain");
  });

  it("drops fenced code blocks entirely", () => {
    expect(stripMarkdown("```js\nconst a = 1;\n```\nAfter")).toBe("After");
  });

  it("unwraps inline code", () => {
    expect(stripMarkdown("run `npm test` now")).toBe("run npm test now");
  });

  it("does not mangle intra-word underscores", () => {
    expect(stripMarkdown("the snake_case_name field")).toBe(
      "the snake_case_name field"
    );
  });

  it("removes underscore emphasis markers", () => {
    expect(stripMarkdown("_italic_")).toBe("italic");
  });

  it("collapses whitespace", () => {
    expect(stripMarkdown("a\n\n\nb   c")).toBe("a b c");
  });
});
