import { adminClient, emailOTPClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  // ONID needs no client plugin. Since Better Auth 1.7 the server's
  // genericOAuth registers it as a social provider, so `signIn.social` reaches
  // it the same way it reaches GitHub.
  // emailOTPClient contributes no methods of its own. It types `signIn.emailOtp`
  // and `emailOtp.*` off the server plugin, and it carries the atom listeners
  // that refresh `useSession()` after a code sign-in. Without it the session
  // store would keep answering "signed out" on the page that just signed in.
  plugins: [adminClient(), emailOTPClient()],
});
