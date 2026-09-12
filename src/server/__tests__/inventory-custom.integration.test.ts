import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "#/db";
import {
  inventoryCustomLineItems,
  inventoryCustomLines,
  inventoryItems,
  inventoryRequestItems,
  inventoryRequests,
  notifications,
  user,
} from "#/db/schema";
import { auth } from "#/lib/auth";
import type { UserRole } from "#/lib/vocabularies";
import { countPendingRequests } from "#/server/_internal/admin";
import { addToCartAs, submitCartAs } from "#/server/_internal/inventory-cart";
import {
  cancelCustomLineAs,
  fulfillCustomLineAs,
  rejectCustomLineAs,
  startSourcingCustomLineAs,
  submitCustomRequestAs,
  updateSourcingNoteAs,
} from "#/server/_internal/inventory-custom";
import {
  listInventoryRequestsAs,
  listMyItemsAs,
} from "#/server/_internal/inventory-holdings";
import { transitionItem } from "#/server/_internal/inventory-transitions";

async function makeUser(email: string, role: UserRole) {
  await auth.api.signUpEmail({
    body: { email, password: "Password1!", name: email },
  });
  await db
    .update(user)
    .set({ emailVerified: true, role })
    .where(eq(user.email, email));
  const [u] = await db.select().from(user).where(eq(user.email, email));
  return { id: u.id, role: u.role };
}

async function makeItem(name: string) {
  const [item] = await db.insert(inventoryItems).values({ name }).returning();
  return item;
}

async function lineById(id: string) {
  const [line] = await db
    .select()
    .from(inventoryCustomLines)
    .where(eq(inventoryCustomLines.id, id));
  return line;
}

async function notificationsFor(userId: string) {
  return await db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId));
}

const ask = (name: string) => ({
  name,
  reason: "For the capstone demo",
  quantity: 1,
  link: null,
});

describe("submitCustomRequestAs", () => {
  it("writes the envelope and its lines, and no item line", async () => {
    const stamp = Date.now();
    const student = await makeUser(`cr-s-${stamp}@x.com`, "user");
    const result = await submitCustomRequestAs(student, {
      lines: [ask("Thermal camera"), { ...ask("Lidar"), quantity: 2 }],
      note: "Both for the same rig",
    });
    expect(result.lineIds).toHaveLength(2);
    const [envelope] = await db
      .select()
      .from(inventoryRequests)
      .where(eq(inventoryRequests.id, result.requestId));
    expect(envelope.userId).toBe(student.id);
    expect(envelope.note).toBe("Both for the same rig");
    const itemLines = await db
      .select()
      .from(inventoryRequestItems)
      .where(eq(inventoryRequestItems.requestId, result.requestId));
    expect(itemLines).toEqual([]);
    const lines = await db
      .select()
      .from(inventoryCustomLines)
      .where(eq(inventoryCustomLines.requestId, result.requestId));
    expect(lines.map((l) => [l.name, l.quantity, l.status])).toEqual(
      expect.arrayContaining([
        ["Thermal camera", 1, "pending"],
        ["Lidar", 2, "pending"],
      ])
    );
    // Staff are told nothing on submit: the overview tile is the signal.
    expect(await notificationsFor(student.id)).toEqual([]);
  });

  it("refuses an anonymous caller and an empty request", async () => {
    const stamp = Date.now();
    const student = await makeUser(`cr-e-${stamp}@x.com`, "user");
    await expect(
      submitCustomRequestAs(null, { lines: [ask("X")], note: null })
    ).rejects.toThrow("Sign in required");
    await expect(
      submitCustomRequestAs(student, { lines: [], note: null })
    ).rejects.toThrow("at least one line");
  });
});

describe("the admin tile", () => {
  it("counts an envelope with only pending custom lines", async () => {
    const stamp = Date.now();
    const student = await makeUser(`cr-tile-${stamp}@x.com`, "user");
    const before = await countPendingRequests();
    const { lineIds } = await submitCustomRequestAs(student, {
      lines: [ask("Oscilloscope probe"), ask("Bench supply")],
      note: null,
    });
    // One envelope, two lines: the tile counts requests, not lines.
    expect(await countPendingRequests()).toBe(before + 1);
    await cancelCustomLineAs(student, {
      customLineId: lineIds[0],
      outcomeNote: null,
    });
    expect(await countPendingRequests()).toBe(before + 1);
    await cancelCustomLineAs(student, {
      customLineId: lineIds[1],
      outcomeNote: null,
    });
    expect(await countPendingRequests()).toBe(before);
  });
});

describe("the custom line lifecycle", () => {
  it("sourcing writes the review columns once and tells the requester", async () => {
    const stamp = Date.now();
    const staffA = await makeUser(`cr-a-${stamp}@x.com`, "admin");
    const staffB = await makeUser(`cr-b-${stamp}@x.com`, "instructor");
    const student = await makeUser(`cr-src-${stamp}@x.com`, "user");
    const {
      lineIds: [id],
    } = await submitCustomRequestAs(student, {
      lines: [ask("Thermal camera")],
      note: null,
    });

    await startSourcingCustomLineAs(staffA, {
      customLineId: id,
      sourcingNote: "Ordered, two weeks",
    });
    const sourced = await lineById(id);
    expect(sourced.status).toBe("sourcing");
    expect(sourced.sourcingNote).toBe("Ordered, two weeks");
    expect(sourced.reviewedBy).toBe(staffA.id);
    expect(sourced.reviewedAt).not.toBeNull();
    expect(sourced.closedAt).toBeNull();

    // A rewritten note reaches the requester and leaves the review columns
    // exactly as the first decision wrote them.
    await updateSourcingNoteAs(staffB, {
      customLineId: id,
      sourcingNote: "Slipped to next month",
    });
    const updated = await lineById(id);
    expect(updated.sourcingNote).toBe("Slipped to next month");
    expect(updated.reviewedBy).toBe(staffA.id);
    expect(updated.reviewedAt?.getTime()).toBe(sourced.reviewedAt?.getTime());

    const notes = await notificationsFor(student.id);
    expect(notes.map((n) => n.type)).toEqual([
      "inventory_custom_sourcing",
      "inventory_custom_sourcing_note",
    ]);
    expect(notes[0].message).toBe("Ordered, two weeks");
    expect(notes[1].message).toBe("Slipped to next month");
  });

  it("cannot source twice, and cannot rewrite the note on a pending line", async () => {
    const stamp = Date.now();
    const staff = await makeUser(`cr-twice-${stamp}@x.com`, "admin");
    const student = await makeUser(`cr-twice-s-${stamp}@x.com`, "user");
    const {
      lineIds: [id],
    } = await submitCustomRequestAs(student, {
      lines: [ask("Thermal camera")],
      note: null,
    });
    await expect(
      updateSourcingNoteAs(staff, { customLineId: id, sourcingNote: "Early" })
    ).rejects.toThrow("only be changed while sourcing");
    await startSourcingCustomLineAs(staff, {
      customLineId: id,
      sourcingNote: null,
    });
    await expect(
      startSourcingCustomLineAs(staff, { customLineId: id, sourcingNote: null })
    ).rejects.toThrow("A sourcing line cannot be sourcing");
  });

  it("rejecting needs a reason, works from sourcing, and reaches the requester", async () => {
    const stamp = Date.now();
    const staff = await makeUser(`cr-rej-${stamp}@x.com`, "admin");
    const student = await makeUser(`cr-rej-s-${stamp}@x.com`, "user");
    const {
      lineIds: [id],
    } = await submitCustomRequestAs(student, {
      lines: [ask("Thermal camera")],
      note: null,
    });
    await startSourcingCustomLineAs(staff, {
      customLineId: id,
      sourcingNote: "Trying",
    });
    await expect(
      rejectCustomLineAs(staff, { customLineId: id, outcomeNote: "  " })
    ).rejects.toThrow("Reject reason required");
    await rejectCustomLineAs(staff, {
      customLineId: id,
      outcomeNote: "The vendor discontinued it",
    });
    const line = await lineById(id);
    expect(line.status).toBe("rejected");
    expect(line.outcomeNote).toBe("The vendor discontinued it");
    // The sourcing note survives beside the outcome: two speaking
    // transitions, two columns, nothing overwritten.
    expect(line.sourcingNote).toBe("Trying");
    expect(line.closedBy).toBe(staff.id);
    expect(line.closedAt).not.toBeNull();
    const notes = await notificationsFor(student.id);
    expect(notes.at(-1)?.type).toBe("inventory_custom_rejected");
    expect(notes.at(-1)?.message).toBe("The vendor discontinued it");
  });

  it("the requester cancels while pending or sourcing, and nobody else", async () => {
    const stamp = Date.now();
    const staff = await makeUser(`cr-can-${stamp}@x.com`, "admin");
    const student = await makeUser(`cr-can-s-${stamp}@x.com`, "user");
    const stranger = await makeUser(`cr-can-o-${stamp}@x.com`, "user");
    const { lineIds } = await submitCustomRequestAs(student, {
      lines: [ask("A"), ask("B")],
      note: null,
    });
    await expect(
      cancelCustomLineAs(stranger, {
        customLineId: lineIds[0],
        outcomeNote: null,
      })
    ).rejects.toThrow("Only the requester can cancel");
    await expect(
      cancelCustomLineAs(staff, { customLineId: lineIds[0], outcomeNote: null })
    ).rejects.toThrow("Only the requester can cancel");

    await cancelCustomLineAs(student, {
      customLineId: lineIds[0],
      outcomeNote: "Found one",
    });
    const cancelled = await lineById(lineIds[0]);
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.outcomeNote).toBe("Found one");
    expect(cancelled.closedBy).toBe(student.id);
    expect(cancelled.reviewedBy).toBeNull();

    await startSourcingCustomLineAs(staff, {
      customLineId: lineIds[1],
      sourcingNote: null,
    });
    await cancelCustomLineAs(student, {
      customLineId: lineIds[1],
      outcomeNote: null,
    });
    expect((await lineById(lineIds[1])).status).toBe("cancelled");
    await expect(
      cancelCustomLineAs(student, {
        customLineId: lineIds[1],
        outcomeNote: null,
      })
    ).rejects.toThrow("A cancelled line cannot be cancelled");
    // Cancelling tells nobody.
    expect(
      (await notificationsFor(student.id)).filter((n) =>
        n.type.startsWith("inventory_custom")
      )
    ).toHaveLength(1);
  });
});

describe("fulfillCustomLineAs", () => {
  it("links the items, reserves each to the requester, and writes one notification", async () => {
    const stamp = Date.now();
    const sourcer = await makeUser(`cr-ful-a-${stamp}@x.com`, "admin");
    const fulfiller = await makeUser(`cr-ful-b-${stamp}@x.com`, "instructor");
    const student = await makeUser(`cr-ful-s-${stamp}@x.com`, "user");
    const one = await makeItem(`FLIR One ${stamp}`);
    const two = await makeItem(`FLIR Two ${stamp}`);
    const {
      lineIds: [id],
    } = await submitCustomRequestAs(student, {
      lines: [{ ...ask("Thermal camera"), quantity: 2 }],
      note: null,
    });
    await startSourcingCustomLineAs(sourcer, {
      customLineId: id,
      sourcingNote: "Ordered",
    });
    const pickupBy = new Date("2026-10-01T00:00:00.000Z");

    const result = await fulfillCustomLineAs(fulfiller, {
      customLineId: id,
      itemIds: [two.id, one.id],
      outcomeNote: "On the shelf by the door",
      pickupBy,
      reserve: true,
    });

    expect(result.itemIds).toEqual([one.id, two.id].sort());
    const line = await lineById(id);
    expect(line.status).toBe("fulfilled");
    expect(line.outcomeNote).toBe("On the shelf by the door");
    expect(line.sourcingNote).toBe("Ordered");
    // Sourcing decided; fulfilling closed. Two people, two pairs of columns.
    expect(line.reviewedBy).toBe(sourcer.id);
    expect(line.closedBy).toBe(fulfiller.id);
    const links = await db
      .select()
      .from(inventoryCustomLineItems)
      .where(eq(inventoryCustomLineItems.customLineId, id));
    expect(links.map((l) => l.itemId).sort()).toEqual([one.id, two.id].sort());
    for (const item of [one, two]) {
      const [after] = await db
        .select()
        .from(inventoryItems)
        .where(eq(inventoryItems.id, item.id));
      expect(after.status).toBe("reserved");
      expect(after.currentHolderId).toBe(student.id);
      expect(after.currentPickupBy?.toISOString()).toBe(pickupBy.toISOString());
      // An ordinary staff hold: no synthetic request line.
      expect(after.currentRequestItemId).toBeNull();
    }
    // One notification for the fulfill, none for the two reservations.
    const notes = (await notificationsFor(student.id)).filter(
      (n) => n.type !== "inventory_custom_sourcing"
    );
    expect(notes).toHaveLength(1);
    expect(notes[0].type).toBe("inventory_custom_fulfilled");
    expect(notes[0].message).toContain(`FLIR One ${stamp}, FLIR Two ${stamp}`);
    expect(notes[0].message).toContain("On the shelf by the door");
  });

  it("goes straight from pending, and links without reserving when asked", async () => {
    const stamp = Date.now();
    const staff = await makeUser(`cr-direct-${stamp}@x.com`, "admin");
    const student = await makeUser(`cr-direct-s-${stamp}@x.com`, "user");
    const item = await makeItem(`Spare probe ${stamp}`);
    const {
      lineIds: [id],
    } = await submitCustomRequestAs(student, {
      lines: [ask("Probe")],
      note: null,
    });
    await fulfillCustomLineAs(staff, {
      customLineId: id,
      itemIds: [item.id],
      outcomeNote: null,
      pickupBy: null,
      reserve: false,
    });
    const line = await lineById(id);
    expect(line.status).toBe("fulfilled");
    expect(line.reviewedBy).toBe(staff.id);
    const [after] = await db
      .select()
      .from(inventoryItems)
      .where(eq(inventoryItems.id, item.id));
    expect(after.status).toBe("available");
    expect(after.currentHolderId).toBeNull();
    const notes = await notificationsFor(student.id);
    expect(notes).toHaveLength(1);
    expect(notes[0].message).toBe(`Spare probe ${stamp} now in the inventory.`);
  });

  it("applies nothing and names the item when one is not available", async () => {
    const stamp = Date.now();
    const staff = await makeUser(`cr-race-${stamp}@x.com`, "admin");
    const student = await makeUser(`cr-race-s-${stamp}@x.com`, "user");
    const holder = await makeUser(`cr-race-h-${stamp}@x.com`, "user");
    const free = await makeItem(`Free ${stamp}`);
    const taken = await makeItem(`Taken ${stamp}`);
    await transitionItem(staff, {
      itemId: taken.id,
      nextStatus: "checked_out",
      holderId: holder.id,
      dueAt: new Date(Date.now() + 86_400_000),
    });
    const {
      lineIds: [id],
    } = await submitCustomRequestAs(student, {
      lines: [ask("Two of something")],
      note: null,
    });

    await expect(
      fulfillCustomLineAs(staff, {
        customLineId: id,
        itemIds: [free.id, taken.id],
        outcomeNote: null,
        pickupBy: null,
        reserve: true,
      })
    ).rejects.toThrow(`Taken ${stamp} is not available`);

    expect((await lineById(id)).status).toBe("pending");
    const [freeAfter] = await db
      .select()
      .from(inventoryItems)
      .where(eq(inventoryItems.id, free.id));
    expect(freeAfter.status).toBe("available");
    expect(
      await db
        .select()
        .from(inventoryCustomLineItems)
        .where(eq(inventoryCustomLineItems.customLineId, id))
    ).toEqual([]);
    expect(await notificationsFor(student.id)).toEqual([]);
  });

  it("is staff only", async () => {
    const stamp = Date.now();
    const student = await makeUser(`cr-ful-nostaff-${stamp}@x.com`, "user");
    const item = await makeItem(`Item ${stamp}`);
    const {
      lineIds: [id],
    } = await submitCustomRequestAs(student, {
      lines: [ask("Thing")],
      note: null,
    });
    await expect(
      fulfillCustomLineAs(student, {
        customLineId: id,
        itemIds: [item.id],
        outcomeNote: null,
        pickupBy: null,
        reserve: true,
      })
    ).rejects.toThrow("Forbidden");
  });
});

describe("the queue with both kinds", () => {
  it("lists custom lines beside item lines, and filters each by its own vocabulary", async () => {
    const stamp = Date.now();
    const staff = await makeUser(`cq-staff-${stamp}@x.com`, "admin");
    const student = await makeUser(`cq-student-${stamp}@x.com`, "user");
    const item = await makeItem(`Carted ${stamp}`);
    await addToCartAs(student, { itemId: item.id });
    await submitCartAs(student, { note: null });
    const {
      lineIds: [custom],
    } = await submitCustomRequestAs(student, {
      lines: [ask(`Wanted ${stamp}`)],
      note: "custom note",
    });
    await startSourcingCustomLineAs(staff, {
      customLineId: custom,
      sourcingNote: "Ordered",
    });

    const all = await listInventoryRequestsAs(staff, { status: "all", q: "" });
    const mine = all.filter((row) => row.requester.id === student.id);
    expect(mine.map((row) => row.kind).sort()).toEqual(["custom", "item"]);
    const customRow = mine.find((row) => row.kind === "custom");
    expect(customRow?.kind).toBe("custom");
    if (customRow?.kind === "custom") {
      expect(customRow.line.name).toBe(`Wanted ${stamp}`);
      expect(customRow.line.sourcingNote).toBe("Ordered");
      expect(customRow.line.reviewedBy).toBe(staff.id);
      expect(customRow.reviewer?.email).toBe(`cq-staff-${stamp}@x.com`);
      expect(customRow.note).toBe("custom note");
      expect(customRow.items).toEqual([]);
    }

    // A status only one kind has filters to that kind.
    const sourcing = await listInventoryRequestsAs(staff, {
      status: "sourcing",
      q: "",
    });
    expect(sourcing.every((row) => row.kind === "custom")).toBe(true);
    expect(sourcing.some((row) => row.requester.id === student.id)).toBe(true);
    const approved = await listInventoryRequestsAs(staff, {
      status: "approved",
      q: "",
    });
    expect(approved.every((row) => row.kind === "item")).toBe(true);

    // Search reaches a custom line's name.
    const found = await listInventoryRequestsAs(staff, {
      status: "all",
      q: `Wanted ${stamp}`,
    });
    expect(found).toHaveLength(1);
    expect(found[0].kind).toBe("custom");
  });

  it("names the items a fulfilled line produced", async () => {
    const stamp = Date.now();
    const staff = await makeUser(`cq-ful-${stamp}@x.com`, "admin");
    const student = await makeUser(`cq-ful-s-${stamp}@x.com`, "user");
    const item = await makeItem(`Arrived ${stamp}`);
    const {
      lineIds: [custom],
    } = await submitCustomRequestAs(student, {
      lines: [ask("Thing")],
      note: null,
    });
    await fulfillCustomLineAs(staff, {
      customLineId: custom,
      itemIds: [item.id],
      outcomeNote: null,
      pickupBy: null,
      reserve: true,
    });
    const rows = await listInventoryRequestsAs(staff, {
      status: "fulfilled",
      q: "",
    });
    const row = rows.find((r) => r.kind === "custom" && r.line.id === custom);
    expect(row?.kind).toBe("custom");
    if (row?.kind === "custom") {
      expect(row.items).toEqual([
        { id: item.id, name: `Arrived ${stamp}`, status: "reserved" },
      ]);
    }
  });

  it("is staff only", async () => {
    const stamp = Date.now();
    const student = await makeUser(`cq-nostaff-${stamp}@x.com`, "user");
    await expect(
      listInventoryRequestsAs(student, { status: "all", q: "" })
    ).rejects.toThrow("Forbidden");
  });
});

describe("custom requests on my items", () => {
  it("files custom lines under their request and the holds they produced under the line", async () => {
    const stamp = Date.now();
    const staff = await makeUser(`cm-staff-${stamp}@x.com`, "admin");
    const student = await makeUser(`cm-student-${stamp}@x.com`, "user");
    const stranger = await makeUser(`cm-stranger-${stamp}@x.com`, "user");
    const produced = await makeItem(`Produced ${stamp}`);
    const plain = await makeItem(`Plain hold ${stamp}`);
    await transitionItem(staff, {
      itemId: plain.id,
      nextStatus: "reserved",
      holderId: student.id,
    });
    const { requestId, lineIds } = await submitCustomRequestAs(student, {
      lines: [ask("First"), ask("Second")],
      note: "for the rig",
    });
    await fulfillCustomLineAs(staff, {
      customLineId: lineIds[0],
      itemIds: [produced.id],
      outcomeNote: "On the shelf",
      pickupBy: null,
      reserve: true,
    });

    const rows = await listMyItemsAs(student);
    // Two custom lines under one request, the hold directly after the line
    // that produced it, and the plain staff hold last in its own group.
    expect(rows.map((row) => row.kind).sort()).toEqual([
      "custom",
      "custom",
      "hold",
      "hold",
    ]);
    const fulfilledAt = rows.findIndex(
      (row) => row.kind === "custom" && row.line.id === lineIds[0]
    );
    const first = rows[fulfilledAt];
    const hold = rows[fulfilledAt + 1];
    const last = rows.at(-1);
    expect(first.kind).toBe("custom");
    expect(hold.kind).toBe("hold");
    expect(last?.kind).toBe("hold");
    if (
      first.kind === "custom" &&
      hold.kind === "hold" &&
      last?.kind === "hold"
    ) {
      expect(first.requestId).toBe(requestId);
      expect(first.note).toBe("for the rig");
      expect(first.line.status).toBe("fulfilled");
      expect(first.line.outcomeNote).toBe("On the shelf");
      expect(Object.keys(first).sort()).toEqual([
        "kind",
        "line",
        "note",
        "requestId",
        "requestedAt",
      ]);
      expect(Object.keys(first.line).sort()).toEqual([
        "closedAt",
        "createdAt",
        "id",
        "link",
        "name",
        "outcomeNote",
        "quantity",
        "reason",
        "reviewedAt",
        "sourcingNote",
        "status",
      ]);
      expect(hold.viaCustomLineId).toBe(lineIds[0]);
      expect(hold.item.id).toBe(produced.id);
      expect(Object.keys(hold).sort()).toEqual([
        "item",
        "kind",
        "viaCustomLineId",
      ]);
      expect(last.viaCustomLineId).toBeNull();
      expect(last.item.id).toBe(plain.id);
    }
    const pending = rows.find(
      (row) => row.kind === "custom" && row.line.id === lineIds[1]
    );
    expect(pending?.kind === "custom" && pending.line.status).toBe("pending");

    // Nobody else sees any of it.
    expect(await listMyItemsAs(stranger)).toEqual([]);
  });
});

describe("custom line emails", () => {
  const ORIGINAL_ENV = { ...process.env };
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("emails the requester when a line is fulfilled or rejected, and not while sourcing", async () => {
    process.env.BETTER_AUTH_URL = "https://app";
    const admin = await makeUser(`a-cl-mail-${Date.now()}@x.com`, "admin");
    const requesterEmail = `r-cl-mail-${Date.now()}@x.com`;
    const requester = await makeUser(requesterEmail, "user");
    const send = vi.fn().mockResolvedValue(undefined);
    const { lineIds } = await submitCustomRequestAs(requester, {
      lines: [
        {
          name: "Thermal camera",
          reason: "Field work",
          quantity: 1,
          link: null,
        },
        { name: "Lidar", reason: "Mapping", quantity: 1, link: null },
      ],
      note: null,
    });

    await startSourcingCustomLineAs(admin, {
      customLineId: lineIds[0],
      sourcingNote: "Ordering",
    });
    expect(send).not.toHaveBeenCalled();

    const item = await makeItem(`Thermal-${Date.now()}`);
    await fulfillCustomLineAs(
      admin,
      {
        customLineId: lineIds[0],
        itemIds: [item.id],
        outcomeNote: "Arrived",
        pickupBy: null,
        reserve: true,
      },
      { send }
    );
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]?.[0]).toBe(requesterEmail);
    expect(send.mock.calls[0]?.[1].subject).toBe("Fulfilled: Thermal camera");

    send.mockClear();
    await rejectCustomLineAs(
      admin,
      { customLineId: lineIds[1], outcomeNote: "No budget" },
      { send }
    );
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]?.[0]).toBe(requesterEmail);
    expect(send.mock.calls[0]?.[1].subject).toBe("Request denied: Lidar");
  });
});
