// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
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
  });
  getProposerForEdit.mockResolvedValue({
    accountLinked: true,
    accountName: "proposer@example.com",
    email: "proposer@example.com",
    studentProposed: false,
  });
});

const PROJECT_ID = "00000000-0000-0000-0000-0000000000p1";

function project(status: string, id = PROJECT_ID) {
  return { id, status, deletedAt: null };
}

// Keyed on the id, as the route renders it: a rerender with a new id is the
// remount the route relies on to drop the previous project's drafts.
function panel(status: string, id = PROJECT_ID, viewerIsOwner = false) {
  return (
    <StaffProjectPanel
      key={id}
      onChanged={() => {
        // no-op
      }}
      project={project(status, id)}
      viewerIsOwner={viewerIsOwner}
    />
  );
}

function renderPanel(status: string, viewerIsOwner = false) {
  return render(panel(status, PROJECT_ID, viewerIsOwner));
}

/** The confirm a save that would email someone opens (#379). */
function confirmDialog(title: string) {
  return within(screen.getByRole("dialog", { name: title }));
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
      "Mentor",
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

  it("saves the student-proposed mark with the link, and enables Save on the mark alone", async () => {
    renderPanel("submitted");
    const save = (await screen.findByRole("button", {
      name: "Save proposer",
    })) as HTMLButtonElement;
    const mark = screen.getByRole("checkbox", { name: "Student proposed" });
    expect(mark.getAttribute("aria-checked")).toBe("false");
    expect(
      screen.getByText("Shown as a badge on the card and project page.")
    ).toBeTruthy();
    expect(save.disabled).toBe(true);
    fireEvent.click(mark);
    await waitFor(() => expect(save.disabled).toBe(false));
    fireEvent.click(save);
    // The mark alone mails nobody, so no confirm stands between the click
    // and the save (#379).
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() =>
      expect(updateProjectProposer).toHaveBeenCalledWith({
        data: {
          id: PROJECT_ID,
          proposerEmail: "proposer@example.com",
          sendEmail: true,
          studentProposed: true,
        },
      })
    );
    // One save, one reload of the record, as with the address.
    await waitFor(() => expect(getProposerForEdit).toHaveBeenCalledTimes(2));
  });

  it("links an external address with one save and reloads the record", async () => {
    getProposerForEdit.mockResolvedValueOnce({
      accountLinked: false,
      accountName: null,
      email: "",
      studentProposed: false,
    });
    renderPanel("submitted");
    const input = (await screen.findByLabelText(
      "Proposer email"
    )) as HTMLInputElement;
    fireEvent.change(input, { target: { value: " partner@example.com " } });
    fireEvent.click(screen.getByRole("button", { name: "Save proposer" }));

    // A new address is announced before it is saved (#379).
    const dialog = confirmDialog("Save the proposer?");
    expect(
      dialog.getByText("This assigns the project to partner@example.com.")
    ).toBeTruthy();
    expect(
      dialog
        .getByRole("checkbox", { name: "Email partner@example.com" })
        .getAttribute("aria-checked")
    ).toBe("true");
    expect(
      dialog.getByText(
        "Uncheck to skip the email; the in-app notification is still sent."
      )
    ).toBeTruthy();
    fireEvent.click(dialog.getByRole("button", { name: "Save proposer" }));

    await waitFor(() =>
      expect(updateProjectProposer).toHaveBeenCalledWith({
        data: {
          id: PROJECT_ID,
          proposerEmail: "partner@example.com",
          sendEmail: true,
          studentProposed: false,
        },
      })
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
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

    // An unlink tells nobody, so nothing asks about an email.
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() =>
      expect(updateProjectProposer).toHaveBeenCalledWith({
        data: {
          id: PROJECT_ID,
          proposerEmail: "",
          sendEmail: true,
          studentProposed: false,
        },
      })
    );
  });

  it("sends sendEmail: false when the confirm's box is unchecked, and the same address in another case asks nothing", async () => {
    renderPanel("submitted");
    const input = (await screen.findByLabelText(
      "Proposer email"
    )) as HTMLInputElement;
    fireEvent.click(screen.getByRole("button", { name: "Re-assign" }));
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Remove the link and set an external proposer",
      })
    );
    fireEvent.change(input, { target: { value: "new@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Save proposer" }));

    const dialog = confirmDialog("Save the proposer?");
    fireEvent.click(
      dialog.getByRole("checkbox", { name: "Email new@example.com" })
    );
    fireEvent.click(dialog.getByRole("button", { name: "Save proposer" }));
    await waitFor(() =>
      expect(updateProjectProposer.mock.calls[0]?.[0].data.sendEmail).toBe(
        false
      )
    );

    // The server lowercases before it compares, so a case-only retype of
    // the saved address is not a change there and mails nobody: no confirm.
    cleanup();
    renderPanel("submitted");
    const again = (await screen.findByLabelText(
      "Proposer email"
    )) as HTMLInputElement;
    fireEvent.click(screen.getByRole("button", { name: "Re-assign" }));
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Remove the link and set an external proposer",
      })
    );
    fireEvent.change(again, { target: { value: "Proposer@Example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Save proposer" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(updateProjectProposer).toHaveBeenCalledTimes(2));
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
    fireEvent.click(
      confirmDialog("Save the proposer?").getByRole("button", {
        name: "Save proposer",
      })
    );
    await waitFor(() => expect(getProposerForEdit).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    fireEvent.click(screen.getByTitle(/^Move to Approved\./));
    await waitFor(() =>
      expect(screen.getByText("Email partner@example.com")).toBeTruthy()
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
      studentProposed: false,
    });
    updateProjectProposer.mockRejectedValueOnce(new Error("Forbidden"));
    renderPanel("submitted");
    const input = (await screen.findByLabelText(
      "Proposer email"
    )) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "partner@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Save proposer" }));
    const dialog = confirmDialog("Save the proposer?");
    fireEvent.click(dialog.getByRole("button", { name: "Save proposer" }));

    // The failure shows in the open confirm, and only there.
    expect(await dialog.findByText("Forbidden")).toBeTruthy();
    expect(screen.getAllByText("Forbidden")).toHaveLength(1);
    expect(input.value).toBe("partner@example.com");
  });

  it("says no account yet when the address has not been claimed", async () => {
    getProposerForEdit.mockResolvedValue({
      accountLinked: false,
      accountName: null,
      email: "external@x.com",
      studentProposed: false,
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
      expect(screen.getByText("Email proposer@example.com")).toBeTruthy()
    );
    const checkbox = screen.getByRole("checkbox");
    expect(checkbox.getAttribute("aria-checked")).toBe("true");
    expect(checkbox.hasAttribute("disabled")).toBe(false);
    // The bell row is not the email's to skip (#379).
    expect(
      screen.getByText(
        "Uncheck to skip the email; the in-app notification is still sent."
      )
    ).toBeTruthy();
  });

  it("shows the checkbox for the Draft dialog and holds Confirm until a comment is typed", async () => {
    // Returning a submission to draft emails the proposer like changes
    // requested does, so the staff skip applies and the comment is required.
    renderPanel("submitted");
    fireEvent.click(screen.getByTitle(/^Move to Draft\./));

    await waitFor(() =>
      expect(screen.getByText("Email proposer@example.com")).toBeTruthy()
    );
    const confirm = screen.getByRole("button", { name: "Confirm" });
    expect(confirm.hasAttribute("disabled")).toBe(true);
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Scope this to one term." },
    });
    expect(confirm.hasAttribute("disabled")).toBe(false);
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
      studentProposed: false,
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
      studentProposed: false,
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

  it("sends sendEmail: true on a Submitted transition, which emails the staff inbox", async () => {
    // No checkbox renders for this transition, so nothing in the UI could ever
    // set the flag false. Every other assertion in this suite checks for
    // false, which is how a panel that always muted mail passed the whole
    // suite once already.
    getProposerForEdit.mockResolvedValue({
      accountLinked: false,
      accountName: null,
      email: "",
      studentProposed: false,
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

describe("StaffProjectPanel mentor block", () => {
  it("prefills the saved record and shows the mentor's account like the proposer's", async () => {
    getProjectMentorship.mockResolvedValue({
      mentorEmail: "mentor@x.test",
      mentorName: "Dana Lee",
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
    // The address is the whole record since #402: no radio group and no
    // preview of a public badge, since nothing about the mentor is public.
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.queryByText("Public listing shows:")).toBeNull();
    // Student proposed lives in the Proposer section now (#336), not here.
  });

  it("says an address has no account yet, with the proposer's wording", async () => {
    getProjectMentorship.mockResolvedValue({
      mentorEmail: "mentor@x.test",
      mentorName: null,
    });
    renderPanel("submitted");
    expect(await screen.findByText("No account yet")).toBeTruthy();
    expect(
      screen.getAllByText(
        "Links automatically when they sign up with this address."
      ).length
    ).toBeGreaterThan(0);
  });

  it("saves the address through the server function and reloads the record", async () => {
    renderPanel("submitted");
    const input = (await screen.findByLabelText(
      "Mentor email"
    )) as HTMLInputElement;
    fireEvent.change(input, { target: { value: " other@x.test " } });
    fireEvent.click(screen.getByRole("button", { name: "Save mentor" }));

    // A new address is announced before it is saved, and the mentor has no
    // bell row, so the line says they will not be told (#379).
    const dialog = confirmDialog("Save the mentor?");
    expect(
      dialog.getByText("This names other@x.test as the mentor.")
    ).toBeTruthy();
    expect(
      dialog
        .getByRole("checkbox", { name: "Email other@x.test" })
        .getAttribute("aria-checked")
    ).toBe("true");
    expect(dialog.getByText("Uncheck and they will not be told.")).toBeTruthy();
    fireEvent.click(dialog.getByRole("button", { name: "Save mentor" }));

    await waitFor(() =>
      expect(updateProjectMentorship).toHaveBeenCalledWith({
        data: {
          id: PROJECT_ID,
          mentorEmail: "other@x.test",
          sendEmail: true,
        },
      })
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // Once on mount, once after the save.
    await waitFor(() => expect(getProjectMentorship).toHaveBeenCalledTimes(2));
  });

  it("saves a case-only retype with no confirm, and sends sendEmail: false when the box is unchecked", async () => {
    getProjectMentorship.mockResolvedValue({
      mentorEmail: "kept@x.test",
      mentorName: null,
    });
    renderPanel("submitted");
    await screen.findByDisplayValue("kept@x.test");
    // Once under the mentor field, once under the proposer picker.
    expect(
      screen.getAllByText("Saving a new address emails it.", { exact: false })
    ).toHaveLength(2);
    // The same address in another case is not a new one, compared the way
    // the server compares (#385), so no dialog announces an email.
    fireEvent.change(screen.getByLabelText("Mentor email"), {
      target: { value: "Kept@x.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save mentor" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() =>
      expect(updateProjectMentorship).toHaveBeenCalledWith({
        data: {
          id: PROJECT_ID,
          mentorEmail: "Kept@x.test",
          sendEmail: true,
        },
      })
    );

    fireEvent.change(screen.getByLabelText("Mentor email"), {
      target: { value: "next@x.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save mentor" }));
    const dialog = confirmDialog("Save the mentor?");
    fireEvent.click(
      dialog.getByRole("checkbox", { name: "Email next@x.test" })
    );
    fireEvent.click(dialog.getByRole("button", { name: "Save mentor" }));
    await waitFor(() =>
      expect(updateProjectMentorship.mock.calls[1]?.[0].data).toEqual({
        id: PROJECT_ID,
        mentorEmail: "next@x.test",
        sendEmail: false,
      })
    );
  });

  it("checks the box again after a Cancel, so a skip is about one save", async () => {
    renderPanel("submitted");
    fireEvent.change(await screen.findByLabelText("Mentor email"), {
      target: { value: "next@x.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save mentor" }));
    let dialog = confirmDialog("Save the mentor?");
    fireEvent.click(
      dialog.getByRole("checkbox", { name: "Email next@x.test" })
    );
    fireEvent.click(dialog.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "Save mentor" }));
    dialog = confirmDialog("Save the mentor?");
    expect(
      dialog
        .getByRole("checkbox", { name: "Email next@x.test" })
        .getAttribute("aria-checked")
    ).toBe("true");
  });

  it("keeps a failed save's error inside the open confirm", async () => {
    updateProjectMentorship.mockRejectedValueOnce(new Error("SES is down"));
    renderPanel("submitted");
    fireEvent.change(await screen.findByLabelText("Mentor email"), {
      target: { value: "next@x.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save mentor" }));
    const dialog = confirmDialog("Save the mentor?");
    fireEvent.click(dialog.getByRole("button", { name: "Save mentor" }));
    expect(await dialog.findByText("SES is down")).toBeTruthy();
    expect(screen.getAllByText("SES is down")).toHaveLength(1);
  });
});

describe("StaffProjectPanel hard delete email", () => {
  it("offers the skip to staff deleting someone else's draft, and sends the choice", async () => {
    hardDeleteProject.mockResolvedValue({ id: PROJECT_ID });
    renderPanel("draft");
    await screen.findByLabelText("Proposer email");
    fireEvent.click(screen.getByRole("button", { name: "Hard delete" }));

    const dialog = within(
      screen.getByRole("alertdialog", {
        name: "Permanently delete this draft?",
      })
    );
    const box = dialog.getByRole("checkbox", {
      name: "Email proposer@example.com",
    });
    expect(box.getAttribute("aria-checked")).toBe("true");
    expect(dialog.getByText("Uncheck and they will not be told.")).toBeTruthy();
    fireEvent.click(box);
    fireEvent.click(dialog.getByRole("button", { name: "Hard delete" }));

    await waitFor(() =>
      expect(hardDeleteProject).toHaveBeenCalledWith({
        data: { id: PROJECT_ID, sendEmail: false },
      })
    );
  });

  it("offers no skip when staff delete their own draft, since nobody is emailed", async () => {
    renderPanel("draft", true);
    await screen.findByLabelText("Proposer email");
    fireEvent.click(screen.getByRole("button", { name: "Hard delete" }));

    const dialog = within(
      screen.getByRole("alertdialog", {
        name: "Permanently delete this draft?",
      })
    );
    expect(dialog.queryByRole("checkbox")).toBeNull();
  });
});

describe("StaffProjectPanel mentor save gate", () => {
  it("keeps Save disabled until the record has loaded, so blank drafts cannot clear a mentor", async () => {
    let resolveLoad: (value: {
      mentorEmail: string;
      mentorName: string | null;
    }) => void = () => {
      // replaced below
    };
    getProjectMentorship.mockReturnValue(
      new Promise((resolve) => {
        resolveLoad = resolve;
      })
    );
    renderPanel("submitted");

    const save = screen.getByRole("button", { name: "Save mentor" });
    expect(save.hasAttribute("disabled")).toBe(true);
    fireEvent.click(save);
    expect(updateProjectMentorship).not.toHaveBeenCalled();

    resolveLoad({
      mentorEmail: "mentor@x.test",
      mentorName: null,
    });
    await waitFor(() => expect(save.hasAttribute("disabled")).toBe(false));
  });

  it("reports a failed load and keeps Save disabled", async () => {
    getProjectMentorship.mockRejectedValue(new Error("Forbidden"));
    renderPanel("submitted");
    expect(await screen.findByText("Forbidden")).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "Save mentor" })
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

describe("StaffProjectPanel mentor across a project change", () => {
  it("drops the previous project's drafts and disables Save while the next record loads", async () => {
    getProjectMentorship.mockResolvedValueOnce({
      mentorEmail: "first@x.test",
      mentorName: null,
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
        .getByRole("button", { name: "Save mentor" })
        .hasAttribute("disabled")
    ).toBe(true);
  });
});
