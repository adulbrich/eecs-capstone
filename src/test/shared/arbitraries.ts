import { fc } from "@fast-check/vitest";
import { shiftDay } from "#/lib/day-range";

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
  "\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}",
  "\u{1F3F3}\u{FE0F}\u{200D}\u{1F308}",
  // Astral letters, which no emoji filter would catch.
  "\u{1D400}",
  "\u{10437}",
  "\u{2070E}",
];

const WHITESPACE = [
  " ",
  "  ",
  "\t",
  "\n",
  "\n\n",
  "\r\n",
  "\u{A0}",
  "\u{3000}",
];

const MARKDOWN = ["#", "*", "_", "`", "[", "]", "(", ")", "!", ">", "~", "|"];

/** What a spreadsheet reads as the start of a formula, and the CSV quoting. */
const CSV = ["=", "+", "-", "@", "\t", "\r", "'", '"', ","];

const PLAIN = ["a", "Z", "word", ".", ":", "e\u{301}", "\u{E9}"];

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
 * Tricky text with the pieces of a tag mixed in: a bare bracket, an entity
 * already written out, and the tags a prompt builder writes, so a value can
 * try to close the tag it sits in or open one of its own (#841).
 *
 * Kept apart from `trickyText` rather than added to its units, so the
 * properties that never meet a tag keep the distribution they were tuned on.
 */
export function tagBreakingText(
  tags: readonly string[],
  constraints: Omit<fc.StringConstraints, "unit"> = {}
): fc.Arbitrary<string> {
  return fc.string({
    ...constraints,
    unit: fc.oneof(
      { arbitrary: trickyUnit, weight: 3 },
      {
        arbitrary: fc.constantFrom(
          "<",
          ">",
          "</",
          "&lt;",
          "&gt;",
          "&",
          ...tags
        ),
        weight: 2,
      }
    ),
  });
}

const TAG_SPAN = /<[^<>]*>/gu;
const BRACKET = /[<>]/gu;

/**
 * Every `<...>` span in a prompt, in order. A tag the builder wrote is one
 * span; a value that slipped one in adds another, and a stray bracket with no
 * partner is caught by `strayBrackets`.
 */
export function tagsIn(text: string): string[] {
  return text.match(TAG_SPAN) ?? [];
}

/**
 * How many brackets sit outside every span `tagsIn` finds. Each span holds
 * exactly one `<` and one `>`, so the rest is the total less two a span.
 * Counted rather than stripped: a `replace` of `<...>` with nothing is what
 * CodeQL reads as a half-done HTML sanitizer, and this text never reaches HTML.
 */
export function strayBrackets(text: string): number {
  return (text.match(BRACKET)?.length ?? 0) - 2 * tagsIn(text).length;
}

/**
 * Tricky text that crosses `limit` code units, so a cut there lands among
 * surrogate pairs and whitespace rather than before any of them.
 *
 * Plain filler carries it most of the way. The caps worth testing are 12,000
 * and 20,000 code units, and generating that much one unit at a time is slow
 * and finds nothing a short run does not; what matters is what sits at the
 * cut.
 *
 * The filler stops 1 to 24 code units short of `limit`, and the tail is 12 to
 * 24 of `trickyText`'s units, one or more code units each, so the cut lands
 * anywhere from the tail's first code unit to beyond its end, where the whole
 * string fits and nothing is cut.
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

/*
 * Days and wall-clock times in the office's zone, for `day-range.ts` and the
 * deadlines built on it.
 */
const pad = (value: number) => String(value).padStart(2, "0");

/**
 * The Sunday the clocks change in `year`, under the US rule since 2007: the
 * second in March, or the first in November.
 */
export function changeSunday(year: number, month: 3 | 11): string {
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const firstSunday = 1 + ((7 - firstWeekday) % 7);
  const date = month === 3 ? firstSunday + 7 : firstSunday;
  return `${year}-${pad(month)}-${pad(date)}`;
}

/**
 * Any day from 2007, or a change Sunday or a day either side of one. The
 * second branch is not optional: a wrong offset shows only on the change day
 * itself, and a uniform day lands on one about one run in two hundred.
 */
export const officeDay = fc.oneof(
  fc
    .integer({ max: 34_000, min: 0 })
    .map((offset) => shiftDay("2007-01-01", offset)),
  fc
    .tuple(
      fc.integer({ max: 2099, min: 2007 }),
      fc.constantFrom<3 | 11>(3, 11),
      fc.integer({ max: 1, min: -1 })
    )
    .map(([year, month, delta]) => shiftDay(changeSunday(year, month), delta))
);

/**
 * An `HH:MM`, weighted toward the small hours: a change moves the offset at
 * 2:00, and a time from then until about 9:00 is where a guessed offset can
 * still be the old one.
 */
export const wallTime = fc
  .tuple(
    fc.oneof(fc.integer({ max: 23, min: 0 }), fc.integer({ max: 9, min: 0 })),
    fc.integer({ max: 59, min: 0 })
  )
  .map(([hour, minute]) => `${pad(hour)}:${pad(minute)}`);
