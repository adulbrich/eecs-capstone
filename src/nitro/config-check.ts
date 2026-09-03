/**
 * The one place that runs at boot and nowhere else.
 *
 * Nitro runs the plugins named in `vite.config.ts` synchronously inside
 * `useNitroApp`, before the listener binds, so a throw here is exit code 1 with
 * the message on stderr and no port. That is what makes it the home for the
 * production config check rather than `src/lib/auth.ts` (imported by tests)
 * or a TanStack Start server entry (loaded on the first request, so a throw
 * there is a 500 on every route with the port still bound). The decision of
 * what is fatal lives in `startup-config.ts`; this file only calls it.
 */

import { definePlugin } from "nitro";
import { assertProductionConfig } from "#/lib/_internal/startup-config";

export default definePlugin(() => {
  assertProductionConfig();
});
