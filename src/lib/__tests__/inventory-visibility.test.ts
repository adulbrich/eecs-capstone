import { describe, expect, it } from "vitest";
import {
  ACTIVE_STATUSES,
  canReadInventoryItem,
  canSeeRetired,
  publicItemView,
  staffItemView,
  visibleStatuses,
} from "../inventory-visibility";
import type { Viewer } from "../viewer";

const admin: Viewer = { id: "u-admin", role: "admin" };
const instructor: Viewer = { id: "u-inst", role: "instructor" };
const student: Viewer = { id: "u-user", role: "user" };
const anon: Viewer = null;

describe("canSeeRetired", () => {
  it("is staff only, and is the one rule the rest derive from", () => {
    expect(canSeeRetired(admin)).toBe(true);
    expect(canSeeRetired(instructor)).toBe(true);
    expect(canSeeRetired(student)).toBe(false);
    expect(canSeeRetired(anon)).toBe(false);
  });
});

describe("visibleStatuses", () => {
  it("excludes retired for everyone by default", () => {
    for (const viewer of [admin, instructor, student, anon]) {
      expect(visibleStatuses(viewer)).toEqual(ACTIVE_STATUSES);
      expect(visibleStatuses(viewer)).not.toContain("retired");
    }
  });

  it("returns exactly the retired set for staff who ask", () => {
    expect(visibleStatuses(admin, { retiredOnly: true })).toEqual(["retired"]);
    expect(visibleStatuses(instructor, { retiredOnly: true })).toEqual([
      "retired",
    ]);
  });

  it("ignores retiredOnly for a viewer who may not see retired", () => {
    // The public schema does not carry this flag, so this is the second of
    // two independent things that would both have to fail for a non-staff
    // request to reach a retired row.
    expect(visibleStatuses(student, { retiredOnly: true })).toEqual(
      ACTIVE_STATUSES
    );
    expect(visibleStatuses(anon, { retiredOnly: true })).toEqual(
      ACTIVE_STATUSES
    );
  });
});

describe("canReadInventoryItem", () => {
  it("lets anyone read an item that is not retired", () => {
    expect(canReadInventoryItem({ status: "available" }, anon)).toBe(true);
    expect(canReadInventoryItem({ status: "checked_out" }, student)).toBe(true);
  });

  it("lets staff read a retired item, and nobody else", () => {
    // A listing decides what to show by default; this decides whether a
    // person may read one row. Staff reaching a retired item by URL is
    // correct, and the retired-only filter is what produces that URL.
    expect(canReadInventoryItem({ status: "retired" }, admin)).toBe(true);
    expect(canReadInventoryItem({ status: "retired" }, instructor)).toBe(true);
    expect(canReadInventoryItem({ status: "retired" }, student)).toBe(false);
    expect(canReadInventoryItem({ status: "retired" }, anon)).toBe(false);
  });
});

const row = {
  id: "i-1",
  name: "Raspberry Pi 5",
  description: "An SBC.",
  imageUrl: "inventory/pi.webp",
  status: "checked_out",
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-02-01"),
  currentPickupBy: null,
  currentDueAt: new Date("2026-03-01"),
  currentHolderId: "u-holder",
  // Deliberately stale: the joined account wins, and the assertions below
  // prove the view reads the hold rather than these columns.
  currentHolderEmail: "old@address.test",
  currentHolderName: "Old Name",
  currentHolderLabel: null,
  currentHolderProgram: null,
  currentRequestItemId: "line-1",
  serial: "SN-1",
  label: "PI-01",
  location: "Cabinet A",
  notes: "Staff only note",
};
const categories = [{ id: "c-1", name: "Single-Board Computer" }];
const hold = {
  kind: "account" as const,
  accountId: "u-holder",
  email: "holder@x.test",
  name: "Holder",
};

describe("publicItemView", () => {
  const view = publicItemView(row, categories);

  it("carries only what a public reader may see", () => {
    expect(view).toEqual({
      id: "i-1",
      name: "Raspberry Pi 5",
      description: "An SBC.",
      categories,
      imageUrl: "inventory/pi.webp",
      status: "checked_out",
      pickupBy: null,
      dueAt: new Date("2026-03-01"),
    });
  });

  it("omits every staff-only field", () => {
    // Built field by field rather than by nulling a copy of the row, which is
    // why a new staff-only column cannot ride the public payload by default.
    for (const key of [
      "serial",
      "label",
      "location",
      "notes",
      "currentHolderId",
      "currentHolderEmail",
      "currentHolderName",
      "currentHolderLabel",
      "currentHolderProgram",
      "currentRequestItemId",
      "createdAt",
      "updatedAt",
    ]) {
      expect(view).not.toHaveProperty(key);
    }
  });
});

describe("staffItemView", () => {
  const view = staffItemView(row, categories, hold);

  it("adds the staff fields on top of the public ones", () => {
    expect(view.name).toBe("Raspberry Pi 5");
    expect(view.serial).toBe("SN-1");
    expect(view.notes).toBe("Staff only note");
    expect(view.location).toBe("Cabinet A");
  });

  it("reads the holder's address and name from the hold, not the row", () => {
    expect(view.currentHolderEmail).toBe("holder@x.test");
    expect(view.currentHolderName).toBe("Holder");
  });

  it("passes the other three holder columns straight through", () => {
    expect(view.currentHolderId).toBe("u-holder");
    expect(view.currentHolderLabel).toBeNull();
    expect(view.currentHolderProgram).toBeNull();
  });
});
