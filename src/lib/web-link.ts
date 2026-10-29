import { z } from "zod";

/**
 * The rule for a field that holds one web link: one http or https link that
 * parses, or nothing. The project URL (#776) and a user's LinkedIn URL (#778)
 * both use it; each keeps its own messages, because what to do with a second
 * link differs between them.
 *
 * zod's `.url()` is not the guard: it accepts `javascript:` and any other
 * scheme, and it accepts several links separated by spaces or newlines because
 * the URL parser percent-encodes whitespace in a query string.
 */

export type WebLinkProblem = "several" | "scheme" | "invalid";

const SCHEME_RE = /^https?:\/\//iu;
// Whitespace, or a link straight after a comma, semicolon or bar, which is how
// `https://a.com,https://b.com` arrives. Neither a comma nor a second `://` is
// a signal alone: both are legal in one link, as in an archive.org snapshot.
const SECOND_LINK_RE = /\s|[,;|]https?:\/\//iu;

// `new URL` rather than `URL.canParse`, which browsers gained only in 2023:
// this runs on the public page at render, where an older one would throw.
function parses(value: string): boolean {
  try {
    return Boolean(new URL(value));
  } catch {
    return false;
  }
}

/** The rule a trimmed, non-empty value breaks, or null when it passes. */
export function webLinkProblem(value: string): WebLinkProblem | null {
  if (SECOND_LINK_RE.test(value)) {
    return "several";
  }
  if (!SCHEME_RE.test(value)) {
    return "scheme";
  }
  if (!parses(value)) {
    return "invalid";
  }
  return null;
}

/**
 * The field as both the form and the server validate it: trimmed, then empty
 * or one link, failing with the field's own message for each rule. The empty
 * string is the form clearing the field; the writer folds it to null.
 */
export function webLinkSchema(
  max: number,
  messages: Record<WebLinkProblem, string>
) {
  return z
    .string()
    .trim()
    .max(max)
    .superRefine((value, ctx) => {
      const problem = value === "" ? null : webLinkProblem(value);
      if (problem) {
        ctx.addIssue({ code: "custom", message: messages[problem] });
      }
    });
}

/**
 * The `href` for a stored link, or null when it should render as plain text.
 * A row written before its field had this rule can hold several links, prose,
 * a bare domain or another scheme; those show as text until someone edits
 * them, rather than as a broken link or one with a scheme nobody vetted.
 */
export function webLinkHref(stored: string | null | undefined): string | null {
  const value = stored?.trim();
  if (!value || webLinkProblem(value)) {
    return null;
  }
  return value;
}
