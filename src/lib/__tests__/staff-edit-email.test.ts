import { describe, expect, it } from "vitest";
import { PROJECT_STATUSES } from "#/lib/vocabularies";
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
});

describe("staffEditEmail", () => {
  const base = {
    editLogUrl: "https://app.test/projects/p-1#edit-log",
    proposer: { email: "pat@oregonstate.edu", name: "Pat" },
    title: "Fish ladder telemetry",
  };

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
      "Changed: Description, Licensing / IP / NDA Notes, Private Notes, Objectives. The edit log has the text"
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
