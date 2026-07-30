import { Link } from "@tanstack/react-router";
import {
  PRIVATE_NOTES_INVENTORY_HINT,
  PRIVATE_NOTES_LABEL,
} from "#/lib/private-notes";
import {
  type HistoryRow,
  InventoryLifecyclePanel,
} from "./inventory-lifecycle-panel";
import { Button } from "./ui/button";

export interface StaffPanelItem {
  currentHolderEmail?: string | null;
  currentHolderId?: string | null;
  currentHolderLabel?: string | null;
  currentHolderName?: string | null;
  currentRequestItemId?: string | null;
  id: string;
  label?: string | null;
  location?: string | null;
  name: string;
  notes?: string | null;
  serial?: string | null;
  status: string;
}

/**
 * The staff half of the item detail page. Rendering the Edit link from inside
 * here makes it staff-only by construction, with no second visibility flag to
 * keep in sync. Unlike a project, an item has no owner, so staff are the only
 * audience for it.
 */
export function StaffInventoryPanel({
  item,
  history,
}: {
  history: HistoryRow[];
  item: StaffPanelItem;
}) {
  return (
    <div className="mt-8 rounded-lg border-(--brand-primary-tint) border-2 bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="island-kicker">Staff panel</p>
        <Button asChild size="sm" variant="outline">
          <Link params={{ itemId: item.id }} to="/inventory/$itemId/edit">
            Edit
          </Link>
        </Button>
      </div>

      <dl className="grid grid-cols-3 gap-2 text-sm">
        <dt className="text-muted-foreground">Location</dt>
        <dd className="col-span-2">{item.location ?? "-"}</dd>
        <dt className="text-muted-foreground">Serial</dt>
        <dd className="col-span-2">{item.serial ?? "-"}</dd>
        <dt className="text-muted-foreground">Label</dt>
        <dd className="col-span-2">{item.label ?? "-"}</dd>
      </dl>

      {item.notes && (
        <section className="mt-4 border-border border-t pt-4">
          <h3 className="font-medium text-sm">{PRIVATE_NOTES_LABEL}</h3>
          <p className="mt-1 whitespace-pre-wrap text-sm">{item.notes}</p>
          <p className="mt-1 text-muted-foreground text-xs">
            {PRIVATE_NOTES_INVENTORY_HINT}
          </p>
        </section>
      )}

      <div className="mt-4 border-border border-t pt-4">
        <InventoryLifecyclePanel
          history={history}
          item={{
            id: item.id,
            name: item.name,
            status: item.status,
            currentHolderId: item.currentHolderId ?? null,
            currentHolderName: item.currentHolderName ?? null,
            currentHolderEmail: item.currentHolderEmail ?? null,
            currentHolderLabel: item.currentHolderLabel ?? null,
            currentRequestItemId: item.currentRequestItemId ?? null,
          }}
        />
      </div>
    </div>
  );
}
