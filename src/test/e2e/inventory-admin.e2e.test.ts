import { expect, test } from "@playwright/test";
import { waitForHydration } from "../shared/playwright";
import { ADMIN_AUTH, USER_AUTH } from "./constants";
import {
  createFixtureItem,
  createFixtureRequestLine,
  fixtureName,
  giveFixtureHold,
  openDb,
  userIdByEmail,
} from "./fixtures";
import { rowFor } from "./locators";

/**
 * Staff maintaining the catalog itself: creating an item, editing it, taking it
 * out of circulation, and the one action that cannot be undone.
 *
 * `/inventory/new` and `/inventory/$itemId/edit` sit under `_authed`, which
 * only guarantees a signed-in viewer. Their staff gate is a `beforeLoad`
 * redirect, so it is visible in a browser and nowhere else.
 */
test.describe("inventory item administration", () => {
  test("a signed-in student cannot reach either staff form", async ({
    browser,
  }) => {
    const itemName = fixtureName("Item");
    const { db, close } = openDb();
    let itemId: string;
    try {
      ({ id: itemId } = await createFixtureItem(db, itemName));
    } finally {
      await close();
    }

    const context = await browser.newContext({ storageState: USER_AUTH });
    try {
      const page = await context.newPage();

      // Both routes, because they carry their own `beforeLoad` gate rather than
      // inheriting one: `_authed` guarantees only that somebody is signed in,
      // so each is separately capable of being left open.
      for (const path of ["/inventory/new", `/inventory/${itemId}/edit`]) {
        await page.goto(path);

        // Home, not a 403. The admin layout and these two routes all redirect
        // rather than render a refusal, which is a decision worth pinning: a
        // 403 page would be a different product.
        await expect(page).toHaveURL("/");
      }
    } finally {
      await context.close();
    }
  });

  test("staff create, edit and retire an item", async ({ browser }) => {
    const itemName = fixtureName("Item");
    const location = "Shelf E2E-7";

    const context = await browser.newContext({ storageState: ADMIN_AUTH });
    try {
      const staff = await context.newPage();
      await staff.goto("/inventory/new");
      await waitForHydration(staff, "form");
      await staff.getByLabel("Name").fill(itemName);
      await staff.getByRole("button", { name: "Create item" }).click();

      // The form navigates to the item it just made, so the URL is where the
      // new id comes from.
      await staff.waitForURL(/\/inventory\/[0-9a-f-]{36}/, { timeout: 15_000 });
      const itemUrl = new URL(staff.url()).pathname;
      await expect(
        staff.getByRole("heading", { level: 1, name: itemName })
      ).toBeVisible();

      await staff.goto(`${itemUrl}/edit`);
      await waitForHydration(staff, "form");
      await staff.getByLabel("Location").fill(location);
      await staff.getByRole("button", { name: "Save" }).click();

      // Waited for, not navigated to. The form navigates back to the item
      // itself once the save resolves, so a `goto` here races the in-flight
      // mutation and can abort it: the page then renders the item exactly as it
      // was, and the edit looks like it silently did nothing.
      await staff.waitForURL(new RegExp(`${itemUrl}$`), { timeout: 15_000 });
      await waitForHydration(staff);
      // Location is one of the four staff-only fields, so the private panel is
      // where it lands rather than the public half of the page.
      await expect(staff.getByText(location)).toBeVisible();

      await retire(staff);
      await expect(staff.getByText("Retired").first()).toBeVisible();

      // Retired items leave the management table. That is the whole point of
      // retiring rather than deleting, and it is a filter default rather than
      // anything about the row.
      const listUrl = `/admin/inventory?q=${encodeURIComponent(itemName)}`;
      await staff.goto(listUrl);
      await waitForHydration(staff);
      const row = rowFor(staff, itemName);
      await expect(row).toHaveCount(0);

      await staff.getByLabel("Show only retired").click();
      await expect(row).toHaveCount(1);

      // Retired is the second status the delete gate allows, and the only one
      // reachable without checking an item out first. Asserting it here rather
      // than in a fourth fixture keeps the gate's two arms proven against the
      // same button.
      await staff.goto(itemUrl);
      await waitForHydration(staff);
      await expect(
        staff.getByRole("button", { name: "Hard delete item" })
      ).toBeEnabled();
    } finally {
      await context.close();
    }
  });
});

/**
 * Hard delete has two conditions and the panel only enforces one of them.
 *
 * The button is disabled purely on status. The other half, that the item has
 * no historical request lines, is a server-side pre-check standing in front of
 * the RESTRICT foreign key on `inventory_request_items.item_id`, so the only
 * way to see it is to press an enabled button and read what comes back. The
 * issue that asked for this describes the button as gated on both; it is not,
 * and asserting the described behavior rather than the real one would have
 * produced a test that fails against correct code.
 */
test.describe("inventory hard delete gate", () => {
  test("status alone disables the button", async ({ browser }) => {
    const itemName = fixtureName("Item");
    const { db, close } = openDb();
    let itemId: string;
    try {
      ({ id: itemId } = await createFixtureItem(db, itemName));
      await giveFixtureHold(db, {
        itemId,
        holderEmail: "user@example.com",
        status: "checked_out",
      });
    } finally {
      await close();
    }

    const context = await browser.newContext({ storageState: ADMIN_AUTH });
    try {
      const staff = await context.newPage();
      await staff.goto(`/inventory/${itemId}`);
      await waitForHydration(staff);
      await expect(
        staff.getByRole("button", { name: "Hard delete item" })
      ).toBeDisabled();

      // Returned, so the same button on the same page is now live. Without
      // this the assertion above would also pass on a button that is disabled
      // in every state.
      await staff.getByRole("button", { name: "Return" }).click();
      await expect(
        staff.getByRole("button", { name: "Hard delete item" })
      ).toBeEnabled();
    } finally {
      await context.close();
    }
  });

  test("request history refuses the delete, and a clean item accepts it", async ({
    browser,
  }) => {
    const usedName = fixtureName("Item");
    const cleanName = fixtureName("Item");
    const { db, close } = openDb();
    let usedId: string;
    let cleanId: string;
    try {
      ({ id: usedId } = await createFixtureItem(db, usedName));
      ({ id: cleanId } = await createFixtureItem(db, cleanName));
      const userId = await userIdByEmail(db, "user@example.com");
      await createFixtureRequestLine(db, { itemId: usedId, userId });
      // Checked out on top of that line, so the test has to return it in the
      // browser before the button goes live. That is what makes the refusal
      // below about the request history rather than about the status.
      await giveFixtureHold(db, {
        itemId: usedId,
        holderEmail: "user@example.com",
        status: "checked_out",
      });
    } finally {
      await close();
    }

    const context = await browser.newContext({ storageState: ADMIN_AUTH });
    try {
      const staff = await context.newPage();

      await staff.goto(`/inventory/${usedId}`);
      await waitForHydration(staff);
      await staff.getByRole("button", { name: "Return" }).click();
      await expect(
        staff.getByRole("button", { name: "Hard delete item" })
      ).toBeEnabled();

      await confirmHardDelete(staff, usedName);

      // Scoped to the dialog. The panel mirrors its own error into the Status
      // section, so the message is on screen twice and an unscoped locator
      // cannot say the dialog is the one that reported it.
      await expect(
        staff
          .getByRole("dialog")
          .getByText(
            "Cannot hard delete; this item has historical request records. Retire it instead."
          )
      ).toBeVisible();
      // Still there, which is the half of the refusal that matters.
      await expect(staff).toHaveURL(new RegExp(`/inventory/${usedId}$`));

      await staff.goto(`/inventory/${cleanId}`);
      await waitForHydration(staff);
      await confirmHardDelete(staff, cleanName);

      // The panel navigates to the management table once the item is gone,
      // because the page the button was on no longer exists.
      await staff.waitForURL(/\/admin\/inventory/, { timeout: 15_000 });
      await staff.goto(
        `/admin/inventory?q=${encodeURIComponent(cleanName)}&retiredOnly=true`
      );
      await expect(rowFor(staff, cleanName)).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});

/**
 * Retire through the override select rather than a button: there is no Retire
 * action on the panel, because retiring is not a step in the item's normal
 * lifecycle. The select's options are the raw status values with underscores
 * swapped for spaces.
 */
async function retire(page: import("@playwright/test").Page): Promise<void> {
  await page.getByLabel("Change status to...").click();
  await page.getByRole("option", { name: "retired", exact: true }).click();
}

/** Opens the delete dialog and types the item name the confirmation demands. */
async function confirmHardDelete(
  page: import("@playwright/test").Page,
  itemName: string
): Promise<void> {
  await page.getByRole("button", { name: "Hard delete item" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Confirm item name").fill(itemName);
  await dialog
    .getByRole("button", { name: "Hard delete", exact: true })
    .click();
}
