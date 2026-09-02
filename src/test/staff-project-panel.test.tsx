// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    ...rest
  }: { children: React.ReactNode } & Record<string, unknown>) => (
    <a {...rest}>{children}</a>
  ),
}));

const {
  performTransition,
  forceSetProjectStatus,
  hardDeleteProject,
  restoreProject,
  softDeleteProject,
  updateProjectMentorship,
} = vi.hoisted(() => ({
  performTransition: vi.fn(),
  forceSetProjectStatus: vi.fn(),
  hardDeleteProject: vi.fn(),
  restoreProject: vi.fn(),
  softDeleteProject: vi.fn(),
  updateProjectMentorship: vi.fn(),
}));
vi.mock("#/server/projects", () => ({
  performTransition,
  forceSetProjectStatus,
  hardDeleteProject,
  restoreProject,
  softDeleteProject,
  updateProjectMentorship,
}));

const { listProjectEditLog, getProposerForEdit, getProjectMentorship } =
  vi.hoisted(() => ({
    listProjectEditLog: vi.fn(),
    getProposerForEdit: vi.fn(),
    getProjectMentorship: vi.fn(),
  }));
vi.mock("#/server/projects-queries", () => ({
  listProjectEditLog,
  getProposerForEdit,
  getProjectMentorship,
}));

// Radix's Checkbox measures itself on mount; jsdom ships no ResizeObserver.
class ResizeObserverStub {
  observe() {
    // no-op
  }
  unobserve() {
    // no-op
  }
  disconnect() {
    // no-op
  }
}
globalThis.ResizeObserver ??=
  ResizeObserverStub as unknown as typeof ResizeObserver;

import { StaffProjectPanel } from "#/components/staff-project-panel";

afterEach(cleanup);
beforeEach(() => {
  performTransition.mockReset();
  forceSetProjectStatus.mockReset();
  hardDeleteProject.mockReset();
  restoreProject.mockReset();
  softDeleteProject.mockReset();
  listProjectEditLog.mockReset();
  getProposerForEdit.mockReset();
  getProjectMentorship.mockReset();
  updateProjectMentorship.mockReset();

  performTransition.mockResolvedValue({});
  forceSetProjectStatus.mockResolvedValue({});
  updateProjectMentorship.mockResolvedValue({ id: PROJECT_ID, updated: true });
  listProjectEditLog.mockResolvedValue({ rows: [] });
  getProjectMentorship.mockResolvedValue({
    mentorEmail: "",
    mentorName: null,
    studentProposed: false,
  });
  getProposerForEdit.mockResolvedValue({
    accountLinked: true,
    accountName: "proposer@example.com",
    email: "proposer@example.com",
  });
});

const PROJECT_ID = "00000000-0000-0000-0000-0000000000p1";

function project(status: string) {
  return { id: PROJECT_ID, status, deletedAt: null };
}

function renderPanel(status: string) {
  return render(
    <StaffProjectPanel
      onChanged={() => {
        // no-op
      }}
      project={project(status)}
    />
  );
}

describe("StaffProjectPanel proposer block", () => {
  it("renders the proposer's link state in the panel body", async () => {
    // ProposerSummary is unit tested on its own; this asserts the panel
    // actually renders it, which is the half a component test cannot cover.
    renderPanel("submitted");

    await waitFor(() =>
      expect(screen.getByText("Account linked")).toBeTruthy()
    );
    expect(screen.getAllByText("proposer@example.com").length).toBeGreaterThan(
      0
    );
  });

  it("says no account yet when the address has not been claimed", async () => {
    getProposerForEdit.mockResolvedValue({
      accountLinked: false,
      accountName: null,
      email: "external@x.com",
    });
    renderPanel("submitted");

    await waitFor(() =>
      expect(screen.getByText("No account yet")).toBeTruthy()
    );
  });
});

describe("StaffProjectPanel review-email control", () => {
  it("shows the checkbox checked and names the address for the Approved dialog", async () => {
    renderPanel("submitted");
    fireEvent.click(screen.getByTitle("Move to Approved"));

    await waitFor(() =>
      expect(
        screen.getByText("Email the proposer (proposer@example.com)")
      ).toBeTruthy()
    );
    const checkbox = screen.getByRole("checkbox");
    expect(checkbox.getAttribute("aria-checked")).toBe("true");
    expect(checkbox.hasAttribute("disabled")).toBe(false);
  });

  it("shows no checkbox at all for the Published dialog", async () => {
    renderPanel("approved");
    fireEvent.click(screen.getByTitle("Move to Published"));

    await waitFor(() =>
      expect(screen.getByText("Move to Published")).toBeTruthy()
    );
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("shows the disabled no-address-on-file state when the proposer has no address", async () => {
    getProposerForEdit.mockResolvedValue({
      accountLinked: false,
      accountName: null,
      email: "",
    });
    renderPanel("submitted");
    fireEvent.click(screen.getByTitle("Move to Approved"));

    await waitFor(() =>
      expect(
        screen.getByText("No address on file, no email will be sent")
      ).toBeTruthy()
    );
    const checkbox = screen.getByRole("checkbox");
    expect(checkbox.hasAttribute("disabled")).toBe(true);
    expect(checkbox.getAttribute("aria-checked")).toBe("false");
  });

  it("sends sendEmail: false when the checked box is unchecked before confirming", async () => {
    renderPanel("submitted");
    fireEvent.click(screen.getByTitle("Move to Approved"));
    await waitFor(() => expect(screen.getByRole("checkbox")).toBeTruthy());

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(performTransition).toHaveBeenCalledTimes(1));
    expect(performTransition).toHaveBeenCalledWith({
      data: {
        id: PROJECT_ID,
        status: "approved",
        comment: "",
        sendEmail: false,
      },
    });
  });

  it("still sends sendEmail: true with no address on file, leaving the server to decide who is reachable", async () => {
    // The flag means "staff did not opt out", not "there is someone to mail".
    // Gating it on the proposer's address here used to mute the review-inbox
    // notice on a Submitted transition, which does not involve the proposer at
    // all. The server declines to mail a proposer it cannot resolve.
    getProposerForEdit.mockResolvedValue({
      accountLinked: false,
      accountName: null,
      email: "",
    });
    renderPanel("submitted");
    fireEvent.click(screen.getByTitle("Move to Approved"));
    await waitFor(() =>
      expect(
        screen.getByText("No address on file, no email will be sent")
      ).toBeTruthy()
    );

    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(performTransition).toHaveBeenCalledTimes(1));
    expect(performTransition).toHaveBeenCalledWith({
      data: {
        id: PROJECT_ID,
        status: "approved",
        comment: "",
        sendEmail: true,
      },
    });
  });

  it("sends sendEmail: true on a Submitted transition, which emails the review inbox", async () => {
    // No checkbox renders for this transition, so nothing in the UI could ever
    // set the flag false. Every other assertion in this suite checks for
    // false, which is how a panel that always muted mail passed the whole
    // suite once already.
    getProposerForEdit.mockResolvedValue({
      accountLinked: false,
      accountName: null,
      email: "",
    });
    renderPanel("draft");
    fireEvent.click(screen.getByTitle("Move to Submitted"));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Confirm" })).toBeTruthy()
    );
    expect(screen.queryByRole("checkbox")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(performTransition).toHaveBeenCalledTimes(1));
    expect(performTransition).toHaveBeenCalledWith({
      data: {
        id: PROJECT_ID,
        status: "submitted",
        comment: "",
        sendEmail: true,
      },
    });
  });
});

describe("StaffProjectPanel mentorship block", () => {
  it("prefills the saved record and says which account the address matches", async () => {
    getProjectMentorship.mockResolvedValue({
      mentorEmail: "mentor@x.test",
      mentorName: "Dana Lee",
      studentProposed: true,
    });
    renderPanel("submitted");

    const input = (await screen.findByLabelText(
      "Mentor email"
    )) as HTMLInputElement;
    expect(input.value).toBe("mentor@x.test");
    expect(await screen.findByText("Account: Dana Lee")).toBeTruthy();
    expect(
      (
        screen.getByRole("checkbox", {
          name: "Student proposed",
        }) as HTMLElement
      ).getAttribute("aria-checked")
    ).toBe("true");
  });

  it("says the catalog shows seeking when a student project has no address", async () => {
    getProjectMentorship.mockResolvedValue({
      mentorEmail: "",
      mentorName: null,
      studentProposed: true,
    });
    renderPanel("submitted");
    expect(
      await screen.findByText(/shows this project as seeking a mentor/)
    ).toBeTruthy();
  });

  it("saves the draft through the server function and reloads the record", async () => {
    renderPanel("submitted");
    const input = (await screen.findByLabelText(
      "Mentor email"
    )) as HTMLInputElement;
    fireEvent.change(input, { target: { value: " other@x.test " } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Student proposed" }));
    fireEvent.click(screen.getByRole("button", { name: "Save mentorship" }));

    await waitFor(() =>
      expect(updateProjectMentorship).toHaveBeenCalledWith({
        data: {
          id: PROJECT_ID,
          mentorEmail: "other@x.test",
          studentProposed: true,
        },
      })
    );
    // Once on mount, once after the save.
    await waitFor(() => expect(getProjectMentorship).toHaveBeenCalledTimes(2));
  });
});

describe("StaffProjectPanel mentorship save gate", () => {
  it("keeps Save disabled until the record has loaded, so blank drafts cannot clear a mentor", async () => {
    let resolveLoad: (value: {
      mentorEmail: string;
      mentorName: string | null;
      studentProposed: boolean;
    }) => void = () => {
      // replaced below
    };
    getProjectMentorship.mockReturnValue(
      new Promise((resolve) => {
        resolveLoad = resolve;
      })
    );
    renderPanel("submitted");

    const save = screen.getByRole("button", { name: "Save mentorship" });
    expect(save.hasAttribute("disabled")).toBe(true);
    fireEvent.click(save);
    expect(updateProjectMentorship).not.toHaveBeenCalled();

    resolveLoad({
      mentorEmail: "mentor@x.test",
      mentorName: null,
      studentProposed: false,
    });
    await waitFor(() => expect(save.hasAttribute("disabled")).toBe(false));
  });

  it("reports a failed load and keeps Save disabled", async () => {
    getProjectMentorship.mockRejectedValue(new Error("Forbidden"));
    renderPanel("submitted");
    expect(await screen.findByText("Forbidden")).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "Save mentorship" })
        .hasAttribute("disabled")
    ).toBe(true);
  });
});
