import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { waitForHydration } from "../shared/playwright";
import { ADMIN_AUTH, USER_AUTH } from "./constants";
import {
  createFixtureProject,
  fixtureName,
  openDb,
  userIdByEmail,
} from "./fixtures";

/**
 * Internal comments, which are the one thing on the project page whose
 * audience is narrower than the panel containing it: the private panel is
 * proposer-and-staff, and an internal comment inside it is staff only.
 *
 * The reason this is worth a browser rather than only the integration test in
 * `src/server/__tests__/comments.integration.test.ts`: that test calls
 * `listProjectCommentsAs` and reads its return value, and the unit test in
 * `src/test/comment-thread.test.tsx` hands `CommentThread` a list it wrote
 * itself. Neither one can see a second path to the same rows. This test asserts
 * on what the proposer's browser actually received, so a staff-only comment
 * arriving through some other fetch fails here and nowhere else.
 *
 * Not `@smoke`. It costs three page loads and two round trips through the
 * comment form, and the pull-request suite has a five-minute job to answer to.
 */

/**
 * Every text-ish response body the page took delivery of.
 *
 * Bodies rather than the DOM, because the DOM only proves `CommentThread` did
 * not render the text, and that component renders whatever it is handed: a
 * regression in `filterCommentsForViewer` would put the internal comment in
 * this browser's memory whether or not a `<p>` ever showed it. Collected from
 * every response rather than matched against the server-function URL, which is
 * a TanStack Start implementation detail this test should not be pinned to.
 *
 * Comments are fetched after hydration, not in the loader, so nothing here is
 * in the server-rendered HTML: the call this is watching for is the client's
 * own `listProjectComments`.
 */
function captureBodies(page: Page): {
  bodies: string[];
  settled: () => Promise<void>;
} {
  const bodies: string[] = [];
  const pending: Promise<void>[] = [];

  page.on("response", (response) => {
    const type = response.headers()["content-type"] ?? "";
    if (!(type.includes("json") || type.includes("text"))) {
      return;
    }
    pending.push(
      response.text().then(
        (body) => {
          bodies.push(body);
        },
        () => {
          // A body Playwright can no longer read (redirect, aborted request).
          // Nothing to assert on, and throwing here would fail the test for a
          // response it was never interested in.
        }
      )
    );
  });

  return {
    bodies,
    // Drained, not snapshotted. Awaiting the batch that exists at call time
    // gives later responses a window to arrive uncollected, and an uncollected
    // body is one the assertion below cannot fail on: the gap runs in the
    // direction that reports a leak as clean.
    settled: async () => {
      while (pending.length > 0) {
        await Promise.all(pending.splice(0, pending.length));
      }
    },
  };
}

/**
 * A comment that has rendered, as opposed to one that is merely typed: React
 * mirrors a controlled textarea's value into its text content, so a bare
 * `getByText(draft)` resolves on the composer itself the moment the draft is
 * typed, before the post has answered. See QUIRKS, "`getByText` finds a draft
 * typed into a controlled textarea".
 */
function posted(page: Page, text: string) {
  return page.getByRole("paragraph").filter({ hasText: text });
}

test.describe("project internal comments", () => {
  test("staff internal comment never reaches the proposer", async ({
    browser,
  }) => {
    const title = fixtureName("Project");
    const publicText = `Staff note the proposer should read. ${fixtureName("Public")}`;
    const internalText = `Staff note the proposer must not read. ${fixtureName("Internal")}`;

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

    try {
      const staff = await staffContext.newPage();
      await staff.goto(`/projects/${projectId}`);
      await waitForHydration(staff);

      await staff.getByLabel("Comment").fill(publicText);
      await staff.getByRole("button", { name: "Post comment" }).click();

      await expect(posted(staff, publicText)).toBeVisible();

      // Typed straight into the same composer, no reload. The composer is
      // disabled while a post is in flight, so this fill waits for the first
      // post to answer rather than racing its clear (#188).
      await staff.getByLabel("Comment").fill(internalText);
      await staff
        .getByRole("checkbox", { name: "Internal (staff only)" })
        .click();
      await staff.getByRole("button", { name: "Post comment" }).click();

      // Staff see both, and the badge is what tells them the second one is not
      // going to the proposer. Exact, because the badge is the bare word and a
      // substring match would also find it inside "Internal (staff only)".
      await expect(posted(staff, internalText)).toBeVisible();
      await expect(staff.getByText("internal", { exact: true })).toBeVisible();

      const owner = await ownerContext.newPage();
      const { bodies, settled } = captureBodies(owner);
      await owner.goto(`/projects/${projectId}`);
      await waitForHydration(owner);

      // The public comment first. Every absence below is vacuous until this
      // passes: the comment list starts as an empty `useState([])`, so a page
      // whose fetch never resolved contains neither comment.
      await expect(posted(owner, publicText)).toBeVisible();

      await expect(owner.getByText(internalText)).toHaveCount(0);
      await expect(owner.getByText("internal", { exact: true })).toHaveCount(0);

      // No way to write one either. The composer is asserted present first
      // because an absence is worth what the proof it could have been present
      // is worth, and the comment list rendering says nothing about a control
      // in a different subtree: a bug that hid the whole composer from the
      // proposer would otherwise pass here for the wrong reason.
      await expect(owner.getByLabel("Comment")).toBeVisible();
      await expect(
        owner.getByRole("checkbox", { name: "Internal (staff only)" })
      ).toHaveCount(0);

      await settled();

      // The guard that keeps the assertion below honest: with nothing
      // captured, "no body contains the internal text" passes on an empty
      // list. `isInternal` as well as the text, because the text alone does
      // not prove the comment fetch was among the bodies: a comment
      // notification carries `content.slice(0, 200)` as its message, and the
      // header bell fetches notifications on mount, so the proposer's browser
      // receives the public comment's words either way. `isInternal` is a
      // field only the comment payload has.
      expect(
        bodies.filter(
          (body) => body.includes(publicText) && body.includes("isInternal")
        ).length
      ).toBeGreaterThan(0);
      expect(bodies.some((body) => body.includes(internalText))).toBe(false);
    } finally {
      await staffContext.close();
      await ownerContext.close();
    }
  });
});
