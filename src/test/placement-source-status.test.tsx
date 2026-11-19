// @vitest-environment jsdom
import { fc, test } from "@fast-check/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { issueCounts } from "#/components/placement/import-issues";
import { shownIssues } from "#/components/placement/source-format";
import { SourceStatus } from "#/components/placement/source-status";
import type { ImportIssue } from "#/lib/placement/csv";

afterEach(cleanup);

// Invented names only (#648).

const LEFT_OUT: ImportIssue = {
  level: "error",
  message: "The response has no recipient email. Left out.",
  row: 19,
};
const PREVIEW: ImportIssue = {
  level: "warning",
  message: "A survey preview, not a response; skipped.",
  row: 4,
};
const NO_EMAIL_COLUMN: ImportIssue = {
  level: "error",
  message: "The export has no Recipient Email column.",
  row: 1,
  wholeFile: true,
};

/** A strip whose problems change from outside, as a Read as change does. */
function Strip({ initial }: { initial: readonly ImportIssue[] }) {
  const [issues, setIssues] = useState(initial);
  return (
    <>
      <SourceStatus
        dataset="bids"
        filename="survey.csv"
        format="Qualtrics export"
        issues={issues}
        remove={null}
        summary="14 students and 45 bids."
      >
        <label>
          Draft
          <input defaultValue="" />
        </label>
      </SourceStatus>
      <button onClick={() => setIssues([LEFT_OUT])} type="button">
        Break it
      </button>
      <button onClick={() => setIssues([])} type="button">
        Fix it
      </button>
    </>
  );
}

const details = () => screen.getByRole("button", { name: "Details" });
// Closed, the details are hidden, still in the document (jsdom applies no
// display rule, so ask the attribute).
const draftShown = () =>
  screen.getByLabelText("Draft").closest("[hidden]") === null;

// Problems aimed at the edges: no rows, one, many; an empty message and one
// outside the Basic Multilingual Plane; whole-file on either level.
const edgeInt = fc.oneof(
  fc.constantFrom(0, 1, 2, -1, Number.MAX_SAFE_INTEGER),
  fc.integer()
);
const issue = fc.record(
  {
    level: fc.constantFrom("error" as const, "warning" as const),
    message: fc.oneof(
      fc.constantFrom("", String.fromCodePoint(0x1_f6_00)),
      fc.string()
    ),
    row: edgeInt,
    rows: fc.oneof(fc.constant<number[]>([]), fc.array(edgeInt)),
    wholeFile: fc.boolean(),
  },
  { requiredKeys: ["level", "message", "row"] }
);
const issues: fc.Arbitrary<ImportIssue[]> = fc.oneof(
  fc.constant<ImportIssue[]>([]),
  fc.array(issue)
);
const conversion = fc.record({ issues, text: fc.string() });

describe("issueCounts", () => {
  it("counts each row an error covers, and warnings by issue", () => {
    expect(
      issueCounts([LEFT_OUT, { ...LEFT_OUT, row: 7, rows: [7, 8, 9] }, PREVIEW])
    ).toEqual({ errors: 2, rowsLeftOut: 4, unread: false, warnings: 1 });
  });

  it("says unread when one error stopped the whole file", () => {
    expect(issueCounts([NO_EMAIL_COLUMN]).unread).toBe(true);
  });

  test.prop([issues])(
    "counts a row left out per error row, one when it names none",
    (xs) => {
      const want = xs
        .filter((i) => i.level === "error")
        .reduce((n, i) => n + (i.rows?.length ?? 1), 0);
      expect(issueCounts(xs).rowsLeftOut).toBe(want);
    }
  );

  test.prop([issues])("splits the list into errors and warnings", (xs) => {
    const counts = issueCounts(xs);
    expect(counts.warnings).toBe(
      xs.filter((i) => i.level === "warning").length
    );
    expect(counts.errors + counts.warnings).toBe(xs.length);
  });

  test.prop([issues])("says unread only for a whole-file error", (xs) => {
    expect(issueCounts(xs).unread).toBe(
      xs.some((i) => i.level === "error" && i.wholeFile === true)
    );
  });
});

describe("shownIssues", () => {
  it("drops the parser's issues when the conversion stopped (#681)", () => {
    expect(
      shownIssues({ issues: [NO_EMAIL_COLUMN], text: "" }, [LEFT_OUT])
    ).toEqual([NO_EMAIL_COLUMN]);
    expect(shownIssues({ issues: [PREVIEW], text: "" }, [LEFT_OUT])).toEqual([
      PREVIEW,
      LEFT_OUT,
    ]);
  });

  test.prop([conversion, issues])(
    "lists the conversion alone when it stopped, else conversion then parse",
    (c, parsed) => {
      const stopped = c.issues.some((i) => i.wholeFile === true);
      expect(shownIssues(c, parsed)).toEqual(
        stopped ? c.issues : [...c.issues, ...parsed]
      );
    }
  );
});

describe("SourceStatus (#739)", () => {
  it("shows no problem badge for a clean file, with its details closed", () => {
    render(<Strip initial={[]} />);
    const strip = screen.getByRole("region", { name: "Loaded bids file" });
    expect(strip.textContent).toContain("survey.csv");
    expect(strip.textContent).toContain("Qualtrics export");
    expect(strip.textContent).toContain("14 students and 45 bids.");
    expect(strip.textContent).not.toContain("left out");
    expect(strip.textContent).not.toContain("warning");
    expect(details().getAttribute("aria-expanded")).toBe("false");
    expect(draftShown()).toBe(false);
  });

  it("badges rows left out and warnings, and opens on the error", () => {
    render(<Strip initial={[LEFT_OUT, PREVIEW, PREVIEW]} />);
    expect(screen.getByText("1 row left out")).toBeTruthy();
    expect(screen.getByText("2 warnings")).toBeTruthy();
    expect(details().getAttribute("aria-expanded")).toBe("true");
    expect(draftShown()).toBe(true);
  });

  it("says Not read, with no row count or summary, for a whole-file error", () => {
    render(<Strip initial={[NO_EMAIL_COLUMN]} />);
    expect(screen.getByText("Not read")).toBeTruthy();
    expect(screen.queryByText(/left out/u)).toBeNull();
    expect(screen.queryByText("14 students and 45 bids.")).toBeNull();
  });

  it("opens on an error that names no row, though it badges none", () => {
    render(<Strip initial={[{ ...LEFT_OUT, rows: [] }]} />);
    expect(screen.queryByText(/left out/u)).toBeNull();
    expect(details().getAttribute("aria-expanded")).toBe("true");
  });

  it("keeps a warning-only file closed", () => {
    render(<Strip initial={[PREVIEW]} />);
    expect(screen.getByText("1 warning")).toBeTruthy();
    expect(details().getAttribute("aria-expanded")).toBe("false");
  });

  it("opens when an error appears, and stays open once it is fixed", () => {
    render(<Strip initial={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Break it" }));
    expect(details().getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Fix it" }));
    expect(details().getAttribute("aria-expanded")).toBe("true");
  });

  it("keeps what the details hold while closed, rather than unmounting", () => {
    render(<Strip initial={[]} />);
    fireEvent.click(details());
    fireEvent.change(screen.getByLabelText("Draft"), {
      target: { value: "Email Address" },
    });
    fireEvent.click(details());
    expect(draftShown()).toBe(false);
    fireEvent.click(details());
    expect((screen.getByLabelText("Draft") as HTMLInputElement).value).toBe(
      "Email Address"
    );
  });
});
