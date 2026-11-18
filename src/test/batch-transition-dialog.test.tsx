// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  type BatchRow,
  BatchTransitionDialog,
} from "#/components/batch-transition-dialog";
import type { BatchTarget } from "#/lib/project-workflow";
import { batchTransitionProjects } from "#/server/projects";
import { deferred } from "./shared/deferred";

vi.mock("#/server/projects", () => ({ batchTransitionProjects: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

// Radix Dialog reads a few DOM APIs jsdom omits. Same stub set as
// approve-dialog.test.tsx.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn();
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  globalThis.ResizeObserver = class {
    observe() {
      // no-op
    }
    unobserve() {
      // no-op
    }
    disconnect() {
      // no-op
    }
  };
});

afterEach(() => {
  cleanup();
  vi.mocked(batchTransitionProjects).mockReset();
});

/** A mixed view: two published, one approved, one soft-deleted published. */
const rows: BatchRow[] = [
  { id: "id-b", title: "Rover", status: "published", deletedAt: null },
  { id: "id-a", title: "Drone", status: "published", deletedAt: null },
  { id: "id-c", title: "Kiosk", status: "approved", deletedAt: null },
  {
    id: "id-d",
    title: "Buoy",
    status: "published",
    deletedAt: "2026-11-01T00:00:00.000Z",
  },
];

function renderDialog(
  target: BatchTarget,
  view: BatchRow[] = rows,
  onDone: () => Promise<void> = () => Promise.resolve()
) {
  const onOpenChange = vi.fn();
  render(
    <BatchTransitionDialog
      onDone={onDone}
      onOpenChange={onOpenChange}
      open
      rows={view}
      target={target}
    />
  );
  return { onOpenChange };
}

describe("BatchTransitionDialog", () => {
  it("counts the eligible rows and says what is left alone, and why", () => {
    renderDialog("archived");
    expect(
      screen.getByRole("heading", { name: "Archive 2 published projects?" })
    ).toBeTruthy();
    const list = screen.getByRole("list", { name: "Projects to archive" });
    expect(list.textContent).toBe("RoverDrone");
    expect(
      screen.getByText(
        "1 project in this view is not published and is left alone."
      )
    ).toBeTruthy();
    expect(
      screen.getByText(
        "1 soft-deleted project is left alone. Restore it first."
      )
    ).toBeTruthy();
    expect(
      screen.getByText("Each proposer gets a notice in the bell, no email.")
    ).toBeTruthy();
    expect(screen.queryByText(/Summaries/u)).toBeNull();
    expect(
      screen.getByRole("button", { name: "Archive 2 projects" })
    ).toBeTruthy();
  });

  it("says the summaries follow on a publish", () => {
    renderDialog("published");
    expect(
      screen.getByRole("heading", { name: "Publish 1 approved project?" })
    ).toBeTruthy();
    expect(
      screen.getByText(
        /Summaries for the published projects arrive over the next few minutes\./u
      )
    ).toBeTruthy();
    expect(
      screen.getByText(
        "2 projects in this view are not approved and are left alone."
      )
    ).toBeTruthy();
  });

  it("with no eligible row says so and offers only Close", () => {
    renderDialog("published", [rows[0], rows[3]]);
    expect(
      screen.getByRole("heading", { name: "No approved projects in this view" })
    ).toBeTruthy();
    // The footer's Close and the dialog's own X, and nothing that acts.
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      expect(button.textContent).toMatch(/^Close$/u);
    }
  });

  it("sends the listed ids, the target and the comment once on a double click", async () => {
    const pending = deferred<{ ids: string[]; status: BatchTarget }>();
    vi.mocked(batchTransitionProjects).mockReturnValue(pending.promise);
    const onDone = vi.fn(() => Promise.resolve());
    const { onOpenChange } = renderDialog("archived", rows, onDone);

    fireEvent.change(screen.getByLabelText("Comment (optional)"), {
      target: { value: "  End of the 2026 term.  " },
    });
    const confirm = screen.getByRole("button", { name: "Archive 2 projects" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    expect(batchTransitionProjects).toHaveBeenCalledTimes(1);
    expect(batchTransitionProjects).toHaveBeenCalledWith({
      data: {
        ids: ["id-b", "id-a"],
        target: "archived",
        comment: "End of the 2026 term.",
      },
    });
    expect(screen.getByRole("button", { name: "Archiving..." })).toBeTruthy();

    await act(async () => {
      pending.resolve({ ids: ["id-a", "id-b"], status: "archived" });
      await pending.promise;
    });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("on a refusal shows the message, stays open and reloads the view", async () => {
    vi.mocked(batchTransitionProjects).mockRejectedValue(
      new Error(
        "Nothing was archived. These changed since the list loaded: Rover."
      )
    );
    const onDone = vi.fn(() => Promise.resolve());
    const { onOpenChange } = renderDialog("archived", rows, onDone);

    fireEvent.click(screen.getByRole("button", { name: "Archive 2 projects" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Nothing was archived. These changed since the list loaded: Rover."
    );
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("keeps the refusal on screen when the reload leaves nothing eligible", async () => {
    vi.mocked(batchTransitionProjects).mockRejectedValue(
      new Error(
        "Nothing was archived. These changed since the list loaded: Rover, Drone."
      )
    );
    const onOpenChange = vi.fn();
    const props = {
      onDone: () => Promise.resolve(),
      onOpenChange,
      open: true,
      target: "archived" as const,
    };
    const { rerender } = render(
      <BatchTransitionDialog {...props} rows={rows} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Archive 2 projects" }));
    await screen.findByRole("alert");
    // The reload: both published rows were archived elsewhere.
    rerender(
      <BatchTransitionDialog
        {...props}
        rows={rows.map((row) => ({ ...row, status: "archived" as const }))}
      />
    );
    expect(
      screen.getByRole("heading", {
        name: "No published projects in this view",
      })
    ).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("Rover, Drone.");
  });

  it("reports a batch that landed as landed even when the reload fails", async () => {
    vi.mocked(batchTransitionProjects).mockResolvedValue({
      ids: ["id-a", "id-b"],
      status: "archived",
    });
    const onDone = vi.fn(() => Promise.reject(new Error("loader down")));
    const { onOpenChange } = renderDialog("archived", rows, onDone);
    fireEvent.click(screen.getByRole("button", { name: "Archive 2 projects" }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(toast.success).toHaveBeenCalledWith("2 projects archived.");
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "The list did not reload. Refresh the page to see it."
      )
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("drops the comment on Cancel, so it never rides into the next batch", () => {
    const { onOpenChange } = renderDialog("archived");
    const box = () =>
      screen.getByLabelText("Comment (optional)") as HTMLTextAreaElement;
    fireEvent.change(box(), { target: { value: "End of term." } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(box().value).toBe("");
  });
});
