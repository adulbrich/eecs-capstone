import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ClipboardList } from "lucide-react";
import { authClient } from "#/lib/auth-client";
import { useHasMounted } from "#/lib/use-has-mounted";
import { getCart } from "#/server/inventory";
import { CountBadge } from "./count-badge";
import { Button } from "./ui/button";

/**
 * The viewer's unsubmitted borrow list, as a count on the `/inventory` title
 * row. It used to be a cart icon in the header; it moved because a half-built
 * list is scoped to one page's contents, and the header carries only
 * site-wide chrome (see `docs/UI-CONVENTIONS.md`).
 *
 * Gates itself on the session rather than taking a prop, so the page that
 * mounts it cannot render it for an anonymous visitor by mistake: `getCart`
 * requires a session and would throw. Gated on mount as well, so the server's
 * signed-out render and the client's first render agree.
 */
export function BorrowListButton() {
  const { data: session } = authClient.useSession();
  const hasMounted = useHasMounted();
  const signedIn = hasMounted && !!session?.user;
  const { data } = useQuery({
    queryKey: ["cart"],
    queryFn: () => getCart(),
    enabled: signedIn,
  });
  if (!signedIn) {
    return null;
  }
  const count = data?.length ?? 0;
  return (
    <Button asChild size="sm" variant="outline">
      <Link search={{ tab: "cart" }} to="/my/items">
        <ClipboardList aria-hidden="true" className="h-4 w-4" />
        Borrow list <CountBadge count={count} />
      </Link>
    </Button>
  );
}
