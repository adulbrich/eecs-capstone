# Project Review Emails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Email the capstone review inbox when a project is submitted, and email the proposer when staff approve it or request changes, with staff able to skip either proposer email.

**Architecture:** Email content moves out of the transports into pure template functions in `src/lib/email/templates.ts`, and `EmailSender` collapses to a single `send(to, rendered)`. A new `src/server/_internal/project-emails.ts` owns recipient resolution and is called after the transaction commits in both `performTransitionAs` and `forceTransitionAs`, where it swallows its own failures so a rejected email cannot undo an approval.

**Tech Stack:** TypeScript, TanStack Start server functions, Drizzle ORM on Postgres, AWS SES v2, Vitest, React 19 with shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-08-07-project-review-emails-design.md`

## Global Constraints

- Never use emdashes in prose, comments, or copy. Use proper punctuation instead.
- Run `npm run check` and `npm run typecheck` on the whole project before committing. Never per-file.
- Integration tests: `npm run test:integration`. They truncate every table in `beforeEach` and need the local Postgres running.
- Unit tests: `npm test`.
- This app is pre-production. Delete and restructure rather than adding back-compat shims, aliases, or parallel code paths.
- Every value interpolated into email HTML must pass through `escapeHtml`. The plain-text body is never escaped.
- `EMAIL_FROM` stays a hard requirement of `createSesEmailSender`. `getEmailSender()` runs at module scope in `src/lib/auth.ts`, so a throw there fails the app's boot.
- The approval email says the project will be published later and that **no further email** will follow. It must not claim the proposer will not be notified at all: the in-app notification on publish stays.
- Copy for the two existing emails must not change. Subjects stay exactly "Verify your email" and "Reset your password".

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/email/templates.ts` (new) | All email content as pure functions. Owns `escapeHtml`, `RenderedEmail`. |
| `src/lib/email/__tests__/templates.test.ts` (new) | Unit tests for content and escaping. |
| `src/lib/email/sender.ts` (modify) | `EmailSender` collapses to `send(to, email)`. Factory unchanged. |
| `src/lib/email/ses-sender.ts` (modify) | Dumb transport. Content constants deleted. |
| `src/lib/email/console-sender.ts` (modify) | Dumb transport. Prints subject and text. |
| `src/lib/auth.ts` (modify) | Renders templates, calls `send`. Behavior unchanged. |
| `src/server/_internal/project-emails.ts` (new) | Recipient resolution, link building, failure swallowing. |
| `src/server/_internal/projects.ts` (modify) | Options object on both transition functions; calls the notifier after commit. |
| `src/server/projects.ts` (modify) | `sendEmail` on the wire schema, threaded through the wrappers. |
| `src/components/staff-project-panel.tsx` (modify) | Recipient hint and opt-out checkbox in the transition dialog. Reads the address from the existing `getProposerEmailForEdit`. |
| `infra/variables.tf`, `infra/ecs.tf`, `.env.example` (modify) | `EMAIL_REVIEW_INBOX`. |
| `README.md`, `DEPLOYMENT.md`, `docs/QUIRKS.md` (modify) | Four emails, not two. |

---

### Task 1: Email templates module

Pure functions with no I/O. Nothing else in the plan can be written until the shapes here exist.

**Files:**
- Create: `src/lib/email/templates.ts`
- Test: `src/lib/email/__tests__/templates.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface RenderedEmail { html: string; subject: string; text: string }`
  - `escapeHtml(value: string): string`
  - `verificationEmail(input: { url: string }): RenderedEmail`
  - `passwordResetEmail(input: { url: string }): RenderedEmail`
  - `projectSubmittedEmail(input: { description: string | null; proposerEmail: string | null; proposerName: string | null; title: string; url: string }): RenderedEmail`
  - `projectApprovedEmail(input: { comment: string | null; title: string; url: string }): RenderedEmail`
  - `projectChangesRequestedEmail(input: { comment: string; title: string; url: string }): RenderedEmail`

- [ ] **Step 1: Write the failing test**

Create `src/lib/email/__tests__/templates.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  escapeHtml,
  passwordResetEmail,
  projectApprovedEmail,
  projectChangesRequestedEmail,
  projectSubmittedEmail,
  verificationEmail,
} from "../templates";

describe("escapeHtml", () => {
  it("neutralizes every character that can break out of markup", () => {
    expect(escapeHtml(`<img src=x onerror="a" & 'b'>`)).toBe(
      "&lt;img src=x onerror=&quot;a&quot; &amp; &#39;b&#39;&gt;"
    );
  });

  it("leaves ordinary text untouched", () => {
    expect(escapeHtml("Robot arm for the lab")).toBe("Robot arm for the lab");
  });
});

describe("verificationEmail", () => {
  it("keeps the existing subject and carries the url", () => {
    const email = verificationEmail({ url: "https://x/verify?t=abc" });
    expect(email.subject).toBe("Verify your email");
    expect(email.text).toContain("https://x/verify?t=abc");
    expect(email.html).toContain("https://x/verify?t=abc");
  });
});

describe("passwordResetEmail", () => {
  it("keeps the existing subject and carries the url", () => {
    const email = passwordResetEmail({ url: "https://x/reset?t=abc" });
    expect(email.subject).toBe("Reset your password");
    expect(email.text).toContain("https://x/reset?t=abc");
  });
});

describe("projectSubmittedEmail", () => {
  it("names the project, the proposer, and the review link", () => {
    const email = projectSubmittedEmail({
      description: "A robot arm.",
      proposerEmail: "alex@oregonstate.edu",
      proposerName: "Alex",
      title: "Robot arm",
      url: "https://app/projects/p1",
    });
    expect(email.subject).toBe("New project submitted: Robot arm");
    expect(email.text).toContain("Alex (alex@oregonstate.edu)");
    expect(email.text).toContain("A robot arm.");
    expect(email.text).toContain("https://app/projects/p1");
  });

  it("falls back to the address alone, then to Unknown proposer", () => {
    const noName = projectSubmittedEmail({
      description: null,
      proposerEmail: "alex@oregonstate.edu",
      proposerName: null,
      title: "T",
      url: "https://app/projects/p1",
    });
    expect(noName.text).toContain("alex@oregonstate.edu");

    const neither = projectSubmittedEmail({
      description: null,
      proposerEmail: null,
      proposerName: null,
      title: "T",
      url: "https://app/projects/p1",
    });
    expect(neither.text).toContain("Unknown proposer");
  });

  it("escapes a hostile title in html but not in text", () => {
    const email = projectSubmittedEmail({
      description: null,
      proposerEmail: null,
      proposerName: null,
      title: "<img src=x onerror=alert(1)>",
      url: "https://app/projects/p1",
    });
    expect(email.html).not.toContain("<img src=x");
    expect(email.html).toContain("&lt;img src=x");
    expect(email.text).toContain("<img src=x onerror=alert(1)>");
  });

  it("truncates a long description and says where to read the rest", () => {
    const email = projectSubmittedEmail({
      description: "z".repeat(900),
      proposerEmail: null,
      proposerName: null,
      title: "T",
      url: "https://app/projects/p1",
    });
    expect(email.text).toContain("Open the project to read the full proposal.");
    expect(email.text).not.toContain("z".repeat(700));
  });
});

describe("projectApprovedEmail", () => {
  it("says it will be published later and that no further email follows", () => {
    const email = projectApprovedEmail({
      comment: null,
      title: "Robot arm",
      url: "https://app/projects/p1",
    });
    expect(email.subject).toBe("Your project was approved: Robot arm");
    expect(email.text).toContain("published");
    expect(email.text).toContain("will not receive another email");
  });

  it("includes a reviewer comment when there is one", () => {
    const email = projectApprovedEmail({
      comment: "Nice scope.",
      title: "T",
      url: "https://app/projects/p1",
    });
    expect(email.text).toContain("Nice scope.");
  });

  it("omits the reviewer line when the comment is blank", () => {
    const email = projectApprovedEmail({
      comment: "   ",
      title: "T",
      url: "https://app/projects/p1",
    });
    expect(email.text).not.toContain("Note from the reviewer");
  });
});

describe("projectChangesRequestedEmail", () => {
  it("carries the staff note verbatim", () => {
    const email = projectChangesRequestedEmail({
      comment: "Add measurable objectives.",
      title: "Robot arm",
      url: "https://app/projects/p1",
    });
    expect(email.subject).toBe("Changes requested: Robot arm");
    expect(email.text).toContain("Add measurable objectives.");
    expect(email.text).toContain("https://app/projects/p1");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- templates`
Expected: FAIL, cannot resolve `../templates`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/email/templates.ts`:

```ts
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

function describeProposer(
  name: string | null,
  email: string | null
): string {
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
  const body = paragraphs
    .map((p) => `<p>${escapeHtml(p)}</p>`)
    .join("");
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- templates`
Expected: PASS, all tests green.

- [ ] **Step 5: Prove the escaping test can fail**

Temporarily change `layout` to interpolate `p` instead of `escapeHtml(p)`, re-run
`npm test -- templates`, and confirm "escapes a hostile title" FAILS. Revert.
An escaping test that cannot fail is worse than none.

- [ ] **Step 6: Check and commit**

```bash
npm run check && npm run typecheck
git add src/lib/email/templates.ts src/lib/email/__tests__/templates.test.ts
git commit -m "feat(email): add template module with html escaping"
```

---

### Task 2: Collapse the transports onto a single send

**Files:**
- Modify: `src/lib/email/sender.ts`
- Modify: `src/lib/email/ses-sender.ts`
- Modify: `src/lib/email/console-sender.ts`
- Modify: `src/lib/auth.ts:22-32`
- Test: `src/lib/email/__tests__/ses-sender.test.ts`, `src/lib/email/__tests__/console-sender.test.ts`

**Interfaces:**
- Consumes: `RenderedEmail`, `verificationEmail`, `passwordResetEmail` from Task 1.
- Produces: `interface EmailSender { send(to: string, email: RenderedEmail): Promise<void> }`. `getEmailSender(): EmailSender` keeps its name and factory behavior. `createSesEmailSender(): SesEmailSender` unchanged in signature.

Note the naming collision: `SesEmailSender` currently has a private field named
`send`. It is renamed to `sendCommand` so the public method can take the name.

- [ ] **Step 1: Rewrite the sender tests for the new shape**

Replace `src/lib/email/__tests__/ses-sender.test.ts` with:

```ts
import { describe, expect, it, vi } from "vitest";
import { SesEmailSender } from "../ses-sender";

const EMAIL = {
  html: "<p>Hi</p>",
  subject: "Verify your email",
  text: "Hi\n\nVerify email: https://x/verify?t=abc\n",
};

describe("SesEmailSender", () => {
  it("sends from the configured identity to the recipient", async () => {
    const sendCommand = vi.fn().mockResolvedValue({});
    const sender = new SesEmailSender("noreply@example.edu", sendCommand);

    await sender.send("a@b.com", EMAIL);

    expect(sendCommand).toHaveBeenCalledOnce();
    const input = sendCommand.mock.calls[0]?.[0];
    expect(input.FromEmailAddress).toBe("noreply@example.edu");
    expect(input.Destination.ToAddresses).toEqual(["a@b.com"]);
  });

  it("passes the rendered subject and both bodies through unchanged", async () => {
    const sendCommand = vi.fn().mockResolvedValue({});
    const sender = new SesEmailSender("noreply@example.edu", sendCommand);

    await sender.send("a@b.com", EMAIL);

    const simple = sendCommand.mock.calls[0]?.[0].Content.Simple;
    expect(simple.Subject.Data).toBe("Verify your email");
    expect(simple.Body.Text.Data).toBe(EMAIL.text);
    expect(simple.Body.Html.Data).toBe(EMAIL.html);
  });

  it("omits the reply-to header entirely when none is configured", async () => {
    const sendCommand = vi.fn().mockResolvedValue({});
    const sender = new SesEmailSender("noreply@example.edu", sendCommand);

    await sender.send("a@b.com", EMAIL);

    expect(sendCommand.mock.calls[0]?.[0].ReplyToAddresses).toBeUndefined();
  });

  it("sets the reply-to header when one is configured", async () => {
    const sendCommand = vi.fn().mockResolvedValue({});
    const sender = new SesEmailSender(
      "noreply@example.edu",
      sendCommand,
      "replies@example.edu"
    );

    await sender.send("a@b.com", EMAIL);

    expect(sendCommand.mock.calls[0]?.[0].ReplyToAddresses).toEqual([
      "replies@example.edu",
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- ses-sender`
Expected: FAIL, `sender.send is not a function`.

- [ ] **Step 3: Rewrite `sender.ts`**

```ts
import { ConsoleEmailSender } from "./console-sender";
import { createSesEmailSender } from "./ses-sender";
import type { RenderedEmail } from "./templates";

export interface EmailSender {
  send(to: string, email: RenderedEmail): Promise<void>;
}

export function getEmailSender(): EmailSender {
  const transport = process.env.EMAIL_TRANSPORT ?? "console";
  switch (transport) {
    case "console":
      return new ConsoleEmailSender();
    case "ses":
      return createSesEmailSender();
    default:
      throw new Error(`Unknown EMAIL_TRANSPORT: ${transport}`);
  }
}
```

The `EmailMessage` interface is deleted, not deprecated.

- [ ] **Step 4: Rewrite `ses-sender.ts`**

Delete the `EmailContent` interface and the `VERIFICATION` and `PASSWORD_RESET`
constants; that copy now lives in `templates.ts`. Keep everything from
`let _client` down unchanged.

```ts
import {
  SESv2Client,
  SendEmailCommand,
  type SendEmailCommandInput,
  type SendEmailCommandOutput,
} from "@aws-sdk/client-sesv2";
import type { EmailSender } from "./sender";
import type { RenderedEmail } from "./templates";

const DEFAULT_REGION = "us-east-1";

/**
 * Sends a `SendEmailCommand` to SES. Injected into `SesEmailSender` so the
 * sender can be unit-tested without touching AWS (mirrors `ConverseFn` in
 * the Bedrock client).
 */
export type SesSendFn = (
  input: SendEmailCommandInput
) => Promise<SendEmailCommandOutput>;

export class SesEmailSender implements EmailSender {
  private readonly from: string;
  private readonly replyTo: string | null;
  private readonly sendCommand: SesSendFn;

  /**
   * `replyTo` is optional because `from` is the address DMARC aligns against;
   * a reply-to only decides where a human's reply lands, so mail sends
   * correctly without one.
   */
  constructor(
    from: string,
    sendCommand: SesSendFn,
    replyTo: string | null = null
  ) {
    this.from = from;
    this.sendCommand = sendCommand;
    this.replyTo = replyTo;
  }

  async send(to: string, email: RenderedEmail): Promise<void> {
    await this.sendCommand({
      FromEmailAddress: this.from,
      // `undefined` is dropped by the SDK serializer, so an unconfigured
      // reply-to leaves the header off rather than sending an empty list.
      ReplyToAddresses: this.replyTo ? [this.replyTo] : undefined,
      Destination: { ToAddresses: [to] },
      Content: {
        Simple: {
          Subject: { Data: email.subject },
          Body: {
            Text: { Data: email.text },
            Html: { Data: email.html },
          },
        },
      },
    });
  }
}
```

Keep the existing `_client`, `getSesClient`, and `createSesEmailSender` exactly
as they are, changing only the constructor call's argument name if the
implementer wishes. `EMAIL_FROM` stays required.

- [ ] **Step 5: Rewrite `console-sender.ts`**

```ts
import type { EmailSender } from "./sender";
import type { RenderedEmail } from "./templates";

export class ConsoleEmailSender implements EmailSender {
  send(to: string, email: RenderedEmail): Promise<void> {
    const lines = [
      "",
      "==================== EMAIL (console transport) ====================",
      `  to:      ${to}`,
      `  subject: ${email.subject}`,
      "",
      email.text,
      "===================================================================",
      "",
    ];
    process.stderr.write(`${lines.join("\n")}\n`);
    return Promise.resolve();
  }
}
```

Update `src/lib/email/__tests__/console-sender.test.ts` to call
`send("a@b.com", EMAIL)` and assert the written output contains the recipient,
the subject, and the text body.

- [ ] **Step 6: Update `src/lib/auth.ts`**

Add the import and change the two callbacks. Nothing else in the file moves.

```ts
import { passwordResetEmail, verificationEmail } from "#/lib/email/templates";
```

```ts
    sendResetPassword: async ({ user, url }) => {
      await emailSender.send(user.email, passwordResetEmail({ url }));
    },
```

```ts
    sendVerificationEmail: async ({ user, url }) => {
      await emailSender.send(user.email, verificationEmail({ url }));
    },
```

- [ ] **Step 7: Run the full unit suite**

Run: `npm test`
Expected: PASS. If any other file referenced `EmailMessage`, `sendVerification`,
or `sendPasswordReset`, it fails here. Fix it rather than re-adding the old
methods.

- [ ] **Step 8: Check and commit**

```bash
npm run check && npm run typecheck
git add src/lib/email src/lib/auth.ts
git commit -m "refactor(email): collapse EmailSender onto a single send"
```

---

### Task 3: The project email notifier and its configuration

**Files:**
- Create: `src/server/_internal/project-emails.ts`
- Test: `src/server/_internal/__tests__/project-emails.test.ts`
- Modify: `.env.example`, `infra/variables.tf`, `infra/ecs.tf`

**Interfaces:**
- Consumes: `RenderedEmail` and the three project templates from Task 1; `getEmailSender` from Task 2; `Status` from `#/lib/project-workflow`.
- Produces:
  - `type SendEmailFn = (to: string, email: RenderedEmail) => Promise<void>`
  - `interface TransitionEmailProject { description: string | null; id: string; proposerEmail: string | null; proposerId: string | null; title: string }`
  - `notifyTransitionByEmail(project: TransitionEmailProject, target: Status, comment: string | null, sendEmail: boolean, send?: SendEmailFn): Promise<void>`

The optional `send` parameter is a test seam, matching `EmbedFn` in
`refreshProjectEmbedding` and `SesSendFn` in `SesEmailSender`. Production
callers omit it.

- [ ] **Step 1: Write the failing test**

Create `src/server/_internal/__tests__/project-emails.test.ts`. This is a unit
test: it never reaches the database, so `proposerId` lookups are exercised only
through the integration tests in Task 4.

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { notifyTransitionByEmail } from "../project-emails";

const PROJECT = {
  description: "A robot arm.",
  id: "p1",
  proposerEmail: "alex@oregonstate.edu",
  proposerId: null,
  title: "Robot arm",
};

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("notifyTransitionByEmail", () => {
  it("emails the review inbox when a project is submitted", async () => {
    process.env.BETTER_AUTH_URL = "https://app";
    process.env.EMAIL_REVIEW_INBOX = "review@oregonstate.edu";
    const send = vi.fn().mockResolvedValue(undefined);

    await notifyTransitionByEmail(PROJECT, "submitted", null, true, send);

    expect(send).toHaveBeenCalledOnce();
    const [to, email] = send.mock.calls[0] ?? [];
    expect(to).toBe("review@oregonstate.edu");
    expect(email.subject).toBe("New project submitted: Robot arm");
    expect(email.text).toContain("https://app/projects/p1");
  });

  it("emails the proposer on approval and on changes requested", async () => {
    process.env.BETTER_AUTH_URL = "https://app";
    const send = vi.fn().mockResolvedValue(undefined);

    await notifyTransitionByEmail(PROJECT, "approved", null, true, send);
    await notifyTransitionByEmail(
      PROJECT,
      "changes_requested",
      "Add objectives.",
      true,
      send
    );

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]?.[0]).toBe("alex@oregonstate.edu");
    expect(send.mock.calls[1]?.[1].text).toContain("Add objectives.");
  });

  it("sends nothing for statuses that are not part of review", async () => {
    process.env.BETTER_AUTH_URL = "https://app";
    process.env.EMAIL_REVIEW_INBOX = "review@oregonstate.edu";
    const send = vi.fn().mockResolvedValue(undefined);

    for (const target of ["draft", "published", "archived"] as const) {
      await notifyTransitionByEmail(PROJECT, target, null, true, send);
    }

    expect(send).not.toHaveBeenCalled();
  });

  it("sends nothing when staff opted out", async () => {
    process.env.BETTER_AUTH_URL = "https://app";
    const send = vi.fn().mockResolvedValue(undefined);

    await notifyTransitionByEmail(PROJECT, "approved", null, false, send);

    expect(send).not.toHaveBeenCalled();
  });

  it("skips the submission email when the review inbox is unset", async () => {
    process.env.BETTER_AUTH_URL = "https://app";
    process.env.EMAIL_REVIEW_INBOX = "";
    const send = vi.fn().mockResolvedValue(undefined);

    await notifyTransitionByEmail(PROJECT, "submitted", null, true, send);

    expect(send).not.toHaveBeenCalled();
  });

  it("skips everything when the app base url is unset", async () => {
    process.env.BETTER_AUTH_URL = "";
    process.env.EMAIL_REVIEW_INBOX = "review@oregonstate.edu";
    const send = vi.fn().mockResolvedValue(undefined);

    await notifyTransitionByEmail(PROJECT, "submitted", null, true, send);

    expect(send).not.toHaveBeenCalled();
  });

  it("prefers the account address over a stale stored one", async () => {
    // Matches getProposerEmailForEditImpl: proposerId is canonical, so the UI
    // and the mail agree on the recipient. Covered end to end in Task 4.
    const { resolveProposerAddress } = await import("../project-emails");
    expect(resolveProposerAddress("stale@old.edu", "current@x.edu")).toBe(
      "current@x.edu"
    );
    expect(resolveProposerAddress("stored@x.edu", null)).toBe("stored@x.edu");
    expect(resolveProposerAddress(null, null)).toBeNull();
  });

  it("skips the proposer email when there is no address at all", async () => {
    process.env.BETTER_AUTH_URL = "https://app";
    const send = vi.fn().mockResolvedValue(undefined);

    await notifyTransitionByEmail(
      { ...PROJECT, proposerEmail: null, proposerId: null },
      "approved",
      null,
      true,
      send
    );

    expect(send).not.toHaveBeenCalled();
  });

  it("never propagates a transport failure to the caller", async () => {
    process.env.BETTER_AUTH_URL = "https://app";
    const send = vi.fn().mockRejectedValue(new Error("SES is down"));

    await expect(
      notifyTransitionByEmail(PROJECT, "approved", null, true, send)
    ).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- project-emails`
Expected: FAIL, cannot resolve `../project-emails`.

- [ ] **Step 3: Write the implementation**

Create `src/server/_internal/project-emails.ts`:

```ts
import { eq } from "drizzle-orm";
import { db } from "#/db";
import { user } from "#/db/schema";
import { getEmailSender } from "#/lib/email/sender";
import {
  projectApprovedEmail,
  projectChangesRequestedEmail,
  projectSubmittedEmail,
  type RenderedEmail,
} from "#/lib/email/templates";
import type { Status } from "#/lib/project-workflow";

export type SendEmailFn = (
  to: string,
  email: RenderedEmail
) => Promise<void>;

export interface TransitionEmailProject {
  description: string | null;
  id: string;
  proposerEmail: string | null;
  proposerId: string | null;
  title: string;
}

async function lookupProposer(
  proposerId: string | null
): Promise<{ email: string | null; name: string | null }> {
  if (!proposerId) {
    return { email: null, name: null };
  }
  const [row] = await db
    .select({ email: user.email, name: user.name })
    .from(user)
    .where(eq(user.id, proposerId));
  return { email: row?.email ?? null, name: row?.name ?? null };
}

/**
 * The address to reach the proposer on.
 *
 * proposerId is canonical: when the project is linked to an account, that
 * account's current email wins over the stored `proposer_email`, which may be
 * stale. Falls back to the stored address only when no account is linked, which
 * is how a proposer without an account is still reachable.
 *
 * This precedence deliberately matches `getProposerEmailForEditImpl` in
 * `projects-queries.ts`. That function is what the staff dialog displays, so
 * diverging here would name one address in the UI and mail another.
 */
export function resolveProposerAddress(
  storedEmail: string | null,
  accountEmail: string | null
): string | null {
  return accountEmail ?? storedEmail;
}

async function sendSubmitted(
  project: TransitionEmailProject,
  url: string,
  send: SendEmailFn
): Promise<void> {
  const inbox = process.env.EMAIL_REVIEW_INBOX?.trim();
  if (!inbox) {
    return;
  }
  const account = await lookupProposer(project.proposerId);
  await send(
    inbox,
    projectSubmittedEmail({
      description: project.description,
      proposerEmail: resolveProposerAddress(
        project.proposerEmail,
        account.email
      ),
      proposerName: account.name,
      title: project.title,
      url,
    })
  );
}

async function sendToProposer(
  project: TransitionEmailProject,
  target: "approved" | "changes_requested",
  comment: string | null,
  url: string,
  send: SendEmailFn
): Promise<void> {
  const account = await lookupProposer(project.proposerId);
  const to = resolveProposerAddress(project.proposerEmail, account.email);
  if (!to) {
    return;
  }
  const email =
    target === "approved"
      ? projectApprovedEmail({ comment, title: project.title, url })
      : projectChangesRequestedEmail({
          comment: comment ?? "",
          title: project.title,
          url,
        });
  await send(to, email);
}

/**
 * Sends the review emails for a transition that has already been committed.
 *
 * Never throws. A failed email must not undo an approval, and the caller runs
 * outside the transaction precisely so it cannot. Mirrors the swallow-and-log
 * shape of `refreshProjectEmbedding`.
 */
export async function notifyTransitionByEmail(
  project: TransitionEmailProject,
  target: Status,
  comment: string | null,
  sendEmail: boolean,
  send?: SendEmailFn
): Promise<void> {
  if (!sendEmail) {
    return;
  }
  try {
    // Absolute, because these links are followed from a mail client. The app
    // host is already configured for auth; a missing one means we cannot build
    // a usable link, so send nothing rather than something broken.
    const base = process.env.BETTER_AUTH_URL?.trim();
    if (!base) {
      return;
    }
    const dispatch: SendEmailFn =
      send ?? ((to, email) => getEmailSender().send(to, email));
    const url = `${base}/projects/${project.id}`;

    if (target === "submitted") {
      await sendSubmitted(project, url, dispatch);
      return;
    }
    if (target === "approved" || target === "changes_requested") {
      await sendToProposer(project, target, comment, url, dispatch);
    }
  } catch (error) {
    console.error(`Review email failed for project ${project.id}`, error);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- project-emails`
Expected: PASS.

- [ ] **Step 5: Add `EMAIL_REVIEW_INBOX` to the environment**

In `.env.example`, directly after the `EMAIL_REPLY_TO` block:

```bash
# Who receives the "new project submitted" email. Distinct from EMAIL_REPLY_TO
# even though they hold the same address today: one is where replies land, the
# other is who reviews submissions. Unset means submissions email nobody.
EMAIL_REVIEW_INBOX=
```

In `infra/variables.tf`, after `email_reply_to`:

```hcl
variable "email_review_inbox" {
  description = "Address that receives the notification when a project is submitted for review. Distinct from email_reply_to even where the address matches: one is where replies land, the other is who reviews submissions. Empty disables the submission email."
  type        = string
  default     = "eecs-capstone@oregonstate.edu"
}
```

In `infra/ecs.tf`, immediately after the `EMAIL_REPLY_TO` entry:

```hcl
        # Recipient of the project submission notice. Unlike EMAIL_FROM this is
        # a destination, so it needs no SES identity, and unlike EMAIL_REPLY_TO
        # it is read by the app rather than stamped on outgoing headers.
        { name = "EMAIL_REVIEW_INBOX", value = var.email_review_inbox },
```

- [ ] **Step 6: Validate the infrastructure change**

```bash
cd infra && terraform fmt -check && terraform validate && cd ..
```
Expected: `Success! The configuration is valid.` If `terraform validate` fails
on a provider plugin handshake, the sandbox is blocking a unix socket; re-run
outside it.

- [ ] **Step 7: Check and commit**

```bash
npm run check && npm run typecheck
git add src/server/_internal/project-emails.ts src/server/_internal/__tests__/project-emails.test.ts .env.example infra/variables.tf infra/ecs.tf
git commit -m "feat(email): add the project review notifier and EMAIL_REVIEW_INBOX"
```

---

### Task 4: Wire the notifier into both transitions

**Files:**
- Modify: `src/server/_internal/projects.ts:215-268` and `:344-402` and `:414-430`
- Modify: `src/server/projects.ts:52-55` and the four transition handlers
- Modify: `src/server/__tests__/project-embeddings.integration.test.ts:141-159`
- Test: `src/server/__tests__/projects.integration.test.ts`

**Interfaces:**
- Consumes: `notifyTransitionByEmail`, `SendEmailFn`, `TransitionEmailProject` from Task 3.
- Produces:
  - `interface TransitionOptions { embed?: EmbedFn; sendEmail?: boolean }`
  - `performTransitionAs(viewer, id, target, comment?, opts?: TransitionOptions)`
  - `forceTransitionAs(viewer, id, target, comment?, opts?: TransitionOptions)`
  - `performTransitionForCurrentUser(id, target, comment?, sendEmail?: boolean)`
  - `forceTransitionForCurrentUser(id, target, comment?, sendEmail?: boolean)`

Only six call sites pass `embed` positionally, all in
`project-embeddings.integration.test.ts`. Every other caller passes three or
four arguments and needs no change.

- [ ] **Step 1: Write the failing tests**

Append to `src/server/__tests__/projects.integration.test.ts`. Follow the file's
existing `makeUser` and `baseProject` helpers.

```ts
describe("review emails", () => {
  // These tests mutate process.env, and this config sets `fileParallelism:
  // false`, so every integration file shares one process. Without this restore
  // a corrupted BETTER_AUTH_URL would leak out of this block and into every
  // later test file, where `auth.api.signUpEmail` reads it. Snapshot and put it
  // back, the same way the Task 3 unit tests do.
  const ORIGINAL_ENV = { ...process.env };
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("emails the review inbox on submit, the proposer on approve, nobody on publish", async () => {
    process.env.BETTER_AUTH_URL = "https://app";
    process.env.EMAIL_REVIEW_INBOX = "review@oregonstate.edu";
    const owner = await makeUser("owner-mail@x.edu", "user");
    const admin = await makeUser("admin-mail@x.edu", "admin");
    const { id } = await createProjectAs(owner, baseProject());
    const send = vi.fn().mockResolvedValue(undefined);

    await performTransitionAs(owner, id, "submitted", undefined, { send });
    await performTransitionAs(admin, id, "approved", undefined, { send });
    await performTransitionAs(admin, id, "published", undefined, { send });

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]?.[0]).toBe("review@oregonstate.edu");
    expect(send.mock.calls[1]?.[0]).toBe("owner-mail@x.edu");
    expect(send.mock.calls[1]?.[1].text).toContain("will not receive another email");
  });

  it("emails the proposer the staff note when changes are requested", async () => {
    process.env.BETTER_AUTH_URL = "https://app";
    const owner = await makeUser("owner-cr@x.edu", "user");
    const admin = await makeUser("admin-cr@x.edu", "admin");
    const { id } = await createProjectAs(owner, baseProject());
    const send = vi.fn().mockResolvedValue(undefined);

    await performTransitionAs(owner, id, "submitted", undefined, { send });
    send.mockClear();
    await performTransitionAs(admin, id, "changes_requested", "Add objectives.", {
      send,
    });

    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]?.[0]).toBe("owner-cr@x.edu");
    expect(send.mock.calls[0]?.[1].text).toContain("Add objectives.");
  });

  it("sends nothing when staff opt out, but still records the transition", async () => {
    process.env.BETTER_AUTH_URL = "https://app";
    const owner = await makeUser("owner-skip@x.edu", "user");
    const admin = await makeUser("admin-skip@x.edu", "admin");
    const { id } = await createProjectAs(owner, baseProject());
    const send = vi.fn().mockResolvedValue(undefined);

    await performTransitionAs(owner, id, "submitted", undefined, { send });
    send.mockClear();
    await performTransitionAs(admin, id, "approved", undefined, {
      send,
      sendEmail: false,
    });

    expect(send).not.toHaveBeenCalled();
    const [row] = await db.select().from(projects).where(eq(projects.id, id));
    expect(row.status).toBe("approved");
    const history = await db
      .select()
      .from(projectStatusHistory)
      .where(eq(projectStatusHistory.projectId, id));
    expect(history.some((h) => h.newStatus === "approved")).toBe(true);
  });

  it("emails a proposer who has an address but no account", async () => {
    process.env.BETTER_AUTH_URL = "https://app";
    const admin = await makeUser("admin-noacct@x.edu", "admin");
    const { id } = await createProjectAs(admin, {
      ...baseProject(),
      proposerEmail: "outsider@example.com",
    });
    const send = vi.fn().mockResolvedValue(undefined);

    await performTransitionAs(admin, id, "submitted", undefined, { send });
    send.mockClear();
    await performTransitionAs(admin, id, "approved", undefined, { send });

    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]?.[0]).toBe("outsider@example.com");
  });

  it("does not roll back the transition when the email fails", async () => {
    process.env.BETTER_AUTH_URL = "https://app";
    const owner = await makeUser("owner-fail@x.edu", "user");
    const admin = await makeUser("admin-fail@x.edu", "admin");
    const { id } = await createProjectAs(owner, baseProject());
    const ok = vi.fn().mockResolvedValue(undefined);
    const boom = vi.fn().mockRejectedValue(new Error("SES is down"));

    await performTransitionAs(owner, id, "submitted", undefined, { send: ok });
    await expect(
      performTransitionAs(admin, id, "approved", undefined, { send: boom })
    ).resolves.toMatchObject({ status: "approved" });

    const [row] = await db.select().from(projects).where(eq(projects.id, id));
    expect(row.status).toBe("approved");
  });

  it("emails from the force path too", async () => {
    process.env.BETTER_AUTH_URL = "https://app";
    const owner = await makeUser("owner-force@x.edu", "user");
    const admin = await makeUser("admin-force@x.edu", "admin");
    const { id } = await createProjectAs(owner, baseProject());
    const send = vi.fn().mockResolvedValue(undefined);

    await forceTransitionAs(admin, id, "approved", undefined, { send });

    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]?.[0]).toBe("owner-force@x.edu");
  });
});
```

Add `vi` and `afterEach` to the existing `vitest` import at the top of the file.

Note the tests pass `send` inside the options object, so `TransitionOptions`
carries the seam through: `{ embed?: EmbedFn; send?: SendEmailFn; sendEmail?: boolean }`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `ulimit -n 8192 && npm run test:integration -- projects`
Expected: FAIL. The options object is not accepted yet, so `send` is ignored and
the call counts are zero.

- [ ] **Step 3: Change both transition signatures**

In `src/server/_internal/projects.ts`, add the import and the options type:

```ts
import {
  notifyTransitionByEmail,
  type SendEmailFn,
} from "./project-emails";
```

```ts
export interface TransitionOptions {
  embed?: EmbedFn;
  /** Test seam. Production callers omit it and the notifier resolves its own transport. */
  send?: SendEmailFn;
  sendEmail?: boolean;
}
```

Change `performTransitionAs`'s signature from `comment?: string, embed?: EmbedFn`
to `comment?: string, opts?: TransitionOptions`, and replace its tail:

```ts
  // After the transaction, never inside it: a Bedrock call must not hold a
  // database transaction open, and its failure must not roll back the publish.
  if (target === "published") {
    await refreshProjectEmbedding(id, opts?.embed);
  }

  // Same reasoning, and it matters more here: a failed email must not undo an
  // approval. notifyTransitionByEmail swallows its own errors.
  await notifyTransitionByEmail(
    {
      description: project.description,
      id: project.id,
      proposerEmail: project.proposerEmail,
      proposerId: project.proposerId,
      title: project.title,
    },
    target,
    comment ?? null,
    opts?.sendEmail ?? true,
    opts?.send
  );

  return { id, status: target };
```

Apply the identical signature change and identical tail to `forceTransitionAs`.
`loadProjectOr404` already does `select()` with no column list, so
`description` and `proposerEmail` are present on `project` without any query
change.

- [ ] **Step 4: Thread the flag through the wrappers**

```ts
export async function performTransitionForCurrentUser(
  id: string,
  target: Status,
  comment?: string,
  sendEmail?: boolean
) {
  const viewer = await requireUser();
  return performTransitionAs(viewer, id, target, comment, { sendEmail });
}

export async function forceTransitionForCurrentUser(
  id: string,
  target: Status,
  comment?: string,
  sendEmail?: boolean
) {
  const viewer = await requireUser();
  return forceTransitionAs(viewer, id, target, comment, { sendEmail });
}
```

- [ ] **Step 5: Update the six positional `embed` call sites**

In `src/server/__tests__/project-embeddings.integration.test.ts`, lines 141, 144,
145, 156, 157 and 159, change `performTransitionAs(admin, id, "x", undefined, embed)`
to `performTransitionAs(admin, id, "x", undefined, { embed })`. These are the
only positional `embed` callers in the repository.

- [ ] **Step 6: Add `sendEmail` to the wire schema**

`src/server/projects.ts` has **two** transition schemas, and both need the flag.
`transitionInputSchema` (line 52) backs `submitProject`, `returnToDraft`,
`requestChanges` and `approveProject`. `statusTransitionSchema` (line 171) backs
`performTransition` and `forceSetProjectStatus`, which is the path the staff
dialog actually uses. Missing the second one leaves the checkbox inert.

```ts
// Defaults true so a partial caller sends mail rather than silently swallowing
// it. Staff opt out per action from the transition dialog.
const SEND_EMAIL_FIELD = { sendEmail: z.boolean().default(true) };

const transitionInputSchema = z.object({
  id: z.string().uuid(),
  comment: z.string().max(2000).optional(),
  ...SEND_EMAIL_FIELD,
});

const statusTransitionSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(STATUS_VALUES),
  comment: z.string().max(2000).optional(),
  ...SEND_EMAIL_FIELD,
});
```

Then pass `data.sendEmail` as the fourth argument in all six handlers. For
example:

```ts
export const approveProject = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => transitionInputSchema.parse(data))
  .handler(async ({ data }) => {
    const { performTransitionForCurrentUser } = await import(
      "./_internal/projects"
    );
    return performTransitionForCurrentUser(
      data.id,
      "approved",
      data.comment,
      data.sendEmail
    );
  });
```

```ts
export const forceSetProjectStatus = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => statusTransitionSchema.parse(data))
  .handler(async ({ data }) => {
    const { forceTransitionForCurrentUser } = await import(
      "./_internal/projects"
    );
    return forceTransitionForCurrentUser(
      data.id,
      data.status as Status,
      data.comment,
      data.sendEmail
    );
  });
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `ulimit -n 8192 && npm run test:integration`
Expected: PASS, including the pre-existing project, bookmark, comment, search,
and embedding suites.

- [ ] **Step 8: Prove the opt-out test can fail**

Temporarily change `opts?.sendEmail ?? true` to `true`, re-run
`npm run test:integration -- projects`, and confirm "sends nothing when staff opt
out" FAILS. Revert.

- [ ] **Step 9: Check and commit**

```bash
npm run check && npm run typecheck
git add src/server
git commit -m "feat(projects): send review emails after each transition commits"
```

---

### Task 5: The staff hint and opt-out control

**Files:**
- Modify: `src/components/staff-project-panel.tsx`

**Interfaces:**
- Consumes: the `sendEmail` field on `statusTransitionSchema` from Task 4, and the existing `getProposerEmailForEdit` server function.
- Produces: no prop changes. `$projectId.tsx` is not touched.

- [ ] **Step 1: Fetch the address the same way the panel already fetches the edit log**

Do **not** add a prop. `getProposerEmailForEdit` already exists, is staff-gated,
and resolves the address with exactly the precedence the notifier uses (account
first, stored address as fallback). Reusing it is what keeps the dialog's label
and the actual recipient in agreement.

Add to the existing import from `#/server/projects-queries`:

```ts
import {
  getProposerEmailForEdit,
  listProjectEditLog,
} from "#/server/projects-queries";
```

Add state and a fetch beside the existing `editLog` effect:

```ts
  const [proposerAddress, setProposerAddress] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const email = await getProposerEmailForEdit({
          data: { projectId: project.id },
        });
        setProposerAddress(email || null);
      } catch {
        // Staff-only endpoint; on failure the dialog degrades to "no address
        // on file" and sends nothing, which is the safe direction.
      }
    })();
  }, [project.id]);
```

Confirm the exported server function's name and its argument key in
`src/server/projects-queries.ts` before writing this; the internal
implementation is `getProposerEmailForEditImpl` and takes `{ projectId }`.

- [ ] **Step 2: Add the state and the control**

Add the import:

```ts
import { Checkbox } from "./ui/checkbox";
```

Add state beside the existing `comment` state:

```ts
const [sendEmail, setSendEmail] = useState(true);
```

Reset it in `openTransition` so each dialog starts from the default, exactly as
`comment` is reset:

```ts
  function openTransition(target: Status, force: boolean) {
    setError(null);
    setComment("");
    setSendEmail(true);
    setPending({ target, force });
  }
```

Derive the one remaining fact, beside `isChangesRequested`:

```ts
  // Only these two transitions email anyone. Publishing is deliberately silent,
  // which is what the approval email promises.
  const emailsProposer =
    pending?.target === "approved" || pending?.target === "changes_requested";
```

`proposerAddress` is already in scope from Step 1.

- [ ] **Step 3: Render the control**

Insert directly after the closing `</div>` of the comment block and before the
`{error && ...}` line:

```tsx
          {emailsProposer && (
            <div className="space-y-1">
              <Label className="font-normal">
                <Checkbox
                  checked={sendEmail && proposerAddress !== null}
                  disabled={proposerAddress === null}
                  onCheckedChange={(checked) => setSendEmail(checked === true)}
                />
                {proposerAddress
                  ? `Email the proposer (${proposerAddress})`
                  : "No address on file, no email will be sent"}
              </Label>
              {proposerAddress && (
                <p className="text-muted-foreground text-xs">
                  Uncheck to change the status silently.
                </p>
              )}
            </div>
          )}
```

- [ ] **Step 4: Send the flag**

In `confirmTransition`, include it in the payload. Send `false` when there is no
address, so the server agrees with what the dialog showed:

```ts
      const data = {
        id: project.id,
        status: pending.target,
        comment,
        sendEmail: sendEmail && proposerAddress !== null,
      };
```

- [ ] **Step 5: Verify in the browser**

```bash
npm run dev
```

Open a submitted project as an admin and check all four:

1. The "Move to Approved" dialog shows the checkbox, checked, naming the address.
2. The "Move to Published" dialog shows no checkbox at all.
3. A project whose proposer has no address shows the disabled "No address on
   file" state.
4. Unchecking the box and confirming still changes the status, and the dev
   server's stderr prints no `EMAIL (console transport)` block for that action.

- [ ] **Step 6: Check and commit**

```bash
npm run check && npm run typecheck
git add src/components/staff-project-panel.tsx
git commit -m "feat(projects): show and allow skipping the review email"
```

---

### Task 6: Documentation

The README currently tells a reader the app sends two emails. It sends four.

**Files:**
- Modify: `README.md` (email transport section)
- Modify: `DEPLOYMENT.md` (section 9)
- Modify: `docs/QUIRKS.md` (console email transport section)

- [ ] **Step 1: Update the README email transport section**

After the paragraph describing `EMAIL_TRANSPORT`, add:

```markdown
The app sends four emails, all through `src/lib/email/templates.ts`:

| Email | Trigger | Recipient |
|---|---|---|
| Verify your email | Sign-up | The new account |
| Reset your password | Forgot-password form | The account |
| New project submitted | A project moves to `submitted` | `EMAIL_REVIEW_INBOX` |
| Approved / Changes requested | Staff review a project | The proposer |

Everything else the app notifies about is in-app only, a row in `notifications`
rendered by the bell, and never reaches an inbox. Staff can skip either review
email per action from the transition dialog.
```

- [ ] **Step 2: Document `EMAIL_REVIEW_INBOX` in DEPLOYMENT.md**

Add a subsection after 9.6:

```markdown
### 9.7 Review inbox

`EMAIL_REVIEW_INBOX` receives the notice when a proposer submits a project. It
holds the same address as `EMAIL_REPLY_TO` today but means something different:
one is where replies land, the other is who reviews submissions. Keeping them
separate means changing either does not silently change the other.

It is a destination rather than a sender, so it needs no SES identity and no
DKIM alignment. Unset, submissions email nobody and the app logs it; nothing
else degrades.
```

Renumber the existing "SES console wizard" section to 9.8.

- [ ] **Step 3: Update QUIRKS.md**

Replace the last sentence of the console email transport section with:

```markdown
All four emails render through `src/lib/email/templates.ts`, which owns the
HTML escaping. Interpolating a project title or staff comment into `html`
without `escapeHtml` is an injection into the staff review inbox, so the
templates are the only place that builds email markup.
```

- [ ] **Step 4: Check and commit**

```bash
npm run check
git add README.md DEPLOYMENT.md docs/QUIRKS.md
git commit -m "docs: record the two new review emails"
```

---

## Self-Review

**Spec coverage.** Every section of the spec maps to a task: templates and
escaping to Task 1, the transport collapse and `src/lib/auth.ts` to Task 2,
`project-emails.ts` with recipient rules and `EMAIL_REVIEW_INBOX` to Task 3, the
options-object signature change and the wire flag to Task 4, the staff hint and
opt-out to Task 5, documentation to Task 6. The spec's error-handling table is
covered by Task 3 Step 1's last three tests plus Task 4 Step 1's failure test.

**Deviation from the spec, deliberate.** The spec put the test seam as a fifth
positional parameter on `notifyTransitionByEmail`. Task 4 also threads it
through `TransitionOptions` as `send`, because the integration tests need to
inject a fake without reaching into module internals. This adds one field to an
options object the task was already creating.

**Correction to the spec's cost estimate.** The spec says the signature change
"touches existing call sites and their tests". In fact only six lines in
`project-embeddings.integration.test.ts` pass `embed` positionally; every other
caller passes three or four arguments and is unaffected.

**Defect found during execution, fixed in Task 4 Step 1.** The integration tests
as first written set `process.env.BETTER_AUTH_URL` and never restored it. Since
`vitest.integration.config.ts` sets `fileParallelism: false`, every integration
file shares one process, so that value would have leaked out of this block into
every later test file, where `auth.api.signUpEmail` reads it. The Task 3 unit
tests got this right and these did not. An `afterEach` now restores the
snapshot. Any future test in this suite that touches `process.env` must do the
same.

**Correction to the spec's recipient rule.** The spec said the proposer email
resolves to "`proposerEmail` when set, otherwise the account address via
`proposerId`". That is backwards from the convention already in the codebase:
`getProposerEmailForEditImpl` (`projects-queries.ts:330`) documents that
"proposerId is canonical" and prefers the account's current email, treating the
stored column as the fallback for a proposer with no account. Task 3 follows the
existing convention rather than the spec, in a shared `resolveProposerAddress`.
Had it not, the staff dialog and the mail would have disagreed about the
recipient, since the dialog reads that same function.

**Correction to the spec's component list.** The spec had the panel taking the
address as a new prop through `$projectId.tsx`. `getProposerEmailForEdit`
already exists, is staff-gated, and applies the precedence above, so Task 5
calls it the way the panel already calls `listProjectEditLog`. The route file is
not touched.

**Gap the spec missed.** `src/server/projects.ts` has two transition schemas,
not one. `statusTransitionSchema` is the one the staff dialog actually posts
through, so adding `sendEmail` only to `transitionInputSchema` would have left
the checkbox inert while every test passed. Task 4 Step 6 covers both.

**Type consistency.** `RenderedEmail` is produced in Task 1 and consumed in
Tasks 2 and 3 under the same name. `SendEmailFn` is produced in Task 3 and
consumed in Task 4. `TransitionEmailProject`'s five fields match what
`loadProjectOr404`'s `select()` returns. The panel prop added in Task 5,
`proposerEmail`, matches the column name in `src/db/schema.ts:113`.
