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
  getSocialSummary: vi.fn(),
  regenerateSocialSummary: vi.fn(),
  saveSocialSummary: vi.fn(),
}));
vi.mock("#/server/social-summary", () => server);

import { SocialPreviewSection } from "#/components/social-preview-section";
import type { SocialSummaryView } from "#/lib/social-summary";

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
});

describe("SocialPreviewSection actions", () => {
  it("does not let a response overwrite what staff typed during it", async () => {
    // The textarea was editable while a request was in flight, so the
    // setDraft on the response replaced a correction typed during the wait
    // with the server's text, with nothing to say it had happened.
    await renderWith(MANUAL);
    let resolve: (v: SocialSummaryView) => void = () => undefined;
    server.regenerateSocialSummary.mockReturnValue(
      new Promise<SocialSummaryView>((r) => {
        resolve = r;
      })
    );
    fireEvent.click(regenerateButton());
    await waitFor(() => expect(textarea().disabled).toBe(true));
    resolve(AUTOMATIC);
    await waitFor(() => expect(textarea().disabled).toBe(false));
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
    server.regenerateSocialSummary.mockResolvedValue(AUTOMATIC);
    fireEvent.click(regenerateButton());

    await waitFor(() => expect(textarea().value).toBe(AUTOMATIC.summary));
    expect(regenerateButton().hasAttribute("disabled")).toBe(true);
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

  it("treats a failed load as nothing stored rather than breaking the panel", async () => {
    server.getSocialSummary.mockRejectedValue(new Error("Forbidden"));
    render(<SocialPreviewSection projectId="p1" />);
    await screen.findByLabelText("Social summary");
    expect(textarea().value).toBe("");
    expect(regenerateButton().hasAttribute("disabled")).toBe(false);
  });
});
