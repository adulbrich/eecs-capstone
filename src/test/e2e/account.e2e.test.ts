import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { waitForHydration } from "../shared/playwright";
import { SERVER_LOG } from "./constants";
import { fixtureEmail } from "./fixtures";

/**
 * The whole account lifecycle, driven through the real forms: sign up, prove
 * the address, sign out, forget the password, set a new one, sign back in.
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
  test("sign up, verify, reset the password, sign back in", async ({
    page,
  }) => {
    const email = fixtureEmail();
    const firstPassword = "e2e-first-password";
    const secondPassword = "e2e-second-password";

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
    //
    await page.goto("/sign-in");
    await waitForHydration(page, "form");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(firstPassword);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expectRefused(page);

    await page.goto(await emailLink(email, "Verify your email"));

    // Home, not `/verify-email`. `src/lib/auth.ts` sets
    // `emailVerification.callbackURL: "/verify-email"`, but the link the
    // sign-up path mails carries `callbackURL=%2F`, so the app's own
    // "Email verified" page is unreachable from this flow. Asserted as it
    // behaves rather than as it is configured, with the mismatch reported
    // rather than papered over.
    await expect(page).toHaveURL("/");

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
  });
});

/**
 * Asserts a sign-in attempt was refused.
 *
 * The error paragraph, not the URL and not the button. Staying on `/sign-in` is
 * already true the instant the click lands, and the button's own label comes
 * back the moment the request settles either way, so both pass before the
 * server has said anything: against an app that signed the account in, they
 * would race it and win. The error is the one monotonic signal on this page,
 * null before the attempt and set afterwards for good.
 *
 * Located by its class because there is nothing else to hold on to: the message
 * is a bare `<p>` with no role, no label and no `data-slot`, and its text comes
 * from Better Auth rather than this repo, so matching on the words would pin
 * the test to a dependency's copy. `text-destructive` is the semantic error
 * token from `docs/UI-CONVENTIONS.md`, not an incidental utility class.
 */
async function expectRefused(page: Page): Promise<void> {
  await expect(page.locator("p.text-destructive")).toBeVisible();
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
