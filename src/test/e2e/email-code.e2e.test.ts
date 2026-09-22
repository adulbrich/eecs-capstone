import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
// biome-ignore lint/performance/noNamespaceImport: drizzle needs the schema namespace object
import * as schema from "../../db/schema";
import { waitForHydration } from "../shared/playwright";
import { fixtureEmail, withDb } from "./fixtures";
import { emailCode, logSize } from "./mail";

/**
 * Signing in with an emailed code, driven through the real form (#576).
 *
 * The integration suite proves the server properties; this proves the three
 * steps the person walks, which is where the interesting failure is. A new
 * address has to be asked for a name BEFORE its code is redeemed, because
 * `requireUserName` refuses a blank one and the refusal would land after the
 * code was already spent. Nothing but a browser run shows that the form gets
 * the order right.
 */
test.describe("@smoke signing in with an emailed code", () => {
  test("creates an account for a new address, asking for a name first", async ({
    page,
  }) => {
    const email = fixtureEmail();

    try {
      await page.goto("/sign-up");
      await waitForHydration(page);

      await page.getByLabel("Email", { exact: true }).fill(email);
      const sentAt = await logSize();
      await page.getByRole("button", { name: "Email me a code" }).click();

      const code = await emailCode(email, sentAt);
      // Empty, not carrying the address typed one step earlier. The three
      // steps render the same shape in the same position, so without a `key`
      // React reuses the input node and its uncontrolled value comes with it.
      await expect(page.getByLabel("Code", { exact: true })).toHaveValue("");
      await page.getByLabel("Code", { exact: true }).fill(code);
      await page.getByRole("button", { name: "Confirm code" }).click();

      // The address has no account, so the form asks for a name rather than
      // redeeming the code and failing on the blank one.
      await expect(page.getByLabel("Your name", { exact: true })).toBeVisible();
      await page.getByLabel("Your name", { exact: true }).fill("Code Newcomer");
      await page.getByRole("button", { name: "Create account" }).click();

      await expect(page).toHaveURL("/");
      const created = await rowFor(email);
      expect(created?.name).toBe("Code Newcomer");
      // Verified at creation, which is the whole point: the row did not exist
      // until the address was proved.
      expect(created?.emailVerified).toBe(true);
    } finally {
      await removeRow(email);
    }
  });

  test("signs an existing account straight in, with no name step", async ({
    page,
  }) => {
    const email = fixtureEmail();

    try {
      await page.goto("/sign-up");
      await waitForHydration(page);
      await page.getByLabel("Email", { exact: true }).fill(email);
      const signUpSend = await logSize();
      await page.getByRole("button", { name: "Email me a code" }).click();
      await page
        .getByLabel("Code", { exact: true })
        .fill(await emailCode(email, signUpSend));
      await page.getByRole("button", { name: "Confirm code" }).click();
      await page
        .getByLabel("Your name", { exact: true })
        .fill("Returning Person");
      await page.getByRole("button", { name: "Create account" }).click();
      await expect(page).toHaveURL("/");

      await page.goto("/profile");
      await waitForHydration(page);
      await page.getByRole("button", { name: "Sign out" }).click();
      await expect(page).toHaveURL(/\/(sign-in)?$/);

      await page.goto("/sign-in");
      await waitForHydration(page);
      await page.getByLabel("Email", { exact: true }).fill(email);
      const signInSend = await logSize();
      await page.getByRole("button", { name: "Email me a code" }).click();
      await page
        .getByLabel("Code", { exact: true })
        .fill(await emailCode(email, signInSend));
      await page.getByRole("button", { name: "Confirm code" }).click();

      // Straight in. Asking a returning person for their name again would be
      // the bug, and it is the one the check-before-redeem step prevents.
      await expect(page).toHaveURL("/");
      await expect(page.getByLabel("Your name", { exact: true })).toHaveCount(
        0
      );
    } finally {
      await removeRow(email);
    }
  });
});

/** The row this test made, or undefined if the flow never created one. */
function rowFor(email: string) {
  return withDb(async (db) => {
    const [row] = await db
      .select({
        emailVerified: schema.user.emailVerified,
        name: schema.user.name,
      })
      .from(schema.user)
      .where(eq(schema.user.email, email))
      .limit(1);
    return row;
  });
}

/** Deletes by address rather than id, because a failed run may have made none. */
function removeRow(email: string): Promise<unknown> {
  return withDb((db) =>
    db.delete(schema.user).where(eq(schema.user.email, email))
  );
}

/**
 * What the form does when a code is refused (#576).
 *
 * Deliberately NOT `@smoke`: the smoke set is the flow that has to work, and
 * these are the three ways it does not. They run in the full suite.
 *
 * None of them assert on the message text. It comes from Better Auth rather
 * than this repo, so matching the words would pin the suite to a dependency's
 * copy; `account.e2e.test.ts` makes the same choice. What each case asserts is
 * the behaviour the person experiences afterwards, which is the part that has
 * to hold.
 */
test.describe("refusals on the emailed code", () => {
  test("a wrong code is refused, and does not spend the right one", async ({
    page,
  }) => {
    const email = fixtureEmail();

    try {
      const code = await startCodeStep(page, email);

      await page.getByLabel("Code", { exact: true }).fill("000000");
      await page.getByRole("button", { name: "Confirm code" }).click();

      const alert = page.getByRole("alert");
      await expect(alert).toBeVisible();
      // Says what to do, not only that something went wrong. Every refusal on
      // this step has the same answer, and the server cannot tell them apart.
      await expect(alert).toContainText(/ask for a new code/i);
      // Still on the code step rather than thrown back to the address, which
      // is what makes a mistyped digit recoverable.
      await expect(page.getByLabel("Code", { exact: true })).toBeVisible();

      // And the real code still works. One wrong guess must not cost the
      // person the code they were sent.
      await page.getByLabel("Code", { exact: true }).fill(code);
      await page.getByRole("button", { name: "Confirm code" }).click();
      await page.getByLabel("Your name", { exact: true }).fill("Mistyped Once");
      await page.getByRole("button", { name: "Create account" }).click();
      await expect(page).toHaveURL("/");
    } finally {
      await removeRow(email);
    }
  });

  test("an expired code is refused, and asking again recovers", async ({
    page,
  }) => {
    const email = fixtureEmail();

    try {
      const code = await startCodeStep(page, email);
      // Five minutes is longer than any suite should wait, so the expiry is
      // moved rather than waited out. What is under test is the form's
      // handling of the refusal, not Better Auth's clock.
      await expireCode(email);

      await page.getByLabel("Code", { exact: true }).fill(code);
      await page.getByRole("button", { name: "Confirm code" }).click();
      await expect(page.getByRole("alert")).toBeVisible();

      // The way out is the button on this step, and then a fresh code.
      await page
        .getByRole("button", { name: "Use a different address" })
        .click();
      const fresh = await sendFrom(page, email);
      await page.getByLabel("Code", { exact: true }).fill(fresh);
      await page.getByRole("button", { name: "Confirm code" }).click();
      await page
        .getByLabel("Your name", { exact: true })
        .fill("Waited Too Long");
      await page.getByRole("button", { name: "Create account" }).click();
      await expect(page).toHaveURL("/");
    } finally {
      await removeRow(email);
    }
  });

  test("three wrong codes exhaust the attempts, and the right code stops working", async ({
    page,
  }) => {
    const email = fixtureEmail();

    try {
      const code = await startCodeStep(page, email);

      for (let guess = 0; guess < ALLOWED_ATTEMPTS; guess += 1) {
        await page.getByLabel("Code", { exact: true }).fill("000000");
        await page.getByRole("button", { name: "Confirm code" }).click();
        await expect(page.getByRole("alert")).toBeVisible();
      }

      // The budget is gone, so the code the person actually holds is refused
      // too. This is the behaviour #581 is about, seen from the owner's side:
      // an exhausted record is consumed and not recreated.
      await page.getByLabel("Code", { exact: true }).fill(code);
      await page.getByRole("button", { name: "Confirm code" }).click();
      await expect(page.getByRole("alert")).toBeVisible();
      await expect(page.getByLabel("Your name", { exact: true })).toHaveCount(
        0
      );

      // Asking again is the way back in, and it always works.
      await page
        .getByRole("button", { name: "Use a different address" })
        .click();
      const fresh = await sendFrom(page, email);
      await page.getByLabel("Code", { exact: true }).fill(fresh);
      await page.getByRole("button", { name: "Confirm code" }).click();
      await page
        .getByLabel("Your name", { exact: true })
        .fill("Locked Out Once");
      await page.getByRole("button", { name: "Create account" }).click();
      await expect(page).toHaveURL("/");
    } finally {
      await removeRow(email);
    }
  });

  test("a browser that keeps no cookie is told at the send, not at the code", async ({
    page,
  }) => {
    const email = fixtureEmail();

    // A browser that keeps no cookie for this site, simulated where the check
    // actually reads: `document.cookie`. Stripping `Set-Cookie` from the
    // response does NOT work, and the wrong version passed for the wrong
    // reason: Playwright's `route.fetch()` puts the header into the context's
    // jar before the fulfilled copy reaches the page, so the cookie is stored
    // anyway. What the page can observe is the whole of what it acts on.
    await page.addInitScript(() => {
      Object.defineProperty(document, "cookie", {
        configurable: true,
        get: () => "",
        set: () => {
          // A browser refusing cookies accepts the assignment and keeps
          // nothing, which is what this stands in for.
        },
      });
    });

    try {
      await page.goto("/sign-up");
      await waitForHydration(page);
      await page.getByLabel("Email", { exact: true }).fill(email);
      await page.getByRole("button", { name: "Email me a code" }).click();

      const alert = page.getByRole("alert");
      await expect(alert).toBeVisible();
      // Named, and with a way out. The server cannot say this: a browser that
      // dropped the claim and a stranger who never had one look identical to
      // it, and both have to get the same answer.
      await expect(alert).toContainText(/cookie/i);
      await expect(alert).toContainText(/ONID/i);
      // And it stops HERE, rather than sending them to their inbox for a code
      // that could never have worked.
      await expect(page.getByLabel("Code", { exact: true })).toHaveCount(0);
    } finally {
      await removeRow(email);
    }
  });

  test("a cookie lost after the send is refused, and asking again recovers", async ({
    page,
  }) => {
    const email = fixtureEmail();

    try {
      const code = await startCodeStep(page, email);
      // The rarer shape: the browser kept the claim and then dropped it. The
      // send-time check cannot catch this one, so the person meets it at the
      // code step, with the same answer a stranger gets.
      await page.context().clearCookies();

      await page.getByLabel("Code", { exact: true }).fill(code);
      await page.getByRole("button", { name: "Confirm code" }).click();
      await expect(page.getByRole("alert")).toBeVisible();

      // Asking again is the way back in, and it always works: the send is not
      // gated on the claim, deliberately (#581).
      await page
        .getByRole("button", { name: "Use a different address" })
        .click();
      const fresh = await sendFrom(page, email);
      await page.getByLabel("Code", { exact: true }).fill(fresh);
      await page.getByRole("button", { name: "Confirm code" }).click();
      await page.getByLabel("Your name", { exact: true }).fill("Lost A Cookie");
      await page.getByRole("button", { name: "Create account" }).click();
      await expect(page).toHaveURL("/");
    } finally {
      await removeRow(email);
    }
  });
});

/** `allowedAttempts` in `src/lib/auth.ts`, restated so a change here is loud. */
const ALLOWED_ATTEMPTS = 3;

/** Opens /sign-up on the code door, asks for a code, and returns it. */
async function startCodeStep(page: Page, email: string): Promise<string> {
  await page.goto("/sign-up");
  await waitForHydration(page);
  await page.getByLabel("Email", { exact: true }).fill(email);
  return await sendFrom(page, email);
}

/** Sends from whatever step the address field is on, and returns the code. */
async function sendFrom(page: Page, email: string): Promise<string> {
  const sentAt = await logSize();
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  return await emailCode(email, sentAt);
}

/** Moves a live code's expiry into the past, which no click can do. */
function expireCode(email: string): Promise<unknown> {
  return withDb((db) =>
    db
      .update(schema.verification)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(
        eq(schema.verification.identifier, `sign-in-otp-${email.toLowerCase()}`)
      )
  );
}
