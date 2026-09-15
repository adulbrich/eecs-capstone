import { authClient } from "./auth-client";

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
