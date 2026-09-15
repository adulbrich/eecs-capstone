// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("#/server/projects", () => ({
  hardDeleteProject: vi.fn(),
  returnToDraft: vi.fn(),
  submitProject: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    params: _params,
    to,
    ...rest
  }: {
    children: React.ReactNode;
    params?: unknown;
    to: string;
  } & Record<string, unknown>) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

import { OwnerProjectActions } from "#/components/owner-project-actions";
import { submitProject } from "#/server/projects";

afterEach(cleanup);

function renderBlock(
  status: string,
  changeRequest: string | null = null,
  onChanged: () => Promise<void> = () => Promise.resolve()
) {
  return render(
    <OwnerProjectActions
      changeRequest={changeRequest}
      onChanged={onChanged}
      project={{ id: "00000000-0000-0000-0000-000000000001", status }}
    />
  );
}

describe("OwnerProjectActions", () => {
  it("shows the staff note, an edit link and the resubmit button when sent back", () => {
    renderBlock("changes_requested", "Tighten the problem statement.");
    expect(screen.getByText("Staff asked for changes")).toBeDefined();
    expect(screen.getByText("Tighten the problem statement.")).toBeDefined();
    expect(screen.getByRole("link", { name: "Edit project" })).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Resubmit for review" })
    ).toBeDefined();
  });

  it("says when no note was left rather than showing an empty request", () => {
    renderBlock("changes_requested", null);
    expect(screen.getByText(/No note was left/)).toBeDefined();
  });

  it("offers submit and delete on a draft, with no staff note", () => {
    renderBlock("draft");
    expect(
      screen.getByRole("button", { name: "Submit for review" })
    ).toBeDefined();
    expect(screen.getByRole("button", { name: "Delete draft" })).toBeDefined();
    expect(screen.queryByText("Staff asked for changes")).toBeNull();
    expect(screen.queryByRole("link", { name: "Edit project" })).toBeNull();
  });

  it("renders nothing for a status with no owner action", () => {
    const { container } = renderBlock("approved");
    expect(container.firstChild).toBeNull();
  });

  // The refresh is what the button is about to be re-enabled over, so the
  // busy window has to cover it and not just the write (#421). A prop typed
  // `() => void` is what used to make this untestable: the promise was
  // discarded at the boundary, so there was nothing to hold the window open.
  it("keeps the button disabled until the refresh resolves", async () => {
    let releaseRefresh = () => {
      // replaced below, before anything awaits the promise
    };
    const refreshed = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    const onChanged = vi.fn(() => refreshed);
    renderBlock("draft", null, onChanged);

    const button = screen.getByRole<HTMLButtonElement>("button", {
      name: "Submit for review",
    });
    fireEvent.click(button);

    // The write has landed and the refresh has started but not resolved,
    // which is exactly the moment the reader could have clicked a live
    // control over a stale row.
    await waitFor(() => expect(submitProject).toHaveBeenCalled());
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(button.disabled).toBe(true);

    releaseRefresh();
    await waitFor(() => expect(button.disabled).toBe(false));
  });
});
