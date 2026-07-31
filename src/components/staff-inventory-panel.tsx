import { Link } from "@tanstack/react-router";
import { STAFF_PANEL_AUDIENCE_HINT } from "#/lib/private-notes";
import {
  type HistoryRow,
  InventoryLifecyclePanel,
} from "./inventory-lifecycle-panel";
import { Panel, PanelHeader, PanelNote, PanelSection } from "./panel";
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
    <Panel tone="staff">
      <PanelHeader
        actions={
          <>
            {/* This page is public now, so a staff member who arrived from the
                management table has no other way back to it. */}
            <Button asChild size="sm" variant="ghost">
              <Link to="/admin/inventory">Manage inventory</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link params={{ itemId: item.id }} to="/inventory/$itemId/edit">
                Edit
              </Link>
            </Button>
          </>
        }
        title="Staff panel"
      />
      <PanelNote>{STAFF_PANEL_AUDIENCE_HINT}</PanelNote>

      <PanelSection title="Details">
        <dl className="grid grid-cols-3 gap-2 text-sm">
          <dt className="text-muted-foreground">Location</dt>
          <dd className="col-span-2">{item.location ?? "-"}</dd>
          <dt className="text-muted-foreground">Serial</dt>
          <dd className="col-span-2">{item.serial ?? "-"}</dd>
          <dt className="text-muted-foreground">Label</dt>
          <dd className="col-span-2">{item.label ?? "-"}</dd>
        </dl>
      </PanelSection>

      {/* Just "Notes": the panel's own audience note already says these are
          staff-only, so repeating it per section was redundant. */}
      {item.notes && (
        <PanelSection title="Notes">
          <p className="whitespace-pre-wrap text-sm">{item.notes}</p>
        </PanelSection>
      )}

      {/* Renders its own PanelSections, so it slots into the same rhythm. */}
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
    </Panel>
  );
}
