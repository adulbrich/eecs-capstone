import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
// biome-ignore lint/performance/noNamespaceImport: drizzle needs the schema namespace object
import * as schema from "../../db/schema";
import { waitForHydration } from "../shared/playwright";
import { ADMIN_AUTH, USER_AUTH } from "./constants";
import {
  addFixtureCartItem,
  createFixtureCustomLine,
  createFixtureItem,
  fixtureName,
  userIdByEmail,
  withDb,
} from "./fixtures";
import { entryFor, rowFor } from "./locators";
import { confirmed } from "./waits";

/**
 * The three ways a line leaves a student's list that no other flow presses:
 * staff reject a custom line, the requester cancels one from the line sheet,
 * and a borrow-list entry is removed before it was ever submitted.
 */
test.describe("custom line rejection", () => {
  test("staff reject a custom line with a reason the requester can read", async ({
    browser,
  }) => {
    const name = fixtureName("Ask");
    await withDb(async (db) =>
      createFixtureCustomLine(db, {
        userId: await userIdByEmail(db, "user@example.com"),
        name,
      })
    );

    const staffContext = await browser.newContext({ storageState: ADMIN_AUTH });
    const userContext = await browser.newContext({ storageState: USER_AUTH });
    try {
      const staff = await staffContext.newPage();
      await staff.goto("/admin/inventory/requests");
      await waitForHydration(staff);

      const row = rowFor(staff, name);
      await row.getByRole("button", { name: "Reject" }).click();
      await staff.getByLabel("Reason (sent to requester)").fill("Not stocked");
      await confirmed(staff, () =>
        staff.getByRole("button", { name: "Confirm reject" }).click()
      );
      // Off the pending list, and on the rejected one: a row that merely
      // vanished could have been filtered rather than written.
      await expect(rowFor(staff, name)).toHaveCount(0);
      await staff.goto("/admin/inventory/requests?status=rejected");
      await waitForHydration(staff);
      await expect(rowFor(staff, name)).toBeVisible();

      const user = await userContext.newPage();
      await user.goto("/my/items?filter=closed");
      await waitForHydration(user);
      await expect(entryFor(user, name)).toBeVisible();
    } finally {
      await staffContext.close();
      await userContext.close();
    }
  });
});

test.describe("custom line self-cancel", () => {
  test("the requester cancels from the line sheet", async ({ browser }) => {
    const name = fixtureName("Ask");
    const { lineId } = await withDb(async (db) =>
      createFixtureCustomLine(db, {
        userId: await userIdByEmail(db, "user@example.com"),
        name,
      })
    );

    const userContext = await browser.newContext({ storageState: USER_AUTH });
    try {
      const user = await userContext.newPage();
      await user.goto("/my/items");
      await waitForHydration(user);

      await entryFor(user, name)
        .getByRole("button", { name: "Details" })
        .click();
      const sheet = user.getByRole("dialog");
      await expect(sheet).toBeVisible();
      await confirmed(user, () =>
        sheet.getByRole("button", { name: "Cancel request" }).click()
      );
      await expect(entryFor(user, name)).toHaveCount(0);

      const [line] = await withDb((db) =>
        db
          .select({ status: schema.inventoryCustomLines.status })
          .from(schema.inventoryCustomLines)
          .where(eq(schema.inventoryCustomLines.id, lineId))
      );
      expect(line.status).toBe("cancelled");
    } finally {
      await userContext.close();
    }
  });
});

test.describe("borrow list removal", () => {
  test("a student removes an item from the borrow list", async ({
    browser,
  }) => {
    const itemName = fixtureName("Item");
    const { id: itemId } = await withDb(async (db) => {
      const item = await createFixtureItem(db, itemName);
      await addFixtureCartItem(db, {
        userId: await userIdByEmail(db, "user@example.com"),
        itemId: item.id,
      });
      return item;
    });

    const userContext = await browser.newContext({ storageState: USER_AUTH });
    try {
      const user = await userContext.newPage();
      await user.goto("/my/items");
      await waitForHydration(user);

      await confirmed(user, () =>
        entryFor(user, itemName).getByRole("button", { name: "Remove" }).click()
      );
      await expect(entryFor(user, itemName)).toHaveCount(0);

      const rows = await withDb((db) =>
        db
          .select()
          .from(schema.inventoryCartItems)
          .where(eq(schema.inventoryCartItems.itemId, itemId))
      );
      expect(rows).toHaveLength(0);
    } finally {
      await userContext.close();
    }
  });
});
