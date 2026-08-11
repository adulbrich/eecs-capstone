import { Link } from "@tanstack/react-router";
import { getPublicUrl } from "#/lib/storage";
import { AddToCartButton } from "./add-to-cart-button";
import { CategoryChip } from "./category-chip";
import { ImageOrFallback } from "./image-or-fallback";
import { InventoryStatusBadge } from "./inventory-status-badge";

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

export function InventoryCard({ item, signedIn }: Props) {
  const src = getPublicUrl(item.imageUrl);
  const canAdd = signedIn && item.status === "available";
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
          <div className="mt-2 flex flex-wrap items-center gap-2">
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
        <div className="p-4 pt-0">
          <AddToCartButton className="w-full" itemId={item.id} />
        </div>
      )}
    </div>
  );
}
