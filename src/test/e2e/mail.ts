import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { SERVER_LOG } from "./constants";

/**
 * Reading a sign-in code back out of the server log, which is the suite's
 * stand-in for the person's inbox, and typing it in. Shared by every test that
 * signs somebody in through the real form, because the offset rule below is
 * easy to get wrong and was got wrong once.
 */

/**
 * Asks for a code for `email` on the code form already open, and confirms the
 * one that arrives. Leaves the page wherever the form goes next: the name step
 * for an address with no row, or away from the form for one that has one.
 */
export async function enterEmailedCode(page: Page, email: string) {
  await page.getByLabel("Email", { exact: true }).fill(email);
  const sentAt = await logSize();
  await page.getByRole("button", { name: "Email me a code" }).click();
  await page
    .getByLabel("Code", { exact: true })
    .fill(await emailCode(email, sentAt));
  await page.getByRole("button", { name: "Confirm code" }).click();
}

/** How much of the log has already been written, to read only what comes next. */
export async function logSize(): Promise<number> {
  return (await readFile(SERVER_LOG, "utf8").catch(() => "")).length;
}

/**
 * The sign-in code mailed to one address AFTER `since` bytes of log.
 *
 * Polled because the mail is written while the request that triggered it is
 * still in flight. The offset is what makes it correct rather than merely tidy,
 * and leaving it out was a real failure rather than a precaution. A test that
 * signs up and then signs in mails the same address twice, and a search over
 * the whole log finds the FIRST code, which the sign-up already spent. The
 * symptom is "Invalid OTP" on a code the person read out of their own inbox,
 * which reads like a product bug.
 */
export async function emailCode(to: string, since: number): Promise<string> {
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
    // Anchored on the line end, or `a@x.com` would read the code mailed to
    // `a@x.com.au`.
    if (block.includes(`to:      ${to}\n`)) {
      const match = block.match(/Your sign-in code is (\d{6})\./);
      if (match) {
        return match[1];
      }
    }
  }
  return null;
}
