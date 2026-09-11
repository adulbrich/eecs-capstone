import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
// biome-ignore lint/performance/noNamespaceImport: drizzle needs the schema namespace object
import * as schema from "../../db/schema";
import { waitForHydration } from "../shared/playwright";
import { ADMIN_AUTH } from "./constants";
import {
  createFixtureCategory,
  createFixtureProgram,
  createFixtureUser,
  type Db,
  openDb,
  readUser,
  userIdByEmail,
} from "./fixtures";
import { rowFor, sectionNamed } from "./locators";
import { confirmed } from "./waits";

/**
 * The destructive controls on the admin catalog pages: a category delete, a
 * program's instructor removal and delete, and taking someone off the mentor
 * list. Each is asserted on the row afterwards, because every one of these
 * pages re-reads on success and would show the same thing after a write that
 * never happened.
 */
test.describe("admin catalog deletes", () => {
  test("staff delete a category", async ({ browser }) => {
    const { db, close } = openDb();
    let categoryId: string;
    let name: string;
    try {
      ({ id: categoryId, name } = await createFixtureCategory(db));
    } finally {
      await close();
    }

    const staffContext = await browser.newContext({ storageState: ADMIN_AUTH });
    try {
      const staff = await staffContext.newPage();
      await staff.goto(`/admin/categories/${categoryId}`);
      await waitForHydration(staff);

      await staff.getByRole("button", { name: "Delete" }).click();
      const dialog = staff.getByRole("alertdialog");
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "Delete" }).click();
      await staff.waitForURL(/\/admin\/categories/, { timeout: 15_000 });

      await expect(rowFor(staff, name)).toHaveCount(0);
      expect(
        await countWhere((db) =>
          db
            .select()
            .from(schema.categories)
            .where(eq(schema.categories.id, categoryId))
        )
      ).toBe(0);
    } finally {
      await staffContext.close();
    }
  });

  test("staff remove a program's instructor, then delete the program", async ({
    browser,
  }) => {
    const { db, close } = openDb();
    let programId: string;
    let courseName: string;
    try {
      const instructorId = await userIdByEmail(db, "admin@example.com");
      ({ id: programId, courseName } = await createFixtureProgram(db, {
        instructorId,
      }));
    } finally {
      await close();
    }

    const staffContext = await browser.newContext({ storageState: ADMIN_AUTH });
    try {
      const staff = await staffContext.newPage();
      await staff.goto(`/admin/programs/${programId}`);
      await waitForHydration(staff);

      const instructors = sectionNamed(staff, "Instructors");
      await confirmed(staff, () =>
        instructors.getByRole("button", { name: "Remove" }).click()
      );
      await expect(instructors.getByText("None yet.")).toBeVisible();
      expect(
        await countWhere((db) =>
          db
            .select()
            .from(schema.programInstructors)
            .where(eq(schema.programInstructors.programId, programId))
        )
      ).toBe(0);

      await staff.getByRole("button", { name: "Delete" }).click();
      const dialog = staff.getByRole("alertdialog");
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "Delete" }).click();
      await staff.waitForURL(/\/admin\/programs$/, { timeout: 15_000 });

      await expect(rowFor(staff, courseName)).toHaveCount(0);
      expect(
        await countWhere((db) =>
          db
            .select()
            .from(schema.programs)
            .where(eq(schema.programs.id, programId))
        )
      ).toBe(0);
    } finally {
      await staffContext.close();
    }
  });

  test("staff take a volunteer off the mentor list", async ({ browser }) => {
    const { db, close } = openDb();
    let userId: string;
    let name: string;
    try {
      ({ id: userId, name } = await createFixtureUser(db, {
        wantsToMentor: true,
      }));
    } finally {
      await close();
    }

    const staffContext = await browser.newContext({ storageState: ADMIN_AUTH });
    try {
      const staff = await staffContext.newPage();
      await staff.goto(`/admin/mentors?q=${encodeURIComponent(name)}`);
      await waitForHydration(staff);

      const row = rowFor(staff, name);
      await expect(row).toBeVisible();
      await confirmed(staff, () =>
        row.getByRole("button", { name: "Remove" }).click()
      );
      await expect(rowFor(staff, name)).toHaveCount(0);

      const { db: after, close: closeAfter } = openDb();
      try {
        expect((await readUser(after, userId)).wantsToMentor).toBe(false);
      } finally {
        await closeAfter();
      }
    } finally {
      await staffContext.close();
    }
  });
});

/** Rows matching a query, read on a connection of its own. */
async function countWhere(
  query: (db: Db) => Promise<unknown[]>
): Promise<number> {
  const { db, close } = openDb();
  try {
    return (await query(db)).length;
  } finally {
    await close();
  }
}
