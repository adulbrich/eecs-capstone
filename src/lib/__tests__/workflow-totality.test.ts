import { describe, expect, it } from "vitest";
import {
  assertTransitionAllowed,
  type RequestLineOutcome,
  type TransitionAuthority,
  type TransitionInput,
} from "../inventory-workflow";
import { type ActorRole, canTransition } from "../project-workflow";
import {
  INVENTORY_ITEM_STATUSES,
  PROJECT_STATUSES,
  type ProjectStatus,
} from "../vocabularies";

/**
 * Every workflow table answers every input its vocabulary can hand it.
 *
 * The vocabularies themselves are no longer checked here: each one is a
 * single `as const` tuple that `src/db/schema.ts` passes to `pgEnum` and the
 * lib modules derive their union from, so the two cannot disagree and the
 * assertion that used to hold them together could no longer fail (#102).
 * What remains is the part deriving the types does not give you: that the
 * tables keyed by those vocabularies are total, and that the project graph is
 * connected.
 */

/**
 * The runtime spelling of a compile-time union, for the unions with no tuple
 * of their own.
 *
 * `Record<T, true>` forces every member of the union to appear, so adding one
 * without listing it here fails to compile, and `Object.keys` then hands the
 * assertions below the same list the type carries. A bare array would let the
 * two drift.
 */
function members<T extends string>(record: Record<T, true>): T[] {
  return Object.keys(record) as T[];
}

const ROLES = members<ActorRole>({ owner: true, staff: true });

const ITEM_STATUSES = INVENTORY_ITEM_STATUSES;

const LINE_OUTCOMES = members<RequestLineOutcome>({
  cancelled: true,
  rejected: true,
  returned: true,
});

const LATER = new Date("2030-01-01T00:00:00Z");

const AUTHORITIES = members<TransitionAuthority>({
  self_cancel: true,
  self_request: true,
});

describe("the project transition table is total and connected", () => {
  it("answers every from/to/role triple without throwing", () => {
    // `TRANSITIONS[from][role] ?? []` reads two levels deep. A status present
    // in the union but missing from the table would be a TypeError here
    // rather than a denial, which is a crash where a "no" was intended.
    for (const from of PROJECT_STATUSES) {
      for (const to of PROJECT_STATUSES) {
        for (const role of ROLES) {
          expect(typeof canTransition(from, to, role)).toBe("boolean");
        }
      }
    }
  });

  it("leaves no status stranded off the graph", () => {
    // Every status is reachable from draft by somebody, and every status can
    // be left again. A status that fails either half is one an operator can
    // strand a project in, and neither the type nor the table would say so.
    const reachable = new Set<ProjectStatus>(["draft"]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const from of [...reachable]) {
        for (const to of PROJECT_STATUSES) {
          if (
            !reachable.has(to) &&
            ROLES.some((role) => canTransition(from, to, role))
          ) {
            reachable.add(to);
            grew = true;
          }
        }
      }
    }
    expect([...reachable].sort()).toEqual([...PROJECT_STATUSES].sort());

    for (const from of PROJECT_STATUSES) {
      const exits = PROJECT_STATUSES.filter((to) =>
        ROLES.some((role) => canTransition(from, to, role))
      );
      expect(exits, `${from} is a dead end`).not.toHaveLength(0);
    }
  });
});

describe("the inventory rules are total", () => {
  /**
   * Runs one input and reports what the rules did with it.
   *
   * The thrown value's exact constructor is compared rather than
   * `instanceof Error`, because `TypeError` and `RangeError` are Errors too.
   * An earlier version of this helper used `instanceof` and could not tell a
   * refusal from a crash: injecting a TypeError into `assertTransitionAllowed`
   * left every case in this file passing.
   *
   * The message is checked because the lifecycle panel renders it verbatim,
   * so a blank refusal is a dialog that tells staff nothing.
   */
  function outcomeOf(input: TransitionInput): string {
    try {
      assertTransitionAllowed({ id: "staff-1", role: "admin" }, input);
      return "allowed";
    } catch (e) {
      expect(
        e?.constructor,
        `${input.nextStatus} threw ${String(e)} rather than refusing`
      ).toBe(Error);
      const { message } = e as Error;
      expect(message.trim().length).toBeGreaterThan(0);
      return message;
    }
  }

  const HOLDER_SHAPES: Partial<TransitionInput>[] = [
    {},
    { holderId: "u1" },
    { holderEmail: "a@b.com" },
    { holderLabel: "Bench 3" },
    { holderId: "u1", holderLabel: "Bench 3" },
    { holderEmail: "a@b.com", holderLabel: "Bench 3" },
    { holderName: "Ada", holderProgram: "ECE" },
  ];

  it("answers every status crossed with every holder shape", () => {
    const outcomes = ITEM_STATUSES.flatMap((nextStatus) =>
      HOLDER_SHAPES.flatMap((holder) => [
        outcomeOf({ itemId: "item-1", nextStatus, ...holder }),
        outcomeOf({
          dueAt: LATER,
          itemId: "item-1",
          nextStatus,
          requestItemId: "line-1",
          ...holder,
        }),
      ])
    );
    // Asserted so a loop that stopped iterating fails instead of passing
    // vacuously, which is the other half of what the old helper allowed.
    expect(outcomes).toHaveLength(
      ITEM_STATUSES.length * HOLDER_SHAPES.length * 2
    );
  });

  it("answers every authority crossed with every status", () => {
    const outcomes = AUTHORITIES.flatMap((authority) =>
      ITEM_STATUSES.map((nextStatus) =>
        outcomeOf({ authority, itemId: "item-1", nextStatus })
      )
    );
    expect(outcomes).toHaveLength(AUTHORITIES.length * ITEM_STATUSES.length);
  });

  it("answers every line outcome crossed with every status", () => {
    const outcomes = LINE_OUTCOMES.flatMap((outcome) =>
      ITEM_STATUSES.map((nextStatus) =>
        outcomeOf({
          comment: "A reason",
          itemId: "item-1",
          lineDecision: { outcome, requestItemId: "line-1" },
          nextStatus,
        })
      )
    );
    expect(outcomes).toHaveLength(LINE_OUTCOMES.length * ITEM_STATUSES.length);
  });
});
