// @vitest-environment jsdom
import { focusManager, notifyManager } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQueryClient } from "./shared/query-client";

const server = vi.hoisted(() => ({
  getSocialSummary: vi.fn(),
  regenerateSocialSummary: vi.fn(),
  saveSocialSummary: vi.fn(),
}));
vi.mock("#/server/social-summary", () => server);

import {
  SocialPreviewSection,
  type SummaryRefresh,
} from "#/components/social-preview-section";
import type {
  RegenerateSocialSummaryResult,
  SaveSocialSummaryResult,
  SocialSummaryView,
} from "#/lib/social-summary";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  focusManager.setFocused(undefined);
});
beforeEach(() => {
  server.getSocialSummary.mockReset();
  server.regenerateSocialSummary.mockReset();
  server.saveSocialSummary.mockReset();
});

const AUTOMATIC: SocialSummaryView = {
  isManual: false,
  automaticEnabled: true,
  current: true,
  refreshable: true,
  summaryAttempt: null,
  summary: "A rover that streams sensor data from a greenhouse.",
  updatedAt: new Date("2026-09-01T10:00:00Z"),
};
const MANUAL: SocialSummaryView = {
  isManual: true,
  automaticEnabled: true,
  current: false,
  refreshable: true,
  summaryAttempt: null,
  summary: "Wording staff chose.",
  updatedAt: new Date("2026-09-02T10:00:00Z"),
};
const NONE: SocialSummaryView = {
  isManual: false,
  automaticEnabled: true,
  current: false,
  refreshable: true,
  summaryAttempt: null,
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
  automaticEnabled: true,
  current: false,
  refreshable: true,
  summaryAttempt: null,
  summary: "Wording a colleague saved mid-flight.",
  updatedAt: new Date("2026-09-03T10:00:00Z"),
  outcome: "changed",
};

/** What Save returns when its write landed. */
const SAVED: SaveSocialSummaryResult = { ...MANUAL, outcome: "saved" };
/** What it returns when a colleague's save landed after this tab loaded. */
const SAVE_LOST: SaveSocialSummaryResult = {
  ...MANUAL,
  summary: "Wording Carol saved.",
  updatedAt: new Date("2026-09-03T10:00:00Z"),
  outcome: "changed",
};

async function renderWith(view: SocialSummaryView) {
  server.getSocialSummary.mockResolvedValue(view);
  renderWithQueryClient(<SocialPreviewSection projectId="p1" />);
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
    expect(screen.getByText(/at most 300 characters/u)).toBeDefined();
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
    expect(screen.queryByText(/at most 300 characters/u)).toBeNull();
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
    server.saveSocialSummary.mockResolvedValue(SAVED);
    type("  Wording staff chose.  ");
    fireEvent.click(saveButton());

    // `expected` is what this tab loaded, verbatim, so the server can refuse
    // the save if a colleague's landed since (#583).
    await waitFor(() =>
      expect(server.saveSocialSummary).toHaveBeenCalledWith({
        data: {
          projectId: "p1",
          summary: "Wording staff chose.",
          expected: { summary: AUTOMATIC.summary, isManual: false },
        },
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
    expect(screen.queryByText(/changed while the rewrite/u)).toBeNull();
  });

  it("says so when the rewrite lost a race, and shows what is stored", async () => {
    // The server refused to overwrite a row that moved between the read that
    // fed the model and the write that would have stored its answer, so the
    // box is about to show wording nobody in this tab typed (#564).
    await renderWith(MANUAL);
    server.regenerateSocialSummary.mockResolvedValue(RACED);
    fireEvent.click(regenerateButton());

    const notice = await screen.findByText(
      /changed while the rewrite was running/u
    );
    // Announced, not merely printed: a reader who cannot see the textarea
    // change is otherwise told nothing about text they did not ask for.
    expect(notice.getAttribute("role")).toBe("alert");
    expect(textarea().value).toBe(RACED.summary);
    // Still manual, so Regenerate is offered again rather than left dead.
    expect(regenerateButton().hasAttribute("disabled")).toBe(false);
  });

  it("says so when a save lost to a colleague's, and keeps what was typed", async () => {
    // Carol saved after this tab loaded, so the server wrote nothing (#583).
    // The box keeps this tab's wording, which nothing else has kept, and the
    // notice carries Carol's, so both are on screen.
    await renderWith(MANUAL);
    server.saveSocialSummary.mockResolvedValueOnce(SAVE_LOST);
    type("Wording Bob typed.");
    fireEvent.click(saveButton());

    const notice = await screen.findByText(/so yours was not saved/u);
    expect(notice.getAttribute("role")).toBe("alert");
    expect(notice.textContent).toContain(`"${SAVE_LOST.summary}"`);
    expect(textarea().value).toBe("Wording Bob typed.");

    // A second Save is a knowing overwrite: it carries Carol's wording as
    // what it replaces, and succeeds.
    server.saveSocialSummary.mockResolvedValueOnce({
      ...SAVED,
      summary: "Wording Bob typed.",
    });
    fireEvent.click(saveButton());
    await waitFor(() =>
      expect(server.saveSocialSummary).toHaveBeenLastCalledWith({
        data: {
          projectId: "p1",
          summary: "Wording Bob typed.",
          expected: { summary: SAVE_LOST.summary, isManual: true },
        },
      })
    );
    await waitFor(() =>
      expect(screen.queryByText(/so yours was not saved/u)).toBeNull()
    );
  });

  it("treats a miss that already stores the typed wording as saved", async () => {
    // This tab's earlier save landed but its answer was lost, so the retry
    // misses on its own write. Nothing was lost, so nothing is announced.
    await renderWith(AUTOMATIC);
    server.saveSocialSummary.mockResolvedValueOnce({
      ...SAVE_LOST,
      summary: "Wording Bob typed.",
    });
    type("Wording Bob typed.");
    fireEvent.click(saveButton());

    await waitFor(() =>
      expect(regenerateButton().hasAttribute("disabled")).toBe(false)
    );
    expect(screen.queryByText(/so yours was not saved/u)).toBeNull();
    expect(saveButton().hasAttribute("disabled")).toBe(true);
  });

  it("reports a failed rewrite and keeps the stored wording", async () => {
    // Unlike the automatic path, which swallows: someone pressed a button.
    await renderWith(MANUAL);
    server.regenerateSocialSummary.mockRejectedValue(
      new Error("You have used all 20 social summary rewrites for this hour.")
    );
    fireEvent.click(regenerateButton());

    expect(await screen.findByText(/used all 20/u)).toBeDefined();
    expect(textarea().value).toBe(MANUAL.summary);
  });

  it("offers no button at all when the load fails", async () => {
    // The panel used to map a rejected load to `{ isManual: false, summary:
    // null }`, which is the shape of an empty row, and Regenerate turns on for
    // an empty row. So a transient read failure offered the one button that
    // clears a summary staff wrote by hand, on a project whose real summary
    // the panel had never seen (#564).
    server.getSocialSummary.mockRejectedValue(new Error("Forbidden"));
    renderWithQueryClient(<SocialPreviewSection projectId="p1" />);
    await screen.findByLabelText("Social summary");

    expect(
      screen.getByText(/Could not load the stored summary/u)
    ).toBeDefined();
    expect(saveButton().hasAttribute("disabled")).toBe(true);
    expect(regenerateButton().hasAttribute("disabled")).toBe(true);
    expect(textarea().disabled).toBe(true);
    expect(server.regenerateSocialSummary).not.toHaveBeenCalled();
  });

  it("comes back to life on a retry that succeeds", async () => {
    server.getSocialSummary.mockRejectedValueOnce(new Error("Forbidden"));
    server.getSocialSummary.mockResolvedValue(MANUAL);
    renderWithQueryClient(<SocialPreviewSection projectId="p1" />);
    const retry = await screen.findByRole("button", { name: "Try again" });

    fireEvent.click(retry);

    await waitFor(() => expect(textarea().value).toBe(MANUAL.summary));
    expect(textarea().disabled).toBe(false);
    expect(regenerateButton().hasAttribute("disabled")).toBe(false);
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(screen.queryByText(/Could not load the stored summary/u)).toBeNull();
  });
});

const FAILED_AT = new Date("2026-10-05T10:02:00Z");

/**
 * The last rewrite (#631): staff must tell "never attempted" from "failed",
 * and a failure must leave them a button rather than a dead end.
 */
describe("SocialPreviewSection last rewrite", () => {
  it("says no attempt has run on a published project with nothing stored", async () => {
    await renderWith(NONE);
    expect(
      screen.getByText("No automatic attempt on record yet.")
    ).toBeDefined();
    expect(screen.queryByText(/failed/u)).toBeNull();
  });

  it("says the automatic path is off rather than that it has not run yet", async () => {
    // With the kill switch off every refresh skips and records nothing, so
    // "not yet" would be a promise nothing keeps.
    await renderWith({ ...NONE, automaticEnabled: false });
    expect(
      screen.getByText(/Automatic summaries are switched off/u)
    ).toBeDefined();
    expect(screen.queryByText(/No automatic attempt/u)).toBeNull();
  });

  it("says when one will run on a project that is not published yet", async () => {
    await renderWith({ ...NONE, refreshable: false });
    expect(
      screen.getByText("Written automatically once the project is published.")
    ).toBeDefined();
  });

  it("tells a failure apart from never attempted, and offers Regenerate", async () => {
    await renderWith({
      ...NONE,
      summaryAttempt: {
        at: FAILED_AT,
        outcome: "failed",
        trigger: "automatic",
      },
    });
    expect(
      screen.getByText(/The last rewrite failed automatically/u)
    ).toBeDefined();
    expect(screen.getByText(/previews use the start/u)).toBeDefined();
    expect(
      screen.queryByText("No automatic attempt on record yet.")
    ).toBeNull();
    expect(regenerateButton().hasAttribute("disabled")).toBe(false);
  });

  it("offers Regenerate when the rewrite of a stored summary failed", async () => {
    // The dead end this closes: a summary of older text, a failure beside it,
    // and Regenerate off because the row is neither manual nor empty.
    await renderWith({
      ...AUTOMATIC,
      summaryAttempt: {
        at: FAILED_AT,
        outcome: "failed",
        trigger: "automatic",
      },
    });
    expect(screen.getByText(/the last one written/u)).toBeDefined();
    expect(regenerateButton().hasAttribute("disabled")).toBe(false);
  });

  it("names the button when the failed attempt was a staff Regenerate", async () => {
    await renderWith({
      ...AUTOMATIC,
      summaryAttempt: { at: FAILED_AT, outcome: "failed", trigger: "staff" },
    });
    expect(
      screen.getByText(/The last rewrite failed from Regenerate/u)
    ).toBeDefined();
  });

  it("says a superseded rewrite was dropped, without calling it a failure", async () => {
    await renderWith({
      ...AUTOMATIC,
      summaryAttempt: {
        at: FAILED_AT,
        outcome: "superseded",
        trigger: "automatic",
      },
    });
    expect(
      screen.getByText(/was dropped because the project changed/u)
    ).toBeDefined();
    expect(regenerateButton().hasAttribute("disabled")).toBe(true);
  });

  it("adds nothing beside a summary that was written", async () => {
    await renderWith({
      ...AUTOMATIC,
      summaryAttempt: {
        at: FAILED_AT,
        outcome: "updated",
        trigger: "automatic",
      },
    });
    expect(screen.queryByText(/last rewrite/u)).toBeNull();
    expect(screen.queryByText(/No automatic attempt/u)).toBeNull();
  });

  it("hides the automatic status on a summary staff wrote", async () => {
    // The automatic path never touches a manual summary, so its old failure
    // says nothing about what is stored.
    await renderWith({
      ...MANUAL,
      summaryAttempt: {
        at: FAILED_AT,
        outcome: "failed",
        trigger: "automatic",
      },
    });
    expect(screen.queryByText(/last rewrite/u)).toBeNull();
  });
});

/** An approved project with nothing written yet, as the section loads it. */
const BEFORE_PUBLISH: SocialSummaryView = { ...NONE, refreshable: false };
/** What a poll reads while the refresh is still running. */
const PENDING: SocialSummaryView = { ...NONE };
/** What a poll reads once the refresh has written. */
const ARRIVED: SocialSummaryView = {
  ...NONE,
  current: true,
  summary: "A rover written up after the publish.",
  updatedAt: new Date("2026-10-30T10:00:05Z"),
};

/** Reads after the first, which loaded the section. */
const polls = () => server.getSocialSummary.mock.calls.length - 1;
const waitingNote = () => screen.queryByText(/Writing the summary now that/u);

/**
 * Loads `before` on real timers, then fakes the clock and hands the section a
 * refresh, as the panel does once its action and `onChanged` have landed.
 */
async function startWait(
  before: SocialSummaryView,
  cause: SummaryRefresh["cause"] = "published",
  edit?: string
) {
  server.getSocialSummary.mockResolvedValueOnce(before);
  const view = renderWithQueryClient(<SocialPreviewSection projectId="p1" />);
  await screen.findByLabelText("Social summary");
  if (edit !== undefined) {
    type(edit);
  }
  vi.useFakeTimers({
    toFake: [
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
      "Date",
    ],
  });
  const refresh = refreshNow(cause);
  view.rerender(<SocialPreviewSection projectId="p1" refresh={refresh} />);
  /** Renders the section again with nothing new, as a parent's render does. */
  const renderAgain = () =>
    view.rerender(<SocialPreviewSection projectId="p1" refresh={refresh} />);
  return { view, renderAgain };
}

/** A refresh the server started now, by the faked clock both sides share. */
function refreshNow(cause: SummaryRefresh["cause"]): SummaryRefresh {
  return { cause, refreshStartedAt: new Date(), sentAt: Date.now() };
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function expectLocked(locked: boolean) {
  expect(textarea().disabled).toBe(locked);
  if (locked) {
    expect(saveButton().hasAttribute("disabled")).toBe(true);
    expect(regenerateButton().hasAttribute("disabled")).toBe(true);
  }
}

/**
 * The wait after a publish, archive or restore (#616). The refresh answers
 * after the action does, and the section's query never refetches on its own,
 * so without this staff saw "No automatic attempt on record yet." until they
 * reloaded.
 */
describe("SocialPreviewSection waiting for a refresh", () => {
  // TanStack tells observers about a landed poll on a zero-delay timeout of
  // its own, which these fake timers never ran: the cache moved and the
  // section did not. Microtasks deliver it inside the same `act`.
  beforeEach(() => notifyManager.setScheduler(queueMicrotask));
  afterEach(() => notifyManager.setScheduler((cb) => setTimeout(cb, 0)));

  it("locks the section after a publish and fills the box when the summary lands", async () => {
    await startWait(BEFORE_PUBLISH);
    server.getSocialSummary.mockResolvedValue(PENDING);

    expectLocked(true);
    const note = waitingNote();
    expect(note?.textContent).toBe(
      "Writing the summary now that the project is published. The box unlocks when it arrives."
    );
    // Polite, not an alert: nothing went wrong.
    expect(note?.tagName).toBe("OUTPUT");
    expect(screen.queryByText(/No automatic attempt/u)).toBeNull();

    await advance(2000);
    expect(polls()).toBe(1);
    expectLocked(true);

    server.getSocialSummary.mockResolvedValue(ARRIVED);
    await advance(2000);
    expect(polls()).toBe(2);
    expectLocked(false);
    expect(textarea().value).toBe(ARRIVED.summary);
    expect(waitingNote()).toBeNull();
    // Nothing to save: the box holds what is stored.
    expect(saveButton().hasAttribute("disabled")).toBe(true);

    await advance(60_000);
    expect(polls()).toBe(2);
  });

  it("settles on the first poll when the stored summary is already current", async () => {
    // A republish with unchanged text: the refresh returns `unchanged` and
    // moves neither the time nor the attempt, so only `current` can say so.
    await startWait({ ...AUTOMATIC, refreshable: false });
    server.getSocialSummary.mockResolvedValue(AUTOMATIC);

    await advance(2000);
    expect(polls()).toBe(1);
    expectLocked(false);
    expect(textarea().value).toBe(AUTOMATIC.summary);

    await advance(30_000);
    expect(polls()).toBe(1);
  });

  it("says the project changed after an archive or restore, and settles the same way", async () => {
    await startWait(AUTOMATIC, "changed");
    server.getSocialSummary.mockResolvedValue(AUTOMATIC);

    expect(waitingNote()?.textContent).toBe(
      "Writing the summary now that the project changed. The box unlocks when it arrives."
    );
    await advance(2000);
    expect(polls()).toBe(1);
    expect(waitingNote()).toBeNull();
    expectLocked(false);
  });

  it("ends on a failure since the refresh started, and shows it", async () => {
    const failedAt = (at: Date): SocialSummaryView => ({
      ...NONE,
      summaryAttempt: { at, outcome: "failed", trigger: "automatic" },
    });
    await startWait(failedAt(FAILED_AT));
    // Not the failure staff already saw, nor one recorded after the page
    // loaded and before the action: neither is this refresh's.
    server.getSocialSummary.mockResolvedValue(
      failedAt(new Date(Date.now() - 1000))
    );
    await advance(2000);
    expectLocked(true);

    server.getSocialSummary.mockResolvedValue(failedAt(new Date()));
    await advance(2000);
    expectLocked(false);
    expect(
      screen.getByText(/The last rewrite failed automatically/u)
    ).toBeDefined();
    expect(regenerateButton().hasAttribute("disabled")).toBe(false);

    await advance(30_000);
    expect(polls()).toBe(2);
  });

  it("polls every 2 s to 20 s, then every 10 s, and gives up on the poll at 120 s", async () => {
    // A stale automatic summary, so Regenerate is off until the wait gives up.
    const stale: SocialSummaryView = { ...AUTOMATIC, current: false };
    await startWait(stale);
    server.getSocialSummary.mockResolvedValue(stale);

    await advance(20_000);
    expect(polls()).toBe(10);
    await advance(9000);
    expect(polls()).toBe(10);
    await advance(1000);
    expect(polls()).toBe(11);
    await advance(80_000);
    expect(polls()).toBe(19);
    expectLocked(true);

    await advance(9999);
    expectLocked(true);
    await advance(1);
    expect(polls()).toBe(20);
    expectLocked(false);
    expect(
      screen.getByText(/has not arrived after two minutes/u)
    ).toBeDefined();
    expect(textarea().value).toBe(AUTOMATIC.summary);
    // The sentence offers Regenerate, so it is on.
    expect(regenerateButton().hasAttribute("disabled")).toBe(false);

    await advance(120_000);
    expect(polls()).toBe(20);
  });

  it("does not give up in a hidden tab, and decides on the first poll back", async () => {
    const { renderAgain } = await startWait(BEFORE_PUBLISH);
    server.getSocialSummary.mockResolvedValue(PENDING);
    focusManager.setFocused(false);
    await advance(130_000);
    expect(polls()).toBe(0);
    expectLocked(true);

    // Coming back refetches the panel's edit log, whose render reaches this
    // section and works the schedule out again, now past the cap.
    renderAgain();
    server.getSocialSummary.mockResolvedValue(ARRIVED);
    focusManager.setFocused(true);
    await advance(2000);
    expect(polls()).toBe(1);
    expectLocked(false);
    expect(textarea().value).toBe(ARRIVED.summary);
    expect(screen.queryByText(/has not arrived/u)).toBeNull();
  });

  it("gives up on the first poll back from a hidden tab when nothing came", async () => {
    await startWait(BEFORE_PUBLISH);
    server.getSocialSummary.mockResolvedValue(PENDING);
    focusManager.setFocused(false);
    await advance(130_000);
    focusManager.setFocused(true);
    await advance(2000);

    expect(polls()).toBe(1);
    expect(
      screen.getByText(/has not arrived after two minutes/u)
    ).toBeDefined();
  });

  it("starts over when a second action lands during the wait", async () => {
    // Archived a minute after publishing: the cap runs from the archive.
    const { view } = await startWait(BEFORE_PUBLISH);
    server.getSocialSummary.mockResolvedValue(PENDING);
    await advance(60_000);
    view.rerender(
      <SocialPreviewSection projectId="p1" refresh={refreshNow("changed")} />
    );
    expect(waitingNote()?.textContent).toContain(
      "now that the project changed"
    );

    await advance(110_000);
    expectLocked(true);
    await advance(10_000);
    expect(
      screen.getByText(/has not arrived after two minutes/u)
    ).toBeDefined();
  });

  it("ends on a poll that fails, keeping what last loaded", async () => {
    await startWait(BEFORE_PUBLISH);
    server.getSocialSummary.mockResolvedValue(PENDING);
    await advance(2000);
    server.getSocialSummary.mockRejectedValue(new Error("Network down"));
    await advance(2000);

    expectLocked(false);
    // A read that failed, so an error, as the section's load failure is.
    expect(
      screen
        .getByText(/Could not check whether the summary has arrived/u)
        .getAttribute("role")
    ).toBe("alert");
    // The data survived the failed refetch, so this is not a failed load.
    expect(screen.queryByText(/Could not load the stored summary/u)).toBeNull();
    expect(regenerateButton().hasAttribute("disabled")).toBe(false);

    await advance(30_000);
    expect(polls()).toBe(2);
  });

  it("ends when a poll shows a colleague saved by hand, with their wording in the box", async () => {
    await startWait(BEFORE_PUBLISH);
    server.getSocialSummary.mockResolvedValue(MANUAL);
    await advance(2000);
    expectLocked(false);
    expect(textarea().value).toBe(MANUAL.summary);
  });

  it("ends when a poll shows nothing will write", async () => {
    // A restore racing a transition out of the published statuses, then the
    // switch going off mid-wait: either way no summary is coming.
    await startWait(BEFORE_PUBLISH);
    server.getSocialSummary.mockResolvedValue(BEFORE_PUBLISH);
    await advance(2000);
    expectLocked(false);
  });

  it("ends when a poll shows automatic summaries were switched off", async () => {
    await startWait(BEFORE_PUBLISH);
    server.getSocialSummary.mockResolvedValue({
      ...PENDING,
      automaticEnabled: false,
    });
    await advance(2000);
    expectLocked(false);
  });

  it("starts no wait when automatic summaries are off", async () => {
    await startWait({ ...BEFORE_PUBLISH, automaticEnabled: false });
    expectLocked(false);
    expect(waitingNote()).toBeNull();
    await advance(10_000);
    expect(polls()).toBe(0);
  });

  it("starts no wait over a summary staff wrote", async () => {
    await startWait(MANUAL);
    expectLocked(false);
    await advance(10_000);
    expect(polls()).toBe(0);
  });

  it("starts no wait over an edit, and keeps what was typed", async () => {
    await startWait(AUTOMATIC, "published", "Wording typed before it.");

    expectLocked(false);
    expect(waitingNote()).toBeNull();
    await advance(10_000);
    expect(polls()).toBe(0);
    expect(textarea().value).toBe("Wording typed before it.");
    expect(saveButton().hasAttribute("disabled")).toBe(false);
  });
});
