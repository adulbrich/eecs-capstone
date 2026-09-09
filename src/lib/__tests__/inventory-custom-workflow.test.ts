import { describe, expect, it } from "vitest";
import {
  assertCustomLineTransition,
  assertSourcingNoteEditable,
  CUSTOM_LINE_TARGET,
  type CustomLineTransition,
  isOpenCustomLine,
} from "../inventory-custom-workflow";
import type { Viewer } from "../viewer";
import { INVENTORY_CUSTOM_LINE_STATUSES } from "../vocabularies";

const staff: Viewer = { id: "u-staff", role: "instructor" };
const requester: Viewer = { id: "u-req", role: "user" };
const stranger: Viewer = { id: "u-other", role: "user" };
const anon: Viewer = null;

const line = (status: string) => ({ requesterId: "u-req", status });

/** The spec's table, as the set of (from, transition) pairs that are legal. */
const LEGAL: Record<CustomLineTransition, readonly string[]> = {
  source: ["pending"],
  fulfill: ["pending", "sourcing"],
  reject: ["pending", "sourcing"],
  cancel: ["pending", "sourcing"],
};

describe("assertCustomLineTransition", () => {
  it("allows exactly the spec's table and refuses every other pair", () => {
    // Derived from the tuple, so a sixth status is covered without a new
    // case here: it must be refused everywhere until this table names it.
    for (const status of INVENTORY_CUSTOM_LINE_STATUSES) {
      for (const transition of Object.keys(LEGAL) as CustomLineTransition[]) {
        const actor = transition === "cancel" ? requester : staff;
        const attempt = () =>
          assertCustomLineTransition(actor, line(status), transition);
        if (LEGAL[transition].includes(status)) {
          expect(attempt, `${status} -> ${transition}`).not.toThrow();
        } else {
          expect(attempt, `${status} -> ${transition}`).toThrow(
            `A ${status} line cannot be ${CUSTOM_LINE_TARGET[transition]}`
          );
        }
      }
    }
  });

  it("refuses a rejection from sourcing only on a request line, not here", () => {
    // The one divergence from the request line: an order can fall through.
    expect(() =>
      assertCustomLineTransition(staff, line("sourcing"), "reject")
    ).not.toThrow();
  });

  it("keeps sourcing, fulfilling and rejecting to staff", () => {
    for (const transition of ["source", "fulfill", "reject"] as const) {
      expect(() =>
        assertCustomLineTransition(requester, line("pending"), transition)
      ).toThrow("Forbidden");
      expect(() =>
        assertCustomLineTransition(anon, line("pending"), transition)
      ).toThrow("Sign in required");
    }
  });

  it("keeps cancel to the requester, staff included", () => {
    expect(() =>
      assertCustomLineTransition(stranger, line("pending"), "cancel")
    ).toThrow("Only the requester can cancel");
    expect(() =>
      assertCustomLineTransition(staff, line("pending"), "cancel")
    ).toThrow("Only the requester can cancel");
    expect(() =>
      assertCustomLineTransition(requester, line("sourcing"), "cancel")
    ).not.toThrow();
  });

  it("answers who before what, so a stranger is not told about the line", () => {
    expect(() =>
      assertCustomLineTransition(stranger, line("fulfilled"), "cancel")
    ).toThrow("Only the requester can cancel");
  });
});

describe("isOpenCustomLine", () => {
  it("is pending or sourcing and nothing else", () => {
    expect(
      INVENTORY_CUSTOM_LINE_STATUSES.filter((status) =>
        isOpenCustomLine(status)
      )
    ).toEqual(["pending", "sourcing"]);
  });
});

describe("assertSourcingNoteEditable", () => {
  it("is staff only and sourcing only", () => {
    expect(() =>
      assertSourcingNoteEditable(staff, line("sourcing"))
    ).not.toThrow();
    expect(() =>
      assertSourcingNoteEditable(requester, line("sourcing"))
    ).toThrow("Forbidden");
    expect(() => assertSourcingNoteEditable(staff, line("pending"))).toThrow(
      "only be changed while sourcing"
    );
    expect(() => assertSourcingNoteEditable(staff, line("fulfilled"))).toThrow(
      "only be changed while sourcing"
    );
  });
});
