import { fc, test } from "@fast-check/vitest";
import { describe, expect, it } from "vitest";
import { trickyText } from "#/test/shared/arbitraries";
import { CONTEXT_LINES, type DiffLine, diffText } from "../text-diff";

/** A line's text, marked words in brackets, for compact assertions. */
function show(line: DiffLine): string {
  if (line.kind === "skipped") {
    return `... ${line.count}`;
  }
  const sign = { added: "+", context: " ", removed: "-" }[line.kind];
  const text = line.segments
    .map((s) => (s.changed ? `[${s.text}]` : s.text))
    .join("");
  return `${sign}${line.number} ${text}`;
}

describe("diffText", () => {
  it("shows a reworded line as removed then added, with the changed words marked", () => {
    const lines = diffText(
      "## Overview\n\n- Exercises emphasis",
      "## Overview\n\n- Exercises bold and italic emphasis"
    );
    expect(lines.map(show)).toEqual([
      " 1 ## Overview",
      " 2 ",
      "-3 - Exercises emphasis",
      "+3 - Exercises [bold and italic ]emphasis",
    ]);
  });

  it("leaves a wholly rewritten line unmarked, since its colour says so", () => {
    const lines = diffText("The first overview.", "Nothing alike here");
    expect(lines.map(show)).toEqual([
      "-1 The first overview.",
      "+1 Nothing alike here",
    ]);
  });

  it("numbers removed lines by the old text and the rest by the new", () => {
    const lines = diffText("a\nb\nc", "a\nx\ny\nc");
    expect(lines.map(show)).toEqual([" 1 a", "-2 b", "+2 x", "+3 y", " 4 c"]);
  });

  it("folds unchanged lines far from any change", () => {
    const before = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
    const after = [...before];
    after[9] = "line ten";
    const lines = diffText(before.join("\n"), after.join("\n"));
    expect(lines.map(show)).toEqual([
      "... 6",
      " 7 line 7",
      " 8 line 8",
      " 9 line 9",
      "-10 line [10]",
      "+10 line [ten]",
      " 11 line 11",
      " 12 line 12",
      " 13 line 13",
      "... 7",
    ]);
  });

  it("marks no words between two different lines that happen to share a position", () => {
    // One removed hunk and one added hunk, paired by position: "the quick
    // brown fox" against "the end." shares only "the", under half of the
    // shorter line, so it is two different lines, not one reworded.
    const lines = diffText(
      "the quick brown fox\nx",
      "the end.\nthe quick brown fox jumps"
    );
    expect(lines.map(show)).toEqual([
      "-1 the quick brown fox",
      "-2 x",
      "+1 the end.",
      "+2 the quick brown fox jumps",
    ]);
  });

  it("shows a single unchanged line instead of folding it", () => {
    const before = Array.from({ length: 9 }, (_, i) => `line ${i + 1}`);
    const after = [...before];
    after[0] = "first";
    after[8] = "last";
    const lines = diffText(before.join("\n"), after.join("\n"));
    // Lines 2 to 4 and 6 to 8 are context; line 5 sits between and is shown.
    expect(lines.filter((l) => l.kind === "skipped")).toEqual([]);
    expect(lines.map(show)).toContain(" 5 line 5");
  });

  it("shows only the other side when one side is empty", () => {
    expect(diffText("", "new text").map(show)).toEqual(["+1 new text"]);
    expect(diffText("old text", "").map(show)).toEqual(["-1 old text"]);
  });

  it("gives nothing for equal texts, a trailing newline or a CRLF", () => {
    expect(diffText("same\ntext", "same\ntext")).toEqual([]);
    expect(diffText("same", "same\n")).toEqual([]);
    expect(diffText("a\r\nb", "a\nb")).toEqual([]);
  });
});

const text = fc.oneof(
  trickyText({ maxLength: 40 }),
  fc
    .array(fc.constantFrom("a", "b", "c", "", "- item", "## Heading"), {
      maxLength: 12,
    })
    .map((lines) => lines.join("\n"))
);

describe("diffText properties", () => {
  test.prop([text, text])(
    "the removed and context lines rebuild the old text, the added and context lines the new",
    (before, after) => {
      const lines = diffText(before, after).filter(
        (l): l is Exclude<DiffLine, { kind: "skipped" }> => l.kind !== "skipped"
      );
      const join = (keep: Set<string>) =>
        lines
          .filter((l) => keep.has(l.kind))
          .map((l) => l.segments.map((s) => s.text).join(""));
      const oldLines = before.replace(/\r\n/gu, "\n").split("\n");
      const newLines = after.replace(/\r\n/gu, "\n").split("\n");
      // Folded context hides lines, so the rebuilt text is a subsequence of
      // each side rather than the whole of it.
      const isSubsequence = (part: string[], whole: string[]) => {
        let j = 0;
        for (const line of whole) {
          if (line === part[j]) {
            j++;
          }
        }
        return j === part.length;
      };
      expect(
        isSubsequence(join(new Set(["context", "removed"])), oldLines)
      ).toBe(true);
      expect(isSubsequence(join(new Set(["context", "added"])), newLines)).toBe(
        true
      );
    }
  );

  test.prop([text])("gives nothing for a text against itself", (same) => {
    expect(diffText(same, same)).toEqual([]);
  });

  test.prop([text, text])(
    "keeps every changed line, and no more than the context it promises around it",
    (before, after) => {
      const lines = diffText(before, after);
      let run = 0;
      for (const line of lines) {
        if (line.kind === "context") {
          run++;
        } else {
          run = 0;
        }
        expect(run).toBeLessThanOrEqual(2 * CONTEXT_LINES);
      }
    }
  );
});
