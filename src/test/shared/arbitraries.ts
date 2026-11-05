import { fc } from "@fast-check/vitest";

/**
 * Generated text for property tests, weighted toward the characters this
 * codebase has shipped bugs on (#485): a cut between the halves of an emoji
 * (#490, #582, #696, #836), whitespace a trim missed (#840), markdown the
 * stripper half-recognised (#761), and a CSV cell a spreadsheet reads as a
 * formula (#733).
 *
 * Every unit is spelled as an escape, because the prose checks refuse a
 * literal emoji anywhere in source. Every unit is well-formed on its own, so
 * any string built from them is too; a test that wants a lone surrogate adds
 * it itself.
 */
const ASTRAL = [
  "\u{1F600}",
  "\u{1F393}",
  "\u{1F4BB}",
  // A flag is two regional indicators, a skin tone a modifier after its base,
  // and a family three people joined by zero-width joiners.
  "\u{1F1FA}\u{1F1F8}",
  "\u{1F44D}\u{1F3FD}",
  "\u{1F468}‍\u{1F469}‍\u{1F467}",
  "\u{1F3F3}️‍\u{1F308}",
  // Astral letters, which no emoji filter would catch.
  "\u{1D400}",
  "\u{10437}",
  "\u{2070E}",
];

const WHITESPACE = [" ", "  ", "\t", "\n", "\n\n", "\r\n", " ", "　"];

const MARKDOWN = ["#", "*", "_", "`", "[", "]", "(", ")", "!", ">", "~", "|"];

/** What a spreadsheet reads as the start of a formula, and the CSV quoting. */
const CSV = ["=", "+", "-", "@", "\t", "\r", "'", '"', ","];

const PLAIN = ["a", "Z", "word", ".", ":", "é", "é"];

const trickyUnit = fc.oneof(
  { arbitrary: fc.constantFrom(...ASTRAL), weight: 4 },
  { arbitrary: fc.constantFrom(...WHITESPACE), weight: 2 },
  { arbitrary: fc.constantFrom(...MARKDOWN, ...CSV), weight: 2 },
  { arbitrary: fc.constantFrom(...PLAIN), weight: 3 }
);

/**
 * The shared arbitrary. `minLength`, `maxLength` and `size` count units, not
 * code units: an emoji is one unit and two or more code units.
 */
export function trickyText(
  constraints: Omit<fc.StringConstraints, "unit"> = {}
): fc.Arbitrary<string> {
  return fc.string({ ...constraints, unit: trickyUnit });
}

/**
 * Tricky text that crosses `limit` code units, so a cut there lands among
 * surrogate pairs and whitespace rather than before any of them.
 *
 * Plain filler carries it most of the way. The caps worth testing are 12,000
 * and 20,000 code units, and generating that much one unit at a time is slow
 * and finds nothing a short run does not; what matters is what sits at the
 * cut.
 */
export function trickyTextAcross(limit: number): fc.Arbitrary<string> {
  return fc
    .tuple(
      fc.integer({ max: 24, min: 1 }),
      trickyText({ maxLength: 24, minLength: 12 })
    )
    .map(([lead, tail]) => "a".repeat(Math.max(limit - lead, 0)) + tail);
}

/**
 * In `u` mode a regex reads a surrogate pair as the one code point it
 * encodes, so `\p{Surrogate}` matches only a half with no partner.
 * `String.prototype.isWellFormed` does the same, but is not in the
 * `ES2022` lib this project compiles against.
 */
const LONE_SURROGATE = /\p{Surrogate}/u;

export function isWellFormed(text: string): boolean {
  return !LONE_SURROGATE.test(text);
}
