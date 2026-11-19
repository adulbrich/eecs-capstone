// @vitest-environment jsdom
import { fc, test } from "@fast-check/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  RuleDisclosure,
  splitFirstSentence,
} from "#/components/placement/rule-disclosure";
import { RunBanner, runBannerState } from "#/components/placement/run-banner";
import { EXPORT_PLUGINS } from "#/lib/placement/plugins";
import { blankText, isWellFormed, trickyText } from "#/test/shared/arbitraries";

afterEach(cleanup);

const button = (name: string) =>
  screen.getByRole("button", { name }) as HTMLButtonElement;
/** The disclosure's hidden part, which the button controls. */
const hiddenPart = () => {
  const id = screen.getByRole("button").getAttribute("aria-controls") ?? "";
  return document.getElementById(id) as HTMLElement;
};

const AT = "2026-11-19T10:06:00.000Z";
const IDLE = {
  failed: false,
  missing: null,
  ranAt: AT,
  running: false,
  stale: false,
  students: 16,
};

describe("RuleDisclosure", () => {
  it("shows the summary and hides the rest until opened", () => {
    render(
      <RuleDisclosure label="How the board works" summary="Approve pins.">
        <p>Unpin frees the student.</p>
      </RuleDisclosure>
    );
    expect(screen.getByText("Approve pins.")).toBeTruthy();
    const toggle = button("How the board works");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(hiddenPart().hidden).toBe(true);

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(hiddenPart().hidden).toBe(false);
  });
});

describe("splitFirstSentence", () => {
  it("cuts after the first sentence", () => {
    expect(splitFirstSentence("One here. Two there. Three.")).toEqual({
      rest: "Two there. Three.",
      summary: "One here.",
    });
  });

  it("leaves one sentence whole", () => {
    expect(splitFirstSentence("Only this.")).toEqual({
      rest: "",
      summary: "Only this.",
    });
  });

  // Every description the page shows, so a plugin whose first sentence
  // ends early is caught here rather than on the page.
  it.each(EXPORT_PLUGINS.map((p) => [p.label, p.description]))(
    "keeps every word of the %s description",
    (_label, description) => {
      const { rest, summary } = splitFirstSentence(description);
      expect(`${summary} ${rest}`.trim()).toBe(description.trim());
      expect(summary.length).toBeGreaterThan(20);
      expect(rest).not.toBe("");
    }
  );
});

describe("runBannerState", () => {
  it("puts a run in progress first", () => {
    expect(
      runBannerState({ ...IDLE, failed: true, missing: "x", running: true })
    ).toEqual({ kind: "running", students: 16 });
  });

  it("says what is missing before any run", () => {
    expect(
      runBannerState({ ...IDLE, missing: "Upload the bids first." })
    ).toEqual({
      at: AT,
      kind: "missing",
      message: "Upload the bids first.",
    });
  });

  it("says nothing of staleness after a failure (#680)", () => {
    expect(runBannerState({ ...IDLE, failed: true, stale: true })).toEqual({
      kind: "failed",
    });
  });

  it("is ready with no board", () => {
    expect(runBannerState({ ...IDLE, ranAt: undefined })).toEqual({
      kind: "ready",
    });
  });

  it("is fresh or stale from the board's run", () => {
    expect(runBannerState(IDLE)).toEqual({ at: AT, kind: "fresh" });
    expect(runBannerState({ ...IDLE, stale: true })).toEqual({
      at: AT,
      kind: "stale",
    });
  });
});

describe("RunBanner", () => {
  const banner = (state: Parameters<typeof RunBanner>[0]["state"]) =>
    render(
      <RunBanner
        hasResult={state.kind === "fresh" || state.kind === "stale"}
        onCancel={() => undefined}
        onRun={() => undefined}
        state={state}
      />
    );

  it("marks a stale run and says how to use the changes", () => {
    banner({ at: AT, kind: "stale" });
    const region = screen.getByRole("region", { name: "Placement run" });
    expect(region.textContent).toMatch(/^Out of date Ran at /u);
    expect(region.textContent).toContain("Run placement again to use them.");
    expect(button("Run placement again").disabled).toBe(false);
  });

  it("disables the run while something is missing", () => {
    banner({
      at: undefined,
      kind: "missing",
      message: "Upload the bids first.",
    });
    expect(screen.getByText("Upload the bids first.")).toBeTruthy();
    expect(button("Run placement").disabled).toBe(true);
  });

  it("keeps the board's time beside what is missing", () => {
    banner({ at: AT, kind: "missing", message: "Upload the bids first." });
    const region = screen.getByRole("region", { name: "Placement run" });
    expect(region.textContent).toMatch(/^Ran at .+\. Upload the bids first\./u);
  });

  it("says a run failed, and nothing of staleness (#680)", () => {
    banner({ kind: "failed" });
    const region = screen.getByRole("region", { name: "Placement run" });
    expect(region.textContent).toContain("The last run failed");
    expect(region.textContent).not.toContain("Out of date");
  });

  it("offers Cancel while running", () => {
    banner({ kind: "running", students: 16 });
    expect(screen.getByText("Placing 16 students...")).toBeTruthy();
    expect(button("Cancel").disabled).toBe(false);
  });

  it("counts one student as one", () => {
    banner({ kind: "running", students: 1 });
    expect(screen.getByText("Placing 1 student...")).toBeTruthy();
  });
});

const TERM = /[.!?]/u;
const SPACE_ONLY = /^\s+$/u;
const STOP_THEN_SPACE = /[.!?]\s/u;
const anyText = fc.oneof(
  fc.string(),
  fc.string({ unit: "grapheme" }),
  fc.string({ unit: "binary" }),
  trickyText({ maxLength: 40 }),
  blankText,
  fc.string({
    maxLength: 30,
    unit: fc.oneof(
      trickyText({ maxLength: 2, minLength: 1 }),
      fc.constantFrom(".", "!", "?", ". ", "! ", "?\n", "...", "e.g.")
    ),
  })
);
const body = (unit: fc.Arbitrary<string>) =>
  fc
    .string({ maxLength: 12, minLength: 1, unit })
    .map((s) => s.trim())
    .filter((s) => s !== "" && !TERM.test(s));
const sentences = (unit: fc.Arbitrary<string>) =>
  fc.array(
    fc
      .tuple(body(unit), fc.constantFrom(".", "!", "?"))
      .map(([b, t]) => `${b}${t}`),
    { maxLength: 4, minLength: 1 }
  );
const anyUnit = trickyText({ maxLength: 1, minLength: 1 });

describe("splitFirstSentence properties", () => {
  test.prop([anyText])("loses no text", (text) => {
    const trimmed = text.trim();
    const { rest, summary } = splitFirstSentence(text);
    if (rest === "") {
      expect(summary).toBe(trimmed);
      return;
    }
    expect(trimmed.startsWith(summary)).toBe(true);
    expect(trimmed.endsWith(rest)).toBe(true);
    expect(trimmed.slice(summary.length, trimmed.length - rest.length)).toMatch(
      SPACE_ONLY
    );
  });

  test.prop([anyText])("cuts at the first sentence end", (text) => {
    const { rest, summary } = splitFirstSentence(text);
    if (rest !== "") {
      expect(summary.at(-1)).toMatch(TERM);
      // A stop at index 0 has no sentence before it.
      expect(summary.slice(1, -1)).not.toMatch(STOP_THEN_SPACE);
    }
  });

  test.prop([anyText])("is idempotent on the summary", (text) => {
    const { summary } = splitFirstSentence(text);
    expect(splitFirstSentence(summary)).toEqual({ rest: "", summary });
  });

  test.prop([anyText])("keeps its halves trimmed and well-formed", (text) => {
    const { rest, summary } = splitFirstSentence(text);
    expect(summary).toBe(summary.trim());
    expect(rest).toBe(rest.trim());
    if (isWellFormed(text)) {
      expect(isWellFormed(summary) && isWellFormed(rest)).toBe(true);
    }
  });

  test.prop([fc.oneof(fc.constant(""), blankText)])(
    "reads blank text as no sentence",
    (text) => {
      expect(splitFirstSentence(text)).toEqual({ rest: "", summary: "" });
    }
  );

  // Line breaks included: a first sentence that wraps still cuts.
  test.prop([sentences(anyUnit)])(
    "rest is empty only for one sentence",
    (list) => {
      expect(splitFirstSentence(list.join(" "))).toEqual({
        rest: list.slice(1).join(" "),
        summary: list[0],
      });
    }
  );
});

describe("runBannerState properties", () => {
  const inputs = fc.record({
    failed: fc.boolean(),
    missing: fc.oneof(
      { arbitrary: fc.constant(null), weight: 3 },
      fc.constantFrom("", " ", "Upload the bids first, on the Bids tab."),
      trickyText({ maxLength: 12 })
    ),
    ranAt: fc.oneof(
      fc.constant(undefined),
      fc.constant(""),
      fc.date({ noInvalidDate: true }).map((d) => d.toISOString())
    ),
    running: fc.boolean(),
    stale: fc.boolean(),
    students: fc.oneof(fc.constantFrom(0, 1, 2), fc.nat()),
  });

  test.prop([inputs])("a run in progress wins over every other input", (i) => {
    expect(runBannerState({ ...i, running: true }).kind).toBe("running");
  });

  test.prop([inputs])("never says out of date after a failure (#680)", (i) => {
    const { kind } = runBannerState({ ...i, failed: true });
    expect(kind).not.toBe("stale");
    expect(kind).not.toBe("fresh");
  });

  test.prop([inputs])("names a run's time only when there is a board", (i) => {
    const state = runBannerState(i);
    if ("at" in state) {
      expect(state.at).toBe(i.ranAt);
    }
    if (state.kind === "fresh" || state.kind === "stale") {
      expect(i.ranAt).not.toBeUndefined();
      expect(state.kind === "stale").toBe(i.stale);
    }
  });

  test.prop([inputs])("blocks the run whenever an input is missing", (i) => {
    const { kind } = runBannerState({ ...i, running: false });
    expect(kind === "missing").toBe(i.missing !== null);
  });
});
