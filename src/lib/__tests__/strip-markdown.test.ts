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

  it("reduces a GFM table to its cell text", () => {
    expect(stripMarkdown("| a | b |\n| - | - |\n| 1 | 2 |")).toBe("a b 1 2");
  });

  it("does not confuse a table separator row with a horizontal rule", () => {
    expect(stripMarkdown("- - -")).toBe("");
  });

  it("does not strip pipes inside a fenced code block", () => {
    expect(stripMarkdown("```\na | b\n```\nAfter")).toBe("After");
  });

  it("removes GFM task-list checkbox markers", () => {
    expect(stripMarkdown("- [x] done\n- [ ] todo")).toBe("done todo");
  });

  it("preserves brackets that are not task markers", () => {
    expect(stripMarkdown("an array[0] index")).toBe("an array[0] index");
  });

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

  it("leaves a space where an image was, so its neighbours stay apart", () => {
    expect(stripMarkdown("before![a](x.png)after")).toBe("before after");
  });

  it("removes heading, bullet, ordered and blockquote markers", () => {
    const source = "## Goals\n\n- first\n- second\n\n1. third\n\n> a quote";
    expect(stripMarkdown(source)).toBe("Goals first second third a quote");
  });

  it("removes a parenthesised ordered list marker", () => {
    expect(stripMarkdown("1) first\n2) second")).toBe("first second");
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

  it("keeps a comparison that is not a tag", () => {
    expect(stripMarkdown("latency < 5 ms and > 1 ms")).toBe(
      "latency < 5 ms and > 1 ms"
    );
  });

  it("reduces a table with a task list beneath it to the words", () => {
    const source =
      "| Goal | Owner |\n| :--- | ---: |\n| ship | us |\n\n- [ ] demo";
    expect(stripMarkdown(source)).toBe("Goal Owner ship us demo");
  });

  it("removes emphasis up to 500 characters and keeps the markers past it", () => {
    const limit = "a".repeat(500);
    expect(stripMarkdown(`**${limit}**`)).toBe(limit);
    expect(stripMarkdown(`**${limit}a**`)).toBe(`**${limit}a**`);
  });

  it("keeps a link whose target holds brackets or parentheses", () => {
    expect(stripMarkdown("see [docs](https://x.test/?q[0]=1) now")).toBe(
      "see docs now"
    );
    expect(stripMarkdown("![x](https://x.test/a[1].png) after")).toBe("after");
    expect(
      stripMarkdown(
        "[Rust](https://en.wikipedia.org/wiki/Rust_(programming_language)) is fast"
      )
    ).toBe("Rust is fast");
    expect(stripMarkdown('[a](https://x.test "a (b) title") b')).toBe("a b");
  });

  it("leaves the contents of a code span alone", () => {
    expect(stripMarkdown("use the `<canvas>` element")).toBe(
      "use the <canvas> element"
    );
    expect(stripMarkdown("edit `__init__` in `__init__.py`")).toBe(
      "edit __init__ in __init__.py"
    );
    expect(stripMarkdown("call `fn(*args, **kwargs)` and **bold**")).toBe(
      "call fn(*args, **kwargs) and bold"
    );
  });

  it("removes an html comment, even one holding a `>`", () => {
    expect(stripMarkdown("x <!-- hidden --> y")).toBe("x y");
    expect(stripMarkdown("<!-- TODO: A -> B --> Build a robot")).toBe(
      "Build a robot"
    );
  });

  it("removes namespaced tags pasted from Word", () => {
    expect(stripMarkdown("<o:p>Pasted</o:p> text")).toBe("Pasted text");
  });

  it("does not let a stray backtick shield a later paragraph", () => {
    expect(
      stripMarkdown("it`s here\n\nsee [docs](https://x.test) and `foo` ok")
    ).toBe("it`s here see docs and foo ok");
  });

  it("drops a pasted private-use character rather than reading it as code", () => {
    const slot = "\uE000";
    expect(stripMarkdown(`x ${slot}0${slot} then \`real\``)).toBe(
      "x 0 then real"
    );
  });

  it("keeps an autolink and an email address in angle brackets", () => {
    expect(stripMarkdown("see <https://x.test/a> or <me@x.test>")).toBe(
      "see <https://x.test/a> or <me@x.test>"
    );
  });
});

/**
 * Each of these, repeated, is an opener with no closer. Before #765 most of
 * them rescanned to the end of the string, and 20,000 characters took 45 to
 * 243 ms on Node 24 on a laptop. The backtick, fence and `<a ` cases were
 * already fast in this module and guard against a regression. The slowest now
 * are the emphasis cases, which still walk the 500-character bound from every
 * opener.
 *
 * The ceiling is absolute, because a ratio between two lengths is flakier
 * under CI load, and sits at about three times the slowest case yet below
 * every timing from before the fix. The best of three runs, not one, so a
 * garbage collection pause cannot fail it.
 */
const UNCLOSED_OPENERS = [
  "~~a ",
  "![a](",
  "**a ",
  "*a ",
  "***a ",
  "[a](",
  "[a",
  "[a](x[b](c)",
  "_a ",
  "___a ",
  "~~___a ",
  "<a ",
  "`a ",
  "```a ",
  "\n",
  " \n",
];
const ADVERSARIAL_LENGTH = 20_000;
const CEILING_MS = 40;
const RUNS = 3;

describe("stripMarkdown on unclosed openers", () => {
  it.each(UNCLOSED_OPENERS)(
    "strips %j repeated within the ceiling",
    (opener) => {
      const input = opener
        .repeat(Math.ceil(ADVERSARIAL_LENGTH / opener.length))
        .slice(0, ADVERSARIAL_LENGTH);
      // The first call pays for compiling the patterns, which is not the cost
      // under test.
      stripMarkdown(input);
      let best = Number.POSITIVE_INFINITY;
      for (let run = 0; run < RUNS; run++) {
        const start = performance.now();
        stripMarkdown(input);
        best = Math.min(best, performance.now() - start);
      }
      expect(best).toBeLessThan(CEILING_MS);
    }
  );
});
