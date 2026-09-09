import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
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
import {
  cancelCustomLineAs,
  fulfillCustomLineAs,
  rejectCustomLineAs,
  startSourcingCustomLineAs,
  submitCustomRequestAs,
  updateSourcingNoteAs,
} from "#/server/_internal/inventory-custom";
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
