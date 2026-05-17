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
      <h1 className="text-2xl font-semibold">Not found</h1>
      <p className="mt-3 text-sm text-neutral-600">
        We could not find the page you were looking for.
      </p>
      <Link
        to="/"
        className="mt-4 inline-block text-sm text-blue-700 hover:underline"
      >
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
