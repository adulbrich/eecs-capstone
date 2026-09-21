/**
 * Runs at boot, before Nitro's entry calls `serve()` and so before the HTTP
 * server exists. The reason it exists, and why it is a wrapper rather than a
 * setting, is in `src/lib/_internal/keep-alive-timeout.ts`; this file only
 * installs it, the same split as `config-check.ts`.
 */

import http from "node:http";
import { definePlugin } from "nitro";
import { installKeepAliveTimeout } from "#/lib/_internal/keep-alive-timeout";

export default definePlugin(() => {
  installKeepAliveTimeout(http);
});
