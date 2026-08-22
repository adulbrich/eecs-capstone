import { Link } from "@tanstack/react-router";
import { getPublicUrl } from "#/lib/storage";
import { AddToCartButton } from "./add-to-cart-button";
import { CategoryChip } from "./category-chip";
import { ImageOrFallback } from "./image-or-fallback";
import { InventoryStatusBadge } from "./inventory-status-badge";
import { Card } from "./ui/card";

interface Props {
  item: {
    id: string;
    name: string;
    description: string | null;
    categories: { id: string; name: string }[];
    imageUrl: string | null;
    status:
      | "available"
      | "requested"
      | "reserved"
      | "checked_out"
      | "maintenance";
  };
  signedIn: boolean;
}

export function InventoryRow({ item, signedIn }: Props) {
  const src = getPublicUrl(item.imageUrl);
  const canAdd = signedIn && item.status === "available";
  return (
    <Card className="flex items-stretch gap-3 overflow-hidden" interactive>
      <Link
        className="flex min-w-0 flex-1 items-stretch gap-3"
        params={{ itemId: item.id }}
        to="/inventory/$itemId"
      >
        <div className="relative w-32 shrink-0 self-stretch">
          <ImageOrFallback
            className="absolute inset-0 h-full w-full object-cover"
            src={src}
          />
        </div>
        <div className="min-w-0 flex-1 py-3">
          <h3 className="truncate font-semibold text-sm">{item.name}</h3>
          {item.description && (
            <p className="mt-1 line-clamp-3 text-muted-foreground text-sm">
              {item.description}
            </p>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <InventoryStatusBadge status={item.status} />
            {item.categories.map((category) => (
              <CategoryChip
                category={{ ...category, type: null }}
                key={category.id}
              />
            ))}
          </div>
        </div>
      </Link>
      {canAdd && (
        <div className="flex shrink-0 items-center pr-3">
          <AddToCartButton itemId={item.id} />
        </div>
      )}
    </Card>
  );
}
