import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ShoppingCart } from "lucide-react";
import { getCart } from "#/server/inventory";
import { Button } from "./ui/button";

export function CartButton() {
  const { data } = useQuery({
    queryKey: ["cart"],
    queryFn: () => getCart(),
  });
  const count = data?.length ?? 0;
  return (
    <Button aria-label="Cart" asChild size="sm" variant="ghost">
      <Link search={{ tab: "cart" }} to="/my/items">
        <ShoppingCart className="h-5 w-5" />
        {count > 0 && (
          <span
            className="ml-1 rounded px-1.5 font-semibold text-xs"
            style={{
              background: "var(--brand-primary)",
              color: "white",
            }}
          >
            {count}
          </span>
        )}
      </Link>
    </Button>
  );
}
