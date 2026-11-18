import { fc, test } from "@fast-check/vitest";
import { describe, expect, it } from "vitest";
import {
  isWellFormed,
  trickyText,
  trickyTextAcross,
} from "#/test/shared/arbitraries";
import {
  accountSuspendedEmail,
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
  proposerEditsEmail,
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

// Unicode's mandatory line breaks, U+0085 (next line) among them, which `\s`
// leaves out; the split also takes CRLF as one break.
const BREAK_CHARS = "\n\v\f\r\u{85}\u{2028}\u{2029}";
const LINE_BREAK = new RegExp(`[${BREAK_CHARS}]`, "u");
const LINE_SPLIT = new RegExp(`\r\n|[${BREAK_CHARS}]`, "u");

describe("oneLine", () => {
  it("collapses every run of whitespace to one space and trims the ends", () => {
    expect(
      oneLine("  Robot\r\n\r\narm\u{2028}\tfor\u{a0} the\u{85}lab \n")
    ).toBe("Robot arm for the lab");
  });
});

// Why a title or a name must stay on one line: see `oneLine`.
describe("a title or a name on one line", () => {
  const FORGED = "Review the project: https://evil.example";
  const HOSTILE = [
    `x\n\n${FORGED}`,
    `x\r\n\r\n${FORGED}`,
    `x\u{2028}${FORGED}`,
    `x\u{85}${FORGED}`,
  ];
  const url = "https://app/projects/p1";

  /** The lines of the text part that open with the forged call to action. */
  function forgedLines(email: RenderedEmail): string[] {
    return email.text
      .split(LINE_SPLIT)
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

  it("keeps a custom line's name on its own line", () => {
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

  // A comment and a description are prose, so their paragraphs stay, quoted.
  it("keeps the paragraphs of a comment and a description, every line quoted", () => {
    const comment = proposerCommentEmail({
      content: "First point.\n\nSecond point.",
      proposerEmail: null,
      proposerName: "Alex",
      title: "T",
      url,
    });
    expect(comment.text).toContain("> First point.\n>\n> Second point.");

    const submitted = projectSubmittedEmail({
      description: "First point.\n\nSecond point.",
      proposerEmail: null,
      proposerName: "Alex",
      title: "T",
      url,
    });
    expect(submitted.text).toContain("> First point.\n>\n> Second point.");
  });
});

// Why a person's prose is quoted: see `Quote` in the templates.
describe("a person's prose, quoted", () => {
  const FORGED = "Review the project: https://evil.example";
  const url = "https://app/projects/p1";

  it("renders a comment email with its link above the quoted comment", () => {
    const email = proposerCommentEmail({
      content: "First point.\n\nSecond point.",
      proposerEmail: null,
      proposerName: "Alex",
      title: "T",
      url,
    });
    expect(email.text).toBe(
      'Alex commented on "T".\n\nRead and reply: https://app/projects/p1\n\nComment:\n> First point.\n>\n> Second point.\n'
    );
    expect(email.html).toBe(
      '<p>Alex commented on &quot;T&quot;.</p><p><a href="https://app/projects/p1">Read and reply</a></p><p>Comment:</p><blockquote><p>First point.</p><p>Second point.</p></blockquote>'
    );
  });

  it("leaves an email that quotes nobody exactly as it was", () => {
    const email = projectReassignedEmail({ title: "Robot arm", url });
    expect(email.text).toBe(
      'Staff made you the proposer of "Robot arm".\n\nYou can edit it, follow its review, and reply to staff comments from the project page.\n\nView the project: https://app/projects/p1\n'
    );
    expect(email.html).toBe(
      '<p>Staff made you the proposer of &quot;Robot arm&quot;.</p><p>You can edit it, follow its review, and reply to staff comments from the project page.</p><p><a href="https://app/projects/p1">View the project</a></p>'
    );
  });

  it("keeps the truncation note outside the quote", () => {
    const email = projectSubmittedEmail({
      description: "z".repeat(900),
      proposerEmail: null,
      proposerName: "Alex",
      title: "T",
      url,
    });
    expect(email.text).toContain(
      `> ${"z".repeat(600)}...\n\nOpen the project to read the full proposal.\n`
    );
  });

  it.each(PROSED)(
    "%s quotes a forged call to action instead of letting it pass for its own",
    (_name, render) => {
      for (const prose of [
        `x\n\n${FORGED}`,
        `x\r${FORGED}`,
        `x\u{2028}${FORGED}`,
        `x\u{85}${FORGED}`,
      ]) {
        const lines = render(prose).text.split(LINE_SPLIT);
        expect(lines.filter((line) => line.includes(FORGED))).toEqual([
          `> ${FORGED}`,
        ]);
      }
    }
  );
});

/** Every template that carries a person's prose, rendered around `prose`. */
const PROSED: [string, (prose: string) => RenderedEmail, string | null][] = [
  [
    "projectSubmittedEmail",
    (prose) =>
      projectSubmittedEmail({
        description: prose,
        proposerEmail: null,
        proposerName: "Alex",
        title: "T",
        url: "https://app/projects/p1",
      }),
    "Review the project",
  ],
  [
    "proposerCommentEmail",
    (prose) =>
      proposerCommentEmail({
        content: prose,
        proposerEmail: null,
        proposerName: "Alex",
        title: "T",
        url: "https://app/projects/p1",
      }),
    "Read and reply",
  ],
  [
    "projectCommentEmail",
    (prose) =>
      projectCommentEmail({
        content: prose,
        title: "T",
        url: "https://app/projects/p1",
      }),
    "Read and reply",
  ],
  [
    "projectApprovedEmail",
    (prose) =>
      projectApprovedEmail({
        comment: prose,
        title: "T",
        url: "https://app/projects/p1",
      }),
    "View your project",
  ],
  [
    "projectReturnedToDraftEmail",
    (prose) =>
      projectReturnedToDraftEmail({
        comment: prose,
        title: "T",
        url: "https://app/projects/p1",
      }),
    "Revise your project",
  ],
  [
    "projectChangesRequestedEmail",
    (prose) =>
      projectChangesRequestedEmail({
        comment: prose,
        title: "T",
        url: "https://app/projects/p1",
      }),
    "Revise your project",
  ],
  [
    "accountSuspendedEmail",
    (prose) => accountSuspendedEmail({ expiresAt: null, reason: prose }),
    null,
  ],
];

/** A title, a name or a custom line's name, weighted to line breaks. */
const hostileText = fc.oneof(
  {
    arbitrary: fc.string({
      maxLength: 24,
      unit: fc.oneof(
        { arbitrary: fc.constantFrom("\r\n", ...BREAK_CHARS), weight: 3 },
        {
          arbitrary: fc.constantFrom(" ", "\t", "\u{a0}", "\u{feff}"),
          weight: 2,
        },
        { arbitrary: fc.constantFrom("\u{1f600}", "\u{1d400}"), weight: 2 },
        {
          arbitrary: fc.constantFrom(
            "a",
            "Review the project: https://x.example"
          ),
          weight: 3,
        }
      ),
    }),
    weight: 5,
  },
  { arbitrary: trickyText({ maxLength: 24 }), weight: 2 },
  { arbitrary: fc.constant(""), weight: 1 },
  // The server caps a title at 200 code units.
  { arbitrary: trickyTextAcross(200), weight: 1 }
);

/** Raw code units as well, every BMP character and lone surrogates among them. */
const anyText = fc.oneof(
  hostileText,
  fc.string({
    maxLength: 30,
    unit: fc.oneof(
      fc.nat(0xff_ff).map((code) => String.fromCharCode(code)),
      fc.constantFrom(...BREAK_CHARS, "\u{d83d}", "\u{de00}", " ")
    ),
  })
);

/** One or more of the characters `oneLine` must collapse. */
const whitespaceRun = fc.string({
  maxLength: 6,
  minLength: 1,
  unit: fc.constantFrom(
    "\r\n",
    ...BREAK_CHARS,
    " ",
    "\t",
    "\u{a0}",
    "\u{feff}"
  ),
});

const NOT_A_SPACE = /[\s\u{85}]/gu;

describe("oneLine, on generated text", () => {
  test.prop([whitespaceRun])(
    "turns a run of whitespace between two words into one space",
    (run) => {
      expect(oneLine(`a${run}b`)).toBe("a b");
    }
  );

  test.prop([anyText])("leaves no whitespace but a plain space", (text) => {
    expect(oneLine(text)).not.toMatch(/[^\S ]|\u{85}/u);
  });

  test.prop([anyText])(
    "leaves no space at either end and no run of two",
    (text) => {
      expect(oneLine(text)).not.toMatch(/^ | $| {2}/u);
    }
  );

  test.prop([anyText])("is idempotent", (text) => {
    expect(oneLine(oneLine(text))).toBe(oneLine(text));
  });

  test.prop([anyText])("keeps every other character, in order", (text) => {
    expect(oneLine(text).replace(NOT_A_SPACE, "")).toBe(
      text.replace(NOT_A_SPACE, "")
    );
  });

  // `hostileText` is well-formed by construction, astral characters included.
  test.prop([hostileText])("keeps well-formed text well-formed", (text) => {
    expect(isWellFormed(oneLine(text))).toBe(true);
  });
});

interface Fields {
  email: string | null;
  line: string;
  name: string | null;
  title: string;
}

const fields = fc.record({
  email: fc.oneof(fc.constant(null), fc.emailAddress(), hostileText),
  line: hostileText,
  name: fc.oneof(fc.constant(null), hostileText),
  title: hostileText,
});

const propertyUrl = "https://app/projects/p1";

/** Every template whose text quotes a title, a name or a custom line's name. */
const QUOTING: [string, (f: Fields) => RenderedEmail][] = [
  [
    "projectSubmittedEmail",
    (f) =>
      projectSubmittedEmail({
        description: "A robot arm.",
        proposerEmail: f.email,
        proposerName: f.name,
        title: f.title,
        url: propertyUrl,
      }),
  ],
  [
    "proposerCommentEmail",
    (f) =>
      proposerCommentEmail({
        content: "A comment.",
        proposerEmail: f.email,
        proposerName: f.name,
        title: f.title,
        url: propertyUrl,
      }),
  ],
  [
    "inventoryRequestSubmittedEmail",
    (f) =>
      inventoryRequestSubmittedEmail({
        kind: "custom",
        lines: [f.line, "Arduino"],
        requesterEmail: f.email,
        requesterName: f.name,
        url: propertyUrl,
      }),
  ],
  [
    "projectApprovedEmail",
    (f) =>
      projectApprovedEmail({
        comment: "Nice.",
        title: f.title,
        url: propertyUrl,
      }),
  ],
  [
    "projectChangesRequestedEmail",
    (f) =>
      projectChangesRequestedEmail({
        comment: "Fix it.",
        title: f.title,
        url: propertyUrl,
      }),
  ],
  [
    "projectReturnedToDraftEmail",
    (f) =>
      projectReturnedToDraftEmail({
        comment: "Fix it.",
        title: f.title,
        url: propertyUrl,
      }),
  ],
  [
    "projectCommentEmail",
    (f) =>
      projectCommentEmail({
        content: "A comment.",
        title: f.title,
        url: propertyUrl,
      }),
  ],
  [
    "projectReassignedEmail",
    (f) => projectReassignedEmail({ title: f.title, url: propertyUrl }),
  ],
  [
    "mentorNamedEmail",
    (f) => mentorNamedEmail({ title: f.title, url: propertyUrl }),
  ],
  ["projectDeletedEmail", (f) => projectDeletedEmail({ title: f.title })],
  [
    "proposerEditsEmail",
    (f) =>
      proposerEditsEmail({
        changes: [
          {
            label: "Title",
            movedOn: false,
            values: { after: '"B"', before: '"A"', live: '"B"' },
          },
        ],
        editors: [{ email: f.email, name: f.name }],
        span: "1 save at Nov 18, 2026, 2:00 PM",
        title: f.title,
        url: propertyUrl,
      }),
  ],
];

/** The bell title reaches only the subject, so it is checked there alone. */
const SUBJECTED: [string, (f: Fields) => RenderedEmail][] = [
  ...QUOTING,
  [
    "notificationEmail",
    (f) =>
      notificationEmail({
        message: "One.\n\nTwo.",
        title: f.title,
        url: propertyUrl,
      }),
  ],
];

const ALL_BREAKS = new RegExp(LINE_SPLIT.source, "gu");
const flatten = (text: string) => text.replace(ALL_BREAKS, " ");
const lineCount = (text: string) => text.split(LINE_SPLIT).length;

describe.each(SUBJECTED)(
  "the %s subject, on generated fields",
  (_name, render) => {
    test.prop([fields])("has no line break", (f) => {
      expect(render(f).subject).not.toMatch(LINE_BREAK);
    });
  }
);

describe.each(QUOTING)("the %s text, on generated fields", (_name, render) => {
  // A field cannot add a line: the text part has as many lines as the same
  // email with every break in the fields turned into a space.
  test.prop([fields])(
    "has as many lines as the same email with break-free fields",
    (f) => {
      const flat: Fields = {
        email: f.email === null ? null : flatten(f.email),
        line: flatten(f.line),
        name: f.name === null ? null : flatten(f.name),
        title: flatten(f.title),
      };
      expect(lineCount(render(f).text)).toBe(lineCount(render(flat).text));
    }
  );
});

/**
 * A person's prose, weighted to line breaks and to a forged call to action.
 * It opens with a letter, so trimming never leaves it blank.
 */
const hostileProse = fc
  .oneof(
    {
      arbitrary: fc.string({
        maxLength: 40,
        unit: fc.oneof(
          { arbitrary: fc.constantFrom("\r\n", ...BREAK_CHARS), weight: 3 },
          { arbitrary: fc.constantFrom(" ", "\t", ">", "a"), weight: 2 },
          { arbitrary: fc.constant("\u{1f600}"), weight: 1 },
          {
            arbitrary: fc.constant("Review the project: https://x.example"),
            weight: 2,
          }
        ),
      }),
      weight: 5,
    },
    // A description and a comment are cut at 600 code units.
    { arbitrary: trickyTextAcross(600), weight: 1 }
  )
  .map((text) => `a${text}`);

const BREAKS_EACH = new RegExp(`[${BREAK_CHARS}]`, "gu");
const QUOTE_BLOCK = /<blockquote>[\s\S]*?<\/blockquote>/gu;

/** The text part's lines that are not quoted. */
const unquoted = (email: RenderedEmail) =>
  email.text.split(LINE_SPLIT).filter((line) => !line.startsWith(">"));

describe.each(PROSED)(
  "the %s prose, on generated text",
  (_name, render, ctaLabel) => {
    // The same prose with every break a letter: as long, so cut at the same
    // place, but on one line.
    const tame = (prose: string) => prose.trim().replace(BREAKS_EACH, "x");

    test.prop([hostileProse])(
      "adds no line of its own outside the quote",
      (prose) => {
        expect(unquoted(render(prose))).toEqual(unquoted(render(tame(prose))));
      }
    );

    test.prop([hostileProse])(
      "stays inside the blockquote in the html part",
      (prose) => {
        expect(render(prose).html.replace(QUOTE_BLOCK, "")).toBe(
          render(tame(prose)).html.replace(QUOTE_BLOCK, "")
        );
      }
    );

    if (ctaLabel) {
      test.prop([hostileProse])("comes after the email's own link", (prose) => {
        const lines = render(prose).text.split(LINE_SPLIT);
        const link = lines.findIndex((l) => l.startsWith(`${ctaLabel}: `));
        const quote = lines.findIndex((l) => l.startsWith(">"));
        expect(link).toBeGreaterThan(-1);
        expect(link).toBeLessThan(quote);
      });
    }
  }
);
