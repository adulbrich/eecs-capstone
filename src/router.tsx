import {
  createRouter as createTanStackRouter,
  ErrorComponent,
  type ErrorComponentProps,
  Link,
} from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import { AccessDeniedPage } from "./components/access-denied";
import { getContext } from "./integrations/tanstack-query/root-provider";
import { isAccessDenied } from "./lib/access-denied";
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

/**
 * The access-denied page for a role guard's refusal (#606), and the router's
 * own error component for anything else, which is what rendered before.
 *
 * Every route that throws is handled here rather than one `errorComponent`
 * per guarded route, because router-core picks a route's own component or
 * this default and never a parent's. Setting a default also gives each route
 * its own error boundary on the client, which puts a client-side error where
 * a server render already put it: in the route's slot, under the header.
 */
function RouteError({ error }: ErrorComponentProps) {
  if (isAccessDenied(error)) {
    return <AccessDeniedPage refusal={error} />;
  }
  return <ErrorComponent error={error} />;
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
     * visit's rows behind a refetch (#474). ADR-0029 is the decision, what
     * it rules out and what it costs; the rule it leaves behind, about
     * seeding `useState` from loader data, is in docs/QUIRKS.md under
     * TanStack Router. Both belong there rather than here, so that
     * revisiting the trade-off is one edit.
     */
    defaultStaleReloadMode: "blocking",
    defaultNotFoundComponent: NotFound,
    defaultErrorComponent: RouteError,
  });

  setupRouterSsrQueryIntegration({ router, queryClient: context.queryClient });

  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
