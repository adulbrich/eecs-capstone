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
 *
 * The call to action is optional for the one message about a row that no
 * longer exists (`projectDeletedEmail`); everything else has a page to open.
 */
function layout(
  paragraphs: string[],
  cta: { label: string; url: string } | null
): { html: string; text: string } {
  const body = paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join("");
  if (!cta) {
    return { html: body, text: `${paragraphs.join("\n\n")}\n` };
  }
  const text = `${paragraphs.join("\n\n")}\n\n${cta.label}: ${cta.url}\n`;
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

/**
 * A bell row, mailed. The inventory notices already say the one thing the
 * recipient must do (pick up by a date, return by a date, ask again), so the
 * email carries the same words rather than a second copy that would drift.
 */
export function notificationEmail(input: {
  message: string;
  title: string;
  url: string;
}): RenderedEmail {
  return {
    subject: input.title,
    ...layout([input.message], {
      label: "Open in the capstone app",
      url: input.url,
    }),
  };
}

/**
 * A student asked for equipment. To the staff inbox, beside the admin tile,
 * because the tile is a pull and the queue fills up unwatched without a push.
 */
export function inventoryRequestSubmittedEmail(input: {
  kind: "cart" | "custom";
  lines: string[];
  requesterEmail: string | null;
  requesterName: string | null;
  url: string;
}): RenderedEmail {
  const who = describeProposer(input.requesterName, input.requesterEmail);
  const shortName =
    input.requesterName ?? input.requesterEmail ?? "Unknown requester";
  const what = input.kind === "cart" ? "Borrow list" : "Custom request";
  return {
    subject: `${what} submitted: ${shortName}`,
    ...layout(
      [
        `${who} submitted a ${what.toLowerCase()}:`,
        input.lines.map((line) => `- ${line}`).join("\n"),
      ],
      { label: "Open the request queue", url: input.url }
    ),
  };
}

/** An admin changed what the account may do. */
export function roleChangedEmail(input: {
  role: string;
  url: string;
}): RenderedEmail {
  return {
    subject: `Your role is now ${input.role}`,
    ...layout(
      [
        `An administrator changed your capstone account's role to ${input.role}.`,
        "Sign out and back in if the change does not show yet.",
      ],
      { label: "Open the capstone app", url: input.url }
    ),
  };
}

/**
 * An admin banned the account. No link: a banned account cannot sign in, so
 * the only thing to offer is the reason and, when there is one, the end date.
 */
export function accountSuspendedEmail(input: {
  expiresAt: Date | null;
  reason: string;
}): RenderedEmail {
  const until = input.expiresAt
    ? `until ${new Date(input.expiresAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
    : "until an administrator lifts it";
  return {
    subject: "Your account was suspended",
    ...layout(
      [
        `An administrator suspended your capstone account ${until}.`,
        `Reason: ${input.reason}`,
        "Reply to this email if you think this is a mistake.",
      ],
      null
    ),
  };
}

/** Staff linked a project to a new proposer. */
export function projectReassignedEmail(input: {
  title: string;
  url: string;
}): RenderedEmail {
  return {
    subject: `A project was assigned to you: ${input.title}`,
    ...layout(
      [
        `Staff made you the proposer of "${input.title}".`,
        "You can edit it, follow its review, and reply to staff comments from the project page.",
      ],
      { label: "View the project", url: input.url }
    ),
  };
}

/**
 * Staff named this address as the project's mentor. No account is needed to
 * receive it; the catalog shows the mentor's name once one exists.
 */
export function mentorNamedEmail(input: {
  title: string;
  url: string;
}): RenderedEmail {
  return {
    subject: `You were named as a mentor: ${input.title}`,
    ...layout(
      [
        `Capstone staff listed you as the mentor for "${input.title}".`,
        "If that is right, nothing is needed from you now; the team will be in touch once the project is assigned. If it is a mistake, reply to this email.",
      ],
      { label: "View the project", url: input.url }
    ),
  };
}

/** Staff hard-deleted a draft. No link: the row is gone. */
export function projectDeletedEmail(input: { title: string }): RenderedEmail {
  return {
    subject: `Your draft was deleted: ${input.title}`,
    ...layout(
      [
        `Your draft project "${input.title}" was deleted by staff.`,
        "Drafts are deleted outright rather than archived, so it cannot be restored. Reply to this email if that was a mistake.",
      ],
      null
    ),
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
