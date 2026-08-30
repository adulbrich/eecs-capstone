import { expect, test } from "@playwright/test";
import { waitForHydration } from "../shared/playwright";
import { ADMIN_AUTH, OTHER_AUTH, USER_AUTH } from "./constants";
import {
  createFixtureProject,
  fixtureName,
  openDb,
  userIdByEmail,
} from "./fixtures";

/**
 * The review conversation, which the smoke suite's straight line to published
 * never has: staff sending a project back with a comment, the proposer reading
 * it, fixing the project and resubmitting.
 *
 * The comment is the point. It is the one piece of review text a proposer is
 * shown, it is written into `project_status_history`, and the panel that
 * renders it is gated on staff-or-owner with no route guard, so who can read it
 * is a browser question rather than a server-function one.
 */
test.describe("project changes-requested round trip", () => {
  test("staff request changes, the owner fixes and resubmits", async ({
    browser,
  }) => {
    const title = fixtureName("Project");
    const comment = `Needs a clearer problem statement. ${fixtureName("Note")}`;
    const { db, close } = openDb();
    let projectId: string;
    try {
      const proposerId = await userIdByEmail(db, "user@example.com");
      ({ id: projectId } = await createFixtureProject(db, {
        title,
        proposerId,
        status: "submitted",
      }));
    } finally {
      await close();
    }

    const staffContext = await browser.newContext({ storageState: ADMIN_AUTH });
    const ownerContext = await browser.newContext({ storageState: USER_AUTH });
    const otherContext = await browser.newContext({ storageState: OTHER_AUTH });

    try {
      const staff = await staffContext.newPage();
      await staff.goto(`/projects/${projectId}`);
      await waitForHydration(staff);

      await staff
        .getByRole("button", { name: "Changes Req.", exact: true })
        .click();
      const dialog = staff.getByRole("dialog");
      await expect(dialog.getByText("Move to Changes Req.")).toBeVisible();

      // The one status whose comment is mandatory, which the dialog enforces by
      // disabling Confirm rather than by rejecting the submission. Worth
      // pinning: it is the difference between a proposer being told what to fix
      // and being sent back with nothing.
      await expect(
        dialog.getByRole("button", { name: "Confirm" })
      ).toBeDisabled();
      await dialog.getByLabel("What needs to change? (required)").fill(comment);
      await dialog.getByRole("button", { name: "Confirm" }).click();
      await expect(
        staff.getByRole("button", { name: "Changes Req.", exact: true })
      ).toBeDisabled();

      const owner = await ownerContext.newPage();
      await owner.goto(`/projects/${projectId}`);
      await waitForHydration(owner);

      // The proposer's copy of the review. It reaches them through the private
      // panel's status history, not through the staff panel, which they cannot
      // see at all.
      await expect(owner.getByText(comment)).toBeVisible();
      await expect(
        owner.getByRole("heading", { name: "Staff panel", exact: true })
      ).toHaveCount(0);

      await owner.goto(`/projects/${projectId}/edit`);
      await waitForHydration(owner, "form");
      await owner
        .getByLabel("Description")
        .fill("Rewritten after the review comment.");
      await owner.getByRole("button", { name: "Save" }).click();

      await owner.goto(`/projects/${projectId}`);
      await waitForHydration(owner);
      await owner.getByRole("button", { name: "Resubmit for review" }).click();

      // Back in staff's hands, which the owner's own card says by offering the
      // withdraw that only a submitted project has.
      await expect(
        owner.getByRole("button", { name: "Withdraw to draft" })
      ).toBeVisible();

      // Approve, then publish. Publishing is not decoration: the visibility
      // assertion below needs a project the third user is allowed to open at
      // all, and only published and archived projects are public.
      await staff.reload();
      await waitForHydration(staff);
      for (const status of ["Approved", "Published"]) {
        await staff.getByRole("button", { name: status, exact: true }).click();
        const step = staff.getByRole("dialog");
        await step.getByRole("button", { name: "Confirm" }).click();
        await expect(
          staff.getByRole("button", { name: status, exact: true })
        ).toBeDisabled();
      }

      const other = await otherContext.newPage();
      await other.goto(`/projects/${projectId}`);

      // Visible page, invisible review. The heading proves the project opened,
      // so the two absences below are about a rendered page rather than a
      // rejected one.
      await expect(
        other.getByRole("heading", { level: 1, name: title })
      ).toBeVisible();
      await expect(other.getByText(comment)).toHaveCount(0);
      await expect(
        other.getByRole("heading", { name: "Status history" })
      ).toHaveCount(0);
    } finally {
      await staffContext.close();
      await ownerContext.close();
      await otherContext.close();
    }
  });
});

/**
 * The override path exists so staff can move a project the workflow says they
 * cannot. It is reachable from the same stepper as the legal moves, looks
 * almost identical, and the only thing in the DOM that distinguishes the two is
 * the dialog's wording: `Override: force to X` is a title attribute, not an
 * accessible name, the same trap `Move to X` sets in the smoke suite.
 */
test.describe("project staff override", () => {
  test("staff force an illegal transition and it sticks", async ({
    browser,
  }) => {
    const title = fixtureName("Project");
    const { db, close } = openDb();
    let projectId: string;
    try {
      const proposerId = await userIdByEmail(db, "user@example.com");
      ({ id: projectId } = await createFixtureProject(db, {
        title,
        proposerId,
        status: "draft",
      }));
    } finally {
      await close();
    }

    const staffContext = await browser.newContext({ storageState: ADMIN_AUTH });
    try {
      const staff = await staffContext.newPage();
      await staff.goto(`/projects/${projectId}`);
      await waitForHydration(staff);

      // The legal move first, opened and abandoned. Without it this test proves
      // only that a dialog said "Override", not that override and normal are
      // two different paths off the same stepper. `draft -> approved` is in
      // TRANSITIONS for staff; `draft -> published` is not.
      await staff
        .getByRole("button", { name: "Approved", exact: true })
        .click();
      const legal = staff.getByRole("dialog");
      await expect(legal.getByText("Move to Approved")).toBeVisible();
      await legal.getByRole("button", { name: "Cancel" }).click();
      await expect(legal).toBeHidden();

      await staff
        .getByRole("button", { name: "Published", exact: true })
        .click();
      const forced = staff.getByRole("dialog");
      await expect(forced.getByText("Override to Published")).toBeVisible();
      await expect(
        forced.getByText(
          "This overrides the workflow and bypasses the normal review process."
        )
      ).toBeVisible();
      await forced.getByRole("button", { name: "Confirm" }).click();

      await expect(
        staff.getByRole("button", { name: "Published", exact: true })
      ).toBeDisabled();

      // Survives a reload, so this is the stored status rather than optimistic
      // client state.
      await staff.reload();
      await expect(
        staff.getByRole("button", { name: "Published", exact: true })
      ).toBeDisabled();
    } finally {
      await staffContext.close();
    }
  });
});
