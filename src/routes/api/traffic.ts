import { createFileRoute } from "@tanstack/react-router";
import { trafficDb } from "#/db/traffic";
import { buildAuthConfig } from "#/lib/_internal/auth-config";
import {
  createTrafficWriter,
  trafficStore,
} from "#/server/_internal/traffic-writer";

/**
 * PUBLIC AND WORLD-WRITABLE. Anyone can POST here, signed in or not, and
 * nothing checks who. `src/server/__tests__/access-contract.ts` only sees
 * `createServerFn` endpoints, so this comment is the declaration (#507).
 *
 * The traffic writer (#591). A plain server route rather than a
 * `createServerFn`, because the client must never log or throw on a failed
 * send, and it answers 204 on every path. The bounds are in
 * `traffic-writer.ts`: same-origin only, a 4 KiB body, `isbot`, and a drop
 * once `CONNECTION_BUDGET.trafficPerTask` writes are in flight (#510).
 *
 * `TRUSTED_PROXY_CIDR` is the list Better Auth walks `X-Forwarded-For`
 * against, read through `auth-config.ts`, which imports no Better Auth code.
 */
const handle = createTrafficWriter({
  store: trafficStore(trafficDb),
  trustedProxies: buildAuthConfig(process.env).trustedProxies,
});

export const Route = createFileRoute("/api/traffic")({
  server: {
    handlers: {
      POST: ({ request }) => handle(request),
    },
  },
});
