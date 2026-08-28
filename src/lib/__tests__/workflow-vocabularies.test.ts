import { describe, expect, it } from "vitest";
import {
  inventoryItemStatusEnum,
  inventoryRequestItemStatusEnum,
  projectStatusEnum,
} from "#/db/schema";
import type { ItemStatus } from "../inventory-visibility";
import {
  assertTransitionAllowed,
  type RequestLineOutcome,
  type TransitionAuthority,
  type TransitionInput,
} from "../inventory-workflow";
import {
  type ActorRole,
  canTransition,
  type Status,
} from "../project-workflow";

/**
 * The runtime spelling of a compile-time union.
 *
 * `Record<T, true>` forces every member of the union to appear, so adding one
 * without listing it here fails to compile, and `Object.keys` then hands the
 * assertions below the same list the type carries. A bare array would let the
 * two drift, which is the whole defect this file exists to catch.
 */
function members<T extends string>(record: Record<T, true>): T[] {
  return Object.keys(record) as T[];
}

const PROJECT_STATUSES = members<Status>({
  approved: true,
  archived: true,
  changes_requested: true,
  draft: true,
  published: true,
  submitted: true,
});

const ROLES = members<ActorRole>({ owner: true, staff: true });

const ITEM_STATUSES = members<ItemStatus>({
  available: true,
  checked_out: true,
  maintenance: true,
  requested: true,
  reserved: true,
  retired: true,
});

const LINE_OUTCOMES = members<RequestLineOutcome>({
  cancelled: true,
  rejected: true,
  returned: true,
});

const AUTHORITIES = members<TransitionAuthority>({
  self_cancel: true,
  self_request: true,
});

describe("the TypeScript vocabularies match the database enums", () => {
  // Each pair is two hand-written lists of the same strings, in two files,
  // with nothing linking them. A value added to one and not the other is a
  // row Postgres accepts and the app cannot name, or the reverse: a status
  // the app hands to a column that rejects it, at runtime, in production.
  //
  // `categories.ts` already derives its domain type from `enumValues`, which
  // is the fix rather than the test. Until the status vocabularies do the
  // same (candidate #5), this is what holds them together.
  it("project statuses agree", () => {
    expect([...PROJECT_STATUSES].sort()).toEqual(
      [...projectStatusEnum.enumValues].sort()
    );
  });

  it("inventory item statuses agree", () => {
    expect([...ITEM_STATUSES].sort()).toEqual(
      [...inventoryItemStatusEnum.enumValues].sort()
    );
  });

  it("every request line outcome is a status the column accepts", () => {
    // A subset, not an equality: `pending` and `approved` are line statuses a
    // release never writes, so they are in the column and not in the union.
    for (const outcome of LINE_OUTCOMES) {
      expect(
        inventoryRequestItemStatusEnum.enumValues,
        `${outcome} is not in inventory_request_item_status`
      ).toContain(outcome);
    }
  });
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
    const reachable = new Set<Status>(["draft"]);
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
  // The rules answer with a decision or a refusal, never with a crash or an
  // empty message. The refusal text is rendered verbatim by the lifecycle
  // panel, so a blank one is a dialog that tells staff nothing.
  function check(input: TransitionInput) {
    try {
      assertTransitionAllowed({ id: "staff-1", role: "admin" }, input);
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      expect((e as Error).message.trim().length).toBeGreaterThan(0);
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
    for (const nextStatus of ITEM_STATUSES) {
      for (const holder of HOLDER_SHAPES) {
        check({ itemId: "item-1", nextStatus, ...holder });
        check({
          dueAt: new Date("2030-01-01T00:00:00Z"),
          itemId: "item-1",
          nextStatus,
          requestItemId: "line-1",
          ...holder,
        });
      }
    }
  });

  it("answers every authority crossed with every status", () => {
    for (const authority of AUTHORITIES) {
      for (const nextStatus of ITEM_STATUSES) {
        check({ authority, itemId: "item-1", nextStatus });
      }
    }
  });

  it("answers every line outcome crossed with every status", () => {
    for (const outcome of LINE_OUTCOMES) {
      for (const nextStatus of ITEM_STATUSES) {
        check({
          comment: "A reason",
          itemId: "item-1",
          lineDecision: { outcome, requestItemId: "line-1" },
          nextStatus,
        });
      }
    }
  });
});
