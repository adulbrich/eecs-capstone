import { adminClient, genericOAuthClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  // genericOAuthClient is what puts `signIn.oauth2` on the client. Without it
  // the ONID config in lib/auth.ts is server-side scenery: the plugin mounts
  // its routes, and nothing can call them.
  plugins: [adminClient(), genericOAuthClient()],
});
