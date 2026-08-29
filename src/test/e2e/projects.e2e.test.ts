import { expect, test } from "@playwright/test";
import { waitForHydration } from "../shared/playwright";
import { ADMIN_AUTH, USER_AUTH } from "./constants";
import { fixtureName } from "./fixtures";

/**
 * Draft, submit, approve, publish. The two role switches use explicit contexts
 * rather than test.use(), because a single test needs both the proposer's
 * session and a staff session.
 *
 * The project is created through /projects/new on every attempt rather than
 * seeded, so a retry starts from nothing rather than from whatever state a
 * failed attempt left behind. Its title carries the E2E_PREFIX that global
 * setup sweeps.
 */
test.describe("@smoke project lifecycle", () => {
  test("draft to published", async ({ browser }) => {
    const title = fixtureName("Project");

    const ownerContext = await browser.newContext({ storageState: USER_AUTH });
    const staffContext = await browser.newContext({ storageState: ADMIN_AUTH });

    try {
      const owner = await ownerContext.newPage();

      await owner.goto("/projects/new");
      await waitForHydration(owner, "form");
      await owner.getByLabel("Title").fill(title);
      await owner.getByRole("button", { name: "Create draft" }).click();

      await owner.waitForURL(/\/projects\/[0-9a-f-]{36}/, { timeout: 15_000 });
      const projectUrl = new URL(owner.url()).pathname;

      await waitForHydration(owner);
      await owner.getByRole("button", { name: "Submit for review" }).click();
      await expect(
        owner.getByRole("button", { name: "Withdraw to draft" })
      ).toBeVisible();

      // Staff take it the rest of the way. The stepper pills are buttons whose
      // text is the status label; `Move to X` is only the title attribute.
      const staff = await staffContext.newPage();
      await staff.goto(projectUrl);
      await waitForHydration(staff);

      for (const status of ["Approved", "Published"]) {
        await staff.getByRole("button", { name: status, exact: true }).click();
        const dialog = staff.getByRole("dialog");
        await expect(dialog).toBeVisible();
        await dialog.getByRole("button", { name: "Confirm" }).click();
        await expect(dialog).toBeHidden();
        // The pill for the current status is the disabled one, which is how the
        // page says the transition landed.
        await expect(
          staff.getByRole("button", { name: status, exact: true })
        ).toBeDisabled();
      }

      // Published is the status that makes a project visible to students, so
      // the flow is not proven until an anonymous visitor can see it.
      const anonymous = await browser.newContext();
      try {
        const visitor = await anonymous.newPage();
        await visitor.goto(projectUrl);
        await expect(
          visitor.getByRole("heading", { name: title })
        ).toBeVisible();
      } finally {
        await anonymous.close();
      }
    } finally {
      await ownerContext.close();
      await staffContext.close();
    }
  });
});
