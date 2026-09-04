import { Link } from "@tanstack/react-router";
import type { ActiveStatus } from "#/lib/inventory-visibility";
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
    status: ActiveStatus;
  };
  signedIn: boolean;
}

/**
 * One item in the public listing, at both widths: image on top below `md`,
 * image on the left from `md` up. The same shape as `ProjectCard`, for the
 * same reason: the viewport picks the layout, not a toggle.
 */
export function InventoryCard({ item, signedIn }: Props) {
  const src = getPublicUrl(item.imageUrl);
  const canAdd = signedIn && item.status === "available";
  return (
    <Card
      className="flex flex-col overflow-hidden md:flex-row md:items-center md:gap-3 md:p-3"
      interactive
    >
      <Link
        className="flex min-w-0 flex-1 flex-col md:flex-row md:items-center md:gap-3"
        params={{ itemId: item.id }}
        to="/inventory/$itemId"
      >
        <ImageOrFallback
          className="aspect-[16/9] w-full object-cover md:aspect-[3/2] md:w-40 md:shrink-0 md:rounded-md"
          src={src}
        />
        <div className="flex min-w-0 flex-1 flex-col p-4 md:p-0">
          <h3 className="font-semibold leading-tight">{item.name}</h3>
          {item.description && (
            <p className="mt-2 line-clamp-3 text-muted-foreground text-sm md:mt-1">
              {item.description}
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2 md:mt-1">
            <InventoryStatusBadge status={item.status} />
            {item.categories.map((category) => (
              <CategoryChip category={category} key={category.id} />
            ))}
          </div>
        </div>
      </Link>
      {canAdd && (
        <div className="px-4 pb-4 md:shrink-0 md:px-0 md:pb-0">
          <AddToCartButton className="w-full md:w-auto" itemId={item.id} />
        </div>
      )}
    </Card>
  );
}
