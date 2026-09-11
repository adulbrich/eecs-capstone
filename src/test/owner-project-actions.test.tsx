// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
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

afterEach(cleanup);

function renderBlock(status: string, changeRequest: string | null = null) {
  return render(
    <OwnerProjectActions
      changeRequest={changeRequest}
      onChanged={vi.fn()}
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
});
