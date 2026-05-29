import { Link } from "@tanstack/react-router";
import { getPublicUrl } from "#/lib/storage";
import { ImageOrFallback } from "./image-or-fallback";
import { InventoryStatusBadge } from "./inventory-status-badge";
import { Button } from "./ui/button";

type Props = {
  item: {
    id: string;
    name: string;
    description: string | null;
    imageUrl: string | null;
    status:
      | "available"
      | "requested"
      | "reserved"
      | "checked_out"
      | "maintenance";
  };
  signedIn: boolean;
  onAddToCart?: (itemId: string) => void;
};

export function InventoryRow({ item, signedIn, onAddToCart }: Props) {
  const src = getPublicUrl(item.imageUrl);
  const canAdd = signedIn && item.status === "available" && !!onAddToCart;
  return (
    <div className="flex items-stretch gap-3 overflow-hidden rounded-lg border border-border bg-card transition-colors hover:border-primary">
      <Link
        to="/inventory/$itemId"
        params={{ itemId: item.id }}
        className="flex min-w-0 flex-1 items-stretch gap-3"
      >
        <div className="relative w-32 shrink-0 self-stretch">
          <ImageOrFallback
            src={src}
            className="absolute inset-0 h-full w-full object-cover"
          />
        </div>
        <div className="min-w-0 flex-1 py-3">
          <h3 className="truncate text-sm font-semibold">{item.name}</h3>
          {item.description && (
            <p className="mt-1 line-clamp-3 text-sm text-muted-foreground">
              {item.description}
            </p>
          )}
          <div className="mt-1">
            <InventoryStatusBadge status={item.status} />
          </div>
        </div>
      </Link>
      {canAdd && (
        <div className="flex shrink-0 items-center pr-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onAddToCart?.(item.id)}
          >
            Add to cart
          </Button>
        </div>
      )}
    </div>
  );
}
