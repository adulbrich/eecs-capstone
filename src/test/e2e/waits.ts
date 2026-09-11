import type { Page, Request } from "@playwright/test";
import { expect } from "@playwright/test";

/**
 * A call into a server function. Matched on the `/_serverFn/` prefix rather
 * than a name: TanStack Start addresses server functions by a build-time hash,
 * which no test can predict.
 */
function isServerFunctionCall(request: Request): boolean {
  return request.method() === "POST" && request.url().includes("/_serverFn/");
}

/**
 * Records every server function call the page makes from now on, for a test
 * that asserts an interaction made none. The listener is attached before the
 * interaction, so a call issued at click time is caught even when the page
 * then navigates away.
 */
export function recordServerFunctionCalls(page: Page): string[] {
  const calls: string[] = [];
  page.on("request", (request) => {
    if (isServerFunctionCall(request)) {
      calls.push(request.url());
    }
  });
  return calls;
}

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
 * Use it only where the page under test fires the one request: the match in
 * `isServerFunctionCall` is any server function, so it is specific enough to
 * wait on only when there is one to wait for.
 */
export async function confirmed(
  page: Page,
  click: () => Promise<void>
): Promise<void> {
  const answered = page.waitForResponse(
    (response) => isServerFunctionCall(response.request()),
    { timeout: 15_000 }
  );
  await click();
  const response = await answered;
  expect(response.status()).toBe(200);
}
