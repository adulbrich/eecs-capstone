import { createFileRoute } from "@tanstack/react-router";
import { handleAuthRequest } from "#/lib/_internal/auth-request";
import { auth } from "#/lib/auth";

/**
 * Thin on purpose. `handleAuthRequest` carries the reasoning and is what the
 * unit test imports, the same split as `src/nitro/config-check.ts`.
 */
const handle = (request: Request) =>
  handleAuthRequest(request, (r) => auth.handler(r));

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: ({ request }) => handle(request),
      POST: ({ request }) => handle(request),
    },
  },
});
