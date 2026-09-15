/**
 * The class string of every `className` in a file, one per attribute.
 *
 * Two scans need this and each grew its own copy: `brand-link-scan.test.ts`
 * asks whether a string that underlines also carries the colour, and
 * `error-text-scan.test.ts` asks whether a string carries `text-destructive`
 * beside a text size. Both questions are about a whole class string rather than
 * one literal or one line, so both got the same answers wrong before this:
 *
 * - Reading line by line missed a `className` spread over several lines, which
 *   is how Biome formats any long one.
 * - Yielding each literal of a `cn()` call separately split one class string
 *   into several, which is a false negative for a rule looking for two classes
 *   together: `cn("text-destructive", "text-sm")` is the paragraph shape.
 *
 * The two rules want opposite things from a conditional, though, so each
 * attribute yields two readings:
 *
 * - `all` is every literal, whether or not a condition gates it. A rule asking
 *   "can this element ever look like X" wants this one.
 * - `unconditional` is only the literals that always apply. A rule asking "does
 *   this element always carry Y" wants this one, because
 *   `cn("underline", on && "text-brand-dark")` renders a bare underline with no
 *   colour whenever `on` is false, which is the defect #411 fixed.
 *
 * A `className={someVariable}` passthrough yields nothing: what the parent
 * passes is the parent's to answer for. Classes assembled elsewhere, in a
 * constant or a variant map, are outside what a regex over one file can see,
 * and this does not pretend otherwise.
 */

export interface ClassString {
  /** Every literal, conditional ones included. */
  all: string;
  /** Only the literals that are not behind a condition. */
  unconditional: string;
}

const CLASS_ATTRIBUTE = /className=(?:"([^"]*)"|\{)/g;
const STRING_LITERAL = /["'`]([^"'`]*)["'`]/g;
/** A segment that is nothing but a quoted string, so nothing gates it. */
const BARE_LITERAL = /^\s*(["'`])([^"'`]*)\1\s*$/;

/**
 * From the `{` after `className=`, the expression up to its matching `}`.
 *
 * Counted rather than matched non-greedily: `cn({ "text-destructive": err },
 * "text-sm")` is clsx's object form, and stopping at the first `}` would cut
 * the string in half and hide the size class behind it.
 */
function expressionAt(
  source: string,
  open: number
): { text: string; end: number } {
  let depth = 0;
  let quote = "";
  for (let i = open; i < source.length; i++) {
    const char = source[i];
    // Braces inside a string are text, not structure. Without this a class
    // string containing one would end the attribute early and silently drop
    // everything after it.
    if (quote) {
      if (char === "\\") {
        i++;
      } else if (char === quote) {
        quote = "";
      }
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
    } else if (char === "{") {
      depth++;
    } else if (char === "}") {
      depth--;
      if (depth === 0) {
        return { text: source.slice(open + 1, i), end: i };
      }
    }
  }
  return { text: source.slice(open + 1), end: source.length };
}

/** The comma-separated arguments of a call, split at depth zero. */
function topLevelSegments(expression: string): string[] {
  const inner = /^\s*[\w.]*\(([\s\S]*)\)\s*$/.exec(expression);
  const body = inner ? inner[1] : expression;
  const segments: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const char = body[i];
    if (char === "(" || char === "{" || char === "[") {
      depth++;
    } else if (char === ")" || char === "}" || char === "]") {
      depth--;
    } else if (char === "," && depth === 0) {
      segments.push(body.slice(start, i));
      start = i + 1;
    }
  }
  segments.push(body.slice(start));
  return segments;
}

function literals(text: string): string[] {
  return [...text.matchAll(STRING_LITERAL)].map((match) => match[1]);
}

export function* classStrings(source: string): Generator<ClassString> {
  CLASS_ATTRIBUTE.lastIndex = 0;
  let match = CLASS_ATTRIBUTE.exec(source);
  while (match) {
    if (match[1] !== undefined) {
      yield { all: match[1], unconditional: match[1] };
      match = CLASS_ATTRIBUTE.exec(source);
      continue;
    }
    const { text, end } = expressionAt(
      source,
      match.index + match[0].length - 1
    );
    const segments = topLevelSegments(text);
    const all = segments.flatMap(literals);
    const unconditional = segments.flatMap((segment) => {
      const bare = BARE_LITERAL.exec(segment);
      return bare ? [bare[2]] : [];
    });
    if (all.length > 0) {
      yield { all: all.join(" "), unconditional: unconditional.join(" ") };
    }
    CLASS_ATTRIBUTE.lastIndex = end;
    match = CLASS_ATTRIBUTE.exec(source);
  }
}
