import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
// biome-ignore lint/performance/noNamespaceImport: drizzle needs the schema namespace object
import * as schema from "../../db/schema";
import { waitForHydration } from "../shared/playwright";
import { ADMIN_AUTH } from "./constants";
import { createFixtureUser, openDb } from "./fixtures";
import { confirmed } from "./waits";

/**
 * The two writes on `/admin/users/:id` that change what a person can do. Both
 * act on a fixture account rather than a seeded one: the accessibility suite
 * signs in as the seeded users, and a ban left behind by a failed run would
 * lock it out.
 *
 * Asserted on the row as well as the page. The page re-reads through
 * `router.invalidate()`, so a control that flipped without writing would
 * still flip back on the next load; the row is what the ban actually is.
 */
test.describe("admin user role and ban", () => {
  test("staff change a role, ban with a reason, and unban", async ({
    browser,
  }) => {
    const { db, close } = openDb();
    let userId: string;
    try {
      ({ id: userId } = await createFixtureUser(db));
    } finally {
      await close();
    }

    const staffContext = await browser.newContext({ storageState: ADMIN_AUTH });
    try {
      const staff = await staffContext.newPage();
      await staff.goto(`/admin/users/${userId}`);
      await waitForHydration(staff);

      const role = staff.getByRole("combobox", { name: "Role" });
      await expect(role).toHaveText("user");
      await role.click();
      await staff.getByRole("option", { name: "instructor" }).click();
      await confirmed(staff, () =>
        staff.getByRole("button", { name: "Save", exact: true }).click()
      );
      await expect(role).toHaveText("instructor");
      await expect(await readUser(userId)).toMatchObject({
        role: "instructor",
      });

      await staff.getByLabel("Reason").fill("End-to-end ban");
      await confirmed(staff, () =>
        staff.getByRole("button", { name: "Ban", exact: true }).click()
      );
      await expect(
        staff.getByRole("heading", { name: "Banned", exact: true })
      ).toBeVisible();
      await expect(staff.getByText("End-to-end ban")).toBeVisible();
      await expect(await readUser(userId)).toMatchObject({
        banned: true,
        banReason: "End-to-end ban",
      });

      await confirmed(staff, () =>
        staff.getByRole("button", { name: "Unban" }).click()
      );
      await expect(
        staff.getByRole("heading", { name: "Ban this user" })
      ).toBeVisible();
      await expect(await readUser(userId)).toMatchObject({ banned: false });
    } finally {
      await staffContext.close();
    }
  });
});

async function readUser(id: string) {
  const { db, close } = openDb();
  try {
    const [row] = await db
      .select({
        role: schema.user.role,
        banned: schema.user.banned,
        banReason: schema.user.banReason,
      })
      .from(schema.user)
      .where(eq(schema.user.id, id));
    return row;
  } finally {
    await close();
  }
}
