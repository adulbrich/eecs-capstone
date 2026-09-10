import { describe, expect, it } from "vitest";
import { lineTimeline, type TimelineInput } from "../inventory-timeline";

const submittedAt = new Date("2026-09-01T10:00:00.000Z");
const reviewedAt = new Date("2026-09-02T10:00:00.000Z");
const closedAt = new Date("2026-09-10T10:00:00.000Z");

/** A request line as the requester sees it: no actors passed at all. */
const pending: TimelineInput = {
  closedAt: null,
  closedLabel: "Pending",
  closedNote: null,
  decidedLabel: "Approved",
  reviewedAt: null,
  submittedAt,
};

describe("lineTimeline", () => {
  it("is the one submitted event while the line is pending", () => {
    expect(lineTimeline(pending)).toEqual([
      {
        actor: null,
        at: submittedAt,
        kind: "submitted",
        label: "Submitted",
        note: null,
      },
    ]);
  });

  it("adds a decided event once reviewed, naming the actor when given one", () => {
    const events = lineTimeline({
      ...pending,
      closedLabel: "Approved",
      reviewedAt,
      reviewedBy: "Staff A",
    });
    expect(events.map((e) => e.kind)).toEqual(["submitted", "decided"]);
    expect(events[1]).toEqual({
      actor: "Staff A",
      at: reviewedAt,
      kind: "decided",
      label: "Approved",
      note: null,
    });
  });

  it("has three events for a line that was approved and then returned", () => {
    const events = lineTimeline({
      ...pending,
      closedAt,
      closedBy: "Staff B",
      closedLabel: "Returned",
      closedNote: null,
      reviewedAt,
      reviewedBy: "Staff A",
    });
    expect(events.map((e) => [e.kind, e.label, e.actor])).toEqual([
      ["submitted", "Submitted", null],
      ["decided", "Approved", "Staff A"],
      ["closed", "Returned", "Staff B"],
    ]);
  });

  it("collapses a rejection into one closed event carrying the reason", () => {
    // A rejection writes reviewed_at and closed_at at the same instant, so
    // a separate decided event would repeat the close with less on it. The
    // requester reads the reason at the close, which is where it lives.
    const events = lineTimeline({
      ...pending,
      closedAt: reviewedAt,
      closedBy: "Staff A",
      closedLabel: "Rejected",
      closedNote: "Out of scope this term",
      reviewedAt,
      reviewedBy: "Staff A",
    });
    expect(events.map((e) => e.kind)).toEqual(["submitted", "closed"]);
    expect(events[1]).toEqual({
      actor: "Staff A",
      at: reviewedAt,
      kind: "closed",
      label: "Rejected",
      note: "Out of scope this term",
    });
  });

  it("has no decided event for a line cancelled while pending", () => {
    const events = lineTimeline({
      ...pending,
      closedAt,
      closedBy: "The Requester",
      closedLabel: "Cancelled",
      closedNote: "Found one",
    });
    expect(events.map((e) => e.kind)).toEqual(["submitted", "closed"]);
    expect(events[1].note).toBe("Found one");
  });

  it("names nobody when the caller passes no actors", () => {
    // The requester's own page names no staff member. The caller decides
    // that by leaving the actors out, and this module adds nothing back.
    const events = lineTimeline({
      ...pending,
      closedAt,
      closedLabel: "Returned",
      reviewedAt,
    });
    expect(events.map((e) => e.actor)).toEqual([null, null, null]);
  });

  it("carries a note on the decided event, for a line whose decision speaks", () => {
    // A custom line's sourcing note. The request line never has one, because
    // approving hands over a physical thing and the thing is the message.
    const events = lineTimeline({
      ...pending,
      decidedLabel: "Sourcing",
      decidedNote: "Ordered from the vendor, two weeks",
      reviewedAt,
    });
    expect(events[1]).toMatchObject({
      kind: "decided",
      label: "Sourcing",
      note: "Ordered from the vendor, two weeks",
    });
  });
});
