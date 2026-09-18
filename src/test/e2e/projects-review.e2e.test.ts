import { expect, test } from "@playwright/test";
import { waitForHydration } from "../shared/playwright";
import { ADMIN_AUTH, OTHER_AUTH, USER_AUTH } from "./constants";
import {
  createFixtureProgram,
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
        .getByRole("button", { name: "Changes requested", exact: true })
        .click();
      const dialog = staff.getByRole("dialog");
      await expect(dialog.getByText("Move to Changes requested")).toBeVisible();

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
        staff.getByRole("button", { name: "Changes requested", exact: true })
      ).toBeDisabled();

      const owner = await ownerContext.newPage();
      await owner.goto(`/projects/${projectId}`);
      await waitForHydration(owner);

      // The proposer's copy of the review, twice: in the "Your actions" box
      // beside the resubmit button, and in the private panel's status history.
      // Never through the staff panel, which they cannot see at all.
      await expect(owner.getByText(comment)).toHaveCount(2);
      await expect(
        owner.getByRole("heading", { name: "Staff panel", exact: true })
      ).toHaveCount(0);

      const rewritten = `Rewritten after the review. ${fixtureName("Edit")}`;
      await owner.goto(`/projects/${projectId}/edit`);
      await waitForHydration(owner, "form");
      await owner.getByLabel("Description").fill(rewritten);
      await owner.getByRole("button", { name: "Save" }).click();

      // Waited for, not navigated past. The form saves and only then navigates
      // back to the project, so a `goto` here aborts the update in flight and
      // the page renders the project exactly as it was: the edit step would
      // pass having changed nothing.
      await owner.waitForURL(new RegExp(`/projects/${projectId}$`), {
        timeout: 15_000,
      });
      await waitForHydration(owner);

      // The new text on the page, which is the only thing that distinguishes a
      // save that landed from one that was thrown away.
      await expect(owner.getByText(rewritten)).toBeVisible();

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

/**
 * Where a project's program is set, which since #450 is the staff panel and
 * nowhere else (ADR-0026). Two halves, and the second is the point: staff can
 * place a project, and the proposer who owns it has no control to do the same.
 * A server test can prove the endpoint refuses them; only a browser can prove
 * the picker is not on the form they actually use.
 */
test.describe("project program placement", () => {
  test("staff place a project in two programs, and the proposer has no picker", async ({
    browser,
  }) => {
    const title = fixtureName("Project");
    const { db, close } = openDb();
    let projectId: string;
    let first: { courseId: string; courseName: string; id: string };
    let second: { courseId: string; courseName: string; id: string };
    try {
      const proposerId = await userIdByEmail(db, "user@example.com");
      ({ id: projectId } = await createFixtureProject(db, {
        title,
        proposerId,
        status: "draft",
      }));
      first = await createFixtureProgram(db);
      second = await createFixtureProgram(db);
    } finally {
      await close();
    }

    const staffContext = await browser.newContext({ storageState: ADMIN_AUTH });
    try {
      const staff = await staffContext.newPage();
      await staff.goto(`/projects/${projectId}`);
      await waitForHydration(staff);

      // Created unplaced: nothing writes a join row on create, so every box
      // starts unchecked however the project was made.
      const firstBox = staff.getByRole("checkbox", {
        name: `${first.courseId} ${first.courseName}`,
      });
      const secondBox = staff.getByRole("checkbox", {
        name: `${second.courseId} ${second.courseName}`,
      });
      await expect(firstBox).toBeVisible();
      await expect(firstBox).not.toBeChecked();

      // Both, which is the whole point of #462: one proposal offered under
      // two courses is one project, not two.
      await firstBox.click();
      await expect(firstBox).toBeChecked();
      await secondBox.click();
      await expect(secondBox).toBeChecked();
      await staff
        .getByRole("button", { name: "Save programs and teams" })
        .click();

      // Wait for the save to land before reloading, or the reload aborts
      // the request in flight. The warning is the signal because it is
      // computed from the SAVED set, not the draft, so it can only appear
      // once the write returned and the route refetched. Advisory: the save
      // was not refused, and teams_supported is still 1 (#462).
      await expect(
        staff.getByText(/supports 1 team but runs in 2 programs/)
      ).toBeVisible();

      // Reload rather than trust the control: this asserts the stored rows,
      // not optimistic client state.
      await staff.reload();
      await waitForHydration(staff);
      await expect(
        staff.getByRole("checkbox", {
          name: `${first.courseId} ${first.courseName}`,
        })
      ).toBeChecked();
      await expect(
        staff.getByRole("checkbox", {
          name: `${second.courseId} ${second.courseName}`,
        })
      ).toBeChecked();

      // One badge per program on the public half of the page, full labels.
      // Scoped to the badges rather than `getByText`, because the checkbox
      // labels in the panel below carry the same strings and a page-wide
      // text match would pass without a badge rendering at all.
      const badges = staff.locator('[data-slot="badge"]');
      await expect(
        badges.filter({ hasText: `${first.courseId} ${first.courseName}` })
      ).toHaveCount(1);
      await expect(
        badges.filter({ hasText: `${second.courseId} ${second.courseName}` })
      ).toHaveCount(1);

      // Still there after a reload, which is the point of reading it off
      // the saved set rather than the draft.
      await expect(
        staff.getByText(/supports 1 team but runs in 2 programs/)
      ).toBeVisible();

      // The save is in the edit log, which is what makes a placement
      // traceable to who made it.
      await expect(staff.getByText("Changed: programs")).toBeVisible();
    } finally {
      await staffContext.close();
    }

    // The other half of the decision. The proposer owns this project and may
    // still edit it, and the Program picker is gone from the form they use.
    const ownerContext = await browser.newContext({ storageState: USER_AUTH });
    try {
      const owner = await ownerContext.newPage();
      await owner.goto(`/projects/${projectId}/edit`);
      await waitForHydration(owner);

      // They are on their own edit form, not bounced off it.
      await expect(owner.getByLabel("Title")).toHaveValue(title);
      await expect(
        owner.getByRole("combobox", { name: "Program" })
      ).toHaveCount(0);
      await expect(owner.getByRole("checkbox", { name: /Course/ })).toHaveCount(
        0
      );
      // The panel is staff-only, so the section is not reachable that way
      // either.
      await owner.goto(`/projects/${projectId}`);
      await waitForHydration(owner);
      await expect(owner.getByText("Staff panel")).toHaveCount(0);
    } finally {
      await ownerContext.close();
    }
  });
});
