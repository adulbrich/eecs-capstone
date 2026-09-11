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
  updateProjectProposer,
} = vi.hoisted(() => ({
  performTransition: vi.fn(),
  forceSetProjectStatus: vi.fn(),
  hardDeleteProject: vi.fn(),
  restoreProject: vi.fn(),
  softDeleteProject: vi.fn(),
  updateProjectMentorship: vi.fn(),
  updateProjectProposer: vi.fn(),
}));
vi.mock("#/server/projects", () => ({
  performTransition,
  forceSetProjectStatus,
  hardDeleteProject,
  restoreProject,
  softDeleteProject,
  updateProjectMentorship,
  updateProjectProposer,
}));

const { listProjectCategories, setProjectCategories } = vi.hoisted(() => ({
  listProjectCategories: vi.fn(),
  setProjectCategories: vi.fn(),
}));
vi.mock("#/server/categories", () => ({
  listProjectCategories,
  setProjectCategories,
}));
// The real control loads the category list through its own server function;
// a checkbox per known id is enough to drive the section's draft and save.
vi.mock("#/components/category-multi-select", () => ({
  CategoryMultiSelect: ({
    onChange,
    value,
  }: {
    onChange: (ids: string[]) => void;
    value: string[];
  }) => (
    <label>
      <input
        checked={value.includes(CATEGORY_ID)}
        onChange={(e) => onChange(e.target.checked ? [CATEGORY_ID] : [])}
        type="checkbox"
      />
      Robotics
    </label>
  ),
}));
vi.mock("#/server/users", () => ({
  searchUsers: vi.fn().mockResolvedValue([]),
}));
const CATEGORY_ID = "22222222-2222-4222-8222-222222222222";

const { listProjectEditLog, getProposerForEdit, getProjectMentorship } =
  vi.hoisted(() => ({
    listProjectEditLog: vi.fn(),
    getProposerForEdit: vi.fn(),
    getProjectMentorship: vi.fn(),
  }));
vi.mock("#/server/scope-assessment", () => ({
  assessProjectScope: vi.fn(() => Promise.resolve(null)),
  getScopeAssessment: vi.fn(() => Promise.resolve(null)),
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
  updateProjectProposer.mockReset();
  listProjectCategories.mockReset();
  setProjectCategories.mockReset();

  performTransition.mockResolvedValue({});
  forceSetProjectStatus.mockResolvedValue({});
  updateProjectMentorship.mockResolvedValue({ id: PROJECT_ID, updated: true });
  updateProjectProposer.mockResolvedValue({ id: PROJECT_ID, updated: true });
  listProjectCategories.mockResolvedValue({ rows: [] });
  setProjectCategories.mockResolvedValue({ ok: true });
  listProjectEditLog.mockResolvedValue({ rows: [] });
  getProjectMentorship.mockResolvedValue({
    mentorEmail: "",
    mentorName: null,
    seekingMentor: false,
    studentProposed: false,
  });
  getProposerForEdit.mockResolvedValue({
    accountLinked: true,
    accountName: "proposer@example.com",
    email: "proposer@example.com",
  });
});

const PROJECT_ID = "00000000-0000-0000-0000-0000000000p1";

function project(status: string, id = PROJECT_ID) {
  return { id, status, deletedAt: null };
}

// Keyed on the id, as the route renders it: a rerender with a new id is the
// remount the route relies on to drop the previous project's drafts.
function panel(status: string, id = PROJECT_ID) {
  return (
    <StaffProjectPanel
      key={id}
      onChanged={() => {
        // no-op
      }}
      project={project(status, id)}
    />
  );
}

function renderPanel(status: string) {
  return render(panel(status));
}

describe("StaffProjectPanel section order", () => {
  it("shows the seven sections in the order #322 asked for", async () => {
    renderPanel("submitted");
    await screen.findByLabelText("Proposer email");
    const titles = Array.from(document.querySelectorAll("h3")).map(
      (h) => h.textContent
    );
    expect(titles).toEqual([
      "Status",
      "Proposer",
      "Mentorship",
      "Scope assessment",
      "Categories",
      "Edit log",
      "Danger zone",
    ]);
  });
});

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

  it("keeps Save disabled until the draft differs from the saved address", async () => {
    renderPanel("submitted");
    const save = (await screen.findByRole("button", {
      name: "Save proposer",
    })) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    // Linked, so the field is locked and Re-assign is the way in (see
    // proposer-picker.test.tsx); unlink through the dialog to make a change.
    fireEvent.click(screen.getByRole("button", { name: "Re-assign" }));
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Remove the link and set an external proposer",
      })
    );
    await waitFor(() => expect(save.disabled).toBe(false));
  });

  it("links an external address with one save and reloads the record", async () => {
    getProposerForEdit.mockResolvedValueOnce({
      accountLinked: false,
      accountName: null,
      email: "",
    });
    renderPanel("submitted");
    const input = (await screen.findByLabelText(
      "Proposer email"
    )) as HTMLInputElement;
    fireEvent.change(input, { target: { value: " partner@example.com " } });
    fireEvent.click(screen.getByRole("button", { name: "Save proposer" }));

    await waitFor(() =>
      expect(updateProjectProposer).toHaveBeenCalledWith({
        data: { id: PROJECT_ID, proposerEmail: "partner@example.com" },
      })
    );
    // Once on mount, once after the save, and the log alongside it.
    await waitFor(() => expect(getProposerForEdit).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(listProjectEditLog).toHaveBeenCalledTimes(2));
  });

  it("unlinks through the dialog and sends an empty address", async () => {
    renderPanel("submitted");
    await screen.findByLabelText("Proposer email");
    fireEvent.click(screen.getByRole("button", { name: "Re-assign" }));
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Remove the link and set an external proposer",
      })
    );
    fireEvent.click(screen.getByRole("button", { name: "Save proposer" }));

    await waitFor(() =>
      expect(updateProjectProposer).toHaveBeenCalledWith({
        data: { id: PROJECT_ID, proposerEmail: "" },
      })
    );
  });

  it("gives the transition dialog the new address without a reload", async () => {
    // The dialog's checkbox reads the panel's copy of the record. A save
    // has to refresh that copy, or the dialog offers to email the old
    // proposer.
    getProposerForEdit
      .mockResolvedValueOnce({
        accountLinked: false,
        accountName: null,
        email: "",
      })
      .mockResolvedValueOnce({
        accountLinked: false,
        accountName: null,
        email: "partner@example.com",
      });
    renderPanel("submitted");
    const input = (await screen.findByLabelText(
      "Proposer email"
    )) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "partner@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Save proposer" }));
    await waitFor(() => expect(getProposerForEdit).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByTitle(/^Move to Approved\./));
    await waitFor(() =>
      expect(
        screen.getByText("Email the proposer (partner@example.com)")
      ).toBeTruthy()
    );
  });

  it("reports a failed load in the section and offers no Save", async () => {
    getProposerForEdit.mockRejectedValueOnce(new Error("Forbidden"));
    renderPanel("submitted");
    expect(await screen.findByText("Forbidden")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save proposer" })).toBeNull();
    expect(screen.queryByLabelText("Proposer email")).toBeNull();
  });

  it("reports a failed save and keeps the draft", async () => {
    getProposerForEdit.mockResolvedValueOnce({
      accountLinked: false,
      accountName: null,
      email: "",
    });
    updateProjectProposer.mockRejectedValueOnce(new Error("Forbidden"));
    renderPanel("submitted");
    const input = (await screen.findByLabelText(
      "Proposer email"
    )) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "partner@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Save proposer" }));

    expect(await screen.findByText("Forbidden")).toBeTruthy();
    expect(input.value).toBe("partner@example.com");
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
    fireEvent.click(screen.getByTitle(/^Move to Approved\./));

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
    fireEvent.click(screen.getByTitle(/^Move to Published\./));

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
    fireEvent.click(screen.getByTitle(/^Move to Approved\./));

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
    fireEvent.click(screen.getByTitle(/^Move to Approved\./));
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
    fireEvent.click(screen.getByTitle(/^Move to Approved\./));
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
    fireEvent.click(screen.getByTitle(/^Move to Submitted\./));
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
  it("prefills the saved record and shows the mentor's account like the proposer's", async () => {
    getProjectMentorship.mockResolvedValue({
      mentorEmail: "mentor@x.test",
      mentorName: "Dana Lee",
      seekingMentor: false,
      studentProposed: true,
    });
    renderPanel("submitted");

    const input = (await screen.findByLabelText(
      "Mentor email"
    )) as HTMLInputElement;
    expect(input.value).toBe("mentor@x.test");
    // Same shape as the Proposer section (#304): name, link pill, address.
    expect(await screen.findByText("Dana Lee")).toBeTruthy();
    expect(screen.getAllByText("Account linked")).toHaveLength(2);
    expect(screen.getByText("mentor@x.test")).toBeTruthy();
    expect(
      (
        screen.getByRole("checkbox", {
          name: "Student proposed",
        }) as HTMLElement
      ).getAttribute("aria-checked")
    ).toBe("true");
    expect(
      (
        screen.getByRole("checkbox", {
          name: "Looking for a mentor",
        }) as HTMLElement
      ).getAttribute("aria-checked")
    ).toBe("false");
  });

  it("says an address has no account yet, and that the catalog shows no mentor", async () => {
    getProjectMentorship.mockResolvedValue({
      mentorEmail: "mentor@x.test",
      mentorName: null,
      seekingMentor: false,
      studentProposed: false,
    });
    renderPanel("submitted");
    expect(await screen.findByText("No account yet")).toBeTruthy();
    expect(
      screen.getByText(/catalog shows no mentor until they sign up/)
    ).toBeTruthy();
  });

  it("says the catalog shows seeking when the flag is on and no address is on file", async () => {
    // Independent of student-proposed since #304: a partner project can
    // want a mentor too.
    getProjectMentorship.mockResolvedValue({
      mentorEmail: "",
      mentorName: null,
      seekingMentor: true,
      studentProposed: false,
    });
    renderPanel("submitted");
    expect(
      await screen.findByText(/shows this project as seeking a mentor/)
    ).toBeTruthy();
    expect(screen.getByText("Mentor:", { exact: false })).toBeTruthy();
  });

  it("warns when the flag is on but an address hides the badge", async () => {
    getProjectMentorship.mockResolvedValue({
      mentorEmail: "mentor@x.test",
      mentorName: null,
      seekingMentor: true,
      studentProposed: true,
    });
    renderPanel("submitted");
    expect(
      await screen.findByText(/shows no badge while an address is on file/)
    ).toBeTruthy();
  });

  it("saves all three fields through the server function and reloads the record", async () => {
    renderPanel("submitted");
    const input = (await screen.findByLabelText(
      "Mentor email"
    )) as HTMLInputElement;
    fireEvent.change(input, { target: { value: " other@x.test " } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Student proposed" }));
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Looking for a mentor" })
    );
    fireEvent.click(screen.getByRole("button", { name: "Save mentorship" }));

    await waitFor(() =>
      expect(updateProjectMentorship).toHaveBeenCalledWith({
        data: {
          id: PROJECT_ID,
          mentorEmail: "other@x.test",
          seekingMentor: true,
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
      seekingMentor: boolean;
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
      seekingMentor: false,
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

describe("StaffProjectPanel categories block", () => {
  it("prefills the saved list and keeps Save disabled until it has loaded", async () => {
    listProjectCategories.mockReturnValueOnce(new Promise(() => undefined));
    renderPanel("submitted");
    const save = screen.getByRole("button", {
      name: "Save categories",
    }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(save);
    expect(setProjectCategories).not.toHaveBeenCalled();
  });

  it("saves the draft through the server function and reloads the list", async () => {
    listProjectCategories.mockResolvedValue({
      rows: [{ id: CATEGORY_ID, name: "Robotics" }],
    });
    renderPanel("submitted");
    const box = (await screen.findByRole("checkbox", {
      name: "Robotics",
    })) as HTMLInputElement;
    await waitFor(() => expect(box.checked).toBe(true));
    fireEvent.click(box);
    fireEvent.click(screen.getByRole("button", { name: "Save categories" }));

    await waitFor(() =>
      expect(setProjectCategories).toHaveBeenCalledWith({
        data: { projectId: PROJECT_ID, categoryIds: [] },
      })
    );
    await waitFor(() => expect(listProjectCategories).toHaveBeenCalledTimes(2));
  });
});

describe("StaffProjectPanel proposer and categories across a project change", () => {
  it("drops the previous project's drafts and disables both Saves while the next records load", async () => {
    const view = renderPanel("submitted");
    const input = (await screen.findByLabelText(
      "Proposer email"
    )) as HTMLInputElement;
    expect(input.value).toBe("proposer@example.com");

    getProposerForEdit.mockReturnValueOnce(new Promise(() => undefined));
    listProjectCategories.mockReturnValueOnce(new Promise(() => undefined));
    view.rerender(panel("submitted", "00000000-0000-0000-0000-0000000000p2"));

    expect(screen.queryByLabelText("Proposer email")).toBeNull();
    expect(screen.getByText("Loading the proposer...")).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "Save categories" })
        .hasAttribute("disabled")
    ).toBe(true);
  });
});

describe("StaffProjectPanel transition dialog across a project change", () => {
  it("closes the dialog and posts nothing stale when the project id changes", async () => {
    // Without the key the dialog opened for the first project stays open
    // across the rerender, and Confirm posts its target status with the
    // second project's id.
    const view = renderPanel("submitted");
    fireEvent.click(screen.getByTitle(/^Move to Approved\./));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Confirm" })).toBeTruthy()
    );
    fireEvent.change(screen.getByLabelText("Comment (optional)"), {
      target: { value: "Looks good" },
    });

    view.rerender(panel("draft", "00000000-0000-0000-0000-0000000000p2"));

    expect(screen.queryByRole("button", { name: "Confirm" })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(performTransition).not.toHaveBeenCalled();
    // The stepper now reflects the second project, so its dialog opens on a
    // fresh draft.
    fireEvent.click(screen.getByTitle(/^Move to Submitted\./));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Confirm" })).toBeTruthy()
    );
    expect(
      (screen.getByLabelText("Comment (optional)") as HTMLTextAreaElement).value
    ).toBe("");
  });
});

describe("StaffProjectPanel mentorship across a project change", () => {
  it("drops the previous project's drafts and disables Save while the next record loads", async () => {
    getProjectMentorship.mockResolvedValueOnce({
      mentorEmail: "first@x.test",
      mentorName: null,
      seekingMentor: false,
      studentProposed: true,
    });
    const view = renderPanel("submitted");
    expect(
      ((await screen.findByLabelText("Mentor email")) as HTMLInputElement).value
    ).toBe("first@x.test");

    getProjectMentorship.mockReturnValueOnce(new Promise(() => undefined));
    view.rerender(panel("submitted", "00000000-0000-0000-0000-0000000000p2"));

    const input = screen.getByLabelText("Mentor email") as HTMLInputElement;
    expect(input.value).toBe("");
    expect(
      screen
        .getByRole("button", { name: "Save mentorship" })
        .hasAttribute("disabled")
    ).toBe(true);
  });
});
