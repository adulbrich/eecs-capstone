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

  test.prop([fc.string()])("loses no text", (text) => {
    const { rest, summary } = splitFirstSentence(text);
    expect([summary, rest].join(" ").replace(/\s+/gu, " ").trim()).toBe(
      text.replace(/\s+/gu, " ").trim()
    );
  });
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
    ).toEqual({ kind: "missing", message: "Upload the bids first." });
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
    banner({ kind: "missing", message: "Upload the bids first." });
    expect(screen.getByText("Upload the bids first.")).toBeTruthy();
    expect(button("Run placement").disabled).toBe(true);
  });

  it("offers Cancel while running", () => {
    banner({ kind: "running", students: 16 });
    expect(screen.getByText("Placing 16 students...")).toBeTruthy();
    expect(button("Cancel").disabled).toBe(false);
  });
});
