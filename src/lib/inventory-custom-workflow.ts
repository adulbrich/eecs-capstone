/**
 * Which transition a custom line may make, and who may make it.
 *
 * Pure and client-safe, like `inventory-workflow.ts` beside it, and for the
 * same reason: the rule is decidable from its arguments, so it is tested
 * here with no docker rather than through a request lifecycle against
 * Postgres. What stays in `src/server/_internal/inventory-custom.ts` is what
 * needs a locked row: reading the line, writing the columns, linking the
 * items.
 *
 * The lifecycle, normative in `docs/QUIRKS.md` under Inventory:
 *
 * | From                   | To          | Who                      |
 * | ---------------------- | ----------- | ------------------------ |
 * | `pending`              | `sourcing`  | staff                    |
 * | `pending` or `sourcing`| `fulfilled` | staff, linking items     |
 * | `pending` or `sourcing`| `rejected`  | staff, reason required   |
 * | `pending` or `sourcing`| `cancelled` | the requester            |
 *
 * One deliberate divergence from a request line: a custom line may be
 * rejected from `sourcing`, because an order can fall through.
 */

import { isStaff, type Viewer } from "./viewer";
import type { InventoryCustomLineStatus, SubsetOf } from "./vocabularies";

export type CustomLineTransition = "cancel" | "fulfill" | "reject" | "source";

/** The status each transition lands on. */
export const CUSTOM_LINE_TARGET: Record<
  CustomLineTransition,
  InventoryCustomLineStatus
> = {
  cancel: "cancelled",
  fulfill: "fulfilled",
  reject: "rejected",
  source: "sourcing",
};

/**
 * The two statuses a line can still leave. Written out rather than derived,
 * because it is a proper subset: the constraint is what holds it to the
 * vocabulary, so a renamed status fails to compile here.
 */
export type CustomLineOpenStatus = SubsetOf<
  InventoryCustomLineStatus,
  "pending" | "sourcing"
>;

const OPEN: readonly CustomLineOpenStatus[] = ["pending", "sourcing"];

/** The statuses each transition may start from. */
const CUSTOM_LINE_FROM: Record<
  CustomLineTransition,
  readonly CustomLineOpenStatus[]
> = {
  cancel: OPEN,
  fulfill: OPEN,
  reject: OPEN,
  source: ["pending"],
};

export function isOpenCustomLine(status: string): boolean {
  return (OPEN as readonly string[]).includes(status);
}

/**
 * Throws unless `transition` is legal from the line's status and the viewer
 * may make it: the requester for cancel, staff for everything else. Checked
 * in that order, so an unauthorized caller learns it is unauthorized rather
 * than receiving a critique of a line it may not touch.
 */
export function assertCustomLineTransition(
  viewer: Viewer,
  line: { requesterId: string; status: string },
  transition: CustomLineTransition
): asserts viewer is NonNullable<Viewer> {
  if (!viewer) {
    throw new Error("Sign in required");
  }
  if (transition === "cancel") {
    if (line.requesterId !== viewer.id) {
      throw new Error("Only the requester can cancel");
    }
  } else if (!isStaff(viewer)) {
    throw new Error("Forbidden");
  }
  const from = CUSTOM_LINE_FROM[transition];
  if (!(from as readonly string[]).includes(line.status)) {
    throw new Error(
      `A ${line.status} line cannot be ${CUSTOM_LINE_TARGET[transition]}`
    );
  }
}

/**
 * The one write that is not a transition: staff may rewrite the sourcing
 * note while the line is `sourcing`, and the requester is told. Refused on
 * any other status, because the note belongs to that event.
 */
export function assertSourcingNoteEditable(
  viewer: Viewer,
  line: { status: string }
): asserts viewer is NonNullable<Viewer> {
  if (!isStaff(viewer)) {
    throw new Error("Forbidden");
  }
  if (line.status !== "sourcing") {
    throw new Error("The sourcing note can only be changed while sourcing");
  }
}
