import { eq } from "drizzle-orm";
import { db } from "#/db";
import {
  inventoryItems,
  inventoryRequestItems,
  inventoryRequests,
} from "#/db/schema";
import { requireUser } from "#/lib/_internal/auth-guards";
import type { InventoryNotice } from "#/lib/inventory-notifications";
import {
  type PickupFields,
  type PickupTerms,
  resolvePickupTerms,
} from "#/lib/pickup-window";
import { assertStaff, type Viewer } from "#/lib/viewer";
import type { EmailOptions } from "./email-dispatch";
import { notifyInventoryByEmail } from "./inventory-emails";
import type { Tx } from "./inventory-transitions";

const DEFAULT_PICKUP_DAYS = 7;

/** Seven days out. Shared with the fulfill path in `inventory-custom.ts`. */
export function defaultPickupBy(): Date {
  return new Date(Date.now() + DEFAULT_PICKUP_DAYS * 86_400_000);
}

/**
 * Approves one pending line inside an open transaction: locks the line,
 * stamps the review columns and hands the item to `transitionItem`, which
 * flips the line to `approved` under the same lock.
 *
 * Line first, then the item inside `transitionItem`. That order is shared
 * with `lockAttachableRequestLine`, and inverting it deadlocks the two paths
 * against each other (see `docs/QUIRKS.md`, Inventory).
 */
async function approveLineInTx(
  tx: Tx,
  viewer: NonNullable<Viewer>,
  requestItemId: string,
  terms: PickupTerms
): Promise<InventoryNotice | null> {
  const { transitionItem } = await import("./inventory-transitions");
  // Lock the line before reading and updating it so a concurrent cancel
  // cannot move it out of 'pending' between this read and the transition.
  const [line] = await tx
    .select({
      id: inventoryRequestItems.id,
      itemId: inventoryRequestItems.itemId,
      requesterId: inventoryRequests.userId,
      status: inventoryRequestItems.status,
    })
    .from(inventoryRequestItems)
    .innerJoin(
      inventoryRequests,
      eq(inventoryRequestItems.requestId, inventoryRequests.id)
    )
    .where(eq(inventoryRequestItems.id, requestItemId))
    .for("update");
  if (!line) {
    throw new Error("Request line not found");
  }
  if (line.status !== "pending") {
    // The name is read on the refusal path only, and without a lock, so the
    // happy path takes no item lock before transitionItem does.
    const [item] = await tx
      .select({ name: inventoryItems.name })
      .from(inventoryItems)
      .where(eq(inventoryItems.id, line.itemId));
    throw new Error(`${item?.name ?? "This item"} is no longer pending`);
  }
  await tx
    .update(inventoryRequestItems)
    .set({
      reviewedBy: viewer.id,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(inventoryRequestItems.id, requestItemId));
  // Pass the open transaction so transitionItem joins the same atomic
  // unit; syncRequestItem will flip the line to 'approved' under the
  // same lock we already hold. The notice comes back for the caller to mail
  // once that transaction has committed.
  return await transitionItem(
    viewer,
    {
      itemId: line.itemId,
      nextStatus: "reserved",
      requestItemId: line.id,
      holderId: line.requesterId,
      ...terms,
    },
    tx
  );
}

/**
 * The terms an approval writes, as row fields. Instants, not what staff
 * typed: the wrappers below compose those (`resolvePickupTerms`), and the
 * seed and the integration suite pass past dates here to build overdue
 * fixtures, which the typed path refuses. With no deadline the fallback is
 * `defaultPickupBy`, as before #799.
 */
type ApprovalTerms = Partial<PickupTerms>;

function withDefaultDeadline(terms: ApprovalTerms): PickupTerms {
  return {
    pickupFrom: terms.pickupFrom ?? null,
    pickupBy: terms.pickupBy ?? defaultPickupBy(),
    pickupPlace: terms.pickupPlace ?? null,
    pickupNote: terms.pickupNote ?? null,
  };
}

export async function approveRequestItemAs(
  viewer: Viewer,
  data: { requestItemId: string } & ApprovalTerms,
  opts?: EmailOptions
) {
  assertStaff(viewer);
  const { requestItemId, ...given } = data;
  const terms = withDefaultDeadline(given);
  const notice = await db.transaction((tx) =>
    approveLineInTx(tx, viewer, requestItemId, terms)
  );
  // After the commit, never inside it: a failed email must not undo an
  // approval, and a slow one must not hold the item's lock.
  await notifyInventoryByEmail(notice, opts);
  return { ok: true as const };
}

/**
 * Approves every named line with one set of pickup terms, or none of them.
 *
 * The ids are the lines the dialog listed, which is what staff confirmed. A
 * line that has since left `pending` fails the whole batch and names its
 * item, rather than being skipped: what staff saw is what gets approved.
 *
 * Iterated in ascending id order whatever order the caller sent, so two
 * staff running overlapping batches wait on each other instead of each
 * holding a line the other wants. Each line then locks its item inside
 * `transitionItem`, the same line-then-item order as the single-line path.
 */
export async function approveRequestLinesAs(
  viewer: Viewer,
  data: { requestItemIds: string[] } & ApprovalTerms,
  opts?: EmailOptions
) {
  assertStaff(viewer);
  const { requestItemIds, ...given } = data;
  const ids = [...new Set(requestItemIds)].sort();
  if (ids.length === 0) {
    throw new Error("No lines to approve");
  }
  // One set of terms for the batch: a fallback date computed per line would
  // drift by milliseconds across the group.
  const terms = withDefaultDeadline(given);
  const notices = await db.transaction(async (tx) => {
    const collected: (InventoryNotice | null)[] = [];
    for (const id of ids) {
      collected.push(await approveLineInTx(tx, viewer, id, terms));
    }
    return collected;
  });
  // One email per line, matching the one bell row per line. A cart of six
  // items is six emails; coalescing them is a later change if it grates.
  for (const notice of notices) {
    await notifyInventoryByEmail(notice, opts);
  }
  return { approved: ids };
}

export async function rejectRequestItemAs(
  viewer: Viewer,
  data: { requestItemId: string; reviewComment: string },
  opts?: EmailOptions
) {
  assertStaff(viewer);
  if (!data.reviewComment.trim()) {
    throw new Error("Reject reason required");
  }
  const notice = await db.transaction(async (tx) => {
    // Locks the line and reads the item it belongs to. The requester is not
    // read here any more: transitionItem looks it up when it closes the line,
    // so that the denial reaches whoever asked even on a path that did not
    // come through this function.
    const [line] = await tx
      .select({
        id: inventoryRequestItems.id,
        itemId: inventoryRequestItems.itemId,
        status: inventoryRequestItems.status,
      })
      .from(inventoryRequestItems)
      .where(eq(inventoryRequestItems.id, data.requestItemId))
      .for("update");
    if (!line) {
      throw new Error("Request line not found");
    }
    if (line.status !== "pending") {
      throw new Error("Only pending lines can be rejected");
    }
    // The release, the line close, the history row and the denial notice all
    // happen inside transitionItem now. This function keeps only what is its
    // own: who may reject, and which line is eligible.
    const { transitionItem } = await import("./inventory-transitions");
    return await transitionItem(
      viewer,
      {
        itemId: line.itemId,
        nextStatus: "available",
        comment: data.reviewComment,
        lineDecision: { outcome: "rejected", requestItemId: line.id },
      },
      tx
    );
  });
  await notifyInventoryByEmail(notice, opts);
  return { ok: true as const };
}

export async function cancelRequestItemAs(
  viewer: Viewer,
  data: { requestItemId: string; note: string | null }
) {
  if (!viewer) {
    throw new Error("Sign in required");
  }
  return await db.transaction(async (tx) => {
    const [line] = await tx
      .select({
        id: inventoryRequestItems.id,
        itemId: inventoryRequestItems.itemId,
        status: inventoryRequestItems.status,
        requesterId: inventoryRequests.userId,
      })
      .from(inventoryRequestItems)
      .innerJoin(
        inventoryRequests,
        eq(inventoryRequestItems.requestId, inventoryRequests.id)
      )
      .where(eq(inventoryRequestItems.id, data.requestItemId))
      .for("update");
    if (!line) {
      throw new Error("Request line not found");
    }
    if (line.requesterId !== viewer.id) {
      throw new Error("Only the requester can cancel");
    }
    if (line.status !== "pending" && line.status !== "approved") {
      throw new Error("Line is not in a cancellable state");
    }
    const [item] = await tx
      .select()
      .from(inventoryItems)
      .where(eq(inventoryItems.id, line.itemId))
      .for("update");
    if (item.status === "checked_out") {
      throw new Error("Cannot cancel after checkout");
    }
    // self_cancel is what lets a requester past the staff gate, and it is the
    // reason no notification is emitted: the only person to tell is the one
    // who just clicked the button.
    const { transitionItem } = await import("./inventory-transitions");
    await transitionItem(
      viewer,
      {
        itemId: line.itemId,
        nextStatus: "available",
        comment: data.note,
        authority: "self_cancel",
        lineDecision: { outcome: "cancelled", requestItemId: line.id },
      },
      tx
    );
    return { ok: true as const };
  });
}

// The skip rides in `EmailOptions`, beside the test seam, so the `*As`
// inputs stay the row fields (#387).
/**
 * What staff typed, as the terms `*As` writes. Staff is checked first, so a
 * caller who may not approve learns that rather than what is wrong with the
 * window; the `*As` call checks again, which costs nothing.
 */
function typedTerms(viewer: Viewer, fields: PickupFields): PickupTerms {
  assertStaff(viewer);
  return resolvePickupTerms(fields);
}

export async function approveRequestItemForCurrentUser(
  data: { requestItemId: string; sendEmail: boolean } & PickupFields
) {
  const viewer = await requireUser();
  const { sendEmail, requestItemId, ...fields } = data;
  return approveRequestItemAs(
    viewer,
    { requestItemId, ...typedTerms(viewer, fields) },
    { sendEmail }
  );
}

export async function approveRequestLinesForCurrentUser(
  data: { requestItemIds: string[]; sendEmail: boolean } & PickupFields
) {
  const viewer = await requireUser();
  const { sendEmail, requestItemIds, ...fields } = data;
  return approveRequestLinesAs(
    viewer,
    { requestItemIds, ...typedTerms(viewer, fields) },
    { sendEmail }
  );
}

export async function rejectRequestItemForCurrentUser(data: {
  requestItemId: string;
  reviewComment: string;
  sendEmail: boolean;
}) {
  const viewer = await requireUser();
  const { sendEmail, ...fields } = data;
  return rejectRequestItemAs(viewer, fields, { sendEmail });
}

export async function cancelRequestItemForCurrentUser(data: {
  requestItemId: string;
  note: string | null;
}) {
  const viewer = await requireUser();
  return cancelRequestItemAs(viewer, data);
}
