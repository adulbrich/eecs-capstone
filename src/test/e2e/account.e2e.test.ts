import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
// biome-ignore lint/performance/noNamespaceImport: drizzle needs the schema namespace object
import * as schema from "../../db/schema";
import { waitForHydration } from "../shared/playwright";
import { SERVER_LOG } from "./constants";
import {
  deleteFixtureUser,
  fixtureEmail,
  readUser,
  userIdByEmail,
  withDb,
} from "./fixtures";
import { confirmed } from "./waits";

/**
 * The whole account lifecycle, driven through the real forms: sign up, prove
 * the address, sign out, forget the password, set a new one, sign back in,
 * edit the profile, change the password from it, sign out from it, sign back
 * in once more, and finally close the account.
 *
 * Every other test in this suite starts from a storage state minted once in
 * global setup, so none of them would notice if verification or password reset
 * broke. This is the only test that creates an account, and the only one whose
 * fixture is a `user` row rather than a project or an item.
 *
 * ONID and GitHub are deliberately out of scope: both need a third-party
 * identity provider that no runner can drive.
 */
test.describe("account lifecycle", () => {
  test("a bad verification token lands on the failure copy", async ({
    page,
  }) => {
    // Better Auth checks the token before redirecting and appends
    // `?error=<code>` to the callback on failure, so the page must read it
    // rather than assume every arrival is a success (#149).
    await page.goto(
      "/api/auth/verify-email?token=not-a-token&callbackURL=%2Fverify-email"
    );
    await expect(page).toHaveURL(/\/verify-email\?error=INVALID_TOKEN$/);
    await expect(
      page.getByRole("heading", { name: "Link not valid" })
    ).toBeVisible();
  });

  test("sign up, verify, reset the password, sign back in", async ({
    page,
  }) => {
    const email = fixtureEmail();
    const firstPassword = "e2e-first-password";
    const secondPassword = "e2e-second-password";
    const thirdPassword = "e2e-third-password";

    await page.goto("/sign-up");
    await waitForHydration(page, "form");
    await page.getByLabel("Name").fill("End To End");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(firstPassword);
    await page.getByRole("button", { name: "Sign up" }).click();
    await expect(
      page.getByRole("heading", { name: "Check your email" })
    ).toBeVisible();

    // Unverified accounts cannot sign in: `requireEmailVerification` is on, so
    // this is the state the link has to get the account out of. Asserting it
    // here is what makes the verification step below mean something.
    await page.goto("/sign-in");
    await waitForHydration(page, "form");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(firstPassword);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expectRefused(page);

    // The sign-up call chooses where the link lands, and Better Auth defaults
    // it to "/" when nothing is passed, which is how the app's own "Email
    // verified" page went unreachable once (#149). Asserted on the link
    // itself, not only on where the browser ends up.
    const verifyLink = await emailLink(email, "Verify your email");
    expect(verifyLink).toContain("callbackURL=%2Fverify-email");
    await page.goto(verifyLink);
    await expect(page).toHaveURL(/\/verify-email$/);
    await expect(
      page.getByRole("heading", { name: "Email verified" })
    ).toBeVisible();

    // `autoSignInAfterVerification` is on, so following the link is also a
    // sign-in. A route behind the auth guard is the proof, since landing on a
    // page is not.
    await page.goto("/my/projects");
    await expect(page).toHaveURL(/\/my\/projects/);

    // Signed out through the menu rather than by clearing cookies, because the
    // sign-out itself is part of the lifecycle and because /sign-in redirects a
    // signed-in viewer away: the forgot-password flow below cannot start from a
    // live session.
    await page.goto("/");
    await waitForHydration(page);
    await page.getByRole("button", { name: "End To End" }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await page.waitForURL(/\/sign-in/, { timeout: 15_000 });

    await page.goto("/forgot-password");
    await waitForHydration(page, "form");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(
      page.getByRole("heading", { name: "Check your email" })
    ).toBeVisible();

    // Better Auth's reset link points at its own API, which consumes the token
    // and redirects to the app's form carrying it as a search param. Following
    // the emailed URL rather than building that second one keeps this test
    // honest about the link a person actually receives.
    await page.goto(await emailLink(email, "Reset your password"));
    await waitForHydration(page, "form");
    await expect(page).toHaveURL(/\/reset-password\?token=/);
    await page.getByLabel("New password").fill(secondPassword);
    await page.getByRole("button", { name: "Reset password" }).click();

    // Waited for, not navigated past. The form sends the reset and only then
    // navigates to /sign-in, so a `goto` here aborts the request in flight and
    // the old password quietly keeps working: the test then signs in with it
    // and reports a reset that never happened as a pass.
    await page.waitForURL(/\/sign-in/, { timeout: 15_000 });
    await waitForHydration(page, "form");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(firstPassword);
    await page.getByRole("button", { name: /sign in/i }).click();

    // The old password is dead. Without this the test would pass against a
    // reset that silently did nothing, because the account would still sign in.
    await expectRefused(page);

    await page.getByLabel("Password").fill(secondPassword);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"), {
      timeout: 15_000,
    });
    await page.goto("/my/projects");
    await expect(page).toHaveURL(/\/my\/projects/);

    // The profile page's own writes run against this account rather than a
    // seeded one, because one of them is a password change: done to a seeded
    // user it would lock every later run and the accessibility suite out.
    // Deletion below anonymizes the row rather than removing it (ADR-0008), so
    // the address on the row changes and the prefix sweep can no longer find
    // it: the id is read first and the row is deleted by hand afterwards.
    const userId = await withDb((db) => userIdByEmail(db, email));
    try {
      await page.goto("/profile");
      await waitForHydration(page);

      const profileForm = page.locator("form").filter({
        has: page.getByRole("button", { name: "Save profile" }),
      });
      await profileForm.getByLabel("Name").fill("End To End Edited");
      await profileForm.getByLabel("Affiliation").fill("E2E Lab");
      await confirmed(page, () =>
        profileForm.getByRole("button", { name: "Save profile" }).click()
      );
      await expect(profileForm.getByRole("status")).toHaveText("Saved.");
      expect(await withDb((db) => readUser(db, userId))).toMatchObject({
        name: "End To End Edited",
        affiliation: "E2E Lab",
      });

      // Embeddings are off in this suite's server, so the save lands on the
      // "saved, but no recommendations" branch; both branches begin with the
      // same word. Scoped to its form because the profile form above has just
      // printed "Saved." of its own.
      const interestsForm = page.locator("form").filter({
        has: page.getByLabel("Interests"),
      });
      await interestsForm.getByLabel("Interests").fill("Robots and sensors.");
      await confirmed(page, () =>
        interestsForm.getByRole("button", { name: "Save interests" }).click()
      );
      await expect(interestsForm.getByRole("status")).toHaveText(/^Saved/);
      const [interests] = await withDb((db) =>
        db
          .select({ text: schema.userInterests.interestsText })
          .from(schema.userInterests)
          .where(eq(schema.userInterests.userId, userId))
      );
      expect(interests.text).toBe("Robots and sensors.");

      // Better Auth's own endpoint, not a server function, so there is no
      // response for `confirmed` to wait on; the feedback line is the signal,
      // and the sign-in further down is the proof.
      const passwordForm = page.locator("form").filter({
        has: page.getByRole("button", { name: "Change password" }),
      });
      await passwordForm.getByLabel("Current password").fill(secondPassword);
      await passwordForm.getByLabel("New password").fill(thirdPassword);
      await passwordForm
        .getByRole("button", { name: "Change password" })
        .click();
      await expect(passwordForm.getByRole("status")).toHaveText(
        "Password changed."
      );

      // The profile page's own Sign out, which is a different control from
      // the header menu item pressed earlier in this flow.
      await page.getByRole("button", { name: "Sign out" }).click();
      await page.waitForURL(/\/sign-in/, { timeout: 15_000 });
      await waitForHydration(page, "form");
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Password").fill(secondPassword);
      await page.getByRole("button", { name: /sign in/i }).click();
      await expectRefused(page);
      await page.getByLabel("Password").fill(thirdPassword);
      await page.getByRole("button", { name: /sign in/i }).click();
      await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"), {
        timeout: 15_000,
      });

      // Closing the account is the last thing the person can do, and the one
      // write here with a typed gate in front of it.
      await page.goto("/profile");
      await waitForHydration(page);
      await page.getByRole("button", { name: "Delete account" }).click();
      const dialog = page.getByRole("alertdialog");
      await expect(dialog).toBeVisible();
      await dialog.getByLabel("Confirm email").fill(email);
      await dialog.getByRole("button", { name: "Delete my account" }).click();
      await page.waitForURL((url) => url.pathname === "/", {
        timeout: 15_000,
      });

      // The address no longer signs in, and the row says why: it is no longer
      // that person's row.
      await page.goto("/sign-in");
      await waitForHydration(page, "form");
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Password").fill(thirdPassword);
      await page.getByRole("button", { name: /sign in/i }).click();
      await expectRefused(page);
      expect((await withDb((db) => readUser(db, userId))).email).toBe(
        `deleted-${userId}@invalid`
      );
    } finally {
      await withDb((db) => deleteFixtureUser(db, userId));
    }
  });
});

/**
 * Asserts a sign-in attempt was refused.
 *
 * The error, not the URL and not the button. Staying on `/sign-in` is already
 * true the instant the click lands, and the button's own label comes back the
 * moment the request settles either way, so both pass before the server has
 * said anything: against an app that signed the account in, they would race it
 * and win. The error is the one monotonic signal on this page, null before the
 * attempt and set afterwards for good.
 *
 * By role, and asserted on text only through the role: the message comes from
 * Better Auth rather than this repo, so matching on the words would pin this
 * test to a dependency's copy.
 */
async function expectRefused(page: Page): Promise<void> {
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page).toHaveURL(/\/sign-in/);
}

/**
 * The most recent link the server mailed to one address.
 *
 * Polled rather than read once: the email is written while the request that
 * triggered it is still in flight, so the page can settle before the line
 * reaches the log. Scoped to the address and the subject because the dev seed
 * and the other tests in this run mail their own.
 */
async function emailLink(to: string, subject: string): Promise<string> {
  const deadline = Date.now() + 15_000;
  let lastSeen = "";

  while (Date.now() < deadline) {
    const log = await readFile(SERVER_LOG, "utf8").catch(() => "");
    lastSeen = log;
    const link = findLink(log, to, subject);
    if (link) {
      return link;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(
    `no "${subject}" email to ${to} in ${SERVER_LOG} after 15s. The log holds ${lastSeen.length} bytes.`
  );
}

/**
 * Pulls the URL out of one console-transport email block.
 *
 * The blocks are delimited by the sender's own banner, so splitting on it is
 * what keeps a link from being read out of the email above or below the one
 * being asked for.
 */
function findLink(log: string, to: string, subject: string): string | null {
  const blocks = log.split("==================== EMAIL");
  for (const block of blocks.reverse()) {
    if (block.includes(`to:      ${to}`) && block.includes(subject)) {
      const match = block.match(/https?:\/\/\S+/);
      if (match) {
        return match[0];
      }
    }
  }
  return null;
}
