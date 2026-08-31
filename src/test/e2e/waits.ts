import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

/**
 * Runs a click that writes through a server function, and waits for the server
 * to answer before returning.
 *
 * Needed wherever the app does not navigate on success. A `goto` or `reload`
 * over an in-flight server function aborts it, and the page then looks exactly
 * as it does after the write succeeded: the avatar uploader has already swapped
 * in a local blob URL, and the bookmark button has already flipped its own
 * label optimistically. Both would pass an assertion made straight afterwards.
 *
 * Matched on the `/_serverFn/` prefix rather than a name: TanStack Start
 * addresses server functions by a build-time hash, which no test can predict.
 * Use it only where the page under test fires the one request, which is what
 * makes the prefix specific enough to wait on.
 */
export async function confirmed(
  page: Page,
  click: () => Promise<void>
): Promise<void> {
  const answered = page.waitForResponse(
    (response) =>
      response.url().includes("/_serverFn/") &&
      response.request().method() === "POST",
    { timeout: 15_000 }
  );
  await click();
  const response = await answered;
  expect(response.status()).toBe(200);
}
