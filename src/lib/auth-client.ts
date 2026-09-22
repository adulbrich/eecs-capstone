import {
  adminClient,
  emailOTPClient,
  genericOAuthClient,
} from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  // genericOAuthClient is what puts `signIn.oauth2` on the client. Without it
  // the ONID config in lib/auth.ts is server-side scenery: the plugin mounts
  // its routes, and nothing can call them.
  // emailOTPClient contributes no methods of its own. It types `signIn.emailOtp`
  // and `emailOtp.*` off the server plugin, and it carries the atom listeners
  // that refresh `useSession()` after a code sign-in. Without it the session
  // store would keep answering "signed out" on the page that just signed in.
  plugins: [adminClient(), emailOTPClient(), genericOAuthClient()],
});
