import { toast } from "sonner";
import { authClient } from "./auth-client";
import { useAction } from "./use-action";

/**
 * End the session and land on the sign-in page.
 *
 * `window.location.href` rather than a router navigation, on purpose: the
 * session is baked into the SSR render and into every loader's cached data, so
 * a client-side navigation would leave a signed-out user looking at a page
 * built for the signed-in one. A full document load is what clears it.
 *
 * Written out three times before this (`site-header.tsx`, `user-menu.tsx`,
 * `profile.tsx`), which is three places for the next change to miss (#392).
 */
export async function signOut(): Promise<void> {
  await authClient.signOut();
  window.location.href = "/sign-in";
}

/**
 * Sign out, with the flight and the refusal the three triggers each lacked.
 *
 * A failed sign-out used to be an unhandled rejection from a `void signOut()`
 * call, which left the reader signed in and looking at a page that had not
 * changed (#410). None of the three triggers sits in a form or a panel (a
 * dropdown item, a button at the foot of the mobile nav, one on /profile), so
 * the refusal is a toast.
 *
 * `busy` is worth having even though the page is about to be replaced: the
 * replacement is a full document load, which takes long enough to click
 * again.
 */
export function useSignOut() {
  const { busy, run } = useAction({
    fallback: "Could not sign you out. Please try again.",
    onError: toast.error,
  });
  return { busy, signOut: () => void run(signOut) };
}
