import { useCallback, useState } from "react";
import type { AdminTableSearch } from "#/lib/table-state";

/**
 * `useAdminTable` keeps a table's sort and columns in the URL, which works
 * for one table per route. A page with several tables would have them fight
 * over the same `sort` and `cols` params, so this stands in for the route's
 * search and navigate with component state: same hook, same column seed from
 * localStorage, no URL.
 */
export function useLocalTableSearch() {
  const [search, setSearch] = useState<AdminTableSearch>({});
  const navigate = useCallback(
    (opts: {
      search: (prev: Record<string, unknown>) => Record<string, unknown>;
    }) => {
      setSearch((prev) => opts.search({ ...prev }) as AdminTableSearch);
    },
    []
  );
  return { navigate, search };
}
