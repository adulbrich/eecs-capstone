import { describe, expect, it } from "vitest";
import {
  assertTransitionAllowed,
  type RequestLineDecision,
  resolveLineOutcome,
  type TransitionActor,
  type TransitionInput,
} from "../inventory-workflow";

const ADMIN: TransitionActor = { id: "staff-1", role: "admin" };
const INSTRUCTOR: TransitionActor = { id: "staff-2", role: "instructor" };
const STUDENT: TransitionActor = { id: "student-1", role: "user" };

const LATER = new Date("2030-01-01T00:00:00Z");

function input(over: Partial<TransitionInput> = {}): TransitionInput {
  return { itemId: "item-1", nextStatus: "available", ...over };
}

describe("assertTransitionAllowed: the staff gate", () => {
  it("refuses a viewer with no staff role and no authority", () => {
    expect(() => assertTransitionAllowed(STUDENT, input())).toThrow(
      /Forbidden/
    );
  });

  it("admits both staff roles", () => {
    expect(() => assertTransitionAllowed(ADMIN, input())).not.toThrow();
    expect(() => assertTransitionAllowed(INSTRUCTOR, input())).not.toThrow();
  });

  it("answers the staff question before the input question", () => {
    // Authorization first is the documented order. This input breaks an
    // invariant too (a checkout with no holder and no dueAt), and the caller
    // must be told it is not staff rather than handed a critique of the
    // payload it was never allowed to send.
    expect(() =>
      assertTransitionAllowed(STUDENT, input({ nextStatus: "checked_out" }))
    ).toThrow(/Forbidden/);
  });

  it("refuses an authority it does not recognize", () => {
    // A value outside the union, as a JS caller could supply. Default deny is
    // the point: an unrecognized authority must not fall through to the
    // staff-gated path and must not be waved past it either.
    expect(() =>
      assertTransitionAllowed(
        STUDENT,
        input({ authority: "self_anything" as "self_cancel" })
      )
    ).toThrow(/Forbidden/);
  });

  it("lets a recognized authority past the gate", () => {
    expect(() =>
      assertTransitionAllowed(STUDENT, input({ authority: "self_cancel" }))
    ).not.toThrow();
  });
});

describe("assertTransitionAllowed: what an authority may do", () => {
  it("holds each authority to its one status", () => {
    expect(() =>
      assertTransitionAllowed(
        STUDENT,
        input({ authority: "self_cancel", nextStatus: "retired" })
      )
    ).toThrow(/self_cancel may only move an item to available, not retired/);
    expect(() =>
      assertTransitionAllowed(
        STUDENT,
        input({ authority: "self_request", nextStatus: "checked_out" })
      )
    ).toThrow(/self_request may only move an item to requested/);
  });

  it("refuses a self-service transition that names another account", () => {
    expect(() =>
      assertTransitionAllowed(
        STUDENT,
        input({
          authority: "self_request",
          holderId: "someone-else",
          nextStatus: "requested",
          requestItemId: "line-1",
        })
      )
    ).toThrow(/only act on its own viewer/);
  });

  it("refuses a self-service transition that names any address", () => {
    // resolveHold reads holderEmail before holderId, so guarding only the id
    // would leave the field the resolver actually prefers unchecked.
    expect(() =>
      assertTransitionAllowed(
        STUDENT,
        input({
          authority: "self_request",
          holderEmail: "victim@oregonstate.edu",
          nextStatus: "requested",
          requestItemId: "line-1",
        })
      )
    ).toThrow(/may not name a holder address/);
  });

  it("accepts a self-service transition onto the viewer's own account", () => {
    expect(() =>
      assertTransitionAllowed(
        STUDENT,
        input({
          authority: "self_request",
          holderId: STUDENT.id,
          nextStatus: "requested",
          requestItemId: "line-1",
        })
      )
    ).not.toThrow();
  });
});

describe("assertTransitionAllowed: line decisions", () => {
  const cancelled: RequestLineDecision = {
    outcome: "cancelled",
    requestItemId: "line-1",
  };

  it("accepts a decision on any of the three release statuses", () => {
    for (const nextStatus of ["available", "maintenance", "retired"] as const) {
      expect(() =>
        assertTransitionAllowed(
          ADMIN,
          input({ lineDecision: cancelled, nextStatus })
        )
      ).not.toThrow();
    }
  });

  it("refuses a decision on a transition that is not a release", () => {
    expect(() =>
      assertTransitionAllowed(
        ADMIN,
        input({
          dueAt: LATER,
          holderLabel: "Bench 3",
          lineDecision: cancelled,
          nextStatus: "checked_out",
        })
      )
    ).toThrow(
      /only meaningful on a release, not on a transition to checked_out/
    );
  });

  it("refuses a rejection with no reason, including whitespace", () => {
    const rejected: RequestLineDecision = {
      outcome: "rejected",
      requestItemId: "line-1",
    };
    expect(() =>
      assertTransitionAllowed(ADMIN, input({ lineDecision: rejected }))
    ).toThrow(/Reject reason required/);
    expect(() =>
      assertTransitionAllowed(
        ADMIN,
        input({ comment: "   ", lineDecision: rejected })
      )
    ).toThrow(/Reject reason required/);
    expect(() =>
      assertTransitionAllowed(
        ADMIN,
        input({ comment: "Out of scope", lineDecision: rejected })
      )
    ).not.toThrow();
  });
});

describe("assertTransitionAllowed: invariants per status", () => {
  it("refuses any holder or request field on a release", () => {
    const holderFields: Partial<TransitionInput>[] = [
      { holderId: "u1" },
      { holderEmail: "a@b.com" },
      { holderLabel: "Bench 3" },
      { holderName: "Ada" },
      { holderProgram: "ECE" },
      { requestItemId: "line-1" },
    ];
    for (const nextStatus of ["available", "maintenance", "retired"] as const) {
      for (const field of holderFields) {
        expect(() =>
          assertTransitionAllowed(ADMIN, input({ ...field, nextStatus }))
        ).toThrow(
          new RegExp(
            `Cannot set holder or request on transition to ${nextStatus}`
          )
        );
      }
    }
  });

  it("refuses a deadline on a release", () => {
    expect(() =>
      assertTransitionAllowed(ADMIN, input({ pickupBy: LATER }))
    ).toThrow(/pickupBy \/ dueAt not allowed on transition to available/);
    expect(() =>
      assertTransitionAllowed(ADMIN, input({ dueAt: LATER }))
    ).toThrow(/pickupBy \/ dueAt not allowed on transition to available/);
  });

  it("requires a line and a person, and no label, on requested", () => {
    const message =
      /requested status requires requestItemId and a holder account or address, no label/;
    expect(() =>
      assertTransitionAllowed(ADMIN, input({ nextStatus: "requested" }))
    ).toThrow(message);
    expect(() =>
      assertTransitionAllowed(
        ADMIN,
        input({ holderId: "u1", nextStatus: "requested" })
      )
    ).toThrow(message);
    expect(() =>
      assertTransitionAllowed(
        ADMIN,
        input({ nextStatus: "requested", requestItemId: "line-1" })
      )
    ).toThrow(message);
    // A request is always on a person, never on a thing.
    expect(() =>
      assertTransitionAllowed(
        ADMIN,
        input({
          holderId: "u1",
          holderLabel: "Bench 3",
          nextStatus: "requested",
          requestItemId: "line-1",
        })
      )
    ).toThrow(message);
    expect(() =>
      assertTransitionAllowed(
        ADMIN,
        input({
          holderEmail: "a@b.com",
          nextStatus: "requested",
          requestItemId: "line-1",
        })
      )
    ).not.toThrow();
  });

  it("requires exactly one holder on a hold, not both and not neither", () => {
    // The wording is asserted rather than a match on "requires", because the
    // admin lifecycle panel renders the message verbatim.
    for (const nextStatus of ["reserved", "checked_out"] as const) {
      const extra = nextStatus === "checked_out" ? { dueAt: LATER } : {};
      expect(() =>
        assertTransitionAllowed(ADMIN, input({ ...extra, nextStatus }))
      ).toThrow(
        `${nextStatus} requires either a holder email or a holder label, not both and not neither`
      );
      expect(() =>
        assertTransitionAllowed(
          ADMIN,
          input({
            ...extra,
            holderEmail: "a@b.com",
            holderLabel: "Bench 3",
            nextStatus,
          })
        )
      ).toThrow(
        `${nextStatus} requires either a holder email or a holder label, not both and not neither`
      );
    }
  });

  it("counts an id and an address as one person, and a name as neither", () => {
    // Two halves of one identity are one holder. A name and a program are
    // attributes of that person, so they cannot stand in for one.
    expect(() =>
      assertTransitionAllowed(
        ADMIN,
        input({
          holderEmail: "a@b.com",
          holderId: "u1",
          nextStatus: "reserved",
        })
      )
    ).not.toThrow();
    expect(() =>
      assertTransitionAllowed(
        ADMIN,
        input({ holderName: "Ada", nextStatus: "reserved" })
      )
    ).toThrow(/not both and not neither/);
  });

  it("catches an id paired with a label, the pair the constructor never sees", () => {
    // The reason QUIRKS gives for this arm surviving at all: the holderId
    // resolution path never routes through `holdFromInput`, so this guard is
    // the only thing standing between an id-plus-label payload and a row that
    // holds both. Asserting the rule through holderEmail instead exercises it
    // by a path the Hold union already makes unrepresentable.
    for (const nextStatus of ["reserved", "checked_out"] as const) {
      const extra = nextStatus === "checked_out" ? { dueAt: LATER } : {};
      expect(() =>
        assertTransitionAllowed(
          ADMIN,
          input({
            ...extra,
            holderId: "u1",
            holderLabel: "Bench 3",
            nextStatus,
          })
        )
      ).toThrow(/not both and not neither/);
    }
  });

  it("accepts an account id as the whole holder", () => {
    // Every "both" case above still fails correctly if `holderId` is dropped
    // from the person test, so only an id-alone case that must NOT throw can
    // tell a live disjunct from a dead one.
    expect(() =>
      assertTransitionAllowed(
        ADMIN,
        input({ holderId: "u1", nextStatus: "reserved" })
      )
    ).not.toThrow();
  });

  it("requires dueAt on a checkout", () => {
    expect(() =>
      assertTransitionAllowed(
        ADMIN,
        input({ holderLabel: "Bench 3", nextStatus: "checked_out" })
      )
    ).toThrow(/checked_out requires dueAt/);
    expect(() =>
      assertTransitionAllowed(
        ADMIN,
        input({
          dueAt: LATER,
          holderLabel: "Bench 3",
          nextStatus: "checked_out",
        })
      )
    ).not.toThrow();
  });

  it("leaves pickupBy optional on a reservation", () => {
    expect(() =>
      assertTransitionAllowed(
        ADMIN,
        input({ holderLabel: "Bench 3", nextStatus: "reserved" })
      )
    ).not.toThrow();
  });
});

describe("resolveLineOutcome", () => {
  it("derives returned from a checkout", () => {
    expect(resolveLineOutcome(null, "checked_out")).toBe("returned");
  });

  it("derives cancelled from every other status it can be released from", () => {
    for (const prev of ["reserved", "requested", "available"] as const) {
      expect(resolveLineOutcome(undefined, prev)).toBe("cancelled");
    }
  });

  it("takes the caller's outcome over the derivation", () => {
    // From checked_out the derivation yields "returned", so asking for
    // "cancelled" here is the only shape that tells the override from its
    // absence: a reserved item derives "cancelled" either way, and a test
    // built on one would stay green with the whole feature deleted.
    expect(
      resolveLineOutcome(
        { outcome: "cancelled", requestItemId: "line-1" },
        "checked_out"
      )
    ).toBe("cancelled");
    expect(
      resolveLineOutcome(
        { outcome: "rejected", requestItemId: "line-1" },
        "requested"
      )
    ).toBe("rejected");
  });
});
