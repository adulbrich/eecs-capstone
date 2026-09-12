import { describe, expect, it, vi } from "vitest";
import type { NotificationConfig } from "#/lib/email/config";
import type { InventoryNotice } from "#/lib/inventory-notifications";
import { notifyInventoryByEmail } from "../inventory-emails";

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
