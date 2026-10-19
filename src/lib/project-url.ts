import { webLinkHref, webLinkSchema } from "./web-link";

/**
 * A project's URL is one http or https link, or nothing (#776). Further links
 * go in the description, whose Markdown already turns them into links;
 * [ADR-0063](../../docs/adr/0063-a-project-has-one-url.md) is the decision.
 * The rule itself is `src/lib/web-link.ts`, shared with the LinkedIn URL.
 */

export const PROJECT_URL_MAX = 500;

export const PROJECT_URL_MESSAGES = {
  invalid: "Must be a valid URL",
  oneLink: "Enter one link. Put any others in the description.",
  scheme: "Start the link with https:// or http://.",
} as const;

/**
 * The field as both the form and the server validate it. The server folds
 * the empty string to null.
 */
export const projectUrlSchema = webLinkSchema(PROJECT_URL_MAX, {
  invalid: PROJECT_URL_MESSAGES.invalid,
  scheme: PROJECT_URL_MESSAGES.scheme,
  several: PROJECT_URL_MESSAGES.oneLink,
});

/** The `href` for a stored project URL, or null to render it as text. */
export const projectUrlHref = webLinkHref;
