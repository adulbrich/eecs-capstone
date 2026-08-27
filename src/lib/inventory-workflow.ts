/**
 * The rules a transition must satisfy, and the outcome it writes to the line
 * it closes.
 *
 * Pure and client-safe, like `hold.ts`, `inventory-deadlines.ts`,
 * `inventory-notifications.ts` and `inventory-visibility.ts`, and for the
 * same reason: these were the subtlest rules in the domain, welded to the
 * transaction that enforced them, so exercising one meant standing up a
 * request lifecycle against docker Postgres. `inventory-notifications.ts` already did this to the question of
 * who gets told. This module does it to the question of what is allowed.
 *
 * Everything here is decidable from its arguments. What stayed behind in
 * `src/server/_internal/inventory-transitions.ts` is the set of rules fused to
 * a `SELECT ... FOR UPDATE`: a line is still open, a line belongs to this
 * item, the item is free to be requested, a rejection lands only on a line
 * that is still pending, and the decision names the line the item is
 * currently holding. Those are not rules about an input, they are rules
 * about a row read under a lock, and moving them here would buy a predicate
 * call at the cost of an interface twice this size.
 *
 * A single `plan(viewer, input, currentRow)` covering both halves was
 * considered and is not possible: it would have to read the item before the
 * request line, and `lockAttachableRequestLine` owns that lock order and says
 * why reversing it deadlocks.
 */

import type { ItemStatus } from "./inventory-visibility";
import { assertStaff, type Viewer } from "./viewer";

/**
 * Whoever is making the transition.
 *
 * Deliberately the non-null arm of `Viewer` in `./viewer`, not that union.
 * `assertAuthorized` reads `viewer.id` on the self-service path without
 * `assertStaff` having narrowed it first, so admitting null here would make an
 * anonymous self-service transition a type error waiting to become a
 * TypeError. Both callers that name an authority reject a null viewer before
 * they get this far; this makes that unrepresentable rather than merely true.
 */
export type TransitionActor = NonNullable<Viewer>;

/**
 * The non-staff authority a caller has already verified for itself.
 *
 * Absent means staff, and `assertStaff` runs exactly as it always has. These
 * two values are the only way past it, they are only reachable from an
 * internal caller, and each names the check its caller performed:
 * `self_cancel` means the caller confirmed the viewer owns the request line,
 * `self_request` means the viewer is submitting their own cart.
 *
 * `transitionSchema` in `src/server/inventory.ts` does not declare this field,
 * and `z.object().parse` strips unknown keys, so a client that posts
 * `authority` has it removed before it reaches here. Do not add it to that
 * schema: it is the whole staff gate for `transitionInventoryItem`, which
 * carries only `requireUser()` of its own.
 */
export type TransitionAuthority = "self_cancel" | "self_request";

/**
 * What a request line becomes when the item is released out from under it.
 *
 * Absent keeps the existing derivation, `returned` from a checkout and
 * `cancelled` otherwise. It is passed rather than derived because rejecting a
 * pending line and releasing a reserved item both end at `available` with a
 * comment, and nothing in the transition itself distinguishes them.
 */
export type RequestLineOutcome = "cancelled" | "rejected" | "returned";

/**
 * A decision about one specific request line.
 *
 * The line id travels with the outcome rather than beside it, and that is the
 * point. A release transition cannot carry `requestItemId` (the invariants
 * below forbid it on the statuses a release targets), so without this the
 * outcome would land on whatever line the item happens to point at when the
 * write runs, which is not necessarily the line the caller locked and decided
 * about. Naming an outcome without naming its line is now unrepresentable,
 * and `transitionItemInTx` refuses a mismatch rather than writing to the
 * wrong student's record.
 */
export interface RequestLineDecision {
  outcome: RequestLineOutcome;
  requestItemId: string;
}

/**
 * Everything a caller asks for, in full.
 *
 * A departure from `inventory-notifications.ts`, which declares a narrow
 * structural `TransitionNotice` because it reads six of these thirteen
 * fields. The rules read all of them but `itemId`, so narrowing would restate
 * the type rather than shrink it. The type is Drizzle-free either way, which
 * is what being here requires; `Tx` was the only unclean type in the module
 * this came from, and it stayed there.
 */
export interface TransitionInput {
  authority?: TransitionAuthority | null;
  comment?: string | null;
  dueAt?: Date | null;
  /** Assigns the hold to an address, with or without a matching account. */
  holderEmail?: string | null;
  /**
   * An already-resolved account, supplied only by an internal caller that
   * already has one: approveRequestItemAs passing the requester's id, and
   * submitCartAs passing the submitting student's. Staff cannot assign a hold
   * this way, because transitionSchema does not accept a holder id. The
   * address is derived from the id, so the column invariant holds here too.
   */
  holderId?: string | null;
  holderLabel?: string | null;
  /** Describes a holder with no account. Discarded when one is resolved. */
  holderName?: string | null;
  holderProgram?: string | null;
  itemId: string;
  lineDecision?: RequestLineDecision | null;
  nextStatus: ItemStatus;
  pickupBy?: Date | null;
  requestItemId?: string | null;
}

/**
 * The one status each self-service authority is allowed to reach. This Record
 * is the single source of truth: adding an authority to the union forces an
 * entry here, and the recognized-authority check reads its keys rather than a
 * parallel list that could drift out of step with it.
 */
const AUTHORITY_TARGET: Record<TransitionAuthority, ItemStatus> = {
  self_cancel: "available",
  self_request: "requested",
};

/**
 * Default deny. No authority means staff, which is every caller that existed
 * before self-service paths were routed through here, so their behavior is
 * unchanged. A named authority is accepted only if it is one this module
 * knows; an unrecognized string is rejected rather than waved through, so a
 * future typo fails closed.
 */
function assertAuthorized(viewer: TransitionActor, input: TransitionInput) {
  if (!input.authority) {
    assertStaff(viewer);
    return;
  }
  if (!Object.hasOwn(AUTHORITY_TARGET, input.authority)) {
    throw new Error("Forbidden");
  }
  // "Self" is the whole claim, so it is checked rather than trusted. Without
  // this, self_request would let a caller place a request hold on somebody
  // else's account, which is the first thing a self-service authority that
  // reaches a holder-writing arm could be abused for.
  //
  // Both identity fields are covered, not just the id. `resolveHold` reads
  // `holderEmail` FIRST and derives the account from it, so guarding only the
  // id would leave the field the resolver actually prefers wide open. No
  // self-service caller supplies an address (submitCartAs passes its own id,
  // cancel passes neither), so refusing it outright costs nothing.
  if (input.holderId && input.holderId !== viewer.id) {
    throw new Error("A self-service transition may only act on its own viewer");
  }
  if (input.holderEmail) {
    throw new Error(
      "A self-service transition may not name a holder address; the viewer is the holder"
    );
  }
}

/** The statuses that release an item, and so can close the line it held. */
function isReleaseStatus(status: ItemStatus): boolean {
  return (
    status === "available" || status === "maintenance" || status === "retired"
  );
}

/**
 * The rules for the two fields that let a caller act outside the staff path.
 * They live here, beside every other cross-field rule, rather than in the
 * callers that pass them. A caller naming its own authority must not also get
 * to decide what that authority is allowed to do.
 */
function validateSelfServiceAndDecision(input: TransitionInput) {
  // Each authority reaches exactly one status. A self-service caller releases
  // an item or requests one; it does not retire one, send one to maintenance,
  // or check one out to itself with a deadline of its choosing. Without this
  // an authority is a hole the size of every status.
  if (input.authority) {
    const allowed = AUTHORITY_TARGET[input.authority];
    if (input.nextStatus !== allowed) {
      throw new Error(
        `${input.authority} may only move an item to ${allowed}, not ${input.nextStatus}`
      );
    }
  }
  const decision = input.lineDecision;
  if (!decision) {
    return;
  }
  if (!isReleaseStatus(input.nextStatus)) {
    throw new Error(
      `A request line outcome is only meaningful on a release, not on a transition to ${input.nextStatus}`
    );
  }
  // Matches the guard rejectRequestItemAs has always had. A denial the
  // student cannot read a reason for is the thing that guard exists to stop.
  if (decision.outcome === "rejected" && !input.comment?.trim()) {
    throw new Error("Reject reason required");
  }
}

function validateStatusInvariants(input: TransitionInput) {
  const {
    nextStatus,
    holderId,
    holderEmail,
    holderLabel,
    holderName,
    holderProgram,
    requestItemId,
    pickupBy,
    dueAt,
  } = input;

  switch (nextStatus) {
    case "available":
    case "maintenance":
    case "retired":
      if (
        holderId ||
        holderEmail ||
        holderLabel ||
        holderName ||
        holderProgram ||
        requestItemId
      ) {
        throw new Error(
          `Cannot set holder or request on transition to ${nextStatus}`
        );
      }
      if (pickupBy || dueAt) {
        throw new Error(
          `pickupBy / dueAt not allowed on transition to ${nextStatus}`
        );
      }
      return;
    case "requested":
      // A requested row always comes from an account (the requester), so it
      // has both an id and an address; it never carries a label, because a
      // request is always on a person, never on a thing. submitCartAs is the
      // one caller that reaches this arm, under the self_request authority,
      // once per surviving cart line. The lifecycle panel does not offer
      // "requested" as a direct target, so staff never land here.
      if (!(requestItemId && (holderId || holderEmail)) || holderLabel) {
        throw new Error(
          "requested status requires requestItemId and a holder account or address, no label"
        );
      }
      return;
    case "reserved":
    case "checked_out": {
      // A hold is on a person or on a thing, never both and never neither.
      // An id and an address both identify the same person, so they count as
      // one; name and program are attributes of that person, not a third
      // identity, and are excluded from the test entirely.
      //
      // This arm looks redundant now that `holdFromInput` builds a union in
      // which "both" is unrepresentable. It is not, and deleting it ships a
      // silent bug. Two reasons:
      //
      // 1. "Never neither" is status-dependent, and the Hold constructor never
      //    sees a status. `{ kind: "none" }` is a legal hold for an available
      //    item. Only this arm knows that it is not a legal one for a
      //    checkout, so without it a checkout with no holder saves silently.
      // 2. `inventory-workflow.test.ts` asserts this exact wording.
      const onAPerson = Boolean(holderId || holderEmail);
      const onAThing = Boolean(holderLabel);
      if (onAPerson === onAThing) {
        throw new Error(
          `${nextStatus} requires either a holder email or a holder label, not both and not neither`
        );
      }
      if (nextStatus === "checked_out" && !dueAt) {
        throw new Error("checked_out requires dueAt");
      }
      return;
    }
    default: {
      // Each arm above is a decision about which fields that status may
      // carry, and `ItemStatus` now lives a file away. Without this, a
      // seventh member would reach a silent `return` and be written with no
      // invariants at all; with it, adding one fails to compile here.
      const unhandled: never = nextStatus;
      throw new Error(
        `No transition invariants declared for ${String(unhandled)}`
      );
    }
  }
}

/**
 * Everything a transition can be refused for before a row is read.
 *
 * One export rather than an authorization check and a validation check side
 * by side, because no caller has ever wanted one without the other, and a
 * caller that ran only the second would be a caller with no staff gate.
 * `transitionItem` calls this before it opens a transaction, so a malformed
 * or unauthorized input never reaches Postgres at all.
 *
 * Throws on the first rule broken. The three calls are flat and their order
 * is the contract: authorization first, so an unauthorized caller learns it is
 * unauthorized rather than receiving a critique of the payload it was never
 * allowed to send. The self-service and decision rules used to run from the
 * first line of the status validator, where its name gave a reader no hint
 * they were there at all.
 *
 * The message is part of the contract. `inventory-lifecycle-panel.tsx` renders
 * `(e as Error).message` verbatim, so these strings reach staff on screen. The
 * panel pre-checks the two rules a form can catch early, in friendlier words
 * of its own; everything else arrives from here.
 */
export function assertTransitionAllowed(
  viewer: TransitionActor,
  input: TransitionInput
) {
  assertAuthorized(viewer, input);
  validateSelfServiceAndDecision(input);
  validateStatusInvariants(input);
}

/**
 * What to write to the request line an item is releasing.
 *
 * Fulfillment ended in the user's hands then came back: returned. Otherwise
 * (reserved abandoned, sent to maintenance or retired before pickup):
 * cancelled. A caller that knows better says so, and only it can tell a staff
 * refusal from a staff release, since both end at available with a comment.
 *
 * `prevStatus` is the item's status before the transition, not after. A
 * release always ends at the same three statuses, so the status being left is
 * the only thing that carries the information.
 */
export function resolveLineOutcome(
  decision: RequestLineDecision | null | undefined,
  prevStatus: ItemStatus
): RequestLineOutcome {
  return (
    decision?.outcome ??
    (prevStatus === "checked_out" ? "returned" : "cancelled")
  );
}
