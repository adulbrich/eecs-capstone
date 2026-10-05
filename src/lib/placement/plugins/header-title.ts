/**
 * A project title inside a survey export's column header, for the plugins
 * that read one column per project: Qualtrics, and custom mapping's wide
 * reading (#736). Shared so the two read a header the same way.
 */

/** Qualtrics' separator: "Rank your top choices. - Tide Clock". */
export const QUALTRICS_SEPARATOR = " - ";

/**
 * The header split at the first `separator`: the question before it, as it
 * is, and the title after it, trimmed. Undefined when the header has none.
 * The first, so a title that itself contains the separator survives.
 */
export function splitAtSeparator(
  header: string,
  separator: string
): { stem: string; title: string } | undefined {
  const at = header.indexOf(separator);
  return at === -1
    ? undefined
    : {
        stem: header.slice(0, at),
        title: header.slice(at + separator.length).trim(),
      };
}

/**
 * The text inside the header's last pair of square brackets, trimmed, as a
 * Google Forms grid writes "Rank the projects [Tide Clock]". Brackets inside
 * the title pair up, so "[Robot [v2]]" gives "Robot [v2]". Undefined when
 * the header has no such pair.
 */
export function titleInBrackets(header: string): string | undefined {
  const close = header.lastIndexOf("]");
  let depth = 0;
  for (let i = close; i >= 0; i--) {
    if (header[i] === "]") {
      depth++;
    } else if (header[i] === "[") {
      depth--;
      if (depth === 0) {
        return header.slice(i + 1, close).trim();
      }
    }
  }
}
