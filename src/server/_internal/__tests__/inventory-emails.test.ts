import { describe, expect, it, vi } from "vitest";
import type { NotificationConfig } from "#/lib/email/config";
import type { InventoryNotice } from "#/lib/inventory-notifications";
import {
  notifyInventoryByEmail,
  notifyRequestSubmittedByEmail,
} from "../inventory-emails";

const CONFIG: NotificationConfig = {
  appBaseUrl: "https://app",
  staffInbox: "staff@oregonstate.edu",
};

const approved: InventoryNotice = {
  link: "/my/items?filter=open",
  message: "Your request for Oculus Quest 3 was approved.",
  recipient: { accountId: "u-1", email: "student@oregonstate.edu" },
  title: "Reserved: Oculus Quest 3. Pick up by Sep 20, 2026.",
  type: "inventory_request_approved",
};

describe("notifyInventoryByEmail", () => {
  it("mails the notice's own words to the recipient, with an absolute link", async () => {
    const send = vi.fn().mockResolvedValue(undefined);

    await notifyInventoryByEmail(approved, send, CONFIG);

    expect(send).toHaveBeenCalledOnce();
    const [to, email] = send.mock.calls[0] ?? [];
    expect(to).toBe("student@oregonstate.edu");
    expect(email.subject).toBe(approved.title);
    expect(email.text).toContain(approved.message);
    expect(email.text).toContain("https://app/my/items?filter=open");
  });

  it("reaches a walk-in holder who has an address and no account", async () => {
    const send = vi.fn().mockResolvedValue(undefined);

    await notifyInventoryByEmail(
      { ...approved, recipient: { accountId: null, email: "walkin@x.edu" } },
      send,
      CONFIG
    );

    expect(send.mock.calls[0]?.[0]).toBe("walkin@x.edu");
  });

  it("sends nothing for a confirmation type, for no notice, or for no address", async () => {
    const send = vi.fn().mockResolvedValue(undefined);

    await notifyInventoryByEmail(
      { ...approved, type: "inventory_item_returned" },
      send,
      CONFIG
    );
    await notifyInventoryByEmail(null, send, CONFIG);
    await notifyInventoryByEmail(
      { ...approved, recipient: { accountId: "u-1", email: null } },
      send,
      CONFIG
    );

    expect(send).not.toHaveBeenCalled();
  });

  it("never propagates a transport failure", async () => {
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const send = vi.fn().mockRejectedValue(new Error("SES is down"));

    await expect(
      notifyInventoryByEmail(approved, send, CONFIG)
    ).resolves.toBeUndefined();

    expect(error).toHaveBeenCalledOnce();
    error.mockRestore();
  });
});

describe("notifyRequestSubmittedByEmail", () => {
  const request = {
    id: "req-1",
    lines: ["Oculus Quest 3", "Raspberry Pi 5"],
    requester: { email: "student@oregonstate.edu", name: "Sam Student" },
  };

  it("tells the staff inbox what was asked for and by whom, linking to the queue", async () => {
    const send = vi.fn().mockResolvedValue(undefined);

    await notifyRequestSubmittedByEmail(request, "cart", send, CONFIG);

    expect(send).toHaveBeenCalledOnce();
    const [to, email] = send.mock.calls[0] ?? [];
    expect(to).toBe("staff@oregonstate.edu");
    expect(email.subject).toBe("Borrow list submitted: Sam Student");
    expect(email.text).toContain("Oculus Quest 3");
    expect(email.text).toContain("Raspberry Pi 5");
    expect(email.text).toContain("https://app/admin/inventory/requests");
  });

  it("names a custom request as one", async () => {
    const send = vi.fn().mockResolvedValue(undefined);

    await notifyRequestSubmittedByEmail(request, "custom", send, CONFIG);

    expect(send.mock.calls[0]?.[1].subject).toBe(
      "Custom request submitted: Sam Student"
    );
  });

  it("warns instead of throwing when the staff inbox is unset", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const send = vi.fn().mockResolvedValue(undefined);

    await expect(
      notifyRequestSubmittedByEmail(request, "cart", send, {
        ...CONFIG,
        staffInbox: null,
      })
    ).resolves.toBeUndefined();

    expect(send).not.toHaveBeenCalled();
    expect(String(warn.mock.calls[0]?.[0])).toContain("EMAIL_STAFF_INBOX");
    warn.mockRestore();
  });
});
