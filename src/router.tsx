import {
  createRouter as createTanStackRouter,
  Link,
} from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import { getContext } from "./integrations/tanstack-query/root-provider";
import { routeTree } from "./routeTree.gen";

function NotFound() {
  return (
    <div className="mx-auto max-w-md p-8">
      <h1 className="font-semibold text-2xl">Not found</h1>
      <p className="mt-3 text-muted-foreground text-sm">
        We could not find the page you were looking for.
      </p>
      <Link className="mt-4 inline-block text-sm hover:underline" to="/">
        Go home
      </Link>
    </div>
  );
}

export function getRouter() {
  const context = getContext();

  const router = createTanStackRouter({
    routeTree,
    context,
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
    /**
     * A revisit waits for its loader instead of painting the previous
     * visit's rows behind a refetch. `defaultStaleTime` is 0, so every
     * revisit is stale, and the default `"background"` meant every
     * navigation away from a save landed on a frame built from pre-edit
     * data (#474). Two costs, both accepted: a revisit now feels like a
     * first visit, and nothing paints until the loader resolves. See
     * "Why the router blocks on a stale reload" in docs/QUIRKS.md, which
     * is also where the rule about seeding `useState` from loader data
     * lives.
     */
    defaultStaleReloadMode: "blocking",
    defaultNotFoundComponent: NotFound,
  });

  setupRouterSsrQueryIntegration({ router, queryClient: context.queryClient });

  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
