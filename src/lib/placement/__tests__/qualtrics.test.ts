import Papa from "papaparse";
import { describe, expect, it } from "vitest";
import { parseBidsCsv } from "#/lib/placement/csv";
import { convertQualtrics, isQualtricsExport } from "#/lib/placement/qualtrics";

// An invented export in the shape Qualtrics writes: three header rows (short
// ids, question text, ImportId JSON), then one row per response. The titles
// carry the traps a real survey has: a " - " inside a title, a comma, and a
// trailing colon. No real response is here (#656).

const TITLES = [
  "Tide Clock - Version 2",
  "Garden Planner, 2026-27",
  "Robot Arm:",
  "Weather Buoy",
];
const PROJECTS = [
  { key: "p1", title: "Tide Clock - Version 2" },
  { key: "p2", title: "Garden Planner, 2026-27" },
  { key: "p3", title: "Robot Arm" },
  { key: "p4", title: "Weather Buoy" },
  { key: "p5", title: "Lantern Map" },
];

const META = [
  ["Status", "Response Type", "status"],
  ["Finished", "Finished", "finished"],
  ["RecordedDate", "Recorded Date", "recordedDate"],
  ["RecipientLastName", "Recipient Last Name", "recipientLastName"],
  ["RecipientFirstName", "Recipient First Name", "recipientFirstName"],
  ["RecipientEmail", "Recipient Email", "recipientEmail"],
  ["Q1", "Have you been pre-assigned a project?", "QID43"],
  ["Q2a", "What is the name of your project?", "QID44_TEXT"],
];
const RANKS = TITLES.map((title, i) => [
  ` _${i}`,
  `Rank your top 6 choices. - ${title}`,
  `QID30_${i + 1}`,
]);
const REASONS = [1, 2, 3, 4].map((n) => [
  "",
  `Tell us why you chose each project. - reason for choice ${n}`,
  `QID3_${n}`,
]);
const TAIL = [
  [
    "",
    "List the name of one person you'd prefer not to work with (Optional).",
    "QID9_TEXT",
  ],
  ["", "Is there anything else you'd like to share?", "QID36_TEXT"],
];
const COLUMNS = [...META, ...RANKS, ...REASONS, ...TAIL];

interface Response {
  anythingElse?: string;
  avoid?: string;
  email: string;
  finished?: string;
  first: string;
  last: string;
  preAssigned?: string;
  preAssignedProject?: string;
  ranks: (number | "")[];
  reasons?: string[];
  recorded: string;
  status?: string;
}

function exportOf(responses: Response[]): string {
  const cells = (r: Response) => [
    r.status ?? "IP Address",
    r.finished ?? "True",
    r.recorded,
    r.last,
    r.first,
    r.email,
    r.preAssigned ?? "No",
    r.preAssignedProject ?? "",
    ...r.ranks.map(String),
    ...[0, 1, 2, 3].map((i) => r.reasons?.[i] ?? ""),
    r.avoid ?? "",
    r.anythingElse ?? "",
  ];
  // Papa rather than the app's toCsv: Qualtrics adds no formula guard, and
  // the fixture has to be what Qualtrics writes.
  return Papa.unparse([
    COLUMNS.map((c) => c[0]),
    COLUMNS.map((c) => c[1]),
    COLUMNS.map((c) => JSON.stringify({ ImportId: c[2] })),
    ...responses.map(cells),
  ]);
}

const ADA: Response = {
  email: "Ada@Example.edu",
  first: "Ada",
  last: "Park",
  recorded: "2026-09-28 10:00:00",
  ranks: [2, 1, "", 3],
  reasons: ["Gardens, and data.", "Tides:\nI built a gauge.", "Sensors."],
  avoid: "Sam from lab",
  anythingElse: "Not surfaced.",
};

describe("isQualtricsExport", () => {
  it("recognizes the ImportId row and nothing else", () => {
    expect(isQualtricsExport(exportOf([ADA]))).toBe(true);
    expect(
      isQualtricsExport("email,priority,project\na@b.c,1,Tide Clock")
    ).toBe(false);
    expect(isQualtricsExport("")).toBe(false);
  });
});

describe("convertQualtrics", () => {
  it("turns ranks into bids and attaches each reason to the project of that rank", () => {
    const { csv, issues } = convertQualtrics(exportOf([ADA]), PROJECTS);
    expect(issues).toEqual([]);
    const { students, issues: parseIssues } = parseBidsCsv(csv, PROJECTS);
    expect(parseIssues).toEqual([]);
    expect(students).toEqual([
      {
        email: "ada@example.edu",
        name: "Ada Park",
        avoid: "Sam from lab",
        bids: [
          {
            projectKey: "p1",
            priority: 2,
            comment: "Tides:\nI built a gauge.",
          },
          { projectKey: "p2", priority: 1, comment: "Gardens, and data." },
          { projectKey: "p4", priority: 3, comment: "Sensors." },
        ],
      },
    ]);
  });

  it("matches a survey title with a trailing colon to the project without one", () => {
    const { csv } = convertQualtrics(
      exportOf([{ ...ADA, ranks: ["", "", 1, ""] }]),
      PROJECTS
    );
    expect(parseBidsCsv(csv, PROJECTS).students[0].bids[0].projectKey).toBe(
      "p3"
    );
  });

  it("skips previews, keeps unfinished responses with a warning, and keeps the latest resubmission", () => {
    const { csv, issues } = convertQualtrics(
      exportOf([
        { ...ADA, status: "Survey Preview", email: "preview@example.edu" },
        { ...ADA, email: "ben@example.edu", first: "Ben", finished: "False" },
        { ...ADA, recorded: "2026-09-28 09:00:00", ranks: [1, "", "", ""] },
        ADA,
      ]),
      PROJECTS
    );
    expect(issues.map((i) => [i.row, i.level])).toEqual([
      [4, "warning"],
      [5, "warning"],
      [6, "warning"],
    ]);
    const { students } = parseBidsCsv(csv, PROJECTS);
    expect(students.map((s) => s.email)).toEqual([
      "ben@example.edu",
      "ada@example.edu",
    ]);
    expect(students[1].bids).toHaveLength(3);
  });

  it("reports a response with no email as an error", () => {
    const { issues } = convertQualtrics(
      exportOf([{ ...ADA, email: "" }]),
      PROJECTS
    );
    expect(issues).toEqual([
      {
        level: "error",
        row: 4,
        message: "The response has no recipient email.",
      },
    ]);
  });

  it("pins a pre-assigned student to the project they name", () => {
    const pinned = (r: Partial<Response>) =>
      parseBidsCsv(
        convertQualtrics(
          exportOf([{ ...ADA, preAssigned: "Yes", ...r }]),
          PROJECTS
        ).csv,
        PROJECTS
      ).students[0];
    expect(pinned({ preAssignedProject: "lantern map" }).pin).toBe("p5");
    // A project they also ranked is pinned on that bid, not added twice.
    const ranked = pinned({ preAssignedProject: "Weather Buoy" });
    expect(ranked.pin).toBe("p4");
    expect(ranked.bids).toHaveLength(3);
  });

  it("warns about a pre-assigned project that matches nothing, and pins nothing", () => {
    const { csv, issues } = convertQualtrics(
      exportOf([
        { ...ADA, preAssigned: "Yes", preAssignedProject: "Moon Base" },
      ]),
      PROJECTS
    );
    expect(issues).toEqual([
      expect.objectContaining({ level: "warning", row: 4 }),
    ]);
    expect(parseBidsCsv(csv, PROJECTS).students[0].pin).toBeUndefined();
  });

  it("lists a survey title that matches no project once, with its bids", () => {
    const { csv } = convertQualtrics(
      exportOf([ADA, { ...ADA, email: "ben@example.edu" }]),
      PROJECTS.filter((p) => p.key !== "p1")
    );
    const { issues } = parseBidsCsv(
      csv,
      PROJECTS.filter((p) => p.key !== "p1")
    );
    expect(issues).toEqual([
      {
        level: "error",
        row: 2,
        rows: [2, 5],
        message: 'No project is titled "Tide Clock - Version 2" (2 bids).',
      },
    ]);
  });

  it("round-trips a reason that starts like a spreadsheet formula", () => {
    const { csv } = convertQualtrics(
      exportOf([{ ...ADA, reasons: ["- bullet reason", "", ""] }]),
      PROJECTS
    );
    expect(csv).toContain("'- bullet reason");
    const bid = parseBidsCsv(csv, PROJECTS).students[0].bids.find(
      (b) => b.priority === 1
    );
    expect(bid?.comment).toBe("- bullet reason");
  });

  it("refuses an export with no email column", () => {
    const text = exportOf([ADA]).replace("recipientEmail", "somethingElse");
    expect(convertQualtrics(text, PROJECTS).issues[0]).toMatchObject({
      level: "error",
      row: 1,
    });
  });
});
