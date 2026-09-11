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

const EXCERPT_LIMIT = 600;

/** The first part of a long text, with a pointer at the rest. */
function excerpt(text: string, truncationNote: string): string {
  if (text.length <= EXCERPT_LIMIT) {
    return text;
  }
  return `${text.slice(0, EXCERPT_LIMIT)}...

${truncationNote}`;
}

function summarize(description: string | null): string {
  const trimmed = description?.trim() ?? "";
  if (!trimmed) {
    return "(No description provided.)";
  }
  return excerpt(trimmed, "Open the project to read the full proposal.");
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

export function projectCommentEmail(input: {
  content: string;
  title: string;
  url: string;
}): RenderedEmail {
  return {
    subject: `New comment on your project: ${input.title}`,
    ...layout(
      [
        `Staff commented on "${input.title}":`,
        excerpt(input.content.trim(), "Open the project to read the rest."),
      ],
      { label: "Read and reply", url: input.url }
    ),
  };
}

/**
 * The proposer replied, so staff are told. Addressed to the staff inbox, the
 * same mailbox that receives submissions, because the reply is the next thing
 * the review needs from staff and the bell reaches only the parent's author.
 */
export function proposerCommentEmail(input: {
  content: string;
  proposerEmail: string | null;
  proposerName: string | null;
  title: string;
  url: string;
}): RenderedEmail {
  const who = describeProposer(input.proposerName, input.proposerEmail);
  return {
    subject: `Comment from the proposer: ${input.title}`,
    ...layout(
      [
        `${who} commented on "${input.title}":`,
        excerpt(input.content.trim(), "Open the project to read the rest."),
      ],
      { label: "Read and reply", url: input.url }
    ),
  };
}

/**
 * Staff sent a submission back to draft. Unlike changes requested, the project
 * leaves review entirely, so the message says what to do next rather than what
 * to fix, and carries the staff comment when there is one (the server requires
 * one from staff, the force path does not).
 */
export function projectReturnedToDraftEmail(input: {
  comment: string | null;
  title: string;
  url: string;
}): RenderedEmail {
  const paragraphs = [
    `Your project "${input.title}" was returned to draft by staff.`,
  ];
  const note = input.comment?.trim();
  if (note) {
    paragraphs.push(`Why: ${note}`);
  }
  paragraphs.push("Update the project and submit it again when it is ready.");
  return {
    subject: `Returned to draft: ${input.title}`,
    ...layout(paragraphs, { label: "Revise your project", url: input.url }),
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
