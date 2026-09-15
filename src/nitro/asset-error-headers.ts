/**
 * Runs on every response, static assets and errors included. The reason it
 * exists is in `src/lib/_internal/asset-error-headers.ts`; this file only
 * registers the hook, the same split as `config-check.ts`.
 */

import { definePlugin } from "nitro";
import { stripCacheHeadersFromAssetErrors } from "#/lib/_internal/asset-error-headers";

export default definePlugin((nitroApp) => {
  nitroApp.hooks.hook("response", stripCacheHeadersFromAssetErrors);
});
