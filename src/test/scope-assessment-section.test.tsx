// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const server = vi.hoisted(() => ({
  assessProjectScope: vi.fn(),
  getScopeAssessment: vi.fn(),
}));
vi.mock("#/server/scope-assessment", () => server);

import { ScopeAssessmentSection } from "#/components/scope-assessment-section";
import type { ScopeAssessmentView } from "#/lib/scope-assessment";

afterEach(cleanup);
beforeEach(() => {
  server.assessProjectScope.mockReset();
  server.getScopeAssessment.mockReset();
});

const view: ScopeAssessmentView = {
  assessedAt: new Date("2026-09-01T10:00:00Z"),
  assessment: {
    oneTerm: "too_large",
    threeTerms: "about_right",
    confidence: 0.35,
    rationale: "Two services and a mobile client exceed one term.",
    model: "openai.gpt-5.6-luna",
  },
  stale: false,
};

describe("ScopeAssessmentSection", () => {
  it("offers the assessment when there is none yet", async () => {
    server.getScopeAssessment.mockResolvedValue(null);
    render(<ScopeAssessmentSection projectId="p1" />);
    expect(await screen.findByText(/Not assessed yet/)).toBeDefined();
    expect(screen.getByRole("button", { name: "Assess scope" })).toBeDefined();
  });

  it("renders both verdicts, the confidence label and the rationale", async () => {
    server.getScopeAssessment.mockResolvedValue(view);
    render(<ScopeAssessmentSection projectId="p1" />);
    expect(await screen.findByText("Too large")).toBeDefined();
    expect(screen.getByText("About right")).toBeDefined();
    // Low confidence is where "high uncertainty" comes from: one number, one
    // label, no separate flag to disagree with it.
    expect(screen.getByText(/35%/).textContent).toContain("low");
    expect(screen.getByText(view.assessment.rationale)).toBeDefined();
    expect(screen.queryByText(/earlier version/)).toBeNull();
    expect(screen.getByRole("button", { name: "Reassess" })).toBeDefined();
  });

  it("says when the verdict is about an earlier version, and keeps showing it", async () => {
    server.getScopeAssessment.mockResolvedValue({ ...view, stale: true });
    render(<ScopeAssessmentSection projectId="p1" />);
    expect(
      await screen.findByText(/assessed against an earlier version/i)
    ).toBeDefined();
    expect(screen.getByText("Too large")).toBeDefined();
    // Nothing re-ran on its own.
    expect(server.assessProjectScope).not.toHaveBeenCalled();
  });

  it("runs the assessment on demand and renders what comes back", async () => {
    server.getScopeAssessment.mockResolvedValue(null);
    server.assessProjectScope.mockResolvedValue(view);
    render(<ScopeAssessmentSection projectId="p1" />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Assess scope" })
    );
    await waitFor(() =>
      expect(server.assessProjectScope).toHaveBeenCalledWith({
        data: { projectId: "p1" },
      })
    );
    expect(await screen.findByText("Too large")).toBeDefined();
  });

  it("shows the server's refusal, such as the limit, in place", async () => {
    server.getScopeAssessment.mockResolvedValue(null);
    server.assessProjectScope.mockRejectedValue(
      new Error("You have used all 10 scope assessments for this hour.")
    );
    render(<ScopeAssessmentSection projectId="p1" />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Assess scope" })
    );
    expect(await screen.findByText(/all 10 scope assessments/)).toBeDefined();
  });
});
