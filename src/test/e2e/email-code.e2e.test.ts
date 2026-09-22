import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
// biome-ignore lint/performance/noNamespaceImport: drizzle needs the schema namespace object
import * as schema from "../../db/schema";
import { waitForHydration } from "../shared/playwright";
import { SERVER_LOG } from "./constants";
import { fixtureEmail, withDb } from "./fixtures";

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

      await page
        .getByRole("button", { name: "Email me a code instead" })
        .click();
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
      await page
        .getByRole("button", { name: "Email me a code instead" })
        .click();
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
      await page
        .getByRole("button", { name: "Email me a code instead" })
        .click();
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

/** How much of the log has already been written, to read only what comes next. */
async function logSize(): Promise<number> {
  return (await readFile(SERVER_LOG, "utf8").catch(() => "")).length;
}

/**
 * The sign-in code mailed to one address AFTER `since` bytes of log.
 *
 * Polled for the same reason `emailLink` in `account.e2e.test.ts` is: the mail
 * is written while the request that triggered it is still in flight. The offset
 * is what makes it correct rather than merely tidy, and leaving it out was a
 * real failure rather than a precaution. A test that signs up and then signs in
 * mails the same address twice, and a search over the whole log finds the FIRST
 * code, which the sign-up already spent. The symptom is "Invalid OTP" on a code
 * the person read out of their own inbox, which reads like a product bug.
 */
async function emailCode(to: string, since: number): Promise<string> {
  const deadline = Date.now() + 15_000;
  let lastSeen = "";

  while (Date.now() < deadline) {
    const log = await readFile(SERVER_LOG, "utf8").catch(() => "");
    lastSeen = log;
    const code = findCode(log.slice(since), to);
    if (code) {
      return code;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(
    `no sign-in code for ${to} in ${SERVER_LOG} after 15s. The log holds ${lastSeen.length} bytes, ${since} of them already read.`
  );
}

/** Split on the sender's banner so a code is never read out of the block above. */
function findCode(log: string, to: string): string | null {
  const blocks = log.split("==================== EMAIL");
  for (const block of blocks.reverse()) {
    if (block.includes(`to:      ${to}`)) {
      const match = block.match(/Your sign-in code is (\d{6})\./);
      if (match) {
        return match[1];
      }
    }
  }
  return null;
}
