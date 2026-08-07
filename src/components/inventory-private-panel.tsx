import { Link } from "@tanstack/react-router";
import { STAFF_PANEL_AUDIENCE_HINT } from "#/lib/private-notes";
import { Panel, PanelHeader, PanelNote, PanelSection } from "./panel";
import { Button } from "./ui/button";

export interface InventoryPrivateItem {
  id: string;
  label?: string | null;
  location?: string | null;
  notes?: string | null;
  serial?: string | null;
}

/**
 * The item's non-public attributes, in the same region shape the project page
 * uses. Separating them from the staff panel splits two things that were
 * sharing one box for no reason: what the item *is* (where it lives, what is
 * written on it, what staff need to know to find it) and what is *happening*
 * to it (its status, who has it, how to retire it).
 *
 * Everything here is editable, which is why the Edit link lives on this
 * header rather than the staff panel's: the button now sits with the fields
 * it changes.
 *
 * Neutral tone, not the staff panel's brand tint, because both panels render
 * stacked for the same viewer and identical borders would read as one region.
 * Unlike the project page's private panel, this one has no second audience:
 * an item has no proposer, so its audience line is the staff-only one.
 */
export function InventoryPrivatePanel({
  item,
}: {
  item: InventoryPrivateItem;
}) {
  return (
    <Panel tone="private">
      <PanelHeader
        actions={
          <Button asChild size="sm" variant="outline">
            <Link params={{ itemId: item.id }} to="/inventory/$itemId/edit">
              Edit
            </Link>
          </Button>
        }
        title="Private"
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

      {/* Rendered even when empty, unlike the old staff-panel version that
          disappeared entirely. Details above already shows "-" for a field
          nobody filled in, and a section that vanishes leaves staff unable to
          tell "no notes" from "notes exist and I cannot see them". */}
      <PanelSection title="Notes">
        {item.notes ? (
          <p className="whitespace-pre-wrap text-sm">{item.notes}</p>
        ) : (
          <p className="text-muted-foreground text-sm">No notes.</p>
        )}
      </PanelSection>
    </Panel>
  );
}
