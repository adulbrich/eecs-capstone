import { describe, expect, it } from "vitest";
import {
  SITE_DESCRIPTION,
  SOCIAL_DESCRIPTION_MAX_LENGTH,
  socialDescription,
  stripMarkdown,
  truncateOnWordBoundary,
} from "#/lib/social-meta";

const ELLIPSIS = "...";

describe("stripMarkdown", () => {
  it("keeps a link's label and drops its target", () => {
    // The target is noise in a preview and would eat most of a 160 character
    // budget on its own.
    expect(
      stripMarkdown("See [the brief](https://example.com/a/b) first")
    ).toBe("See the brief first");
  });

  it("drops an image entirely, label and all", () => {
    expect(stripMarkdown("![a diagram](/x.png) Then the text")).toBe(
      "Then the text"
    );
  });

  it("removes heading, bullet, ordered and blockquote markers", () => {
    const source = "## Goals\n\n- first\n- second\n\n1. third\n\n> a quote";
    expect(stripMarkdown(source)).toBe("Goals first second third a quote");
  });

  it("unwraps bold, italic and strikethrough without eating the words", () => {
    expect(stripMarkdown("**bold** and _italic_ and ~~gone~~")).toBe(
      "bold and italic and gone"
    );
  });

  it("does not eat an underscore inside a word", () => {
    // snake_case identifiers appear in these fields constantly, and an
    // emphasis rule that matched them would silently delete the middle.
    expect(stripMarkdown("call refresh_social_summary now")).toBe(
      "call refresh_social_summary now"
    );
  });

  it("removes a fenced code block rather than inlining its contents", () => {
    const source = "Before\n\n```ts\nconst x = 1;\n```\n\nAfter";
    expect(stripMarkdown(source)).toBe("Before After");
  });

  it("keeps the contents of inline code", () => {
    expect(stripMarkdown("run `npm test` first")).toBe("run npm test first");
  });

  it("collapses newlines and runs of whitespace into single spaces", () => {
    expect(stripMarkdown("one\n\n\ntwo    three\t\tfour")).toBe(
      "one two three four"
    );
  });

  it("strips html a proposer pasted in", () => {
    expect(stripMarkdown("<p>Hello <b>there</b></p>")).toBe("Hello there");
  });
});

describe("truncateOnWordBoundary", () => {
  it("returns a string at the limit untouched", () => {
    const exact = "a".repeat(SOCIAL_DESCRIPTION_MAX_LENGTH);
    expect(truncateOnWordBoundary(exact)).toBe(exact);
  });

  it("returns a string one under the limit untouched", () => {
    const under = "a".repeat(SOCIAL_DESCRIPTION_MAX_LENGTH - 1);
    expect(truncateOnWordBoundary(under)).toBe(under);
  });

  it("never exceeds the limit once it has to cut", () => {
    const long = "word ".repeat(100);
    expect(truncateOnWordBoundary(long).length).toBeLessThanOrEqual(
      SOCIAL_DESCRIPTION_MAX_LENGTH
    );
  });

  it("cuts on a word boundary, not mid-word", () => {
    const text = `${"ab ".repeat(10)}finalword ${"cd ".repeat(100)}`;
    const result = truncateOnWordBoundary(text, 40);
    expect(result.endsWith(ELLIPSIS)).toBe(true);
    // The body has to be a prefix of the source that stops exactly where a
    // space follows. Asserting the last character is not a word character
    // would be wrong: cutting on a boundary means ending ON a whole word.
    const body = result.slice(0, -ELLIPSIS.length);
    expect(text.startsWith(body)).toBe(true);
    expect(text[body.length]).toBe(" ");
  });

  it("drops trailing punctuation before the ellipsis", () => {
    expect(truncateOnWordBoundary("alpha beta, gamma delta", 14)).toBe(
      `alpha beta${ELLIPSIS}`
    );
  });

  it("never splits a surrogate pair at the cut", () => {
    // Slicing by code unit can cut an emoji in half, leaving a lone high
    // surrogate that UTF-8 encoding turns into a replacement character in a
    // public meta tag.
    // No spaces, so the word-boundary search cannot rescue the cut: this is
    // the unbroken-token fallback, which slices at the raw code unit.
    const text = "\u{1F600}".repeat(200);
    const result = truncateOnWordBoundary(text);
    expect(result).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    expect(result).not.toMatch(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
  });

  it("keeps the text when stripping punctuation would empty it", () => {
    // A description of nothing but punctuation truncated to bare dots says
    // less than the fragment it replaced.
    const result = truncateOnWordBoundary("!".repeat(200));
    expect(result).not.toBe("...");
    expect(result.length).toBeGreaterThan(10);
  });

  it("cuts a single unbroken token at the limit rather than returning nothing", () => {
    // A token this long is a pasted URL or an accident. A fragment beats an
    // empty description, which would unfurl as a bare title.
    const token = "x".repeat(300);
    const result = truncateOnWordBoundary(token, 20);
    expect(result).toBe(`${"x".repeat(17)}${ELLIPSIS}`);
    expect(result).toHaveLength(20);
  });
});

describe("socialDescription", () => {
  it("prefers the generated summary", () => {
    expect(
      socialDescription({
        description: "The description",
        problemStatement: "The problem",
        socialSummary: "The summary",
      })
    ).toBe("The summary");
  });

  it("falls back to the description when there is no summary", () => {
    expect(
      socialDescription({
        description: "The description",
        problemStatement: "The problem",
        socialSummary: null,
      })
    ).toBe("The description");
  });

  it("falls back to the problem statement when both are missing", () => {
    expect(
      socialDescription({
        description: null,
        problemStatement: "The problem",
        socialSummary: null,
      })
    ).toBe("The problem");
  });

  it("falls back to the site sentence when the project has no prose at all", () => {
    expect(
      socialDescription({
        description: null,
        problemStatement: null,
        socialSummary: null,
      })
    ).toBe(SITE_DESCRIPTION);
  });

  it("treats a field that is only Markdown syntax as absent", () => {
    // Stripping runs before the chain decides, so a description of "##" does
    // not win over a usable problem statement and produce an empty tag.
    expect(
      socialDescription({
        description: "## ",
        problemStatement: "The problem",
        socialSummary: null,
      })
    ).toBe("The problem");
  });

  it("treats whitespace as absent", () => {
    expect(
      socialDescription({
        description: "   \n  ",
        problemStatement: null,
        socialSummary: null,
      })
    ).toBe(SITE_DESCRIPTION);
  });

  it("strips Markdown out of the stored summary too", () => {
    // The model is asked for one plain sentence, which is not the same as
    // being guaranteed to return one.
    expect(
      socialDescription({
        description: null,
        problemStatement: null,
        socialSummary: "A **robotics** project for [OSU](https://x.test)",
      })
    ).toBe("A robotics project for OSU");
  });

  it("truncates a long description to the limit", () => {
    const result = socialDescription({
      description: "sentence ".repeat(80),
      problemStatement: null,
      socialSummary: null,
    });
    expect(result.length).toBeLessThanOrEqual(SOCIAL_DESCRIPTION_MAX_LENGTH);
    expect(result.endsWith(ELLIPSIS)).toBe(true);
  });

  it("never returns an empty string", () => {
    for (const value of ["", "   ", "``", "<br>"]) {
      expect(
        socialDescription({
          description: value,
          problemStatement: value,
          socialSummary: value,
        })
      ).toBe(SITE_DESCRIPTION);
    }
  });
});
