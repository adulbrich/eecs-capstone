import { useEffect, useState } from "react";

/**
 * False during SSR and on the client's first render, true thereafter.
 *
 * Use it to gate anything whose output depends on state the server cannot
 * know — most often the signed-in session, which Better Auth can resolve
 * synchronously on the client from a cached cookie. Without a gate the server
 * renders the signed-out branch, the client's very first render produces the
 * signed-in one, and React reports a hydration mismatch and throws the tree
 * away. Gating on the session's own `isPending` is not enough: a cached
 * session makes it false immediately.
 *
 * The first render is what must match; the effect runs after, so the swap to
 * the real branch happens as a normal client update.
 */
export function useHasMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  return mounted;
}
