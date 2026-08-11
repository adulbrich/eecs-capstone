import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2 } from "lucide-react";
import { addToCart, getCart } from "#/server/inventory";
import { Button } from "./ui/button";

interface Props {
  className?: string;
  itemId: string;
  size?: "sm" | "default";
  variant?: "default" | "outline";
}

/**
 * Add to cart, with the three states the action actually has.
 *
 * The "already in cart" state is read from the cart itself rather than kept as
 * local UI state, so it survives a reload and is right on first paint for an
 * item added from another page. The query key is shared with `CartButton`, so
 * however many of these are on screen there is one request.
 *
 * Only rendered for a signed-in viewer looking at an available item, which is
 * what keeps the cart query off the public listing: `getCart` requires a
 * session and would throw for an anonymous visitor.
 */
export function AddToCartButton({
  className,
  itemId,
  size = "sm",
  variant = "outline",
}: Props) {
  const qc = useQueryClient();
  const { data: cart } = useQuery({
    queryKey: ["cart"],
    queryFn: () => getCart(),
  });
  const { mutate, isPending, isSuccess, isError } = useMutation({
    mutationFn: () => addToCart({ data: { itemId } }),
    // Only the cart. The previous call sites invalidated every query, but
    // adding to a cart changes no item's status, and the cart is the only
    // React Query consumer that cares. The header count shares this key, so
    // it updates from the same refetch.
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cart"] }),
  });

  // isSuccess as well as the cart, so the label flips the moment the write
  // lands rather than waiting for the refetch that follows it. Without it the
  // button reads "Add to cart" again for as long as the invalidation takes,
  // which is exactly the moment the user is looking for confirmation.
  const inCart = isSuccess || (cart ?? []).some((row) => row.itemId === itemId);

  if (inCart) {
    return (
      <Button
        className={className}
        disabled
        size={size}
        // aria-disabled would keep it focusable, but there is nothing left to
        // do here and the cart link in the header is the next step.
        variant={variant}
      >
        <Check aria-hidden="true" className="h-4 w-4" />
        In cart
      </Button>
    );
  }

  return (
    <Button
      className={className}
      disabled={isPending}
      onClick={() => mutate()}
      size={size}
      variant={variant}
    >
      {isPending && (
        <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
      )}
      {addToCartLabel(isPending, isError)}
    </Button>
  );
}

function addToCartLabel(isPending: boolean, isError: boolean): string {
  if (isPending) {
    return "Adding...";
  }
  if (isError) {
    return "Could not add, try again";
  }
  return "Add to cart";
}
