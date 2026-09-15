/**
 * The class string of every `className` in a file, one per attribute.
 *
 * Two scans need this and each grew its own copy: `brand-link-scan.test.ts`
 * asks whether a string that underlines also carries the colour, and
 * `error-text-scan.test.ts` asks whether a string carries `text-destructive`
 * beside a text size. Both questions are about the whole class string, so both
 * got the same two answers wrong before this existed:
 *
 * - Reading line by line missed a `className` spread over several lines, which
 *   is how Biome formats any long one.
 * - Yielding each literal of a `cn()` call separately split one class string
 *   into several. That is a false negative for a rule looking for two classes
 *   together (`cn("text-destructive", "text-sm")` is the paragraph shape) and a
 *   false positive for a rule looking for one class without another
 *   (`cn("underline", "text-brand-dark")` is a correctly coloured link).
 *
 * So the literals of one `className` are joined and yielded as one string. A
 * conditional inside a `cn()` is treated as present, which is the cautious
 * reading for both rules: a class that is sometimes applied is a class the
 * element can have.
 *
 * A `className={someVariable}` passthrough yields nothing, which is right:
 * what the parent passes is the parent's to answer for.
 */
const CLASS_ATTRIBUTE = /className=(?:"([^"]*)"|\{([\s\S]*?)\})/g;
const STRING_LITERAL = /["'`]([^"'`]*)["'`]/g;

export function* classStrings(source: string): Generator<string> {
  for (const attribute of source.matchAll(CLASS_ATTRIBUTE)) {
    if (attribute[1] !== undefined) {
      yield attribute[1];
      continue;
    }
    const literals = [...(attribute[2] ?? "").matchAll(STRING_LITERAL)].map(
      (literal) => literal[1]
    );
    if (literals.length > 0) {
      yield literals.join(" ");
    }
  }
}
