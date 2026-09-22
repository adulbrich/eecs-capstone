// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const server = vi.hoisted(() => ({
  getSocialSummary: vi.fn(),
  regenerateSocialSummary: vi.fn(),
  saveSocialSummary: vi.fn(),
}));
vi.mock("#/server/social-summary", () => server);

import { SocialPreviewSection } from "#/components/social-preview-section";
import type {
  RegenerateSocialSummaryResult,
  SocialSummaryView,
} from "#/lib/social-summary";

afterEach(cleanup);
beforeEach(() => {
  server.getSocialSummary.mockReset();
  server.regenerateSocialSummary.mockReset();
  server.saveSocialSummary.mockReset();
});

const AUTOMATIC: SocialSummaryView = {
  isManual: false,
  summary: "A rover that streams sensor data from a greenhouse.",
  updatedAt: new Date("2026-09-01T10:00:00Z"),
};
const MANUAL: SocialSummaryView = {
  isManual: true,
  summary: "Wording staff chose.",
  updatedAt: new Date("2026-09-02T10:00:00Z"),
};
const NONE: SocialSummaryView = {
  isManual: false,
  summary: null,
  updatedAt: null,
};
/** What Regenerate returns when its write landed. */
const REWRITTEN: RegenerateSocialSummaryResult = {
  ...AUTOMATIC,
  outcome: "rewritten",
};
/**
 * What it returns when the row moved under it: the model's text was thrown
 * away and this is what is stored instead (#564).
 */
const RACED: RegenerateSocialSummaryResult = {
  isManual: true,
  summary: "Wording a colleague saved mid-flight.",
  updatedAt: new Date("2026-09-03T10:00:00Z"),
  outcome: "changed",
};

async function renderWith(view: SocialSummaryView) {
  server.getSocialSummary.mockResolvedValue(view);
  render(<SocialPreviewSection projectId="p1" />);
  await screen.findByLabelText("Social summary");
}

const saveButton = () => screen.getByRole("button", { name: "Save" });
const regenerateButton = () =>
  screen.getByRole("button", { name: "Regenerate with AI" });
const textarea = () =>
  screen.getByLabelText("Social summary") as HTMLTextAreaElement;

function type(value: string) {
  fireEvent.change(textarea(), { target: { value } });
}

/**
 * The five states #498 settled, as a table. The rule is not obvious from
 * either button alone: Save follows whether the text differs from what is
 * stored, Regenerate follows who owns the wording, and the empty case has to
 * enable Regenerate or a Bedrock outage leaves staff with two dead buttons.
 */
describe("SocialPreviewSection button states", () => {
  it("disables both when an automatic summary is untouched", async () => {
    await renderWith(AUTOMATIC);
    expect(saveButton().hasAttribute("disabled")).toBe(true);
    expect(regenerateButton().hasAttribute("disabled")).toBe(true);
  });

  it("enables only Save once an automatic summary is edited", async () => {
    await renderWith(AUTOMATIC);
    type("Something staff prefer.");
    expect(saveButton().hasAttribute("disabled")).toBe(false);
    expect(regenerateButton().hasAttribute("disabled")).toBe(true);
  });

  it("enables only Regenerate when a manual summary is untouched", async () => {
    await renderWith(MANUAL);
    expect(saveButton().hasAttribute("disabled")).toBe(true);
    expect(regenerateButton().hasAttribute("disabled")).toBe(false);
  });

  it("enables both when a manual summary is edited", async () => {
    await renderWith(MANUAL);
    type("A further correction.");
    expect(saveButton().hasAttribute("disabled")).toBe(false);
    expect(regenerateButton().hasAttribute("disabled")).toBe(false);
  });

  it("offers Regenerate, and Save only once typed, when nothing is stored", async () => {
    // The Bedrock outage: the automatic path swallowed its error and left the
    // column null. Without Regenerate here the panel would be a dead end.
    await renderWith(NONE);
    expect(regenerateButton().hasAttribute("disabled")).toBe(false);
    expect(saveButton().hasAttribute("disabled")).toBe(true);
    type("Written by hand.");
    expect(saveButton().hasAttribute("disabled")).toBe(false);
  });

  it("disables Save again when an edit is reverted to the stored text", async () => {
    await renderWith(AUTOMATIC);
    type("Something else.");
    expect(saveButton().hasAttribute("disabled")).toBe(false);
    type(AUTOMATIC.summary as string);
    expect(saveButton().hasAttribute("disabled")).toBe(true);
  });

  it("refuses a summary over the cap without asking the server", async () => {
    await renderWith(AUTOMATIC);
    type("x".repeat(400));
    expect(saveButton().hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/at most 300 characters/)).toBeDefined();
    expect(server.saveSocialSummary).not.toHaveBeenCalled();
  });

  it("counts an emoji as one character, the way the server does", async () => {
    // 151 emoji is 151 code points and 302 UTF-16 code units. The counter read
    // `.length`, so it showed 302 against a cap of 300 and disabled Save on
    // text the schema and the server would both have accepted (#565). The
    // panel is the third of the three sites that had to agree.
    await renderWith(NONE);
    type("\u{1F600}".repeat(151));
    expect(screen.getByText("151 / 300")).toBeDefined();
    expect(saveButton().hasAttribute("disabled")).toBe(false);
    expect(screen.queryByText(/at most 300 characters/)).toBeNull();
  });

  it("still refuses 301 code points of emoji", async () => {
    await renderWith(NONE);
    type("\u{1F600}".repeat(301));
    expect(screen.getByText("301 / 300")).toBeDefined();
    expect(saveButton().hasAttribute("disabled")).toBe(true);
  });
});

describe("SocialPreviewSection actions", () => {
  it("does not let a response overwrite what staff typed during it", async () => {
    // The textarea was editable while a request was in flight, so the
    // setDraft on the response replaced a correction typed during the wait
    // with the server's text, with nothing to say it had happened.
    await renderWith(MANUAL);
    let resolve: (v: RegenerateSocialSummaryResult) => void = () => undefined;
    server.regenerateSocialSummary.mockReturnValue(
      new Promise<RegenerateSocialSummaryResult>((r) => {
        resolve = r;
      })
    );
    const typed = "A correction typed before pressing the button.";
    type(typed);
    fireEvent.click(regenerateButton());
    await waitFor(() => expect(textarea().disabled).toBe(true));

    // `userEvent`, not `fireEvent`, and the difference is the whole point.
    // `fireEvent.change` dispatches the event straight at the element, and a
    // disabled textarea takes it, so it cannot tell a guarded field from an
    // unguarded one: it reports the bug as fixed either way. `userEvent.type`
    // goes through the checks a browser makes and refuses a disabled control,
    // which is the behaviour staff actually get.
    await userEvent.type(textarea(), " typed while waiting");
    expect(textarea().value).toBe(typed);

    resolve(REWRITTEN);
    await waitFor(() => expect(textarea().disabled).toBe(false));
    expect(textarea().value).toBe(AUTOMATIC.summary);
  });

  it("saves the trimmed text and takes the manual mark back from the server", async () => {
    await renderWith(AUTOMATIC);
    server.saveSocialSummary.mockResolvedValue(MANUAL);
    type("  Wording staff chose.  ");
    fireEvent.click(saveButton());

    await waitFor(() =>
      expect(server.saveSocialSummary).toHaveBeenCalledWith({
        data: { projectId: "p1", summary: "Wording staff chose." },
      })
    );
    // The stored value comes back from the server rather than being assumed,
    // so Regenerate turns on because the row really is manual now.
    await waitFor(() =>
      expect(regenerateButton().hasAttribute("disabled")).toBe(false)
    );
  });

  it("puts the regenerated text in the box and hands the row back to the model", async () => {
    await renderWith(MANUAL);
    server.regenerateSocialSummary.mockResolvedValue(REWRITTEN);
    fireEvent.click(regenerateButton());

    await waitFor(() => expect(textarea().value).toBe(AUTOMATIC.summary));
    expect(regenerateButton().hasAttribute("disabled")).toBe(true);
    expect(screen.queryByText(/changed while the rewrite/)).toBeNull();
  });

  it("says so when the rewrite lost a race, and shows what is stored", async () => {
    // The server refused to overwrite a row that moved between the read that
    // fed the model and the write that would have stored its answer, so the
    // box is about to show wording nobody in this tab typed (#564).
    await renderWith(MANUAL);
    server.regenerateSocialSummary.mockResolvedValue(RACED);
    fireEvent.click(regenerateButton());

    const notice = await screen.findByText(
      /changed while the rewrite was running/
    );
    // Announced, not merely printed: a reader who cannot see the textarea
    // change is otherwise told nothing about text they did not ask for.
    expect(notice.getAttribute("role")).toBe("alert");
    expect(textarea().value).toBe(RACED.summary);
    // Still manual, so Regenerate is offered again rather than left dead.
    expect(regenerateButton().hasAttribute("disabled")).toBe(false);
  });

  it("reports a failed rewrite and keeps the stored wording", async () => {
    // Unlike the automatic path, which swallows: someone pressed a button.
    await renderWith(MANUAL);
    server.regenerateSocialSummary.mockRejectedValue(
      new Error("You have used all 20 social summary rewrites for this hour.")
    );
    fireEvent.click(regenerateButton());

    expect(await screen.findByText(/used all 20/)).toBeDefined();
    expect(textarea().value).toBe(MANUAL.summary);
  });

  it("offers no button at all when the load fails", async () => {
    // The panel used to map a rejected load to `{ isManual: false, summary:
    // null }`, which is the shape of an empty row, and Regenerate turns on for
    // an empty row. So a transient read failure offered the one button that
    // clears a summary staff wrote by hand, on a project whose real summary
    // the panel had never seen (#564).
    server.getSocialSummary.mockRejectedValue(new Error("Forbidden"));
    render(<SocialPreviewSection projectId="p1" />);
    await screen.findByLabelText("Social summary");

    expect(screen.getByText(/Could not load the stored summary/)).toBeDefined();
    expect(saveButton().hasAttribute("disabled")).toBe(true);
    expect(regenerateButton().hasAttribute("disabled")).toBe(true);
    expect(textarea().disabled).toBe(true);
    expect(server.regenerateSocialSummary).not.toHaveBeenCalled();
  });

  it("comes back to life on a retry that succeeds", async () => {
    server.getSocialSummary.mockRejectedValueOnce(new Error("Forbidden"));
    server.getSocialSummary.mockResolvedValue(MANUAL);
    render(<SocialPreviewSection projectId="p1" />);
    const retry = await screen.findByRole("button", { name: "Try again" });

    fireEvent.click(retry);

    await waitFor(() => expect(textarea().value).toBe(MANUAL.summary));
    expect(textarea().disabled).toBe(false);
    expect(regenerateButton().hasAttribute("disabled")).toBe(false);
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(screen.queryByText(/Could not load the stored summary/)).toBeNull();
  });
});
