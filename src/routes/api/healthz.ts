import { createFileRoute } from "@tanstack/react-router";

// Lightweight liveness probe for the ALB target group. Intentionally avoids
// auth and the database so the load balancer can verify the process is up
// without coupling health to downstream dependencies.
export const Route = createFileRoute("/api/healthz")({
  server: {
    handlers: {
      GET: () =>
        new Response("ok", {
          status: 200,
          headers: { "content-type": "text/plain" },
        }),
    },
  },
});
