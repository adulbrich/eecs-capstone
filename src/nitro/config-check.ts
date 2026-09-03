/**
 * The one place that runs at boot and nowhere else: Nitro calls this before
 * the listener binds, so a throw is exit code 1 and no port. The decision of
 * what is fatal lives in `startup-config.ts`; this file only calls it. See
 * the TanStack Start section of docs/QUIRKS.md for the measurement behind
 * putting it here rather than in a server entry.
 */

import { definePlugin } from "nitro";
import { assertProductionConfig } from "#/lib/_internal/startup-config";

export default definePlugin(() => {
  assertProductionConfig();
});
