export interface RenderedEmail {
  html: string;
  subject: string;
  text: string;
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

// Top-level so it is compiled once rather than per call.
const HTML_UNSAFE = /[&<>"']/g;

/**
 * Escapes a value for interpolation into the HTML body. One regex pass over a
 * lookup table, so `&` cannot be double-escaped by a later rule. Only the HTML
 * alternative needs this; the plain-text body is never markup.
 */
export function escapeHtml(value: string): string {
  return value.replace(HTML_UNSAFE, (char) => HTML_ESCAPES[char] ?? char);
}

const DESCRIPTION_LIMIT = 600;
const TRUNCATION_NOTE = "Open the project to read the full proposal.";

function summarize(description: string | null): string {
  const trimmed = description?.trim() ?? "";
  if (!trimmed) {
    return "(No description provided.)";
  }
  if (trimmed.length <= DESCRIPTION_LIMIT) {
    return trimmed;
  }
  return `${trimmed.slice(0, DESCRIPTION_LIMIT)}...

${TRUNCATION_NOTE}`;
}

function describeProposer(name: string | null, email: string | null): string {
  if (name && email) {
    return `${name} (${email})`;
  }
  return name ?? email ?? "Unknown proposer";
}

/**
 * Renders the shared shell: paragraphs then a single call to action. Every
 * paragraph is escaped for the HTML alternative because callers pass
 * user-supplied titles, descriptions, and staff comments through here.
 */
function layout(
  paragraphs: string[],
  cta: { label: string; url: string }
): { html: string; text: string } {
  const text = `${paragraphs.join("\n\n")}\n\n${cta.label}: ${cta.url}\n`;
  const body = paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join("");
  const link = `<p><a href="${escapeHtml(cta.url)}">${escapeHtml(cta.label)}</a></p>`;
  return { html: `${body}${link}`, text };
}

export function verificationEmail(input: { url: string }): RenderedEmail {
  return {
    subject: "Verify your email",
    ...layout(
      ["Confirm your email address to finish setting up your account."],
      { label: "Verify email", url: input.url }
    ),
  };
}

export function passwordResetEmail(input: { url: string }): RenderedEmail {
  return {
    subject: "Reset your password",
    ...layout(["We received a request to reset your password."], {
      label: "Reset password",
      url: input.url,
    }),
  };
}

export function projectSubmittedEmail(input: {
  description: string | null;
  proposerEmail: string | null;
  proposerName: string | null;
  title: string;
  url: string;
}): RenderedEmail {
  const who = describeProposer(input.proposerName, input.proposerEmail);
  return {
    subject: `New project submitted: ${input.title}`,
    ...layout(
      [
        `${who} submitted a project for review.`,
        `Title: ${input.title}`,
        `Description: ${summarize(input.description)}`,
      ],
      { label: "Review the project", url: input.url }
    ),
  };
}

export function projectApprovedEmail(input: {
  comment: string | null;
  title: string;
  url: string;
}): RenderedEmail {
  const paragraphs = [
    `Your project "${input.title}" has been approved.`,
    "It will be published to the project list later. You will not receive another email when that happens.",
  ];
  const note = input.comment?.trim();
  if (note) {
    paragraphs.push(`Note from the reviewer: ${note}`);
  }
  return {
    subject: `Your project was approved: ${input.title}`,
    ...layout(paragraphs, { label: "View your project", url: input.url }),
  };
}

export function projectChangesRequestedEmail(input: {
  comment: string;
  title: string;
  url: string;
}): RenderedEmail {
  return {
    subject: `Changes requested: ${input.title}`,
    ...layout(
      [
        `Your project "${input.title}" needs changes before it can be approved.`,
        `What needs to change: ${input.comment}`,
        "Update the project and submit it again for review.",
      ],
      { label: "Revise your project", url: input.url }
    ),
  };
}
