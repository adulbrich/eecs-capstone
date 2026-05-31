import { Link } from "@tanstack/react-router";
import { getPublicUrl } from "#/lib/storage";
import { ImageOrFallback } from "./image-or-fallback";
import { InventoryStatusBadge } from "./inventory-status-badge";
import { Button } from "./ui/button";

interface Props {
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
  onAddToCart?: (itemId: string) => void;
  signedIn: boolean;
}

export function InventoryCard({ item, signedIn, onAddToCart }: Props) {
  const src = getPublicUrl(item.imageUrl);
  const canAdd = signedIn && item.status === "available" && !!onAddToCart;
  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-border bg-card transition-colors hover:border-primary">
      <Link
        className="flex flex-1 flex-col"
        params={{ itemId: item.id }}
        to="/inventory/$itemId"
      >
        <ImageOrFallback
          className="aspect-[16/9] w-full object-cover"
          src={src}
        />
        <div className="flex flex-1 flex-col p-4">
          <h3 className="font-semibold leading-tight">{item.name}</h3>
          {item.description && (
            <p className="mt-2 line-clamp-3 text-muted-foreground text-sm">
              {item.description}
            </p>
          )}
          <div className="mt-2">
            <InventoryStatusBadge status={item.status} />
          </div>
        </div>
      </Link>
      {canAdd && (
        <div className="p-4 pt-0">
          <Button
            className="w-full"
            onClick={() => onAddToCart?.(item.id)}
            size="sm"
            variant="outline"
          >
            Add to cart
          </Button>
        </div>
      )}
    </div>
  );
}
