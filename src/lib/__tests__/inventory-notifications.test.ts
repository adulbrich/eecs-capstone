import { describe, expect, it } from "vitest";
import type { ItemStatus } from "#/lib/vocabularies";
import {
  notificationFor,
  overdueNotifications,
} from "../inventory-notifications";

const item = {
  currentHolderId: null as string | null,
  currentRequestItemId: null as string | null,
  id: "i-1",
  name: "Oculus Quest 3",
  status: "reserved" as ItemStatus,
};

describe("notificationFor", () => {
  it("sends a denial to the requester, not to whoever holds the item", () => {
    // The subtlest rule in the domain: staff can take a still-pending item
    // straight to checked_out for a teammate, so the holder and the person
    // owed the denial are two different people.
    const row = notificationFor(
      { ...item, currentHolderId: "u-teammate" },
      { nextStatus: "available", comment: "Out of scope this term" },
      "u-teammate",
      { outcome: "rejected", requesterId: "u-requester" }
    );
    expect(row?.userId).toBe("u-requester");
    expect(row?.type).toBe("inventory_request_rejected");
    expect(row?.message).toBe("Out of scope this term");
  });

  it("answers the denial before asking who holds the item", () => {
    // A label hold resolves to nobody, and the recipient guard below would
    // have swallowed the denial owed to the person who asked.
    const row = notificationFor(
      { ...item, currentHolderId: null },
      { nextStatus: "available" },
      null,
      { outcome: "rejected", requesterId: "u-requester" }
    );
    expect(row?.userId).toBe("u-requester");
  });

  it("says nothing for a rejection with no resolved requester", () => {
    expect(
      notificationFor(item, { nextStatus: "available" }, null, {
        outcome: "rejected",
        requesterId: null,
      })
    ).toBeNull();
  });

  it("says nothing when a requester cancels their own line", () => {
    expect(
      notificationFor(
        item,
        { nextStatus: "available", authority: "self_cancel" },
        "u-holder",
        null
      )
    ).toBeNull();
  });

  it("says nothing when there is nobody to tell", () => {
    expect(
      notificationFor(item, { nextStatus: "reserved" }, null, null)
    ).toBeNull();
  });

  it("names the pickup date on a reservation, and omits it when absent", () => {
    const withDate = notificationFor(
      item,
      { nextStatus: "reserved", pickupBy: new Date("2026-09-01") },
      "u-holder",
      null
    );
    expect(withDate?.type).toBe("inventory_request_approved");
    expect(withDate?.title).toContain("Pick up by");

    const without = notificationFor(
      item,
      { nextStatus: "reserved" },
      "u-holder",
      null
    );
    expect(without?.title).not.toContain("Pick up by");
  });

  it("announces a checkout with its due date, year included", () => {
    // The year is load-bearing: an item due "Sep 1" with no year reads as this
    // year, and the whole point of the notice is that a deadline has meaning.
    const row = notificationFor(
      item,
      { nextStatus: "checked_out", dueAt: new Date("2026-09-01T12:00:00Z") },
      "u-holder",
      null
    );
    expect(row?.type).toBe("inventory_item_checked_out");
    expect(row?.link).toBe("/my/items?tab=active");
    expect(row?.title).toContain("2026");
  });

  it("says the deadline is soon when there is none", () => {
    const row = notificationFor(
      item,
      { nextStatus: "checked_out" },
      "u-holder",
      null
    );
    expect(row?.title).toContain("soon");
  });

  it("thanks a returner but closes a request otherwise", () => {
    const held = {
      ...item,
      currentHolderId: "u-holder",
      status: "checked_out" as ItemStatus,
    };
    const returned = notificationFor(
      held,
      { nextStatus: "available" },
      null,
      null
    );
    expect(returned?.type).toBe("inventory_item_returned");
    expect(returned?.link).toBe("/inventory/i-1");

    const closed = notificationFor(
      { ...held, status: "reserved" as ItemStatus },
      { nextStatus: "retired" },
      null,
      null
    );
    expect(closed?.type).toBe("inventory_request_closed");
  });

  it("says nothing when a release was not from a hold", () => {
    expect(
      notificationFor(
        item,
        { nextStatus: "available", requestItemId: "line-1" },
        "u-holder",
        null
      )
    ).toBeNull();
  });
});

describe("overdueNotifications", () => {
  const NOW = new Date("2026-08-12T00:00:00Z").getTime();
  const past = new Date("2026-08-01T00:00:00Z");
  const candidate = {
    dueAt: past,
    itemId: "i-1",
    itemName: "Raspberry Pi 5",
    pickupBy: null,
    status: "checked_out",
    userId: "u-1",
  };

  it("collapses the same person appearing in both scans", () => {
    // The request scan and the hold scan deliberately overlap, because a
    // teammate can collect an item someone else requested. When they are the
    // same person the row comes back twice.
    expect(overdueNotifications([candidate, candidate], NOW)).toHaveLength(1);
  });

  it("keeps two different people for the same item", () => {
    expect(
      overdueNotifications([candidate, { ...candidate, userId: "u-2" }], NOW)
    ).toHaveLength(2);
  });

  it("emits nothing for a deadline that has not passed", () => {
    expect(
      overdueNotifications(
        [{ ...candidate, dueAt: new Date("2026-12-01") }],
        NOW
      )
    ).toEqual([]);
  });

  it("tells a missed pickup apart from a missed return", () => {
    const [pickup] = overdueNotifications(
      [{ ...candidate, dueAt: null, pickupBy: past, status: "reserved" }],
      NOW
    );
    expect(pickup.type).toBe("inventory_pickup_overdue");
    const [checkout] = overdueNotifications([candidate], NOW);
    expect(checkout.type).toBe("inventory_checkout_overdue");
  });
});
