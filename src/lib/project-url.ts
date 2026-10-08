import { z } from "zod";

/**
 * A project's URL is one http or https link, or nothing (#776). Further links
 * go in the description, whose Markdown already turns them into links;
 * [ADR-0063](../../docs/adr/0063-a-project-has-one-url.md) is the decision.
 *
 * zod's `.url()` is not the guard: it accepts `javascript:` and any other
 * scheme, and it accepts several links separated by spaces or newlines because
 * the URL parser percent-encodes whitespace in a query string.
 */

export const PROJECT_URL_MAX = 500;

export const PROJECT_URL_MESSAGES = {
  invalid: "Must be a valid URL",
  oneLink: "Enter one link. Put any others in the description.",
  scheme: "Start the link with https:// or http://.",
} as const;

const SCHEME_RE = /^https?:\/\//i;
// Whitespace, or a link straight after a comma, semicolon or bar, which is how
// `https://a.com,https://b.com` arrives. Neither a comma nor a second `://` is
// a signal alone: both are legal in one link, as in an archive.org snapshot.
const SECOND_LINK_RE = /\s|[,;|]https?:\/\//i;

// `new URL` rather than `URL.canParse`, which browsers gained only in 2023:
// this runs on the public page at render, where an older one would throw.
function parses(value: string): boolean {
  try {
    return Boolean(new URL(value));
  } catch {
    return false;
  }
}

/** The message a trimmed, non-empty value fails with, or null when it passes. */
function projectUrlProblem(value: string): string | null {
  if (SECOND_LINK_RE.test(value)) {
    return PROJECT_URL_MESSAGES.oneLink;
  }
  if (!SCHEME_RE.test(value)) {
    return PROJECT_URL_MESSAGES.scheme;
  }
  if (!parses(value)) {
    return PROJECT_URL_MESSAGES.invalid;
  }
  return null;
}

/**
 * The field as both the form and the server validate it: trimmed, then empty
 * or one link. The empty string is the form clearing the field, and the
 * server folds it to null.
 */
export const projectUrlSchema = z
  .string()
  .trim()
  .max(PROJECT_URL_MAX)
  .superRefine((value, ctx) => {
    const problem = value === "" ? null : projectUrlProblem(value);
    if (problem) {
      ctx.addIssue({ code: "custom", message: problem });
    }
  });

/**
 * The `href` for a stored URL, or null when it should render as plain text.
 * Rows written before #776 can hold several links, prose, or a bare domain;
 * those show as text until someone edits them, rather than as a broken link
 * or one with a scheme nobody vetted.
 */
export function projectUrlHref(stored: string | null): string | null {
  const value = stored?.trim();
  if (!value || projectUrlProblem(value)) {
    return null;
  }
  return value;
}
