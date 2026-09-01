import { Link } from "@tanstack/react-router";
import { STAFF_PANEL_AUDIENCE_HINT } from "#/lib/private-notes";
import {
  type HistoryRow,
  InventoryLifecyclePanel,
} from "./inventory-lifecycle-panel";
import { Panel, PanelHeader, PanelNote } from "./panel";
import { Button } from "./ui/button";

export interface StaffPanelItem {
  currentHolderEmail?: string | null;
  currentHolderId?: string | null;
  currentHolderLabel?: string | null;
  currentHolderName?: string | null;
  currentHolderProgram?: string | null;
  currentRequestItemId?: string | null;
  dueAt?: Date | string | null;
  id: string;
  name: string;
  pickupBy?: Date | string | null;
  status: string;
}

/**
 * What is happening to the item: its status, how that status has moved, and
 * how to take it out of circulation. What the item *is* lives next door in
 * InventoryPrivatePanel, along with the Edit link that changes it.
 *
 * Rendering only from a staff branch makes this staff-only by construction,
 * with no second visibility flag to keep in sync.
 */
export function StaffInventoryPanel({
  item,
  history,
  hasRequestHistory,
}: {
  hasRequestHistory: boolean;
  history: HistoryRow[];
  item: StaffPanelItem;
}) {
  return (
    <Panel tone="staff">
      <PanelHeader
        actions={
          // This page is public now, so a staff member who arrived from the
          // management table has no other way back to it. Edit lives on the
          // private panel instead, beside the fields it edits.
          <Button asChild size="sm" variant="ghost">
            <Link to="/admin/inventory">Manage inventory</Link>
          </Button>
        }
        title="Staff panel"
      />
      <PanelNote>{STAFF_PANEL_AUDIENCE_HINT}</PanelNote>

      {/* Renders its own PanelSections, so it slots into the same rhythm. */}
      <InventoryLifecyclePanel
        hasRequestHistory={hasRequestHistory}
        history={history}
        item={{
          id: item.id,
          name: item.name,
          status: item.status,
          currentHolderId: item.currentHolderId ?? null,
          currentHolderName: item.currentHolderName ?? null,
          currentHolderEmail: item.currentHolderEmail ?? null,
          currentHolderLabel: item.currentHolderLabel ?? null,
          currentHolderProgram: item.currentHolderProgram ?? null,
          currentRequestItemId: item.currentRequestItemId ?? null,
          pickupBy: item.pickupBy ?? null,
          dueAt: item.dueAt ?? null,
        }}
      />
    </Panel>
  );
}
