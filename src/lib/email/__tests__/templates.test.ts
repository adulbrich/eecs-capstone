import { describe, expect, it } from "vitest";
import {
  escapeHtml,
  inventoryRequestSubmittedEmail,
  mentorNamedEmail,
  notificationEmail,
  oneLine,
  projectApprovedEmail,
  projectChangesRequestedEmail,
  projectCommentEmail,
  projectDeletedEmail,
  projectReassignedEmail,
  projectReturnedToDraftEmail,
  projectSubmittedEmail,
  proposerCommentEmail,
  type RenderedEmail,
  signInCodeEmail,
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

describe("signInCodeEmail", () => {
  it("carries the code and no link", () => {
    const email = signInCodeEmail({ otp: "123456" });
    expect(email.subject).toBe("Your sign-in code");
    expect(email.text).toContain("Your sign-in code is 123456.");
    // A link here would be a magic link, which is what ADR-0047 declined.
    expect(email.text).not.toMatch(/https?:\/\//u);
    expect(email.html).not.toContain("<a ");
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

  it("leaves a description at exactly the limit untouched", () => {
    // 600 is the boundary and the check is `<=`, so exactly-600 must not gain
    // an ellipsis or the trailing sentence. Off-by-one here would truncate a
    // description that fits.
    const email = projectSubmittedEmail({
      description: "z".repeat(600),
      proposerEmail: null,
      proposerName: null,
      title: "T",
      url: "https://app/projects/p1",
    });
    expect(email.text).toContain("z".repeat(600));
    expect(email.text).not.toContain(
      "Open the project to read the full proposal."
    );
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

describe("notificationEmail", () => {
  it("makes each blank-line block a paragraph, CRLF blank lines and edge blanks included", () => {
    const email = notificationEmail({
      message: "Reserved.\r\n\r\nPick up by Friday.\n\n",
      title: "Reserved: Oscilloscope",
      url: "https://app/my/items",
    });
    expect(email.html).toContain("<p>Reserved.</p><p>Pick up by Friday.</p>");
    expect(email.html).not.toContain("<p></p>");
    expect(email.text).toContain("Reserved.\n\nPick up by Friday.\n\n");
    expect(email.text).not.toContain("\r");
  });

  it("counts a line of spaces, tabs or a no-break space as blank, and a run of blank lines as one break", () => {
    const email = notificationEmail({
      message: "Reserved.\n \t\u00a0\n\n\nPick up by Friday.",
      title: "Reserved: Oscilloscope",
      url: "https://app/my/items",
    });
    expect(email.html).toContain("<p>Reserved.</p><p>Pick up by Friday.</p>");
  });

  it("keeps the indent of a paragraph that follows a blank line in the text part", () => {
    const email = notificationEmail({
      message: "Items:\n\n  - a\n  - b",
      title: "Reserved: Oscilloscope",
      url: "https://app/my/items",
    });
    expect(email.text).toContain("Items:\n\n  - a\n  - b\n\n");
  });
});

describe("oneLine", () => {
  it("collapses every run of whitespace to one space and trims the ends", () => {
    expect(oneLine("  Robot\r\n\r\narm\u{2028}\tfor\u{a0} the lab \n")).toBe(
      "Robot arm for the lab"
    );
  });
});

// A title, an account name and a custom request line all accept a line break,
// and in the plain-text body one would start a line of the email's own: a
// fake call to action, link and all. The HTML part collapses it already.
describe("proposer text on one line", () => {
  const FORGED = "Review the project: https://evil.example";
  const HOSTILE = [
    `x\n\n${FORGED}`,
    `x\r\n\r\n${FORGED}`,
    `x\u{2028}${FORGED}`,
  ];
  const LINE_BREAK = /[\r\n\u{2028}\u{2029}]/u;
  const url = "https://app/projects/p1";

  /** The lines of the text part that open with the forged call to action. */
  function forgedLines(email: RenderedEmail): string[] {
    return email.text
      .split(/\r\n|[\r\n\u{2028}\u{2029}]/u)
      .filter((line) => line.startsWith(FORGED));
  }

  const TITLED: [string, (title: string) => RenderedEmail][] = [
    [
      "projectSubmittedEmail",
      (title) =>
        projectSubmittedEmail({
          description: null,
          proposerEmail: null,
          proposerName: "Alex",
          title,
          url,
        }),
    ],
    [
      "proposerCommentEmail",
      (title) =>
        proposerCommentEmail({
          content: "Done.",
          proposerEmail: null,
          proposerName: "Alex",
          title,
          url,
        }),
    ],
    [
      "projectApprovedEmail",
      (title) => projectApprovedEmail({ comment: null, title, url }),
    ],
    [
      "projectChangesRequestedEmail",
      (title) =>
        projectChangesRequestedEmail({
          comment: "Add objectives.",
          title,
          url,
        }),
    ],
    [
      "projectReturnedToDraftEmail",
      (title) => projectReturnedToDraftEmail({ comment: null, title, url }),
    ],
    [
      "projectCommentEmail",
      (title) => projectCommentEmail({ content: "Looks good.", title, url }),
    ],
    [
      "projectReassignedEmail",
      (title) => projectReassignedEmail({ title, url }),
    ],
    ["mentorNamedEmail", (title) => mentorNamedEmail({ title, url })],
    ["projectDeletedEmail", (title) => projectDeletedEmail({ title })],
  ];

  it.each(TITLED)(
    "%s keeps the title on one line in the subject and the body",
    (_name, render) => {
      for (const title of HOSTILE) {
        const email = render(title);
        expect(email.subject).not.toMatch(LINE_BREAK);
        expect(email.subject).toContain(`x ${FORGED}`);
        expect(email.text).toContain(`x ${FORGED}`);
        expect(forgedLines(email)).toEqual([]);
      }
    }
  );

  const NAMED: [string, (name: string) => RenderedEmail][] = [
    [
      "projectSubmittedEmail",
      (name) =>
        projectSubmittedEmail({
          description: null,
          proposerEmail: "alex@oregonstate.edu",
          proposerName: name,
          title: "T",
          url,
        }),
    ],
    [
      "proposerCommentEmail",
      (name) =>
        proposerCommentEmail({
          content: "Done.",
          proposerEmail: "alex@oregonstate.edu",
          proposerName: name,
          title: "T",
          url,
        }),
    ],
    [
      "inventoryRequestSubmittedEmail",
      (name) =>
        inventoryRequestSubmittedEmail({
          kind: "custom",
          lines: ["Arduino"],
          requesterEmail: "alex@oregonstate.edu",
          requesterName: name,
          url,
        }),
    ],
  ];

  it.each(NAMED)("%s keeps the account name on one line", (_name, render) => {
    for (const name of HOSTILE) {
      const email = render(name);
      expect(email.subject).not.toMatch(LINE_BREAK);
      expect(email.text).toContain(`x ${FORGED} (alex@oregonstate.edu)`);
      expect(forgedLines(email)).toEqual([]);
    }
  });

  it("falls back to the address when the account name is only whitespace", () => {
    const email = projectSubmittedEmail({
      description: null,
      proposerEmail: "alex@oregonstate.edu",
      proposerName: " \n ",
      title: "T",
      url,
    });
    expect(email.text).toMatch(
      /^alex@oregonstate\.edu submitted a project for review\./u
    );
  });

  it("names a whitespace-only requester by address in the request subject", () => {
    const email = inventoryRequestSubmittedEmail({
      kind: "cart",
      lines: ["Oscilloscope"],
      requesterEmail: "alex@oregonstate.edu",
      requesterName: "\n",
      url,
    });
    expect(email.subject).toBe("Borrow list submitted: alex@oregonstate.edu");
  });

  it("keeps a custom request line on its own line", () => {
    const email = inventoryRequestSubmittedEmail({
      kind: "custom",
      lines: [`Arduino\n\n${FORGED}`, "Breadboard"],
      requesterEmail: null,
      requesterName: "Alex",
      url,
    });
    expect(email.text).toContain(`- Arduino ${FORGED}\n- Breadboard`);
    expect(forgedLines(email)).toEqual([]);
  });

  it("keeps a bell title off a second subject line", () => {
    const email = notificationEmail({
      message: "Reserved.",
      title: "Reserved:\nOscilloscope",
      url,
    });
    expect(email.subject).toBe("Reserved: Oscilloscope");
  });

  // A comment and a description are prose, so their paragraphs stay.
  it("leaves the paragraphs of a comment and a description alone", () => {
    const comment = proposerCommentEmail({
      content: "First point.\n\nSecond point.",
      proposerEmail: null,
      proposerName: "Alex",
      title: "T",
      url,
    });
    expect(comment.text).toContain("First point.\n\nSecond point.");

    const submitted = projectSubmittedEmail({
      description: "First point.\n\nSecond point.",
      proposerEmail: null,
      proposerName: "Alex",
      title: "T",
      url,
    });
    expect(submitted.text).toContain("First point.\n\nSecond point.");
  });
});
