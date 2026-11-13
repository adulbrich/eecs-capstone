// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CategoryCleanupDialog } from "#/components/category-cleanup-dialog";
import type { CleanupProposal } from "#/lib/category-cleanup";
import { deferred } from "./shared/deferred";

const server = vi.hoisted(() => ({
  applyCategoryCleanup: vi.fn(),
  proposeCategoryCleanup: vi.fn(),
}));
vi.mock("#/server/categories", () => server);
const invalidate = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({ invalidate }),
}));

const ref = (id: string, name: string, type = "Field") => ({
  id,
  name,
  type,
  description: null,
});

const MERGE: CleanupProposal = {
  operation: {
    kind: "merge",
    target: ref("00000000-0000-4000-8000-000000000001", "AR / VR"),
    sources: [ref("00000000-0000-4000-8000-000000000002", "VR")],
    reason: "One idea split across two checkboxes.",
  },
  effect: {
    kind: "merge",
    targetUsage: 6,
    sourceUsage: [3],
    after: 8,
    shared: 1,
  },
};

const RETIRE: CleanupProposal = {
  operation: {
    kind: "retire",
    category: ref("00000000-0000-4000-8000-000000000003", "Blockchain"),
    reason: "One project in four years, which keeps Web Development.",
  },
  effect: { kind: "retire", usage: 1 },
};

const RENAME: CleanupProposal = {
  operation: {
    kind: "rename",
    category: ref("00000000-0000-4000-8000-000000000004", "ML"),
    name: "Machine Learning",
    description: null,
    reason: "Spell it out like its siblings.",
  },
  effect: { kind: "rename", usage: 11 },
};

beforeEach(() => {
  server.applyCategoryCleanup.mockReset();
  server.proposeCategoryCleanup.mockReset();
  invalidate.mockReset();
  invalidate.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
});

function open() {
  render(<CategoryCleanupDialog />);
  fireEvent.click(screen.getByRole("button", { name: "Propose a cleanup" }));
  fireEvent.click(screen.getByRole("button", { name: "Propose" }));
}

describe("the category cleanup dialog", () => {
  it("calls nothing until Propose is pressed", () => {
    render(<CategoryCleanupDialog />);
    fireEvent.click(screen.getByRole("button", { name: "Propose a cleanup" }));

    expect(screen.getByRole("button", { name: "Propose" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Apply/u })).toBeNull();
    expect(server.proposeCategoryCleanup).not.toHaveBeenCalled();
  });

  it("lists each proposed change with its effect, unticked", async () => {
    server.proposeCategoryCleanup.mockResolvedValue({
      proposals: [MERGE, RETIRE],
    });
    open();

    const merge = await screen.findByLabelText(
      "Merge VR (3) into AR / VR (6): 8 projects after, 1 already carried both"
    );
    expect(server.proposeCategoryCleanup).toHaveBeenCalledTimes(1);
    expect(merge.getAttribute("aria-checked")).toBe("false");
    expect(
      screen.getByLabelText("Retire Blockchain: 1 project loses it")
    ).toBeTruthy();
    expect(
      screen.getByText("One idea split across two checkboxes.")
    ).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "Apply 0 changes" })
        .hasAttribute("disabled")
    ).toBe(true);
  });

  it("applies only the ticked changes and shows each one's result", async () => {
    server.proposeCategoryCleanup.mockResolvedValue({
      proposals: [MERGE, RETIRE, RENAME],
    });
    server.applyCategoryCleanup.mockResolvedValue({
      results: [
        { ok: true },
        { ok: false, reason: "ML was edited after the proposal." },
      ],
    });
    open();
    fireEvent.click(
      await screen.findByLabelText(
        "Merge VR (3) into AR / VR (6): 8 projects after, 1 already carried both"
      )
    );
    fireEvent.click(
      screen.getByLabelText("Rename ML to Machine Learning (11 projects)")
    );

    fireEvent.click(screen.getByRole("button", { name: "Apply 2 changes" }));

    expect(await screen.findByText("Applied.")).toBeTruthy();
    expect(
      screen.getByText("Refused: ML was edited after the proposal.")
    ).toBeTruthy();
    expect(screen.getByText("1 applied, 1 refused.")).toBeTruthy();
    expect(server.applyCategoryCleanup).toHaveBeenCalledWith({
      data: { changes: [MERGE.operation, RENAME.operation] },
    });
    // The retirement was not ticked: it keeps its box and has no result.
    expect(
      screen.getByLabelText("Retire Blockchain: 1 project loses it")
    ).toBeTruthy();
    await waitFor(() => expect(invalidate).toHaveBeenCalled());
  });

  it("says so when the model proposes nothing", async () => {
    server.proposeCategoryCleanup.mockResolvedValue({ proposals: [] });
    open();
    expect(
      await screen.findByText("No changes proposed: the list looks clean.")
    ).toBeTruthy();
  });

  it("shows a refused proposal's message", async () => {
    server.proposeCategoryCleanup.mockRejectedValue(
      new Error(
        "You have used all 20 category regenerations and cleanups for this hour."
      )
    );
    open();
    expect(
      await screen.findByText(
        "You have used all 20 category regenerations and cleanups for this hour."
      )
    ).toBeTruthy();
  });

  it("drops an answer that arrives after the dialog closed", async () => {
    const late = deferred<{ proposals: CleanupProposal[] }>();
    server.proposeCategoryCleanup
      .mockReturnValueOnce(late.promise)
      .mockResolvedValueOnce({ proposals: [RETIRE] });
    open();
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    // Reopened while the first call is still in flight; its answer then lands.
    fireEvent.click(screen.getByRole("button", { name: "Propose a cleanup" }));
    late.resolve({ proposals: [MERGE] });
    await late.promise;
    const propose = await screen.findByRole("button", { name: "Propose" });
    await waitFor(() => expect(propose.hasAttribute("disabled")).toBe(false));
    expect(screen.queryByText(/Merge VR/u)).toBeNull();

    fireEvent.click(propose);
    expect(
      await screen.findByLabelText("Retire Blockchain: 1 project loses it")
    ).toBeTruthy();
    expect(server.proposeCategoryCleanup).toHaveBeenCalledTimes(2);
  });
});
