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
  fixtureName,
  readUser,
  userIdByEmail,
  withDb,
} from "./fixtures";
import { rowFor, sectionNamed } from "./locators";
import { confirmed } from "./waits";

/**
 * The writes on the admin catalog pages, asserted on the row afterwards,
 * because every one of these pages re-reads on success and would show the
 * same thing after a write that never happened.
 *
 * Two groups. The creates and saves: a category and a program each created
 * from the list page's dialog and renamed from its edit page, an instructor
 * added to a program, and a mentor's capacity saved. Then the destructive
 * controls: a category delete, a program's instructor removal and delete, and
 * taking someone off the mentor list.
 *
 * Every name typed into a form here carries the fixture prefix, including the
 * renamed ones, because the prefix is the only thing the sweep matches on.
 */
test.describe("admin catalog creates and saves", () => {
  test("staff create an inventory category, then rename it", async ({
    browser,
  }) => {
    const name = fixtureName("Category");
    const renamed = fixtureName("Renamed");

    const staffContext = await browser.newContext({ storageState: ADMIN_AUTH });
    try {
      const staff = await staffContext.newPage();
      // The tab is named rather than defaulted: the project tab adds a type
      // combobox to the same form, and the inventory one is the shape both
      // submit paths share.
      await staff.goto("/admin/categories?tab=inventory");
      await waitForHydration(staff);

      await staff.getByRole("button", { name: "+ New category" }).click();
      const dialog = staff.getByRole("dialog", {
        name: "New inventory category",
      });
      await expect(dialog).toBeVisible();
      await dialog.getByLabel("Name").fill(name);
      await confirmed(staff, () =>
        dialog.getByRole("button", { name: "Create category" }).click()
      );
      await expect(dialog).toBeHidden();
      await expect(rowFor(staff, name)).toBeVisible();

      const [created] = await withDb((db) =>
        db
          .select({
            id: schema.categories.id,
            domain: schema.categories.domain,
          })
          .from(schema.categories)
          .where(eq(schema.categories.name, name))
      );
      expect(created.domain).toBe("inventory");

      await staff.goto(`/admin/categories/${created.id}`);
      await waitForHydration(staff);
      await staff.getByLabel("Name").fill(renamed);
      await staff.getByRole("button", { name: "Save", exact: true }).click();
      await staff.waitForURL(/\/admin\/categories\?/, { timeout: 15_000 });

      await expect(rowFor(staff, renamed)).toBeVisible();
      await expect(rowFor(staff, name)).toHaveCount(0);
      const [saved] = await withDb((db) =>
        db
          .select({ name: schema.categories.name })
          .from(schema.categories)
          .where(eq(schema.categories.id, created.id))
      );
      expect(saved.name).toBe(renamed);
    } finally {
      await staffContext.close();
    }
  });

  test("staff create a program, add an instructor, then rename it", async ({
    browser,
  }) => {
    const courseId = fixtureName("Course");
    const courseName = fixtureName("Program");
    const renamed = fixtureName("Renamed");
    // A fixture instructor rather than the seeded admin, so the option picked
    // from the list is one no other run could have added already.
    const { id: instructorId, name: instructorName } = await withDb((db) =>
      createFixtureUser(db, { role: "instructor" })
    );

    const staffContext = await browser.newContext({ storageState: ADMIN_AUTH });
    try {
      const staff = await staffContext.newPage();
      await staff.goto("/admin/programs");
      await waitForHydration(staff);

      await staff.getByRole("button", { name: "+ New program" }).click();
      const dialog = staff.getByRole("dialog", { name: "New program" });
      await expect(dialog).toBeVisible();
      await dialog.getByLabel("Course ID").fill(courseId);
      await dialog.getByLabel("Course name").fill(courseName);
      await confirmed(staff, () =>
        dialog.getByRole("button", { name: "Create program" }).click()
      );
      await expect(dialog).toBeHidden();
      await expect(rowFor(staff, courseName)).toBeVisible();

      const [created] = await withDb((db) =>
        db
          .select({ id: schema.programs.id })
          .from(schema.programs)
          .where(eq(schema.programs.courseName, courseName))
      );

      // Add before Save, because Save leaves the page.
      await staff.goto(`/admin/programs/${created.id}`);
      await waitForHydration(staff);
      const instructors = sectionNamed(staff, "Instructors");
      await expect(instructors.getByText("None yet.")).toBeVisible();
      await instructors
        .getByRole("combobox", { name: "Add instructor" })
        .click();
      await staff.getByRole("option", { name: instructorName }).click();
      await confirmed(staff, () =>
        instructors.getByRole("button", { name: "Add" }).click()
      );
      await expect(instructors.getByText(instructorName)).toBeVisible();
      expect(
        await countWhere((db) =>
          db
            .select()
            .from(schema.programInstructors)
            .where(eq(schema.programInstructors.userId, instructorId))
        )
      ).toBe(1);

      await staff.getByLabel("Course name").fill(renamed);
      await staff.getByRole("button", { name: "Save", exact: true }).click();
      await staff.waitForURL(/\/admin\/programs$/, { timeout: 15_000 });

      await expect(rowFor(staff, renamed)).toBeVisible();
      await expect(rowFor(staff, courseName)).toHaveCount(0);
      const [saved] = await withDb((db) =>
        db
          .select({ courseName: schema.programs.courseName })
          .from(schema.programs)
          .where(eq(schema.programs.id, created.id))
      );
      expect(saved.courseName).toBe(renamed);
    } finally {
      await staffContext.close();
    }
  });

  test("staff save a mentor's capacity", async ({ browser }) => {
    const { id: userId, name } = await withDb((db) =>
      createFixtureUser(db, { wantsToMentor: true })
    );

    const staffContext = await browser.newContext({ storageState: ADMIN_AUTH });
    try {
      const staff = await staffContext.newPage();
      await staff.goto(`/admin/mentors?q=${encodeURIComponent(name)}`);
      await waitForHydration(staff);

      const row = rowFor(staff, name);
      await expect(row).toBeVisible();
      await row.getByLabel(`Capacity for ${name}`).fill("3");
      await confirmed(staff, () =>
        row.getByRole("button", { name: "Save", exact: true }).click()
      );

      // Still on the list, with the new capacity: Save and Remove share a
      // server function and differ only in the flag they send, so the row is
      // what tells the two apart.
      await expect(row).toBeVisible();
      await expect(await withDb((db) => readUser(db, userId))).toMatchObject({
        wantsToMentor: true,
        mentorTeamCount: 3,
      });
    } finally {
      await staffContext.close();
    }
  });
});

test.describe("admin catalog deletes", () => {
  test("staff delete a category", async ({ browser }) => {
    const { id: categoryId, name } = await withDb((db) =>
      createFixtureCategory(db)
    );

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
    const { id: programId, courseName } = await withDb(async (db) =>
      createFixtureProgram(db, {
        instructorId: await userIdByEmail(db, "admin@example.com"),
      })
    );

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
    const { id: userId, name } = await withDb((db) =>
      createFixtureUser(db, { wantsToMentor: true })
    );

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

      expect((await withDb((db) => readUser(db, userId))).wantsToMentor).toBe(
        false
      );
    } finally {
      await staffContext.close();
    }
  });
});

/** Rows matching a query, for the "the row is gone" assertions. */
async function countWhere(
  query: (db: Db) => Promise<unknown[]>
): Promise<number> {
  return (await withDb(query)).length;
}
