import { QueryClient } from "@tanstack/react-query";

export function getContext() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // TanStack's Start guide value. Refetch on window focus stays on:
        // the header's borrow-list and bookmark counts live across
        // navigations and pick up a change made in another tab that way, and
        // with this a focus refetches only data older than 30 seconds. See
        // docs/QUIRKS.md, "Page data comes from the loader; a component's own
        // read goes through `useQuery`".
        staleTime: 30_000,
      },
    },
  });

  return {
    queryClient,
  };
}
export default function TanstackQueryProvider() {
  return null;
}
