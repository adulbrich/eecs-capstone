import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ClipboardList } from "lucide-react";
import { useSignedInUserId } from "#/lib/use-signed-in";
import { cartQuery } from "./add-to-cart-button";
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
 * requires a session and would throw. `useSignedInUserId` holds the first
 * client render to the server's signed-out answer.
 */
export function BorrowListButton() {
  const userId = useSignedInUserId();
  const { data } = useQuery(cartQuery(userId));
  if (userId === undefined) {
    return null;
  }
  const count = data?.length ?? 0;
  return (
    <Button asChild size="sm" variant="outline">
      <Link search={{ filter: "open" }} to="/my/items">
        <ClipboardList aria-hidden="true" />
        Borrow list <CountBadge count={count} />
      </Link>
    </Button>
  );
}
