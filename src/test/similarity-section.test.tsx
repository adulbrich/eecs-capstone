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
  getSimilarity: vi.fn(),
  recomputeSimilarity: vi.fn(),
}));
vi.mock("#/server/similarity", () => server);

import { SimilaritySection } from "#/components/similarity-section";
import type {
  AiRefreshAttempt,
  RecomputeSimilarityResult,
  SimilarityView,
} from "#/lib/ai-refresh";

afterEach(cleanup);
beforeEach(() => {
  server.getSimilarity.mockReset();
  server.recomputeSimilarity.mockReset();
});

const AT = new Date("2026-10-05T10:02:00Z");
const failed = (trigger: AiRefreshAttempt["trigger"]): AiRefreshAttempt => ({
  at: AT,
  outcome: "failed",
  trigger,
});

const NEVER: SimilarityView = {
  attempt: null,
  computedAt: null,
  refreshable: true,
};
const COMPUTED: SimilarityView = {
  attempt: { at: AT, outcome: "updated", trigger: "automatic" },
  computedAt: AT,
  refreshable: true,
};

async function renderWith(view: SimilarityView) {
  server.getSimilarity.mockResolvedValue(view);
  render(<SimilaritySection projectId="p1" />);
  await waitFor(() => expect(screen.queryByText("Loading...")).toBeNull());
}

const recompute = () => screen.queryByRole("button", { name: "Recompute" });

/**
 * The states #631 exists to tell apart, and the one rule for the button: it
 * appears only when pressing it can change something.
 */
describe("SimilaritySection status", () => {
  it("says it was never computed, what that costs, and offers Recompute", async () => {
    await renderWith(NEVER);
    expect(screen.getByText(/Not computed yet/)).toBeDefined();
    expect(screen.getByText(/missing from Similar projects/)).toBeDefined();
    expect(recompute()).not.toBeNull();
  });

  it("tells a failure apart from never computed", async () => {
    await renderWith({ ...NEVER, attempt: failed("automatic") });
    expect(
      screen.getByText(/The last attempt failed automatically/)
    ).toBeDefined();
    expect(screen.getByText(/Nothing is computed/)).toBeDefined();
    expect(screen.queryByText(/Not computed yet/)).toBeNull();
    expect(recompute()).not.toBeNull();
  });

  it("says a failure leaves the older computation in use, and offers Recompute", async () => {
    await renderWith({ ...COMPUTED, attempt: failed("staff") });
    expect(
      screen.getByText(/The last attempt failed from Recompute/)
    ).toBeDefined();
    expect(screen.getByText(/from before the last change/)).toBeDefined();
    expect(recompute()).not.toBeNull();
  });

  it("offers no button when it is computed and current", async () => {
    await renderWith(COMPUTED);
    // "Computed <time>." The time is its own element, so the line is read
    // through it rather than by a text match the split would defeat.
    const time = document.querySelector("time");
    expect(time?.closest("p")?.textContent).toMatch(/^Computed .+\.$/);
    expect(screen.queryByText(/failed|Not computed/)).toBeNull();
    expect(recompute()).toBeNull();
  });

  it("offers no button on a project the refresh does not write for", async () => {
    await renderWith({ ...NEVER, refreshable: false });
    expect(
      screen.getByText("Computed once the project is published.")
    ).toBeDefined();
    expect(recompute()).toBeNull();
  });

  it("never says embedding", async () => {
    await renderWith({ ...NEVER, attempt: failed("automatic") });
    expect(screen.queryByText(/embedding/i)).toBeNull();
  });
});

describe("SimilaritySection Recompute", () => {
  it("shows the view it gets back and confirms", async () => {
    await renderWith({ ...NEVER, attempt: failed("automatic") });
    const result: RecomputeSimilarityResult = {
      ...COMPUTED,
      attempt: { at: AT, outcome: "updated", trigger: "staff" },
      outcome: "updated",
    };
    server.recomputeSimilarity.mockResolvedValue(result);
    fireEvent.click(recompute() as HTMLElement);

    expect(await screen.findByText("Recomputed.")).toBeDefined();
    expect(screen.queryByText(/failed/)).toBeNull();
    expect(recompute()).toBeNull();
    expect(server.recomputeSimilarity).toHaveBeenCalledWith({
      data: { projectId: "p1" },
    });
  });

  it("explains an outcome the status line cannot", async () => {
    await renderWith(NEVER);
    server.recomputeSimilarity.mockResolvedValue({
      ...NEVER,
      refreshable: false,
      outcome: "skipped",
    } satisfies RecomputeSimilarityResult);
    fireEvent.click(recompute() as HTMLElement);

    expect(
      await screen.findByText(/no longer published or archived/)
    ).toBeDefined();
  });

  it("shows a failed recompute in the status box", async () => {
    await renderWith(NEVER);
    server.recomputeSimilarity.mockResolvedValue({
      ...NEVER,
      attempt: failed("staff"),
      outcome: "failed",
    } satisfies RecomputeSimilarityResult);
    fireEvent.click(recompute() as HTMLElement);

    expect(
      await screen.findByText(/The last attempt failed from Recompute/)
    ).toBeDefined();
    expect(recompute()).not.toBeNull();
  });
});
