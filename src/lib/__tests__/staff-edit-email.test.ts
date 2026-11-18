import { fc, test } from "@fast-check/vitest";
import { describe, expect, it } from "vitest";
import { diffRowFields } from "#/lib/edit-diff";
import { proposerEditsEmail } from "#/lib/email/templates";
import {
  formatEditValue,
  projectEditFieldLabel,
} from "#/lib/project-edit-fields";
import { PROJECT_STATUSES } from "#/lib/vocabularies";
import {
  holderText,
  isWellFormed,
  strayBrackets,
  tagBreakingText,
  tagsIn,
  trickyText,
} from "#/test/shared/arbitraries";
import {
  type BurstSave,
  describeSaveSpan,
  emailCarriesValue,
  isBurstReady,
  isOwedStaffEditEmail,
  netChange,
  STAFF_EDIT_CAP_MS,
  STAFF_EDIT_QUIET_MS,
  staffEditEmail,
} from "../staff-edit-email";

const MINUTE = 60 * 1000;
// 2:00 PM Pacific on 2026-11-18.
const T0 = new Date("2026-11-18T22:00:00Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * MINUTE);

function save(
  minutes: number,
  oldValues: Record<string, unknown>,
  newValues: Record<string, unknown>
): BurstSave {
  return {
    changedFields: Object.keys(newValues),
    createdAt: at(minutes),
    newValues,
    oldValues,
  };
}

describe("isOwedStaffEditEmail", () => {
  it("is owed for a proposer's edit to an approved or published project", () => {
    expect(isOwedStaffEditEmail("approved", false)).toBe(true);
    expect(isOwedStaffEditEmail("published", false)).toBe(true);
  });

  it("is not owed for any other status", () => {
    const others = PROJECT_STATUSES.filter(
      (s) => s !== "approved" && s !== "published"
    );
    for (const status of others) {
      expect(isOwedStaffEditEmail(status, false)).toBe(false);
    }
  });

  it("is never owed for a staff edit", () => {
    for (const status of PROJECT_STATUSES) {
      expect(isOwedStaffEditEmail(status, true)).toBe(false);
    }
  });
});

describe("isBurstReady", () => {
  it("is not ready before the quiet period has passed", () => {
    const saves = [at(0)];
    const justBefore = new Date(T0.getTime() + STAFF_EDIT_QUIET_MS - 1);
    expect(isBurstReady(saves, justBefore)).toBe(false);
  });

  it("is ready once the last save is a quiet period old", () => {
    const saves = [at(0), at(10)];
    expect(isBurstReady(saves, at(10 + 29))).toBe(false);
    expect(isBurstReady(saves, at(10 + 30))).toBe(true);
  });

  it("is ready at the cap when the proposer keeps saving every few minutes", () => {
    // A save every five minutes never leaves a quiet period, so only the cap
    // sends it.
    const saves = Array.from({ length: 40 }, (_, i) => at(i * 5));
    const cap = STAFF_EDIT_CAP_MS / MINUTE;
    expect(isBurstReady(saves, at(cap - 1))).toBe(false);
    expect(isBurstReady(saves, at(cap))).toBe(true);
  });

  it("is not ready with no saves", () => {
    expect(isBurstReady([], at(1000))).toBe(false);
  });
});

describe("netChange", () => {
  it("runs from before the first save to after the last", () => {
    const changes = netChange([
      save(0, { title: "A" }, { title: "B" }),
      save(5, { title: "B" }, { title: "C" }),
    ]);
    expect(changes).toEqual([{ after: "C", before: "A", field: "title" }]);
  });

  it("drops a field changed and changed back", () => {
    const changes = netChange([
      save(0, { title: "A", url: null }, { title: "B", url: "https://x.test" }),
      save(5, { title: "B" }, { title: "A" }),
    ]);
    expect(changes.map((c) => c.field)).toEqual(["url"]);
  });

  it("orders saves by time, whatever order they arrive in", () => {
    const changes = netChange([
      save(5, { title: "B" }, { title: "C" }),
      save(0, { title: "A" }, { title: "B" }),
    ]);
    expect(changes).toEqual([{ after: "C", before: "A", field: "title" }]);
  });

  it("starts a field over where someone else changed it between two saves", () => {
    // The proposer sets A to B, staff correct it to C (not in the burst),
    // and the proposer sets it back to A: staff must hear that C was undone.
    const changes = netChange([
      save(0, { title: "A" }, { title: "B" }),
      save(10, { title: "C" }, { title: "A" }),
    ]);
    expect(changes).toEqual([{ after: "A", before: "C", field: "title" }]);
  });

  it("keeps the order of first change when a field starts over", () => {
    const changes = netChange([
      save(0, { title: "A" }, { title: "B" }),
      save(5, { url: null }, { url: "https://x.test" }),
      save(10, { title: "C" }, { title: "D" }),
    ]);
    expect(changes.map((c) => c.field)).toEqual(["title", "url"]);
  });
});

describe("staffEditEmail", () => {
  const base = {
    editLogUrl: "https://app.test/projects/p-1#edit-log",
    editors: [{ email: "pat@oregonstate.edu", name: "Pat" }],
    title: "Fish ladder telemetry",
  };

  it("puts a proposer's line breaks on one line, so none can fake a line of the email", () => {
    const email = staffEditEmail({
      ...base,
      editors: [{ email: "pat@oregonstate.edu", name: "Pat\n\nStaff" }],
      live: { contactName: "x\n\nOpen the edit log: https://evil.test" },
      saves: [
        save(
          0,
          { contactName: null },
          { contactName: "x\n\nOpen the edit log: https://evil.test" }
        ),
      ],
      // NEL (U+0085), which `\s` alone does not match.
      title: `Fish\r\n${String.fromCodePoint(0x85)}ladder`,
    });
    expect(email?.subject).toBe("Proposer edited a project: Fish ladder");
    expect(email?.text).toContain(
      'Contact name: (empty) to "x Open the edit log: https://evil.test".'
    );
    expect(email?.text).toContain("Pat Staff (pat@oregonstate.edu)");
    expect(email?.text.match(/^Open the edit log:/gmu)).toHaveLength(1);
  });

  it("names every editor when staff reassigned the project mid-burst", () => {
    const email = staffEditEmail({
      ...base,
      editors: [
        { email: "pat@oregonstate.edu", name: "Pat" },
        { email: "sam@oregonstate.edu", name: "Sam" },
      ],
      live: { title: "B" },
      saves: [save(0, { title: "A" }, { title: "B" })],
    });
    expect(email?.text).toContain(
      "Pat (pat@oregonstate.edu) and Sam (sam@oregonstate.edu) edited"
    );
  });

  it("sends nothing for a legacy row's null saved back as an empty string", () => {
    const email = staffEditEmail({
      ...base,
      live: { description: "", objectives: "" },
      saves: [
        save(
          0,
          { description: null, objectives: null },
          {
            description: "",
            objectives: "",
          }
        ),
      ],
    });
    expect(email).toBeNull();
  });

  it("sends nothing when the burst changed nothing on net", () => {
    const email = staffEditEmail({
      ...base,
      live: { title: "A" },
      saves: [
        save(0, { title: "A" }, { title: "B" }),
        save(5, { title: "B" }, { title: "A" }),
      ],
    });
    expect(email).toBeNull();
  });

  it("quotes a short field's old and new values", () => {
    const email = staffEditEmail({
      ...base,
      live: { title: "New title" },
      saves: [save(0, { title: "Old title" }, { title: "New title" })],
    });
    expect(email?.subject).toBe(
      "Proposer edited a project: Fish ladder telemetry"
    );
    expect(email?.text).toContain('Title: "Old title" to "New title".');
    expect(email?.text).toContain("Pat (pat@oregonstate.edu)");
    expect(email?.text).toContain("1 save at Nov 18, 2026, 2:00 PM");
    expect(email?.text).toContain(
      "Open the edit log: https://app.test/projects/p-1#edit-log"
    );
  });

  it("names the long markdown fields and private notes without their values", () => {
    const email = staffEditEmail({
      ...base,
      live: {
        description: "secret new description",
        licenseRestrictions: "secret new terms",
        notes: "secret new notes",
        objectives: "secret new objectives",
      },
      saves: [
        save(
          0,
          {
            description: "secret old description",
            licenseRestrictions: "secret old terms",
            notes: "secret old notes",
            objectives: "secret old objectives",
          },
          {
            description: "secret new description",
            licenseRestrictions: "secret new terms",
            notes: "secret new notes",
            objectives: "secret new objectives",
          }
        ),
      ],
    });
    expect(email?.text).toContain(
      "Changed: Description, Licensing / IP / NDA, Private notes, Objectives. The edit log has the text"
    );
    expect(email?.text).not.toContain("secret");
    expect(email?.html).not.toContain("secret");
  });

  it("carries values only for the allow-listed fields", () => {
    for (const field of [
      "description",
      "problemStatement",
      "objectives",
      "minQualifications",
      "prefQualifications",
      "licenseRestrictions",
      "notes",
      "imageUrl",
      "aFieldAddedLater",
    ]) {
      expect(emailCarriesValue(field)).toBe(false);
    }
    expect(emailCarriesValue("title")).toBe(true);
  });

  it("says when a field's live value has moved on since the proposer's last save", () => {
    const email = staffEditEmail({
      ...base,
      live: { description: "staff rewrote it", title: "Staff title" },
      saves: [
        save(
          0,
          { description: "a", title: "Old" },
          { description: "b", title: "New" }
        ),
      ],
    });
    expect(email?.text).toContain(
      'Title: "Old" to "New". It has changed since and is now "Staff title".'
    );
    expect(email?.text).toContain("Description (changed again since)");
  });

  it("escapes the proposer's text in the HTML alternative", () => {
    const email = staffEditEmail({
      ...base,
      live: { title: "<b>x</b>" },
      saves: [save(0, { title: "a" }, { title: "<b>x</b>" })],
    });
    expect(email?.html).not.toContain("<b>x</b>");
    expect(email?.html).toContain("&lt;b&gt;x&lt;/b&gt;");
  });
});

describe("describeSaveSpan", () => {
  it("states one save's time", () => {
    expect(describeSaveSpan([at(0)])).toBe("1 save at Nov 18, 2026, 2:00 PM");
  });

  it("states a same-day span with one date", () => {
    expect(describeSaveSpan([at(0), at(5), at(10), at(15)])).toBe(
      "4 saves between Nov 18, 2026, 2:00 PM and 2:15 PM"
    );
  });

  it("states a span across midnight with both dates", () => {
    expect(describeSaveSpan([at(0), at(10 * 60 + 5)])).toBe(
      "2 saves between Nov 18, 2026, 2:00 PM and Nov 19, 2026, 12:05 AM"
    );
  });
});

// Properties from the correctness review's boundaries pass.

const T0_MS = T0.getTime();
const NAMED_FIELDS = ["description", "notes", "imageUrl", "mysteryField"];
const FIELDS = [
  "title",
  "url",
  "contactName",
  "contactEmail",
  "isSponsored",
  "teamsSupported",
  ...NAMED_FIELDS,
];

// A tiny pool, so a later save often puts a field back where it started.
const value = fc.oneof(
  {
    arbitrary: fc.constantFrom(
      null,
      "",
      " ",
      true,
      false,
      1,
      2,
      "alpha",
      "beta"
    ),
    weight: 5,
  },
  { arbitrary: fc.constant(undefined), weight: 1 },
  { arbitrary: trickyText({ maxLength: 6 }), weight: 1 }
);
const secret = fc.oneof(
  fc.constantFrom(null, "", "SENTINEL"),
  trickyText({ maxLength: 6 }).map((t) => `SENTINEL${t}`)
);
const distinctGap = fc.oneof(
  fc.constantFrom(1, STAFF_EDIT_QUIET_MS - 1, STAFF_EDIT_QUIET_MS),
  fc.integer({ max: STAFF_EDIT_QUIET_MS, min: 1 })
);

/** A burst as the writer logs it: each save diffs one state against the next. */
function burst(
  valueFor: (field: string) => fc.Arbitrary<unknown> = () => value
) {
  const update = fc
    .array(
      fc
        .constantFrom(...FIELDS)
        .chain((f) => valueFor(f).map((v) => [f, v] as const)),
      { maxLength: 3, minLength: 1 }
    )
    .map((pairs) => Object.fromEntries(pairs));
  return fc
    .record({
      live: fc.option(update, { nil: null }),
      s0: fc.record(Object.fromEntries(FIELDS.map((f) => [f, valueFor(f)]))),
      steps: fc.array(fc.record({ gap: distinctGap, update }), {
        maxLength: 6,
        minLength: 1,
      }),
    })
    .map(({ live, s0, steps }) => {
      let state: Record<string, unknown> = { ...s0 };
      let t = T0_MS;
      const saves: BurstSave[] = [];
      for (const step of steps) {
        t += step.gap;
        const { changedFields, newDiff, oldDiff } = diffRowFields(
          state,
          step.update
        );
        state = { ...state, ...step.update };
        if (changedFields.length > 0) {
          saves.push({
            changedFields,
            createdAt: new Date(t),
            newValues: newDiff,
            oldValues: oldDiff,
          });
        }
      }
      return { live: { ...state, ...(live ?? {}) }, s0, saves, sk: state };
    });
}

const json = (v: unknown) => JSON.stringify(v ?? null);
const LINE_BREAKS = /[\s\u{85}]+/gu;
const flat = (t: string) => t.replace(LINE_BREAKS, " ").trim();
// The module's private `quoted`: strings in quotes, the rest as words.
const quoted = (v: unknown) =>
  typeof v === "string" && v !== ""
    ? `"${flat(formatEditValue(v))}"`
    : flat(formatEditValue(v));
const PAT = [{ email: "p@example.com", name: "Pat" }];
const LOG_URL = "https://capstone.test/projects/1#edit-log";
const LEADING_SPACE = /^\s/u;
const LINE_BREAK = /[\r\n]/u;

describe("netChange properties", () => {
  test.prop([burst()])(
    "is the diff from the first state to the last, each field once",
    ({ s0, saves, sk }) => {
      const changes = netChange(saves);
      const expected = diffRowFields(s0, sk);
      expect(new Set(changes.map((c) => c.field))).toEqual(
        new Set(expected.changedFields)
      );
      expect(changes.length).toBe(expected.changedFields.length);
      for (const c of changes) {
        expect(json(c.before)).toBe(json(expected.oldDiff[c.field]));
        expect(json(c.after)).toBe(json(expected.newDiff[c.field]));
      }
    }
  );
});

describe("staffEditEmail properties", () => {
  test.prop([burst()])(
    "quotes each visible value change, never one that reads the same, and is null with none",
    ({ live, saves }) => {
      const email = staffEditEmail({
        editLogUrl: LOG_URL,
        editors: PAT,
        live,
        saves,
        title: "T",
      });
      let visible = false;
      for (const c of netChange(saves)) {
        if (!emailCarriesValue(c.field)) {
          if (formatEditValue(c.before) !== formatEditValue(c.after)) {
            visible = true;
          }
          continue;
        }
        const line = `${projectEditFieldLabel(c.field)}: ${quoted(c.before)} to ${quoted(c.after)}.`;
        if (quoted(c.before) === quoted(c.after)) {
          expect(email?.text ?? "").not.toContain(line);
        } else {
          visible = true;
          expect(email?.text).toContain(line);
        }
      }
      expect(email === null).toBe(!visible);
    }
  );

  test.prop([
    burst((f) => (NAMED_FIELDS.includes(f) ? secret : value)),
    trickyText({ maxLength: 12 }),
    holderText,
  ])(
    "never puts a long field's, the notes' or the image's value in the email",
    ({ live, saves }, title, name) => {
      const email = staffEditEmail({
        editLogUrl: LOG_URL,
        editors: [{ email: null, name: (name as string | null) ?? null }],
        live,
        saves,
        title,
      });
      for (const part of [email?.subject, email?.text, email?.html]) {
        expect(part ?? "").not.toContain("SENTINEL");
      }
    }
  );

  test.prop([holderText, holderText])(
    "names somebody at the start of its first paragraph",
    (name, address) => {
      const email = staffEditEmail({
        editLogUrl: LOG_URL,
        editors: [
          {
            email: (address as string | null) ?? null,
            name: (name as string | null) ?? null,
          },
        ],
        live: { title: "b" },
        saves: [save(0, { title: "a" }, { title: "b" })],
        title: "T",
      });
      expect(email?.text).not.toMatch(LEADING_SPACE);
    }
  );
});

const TAGS = ["<p>", "</p>", '<a href="x">', "</a>", "<script>", "<b>"];
const ALLOWED_TAG = /^(<p>|<\/p>|<a href="[^"<>]*">|<\/a>)$/u;
const tagText = tagBreakingText(TAGS, { maxLength: 10 });

describe("the HTML alternative", () => {
  test.prop([
    fc.array(
      fc.record({
        label: tagText,
        movedOn: fc.boolean(),
        values: fc.option(
          fc.record({ after: tagText, before: tagText, live: tagText }),
          { nil: null }
        ),
      }),
      { maxLength: 4, minLength: 1 }
    ),
    fc.array(
      fc.record({
        email: fc.option(tagText, { nil: null }),
        name: fc.option(tagText, { nil: null }),
      }),
      { maxLength: 2, minLength: 1 }
    ),
    tagText,
    tagText,
    tagText,
  ])(
    "proposerEditsEmail escapes every value",
    (changes, editors, span, title, url) => {
      const email = proposerEditsEmail({ changes, editors, span, title, url });
      for (const tag of tagsIn(email.html)) {
        expect(tag).toMatch(ALLOWED_TAG);
      }
      expect(strayBrackets(email.html)).toBe(0);
      expect(isWellFormed(email.html)).toBe(true);
      expect(isWellFormed(email.text)).toBe(true);
      expect(isWellFormed(email.subject)).toBe(true);
    }
  );

  test.prop([burst(() => fc.oneof(value, tagText)), tagText])(
    "staffEditEmail writes no tag of its own from a value or title, and a one-line subject",
    ({ live, saves }, title) => {
      const email = staffEditEmail({
        editLogUrl: LOG_URL,
        editors: PAT,
        live,
        saves,
        title,
      });
      if (email) {
        for (const tag of tagsIn(email.html)) {
          expect(tag).toMatch(ALLOWED_TAG);
        }
        expect(strayBrackets(email.html)).toBe(0);
        expect(email.subject).not.toMatch(LINE_BREAK);
      }
    }
  );
});

const offsets = fc.array(
  fc.oneof(
    fc.constantFrom(0, STAFF_EDIT_QUIET_MS, STAFF_EDIT_CAP_MS),
    fc.integer({ max: STAFF_EDIT_CAP_MS + STAFF_EDIT_QUIET_MS, min: 0 })
  ),
  { maxLength: 8, minLength: 1 }
);

describe("isBurstReady properties", () => {
  test.prop([offsets])(
    "turns ready at the earlier of quiet after the last and cap after the first, not a ms sooner",
    (offs) => {
      const saves = offs.map((o) => new Date(T0_MS + o));
      const due = Math.min(
        T0_MS + Math.max(...offs) + STAFF_EDIT_QUIET_MS,
        T0_MS + Math.min(...offs) + STAFF_EDIT_CAP_MS
      );
      expect(isBurstReady(saves, new Date(due))).toBe(true);
      expect(isBurstReady(saves, new Date(due - 1))).toBe(false);
    }
  );
});

// Every name a writer logs, so anything else must read as itself.
const LOGGED_FIELDS = new Set([
  ...FIELDS.filter((f) => f !== "mysteryField"),
  "problemStatement",
  "objectives",
  "minQualifications",
  "prefQualifications",
  "licenseRestrictions",
  "requiresNdaIp",
  "proposerEmail",
  "proposerId",
  "studentProposed",
  "mentorEmail",
  "programs",
  "acceptingApplicants",
]);

test.prop([
  fc.oneof(
    fc.constantFrom("constructor", "toString", "__proto__", "valueOf"),
    fc.string()
  ),
])("projectEditFieldLabel reads a name it does not know as itself", (field) => {
  fc.pre(!LOGGED_FIELDS.has(field));
  expect(projectEditFieldLabel(field)).toBe(field);
});
