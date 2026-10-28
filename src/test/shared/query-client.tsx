import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type * as React from "react";

/**
 * `render` inside a fresh `QueryClientProvider`, for a component that reads
 * through `useQuery`. One client per call, so no test sees another's cache,
 * and `retry: false`, so a rejected read reports at once instead of after the
 * default three retries. `rerender` keeps the provider, and the client comes
 * back for a test that changes a query's data by hand.
 */
export function renderWithQueryClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }
  return { queryClient, ...render(ui, { wrapper }) };
}
