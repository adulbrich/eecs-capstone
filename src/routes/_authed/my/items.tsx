import { useQueryClient } from "@tanstack/react-query";
import {
  createFileRoute,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { EmptyState } from "#/components/empty-state";
import { InventoryStatusBadge } from "#/components/inventory-status-badge";
import { LocalTime } from "#/components/local-time";
import { OverdueBadge } from "#/components/overdue-badge";
import { Button } from "#/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs";
import { Textarea } from "#/components/ui/textarea";
import {
  cancelRequestItem,
  listMyItems,
  removeFromCart,
  submitCart,
} from "#/server/inventory";

// `tab` is optional rather than defaulted, so "the user asked for Active" and
// "the URL said nothing" stay distinguishable. With a default they collapse
// into the same value, which is what made Active unreachable below.
const searchSchema = z.object({
  tab: z.enum(["cart", "active", "history"]).optional(),
});

export const Route = createFileRoute("/_authed/my/items")({
  validateSearch: (s) => searchSchema.parse(s),
  loader: () => listMyItems(),
  component: MyItems,
});

function MyItems() {
  const data = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/my/items" });
  const router = useRouter();
  const qc = useQueryClient();
  const [note, setNote] = useState("");

  async function refresh() {
    await Promise.all([qc.invalidateQueries(), router.invalidate()]);
  }

  // A bare /my/items opens on the cart when there is something in it, which is
  // the common case right after adding items. An explicit `?tab=` always wins,
  // so Active stays reachable: the previous derivation re-applied the cart pin
  // on every render, so selecting Active snapped straight back to Cart and the
  // user menu's own "Active" link could never land.
  const tab = search.tab ?? (data.cart.length > 0 ? "cart" : "active");

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 md:p-8">
      <h1 className="font-semibold text-2xl">My Items</h1>
      {/* Manual activation: selecting a tab pushes a navigation and rewrites
          the URL, so arrowing must only move focus. Under automatic mode,
          arrowing across the strip fires onValueChange (and a navigation) on
          every keypress. */}
      <Tabs
        activationMode="manual"
        className="mt-4"
        onValueChange={(next) =>
          navigate({
            search: () => ({ tab: next as "active" | "cart" | "history" }),
          })
        }
        value={tab}
      >
        <TabsList>
          <TabsTrigger value="cart">
            Borrow list ({data.cart.length})
          </TabsTrigger>
          <TabsTrigger value="active">
            Active ({data.active.length})
          </TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        <TabsContent value="cart">
          <div className="space-y-2">
            {data.cart.length === 0 && (
              <EmptyState>Your borrow list is empty.</EmptyState>
            )}
            {data.cart.map((row) => (
              <div
                className="flex items-center justify-between rounded-md border border-border bg-card p-3"
                key={row.itemId}
              >
                <div>
                  <p className="font-medium">{row.name}</p>
                  <InventoryStatusBadge status={row.status as "available"} />
                </div>
                <Button
                  onClick={async () => {
                    await removeFromCart({ data: { itemId: row.itemId } });
                    await refresh();
                  }}
                  size="sm"
                  variant="outline"
                >
                  Remove
                </Button>
              </div>
            ))}
            {data.cart.length > 0 && (
              <div className="space-y-2 rounded-md border border-border bg-card p-3">
                <Textarea
                  aria-label="Note for staff"
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Optional note for staff"
                  value={note}
                />
                <Button
                  onClick={async () => {
                    const result = await submitCart({
                      data: { note: note || null },
                    });
                    setNote("");
                    await refresh();
                    if (result.skipped.length > 0) {
                      toast.warning(
                        `Submitted ${result.submitted.length}, skipped ${result.skipped.length} (no longer available).`
                      );
                    }
                    navigate({ search: () => ({ tab: "active" }) });
                  }}
                >
                  Submit request
                </Button>
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="active">
          <div className="space-y-2">
            {data.active.length === 0 && (
              <EmptyState>Nothing active.</EmptyState>
            )}
            {data.active.map((entry) => {
              if (entry.kind === "hold") {
                return (
                  <div
                    className="flex items-center justify-between rounded-md border border-border bg-card p-3"
                    key={entry.item.id}
                  >
                    <div>
                      <p className="font-medium">{entry.item.name}</p>
                      <InventoryStatusBadge status={entry.item.status} />
                      <OverdueBadge entry={entry} />
                      {entry.item.pickupBy && (
                        <p className="text-muted-foreground text-xs">
                          Pick up by{" "}
                          <LocalTime dateOnly value={entry.item.pickupBy} />
                        </p>
                      )}
                      {entry.item.dueAt && (
                        <p className="text-muted-foreground text-xs">
                          Due <LocalTime dateOnly value={entry.item.dueAt} />
                        </p>
                      )}
                      <p className="text-muted-foreground text-xs">
                        Assigned by staff
                      </p>
                    </div>
                  </div>
                );
              }

              const { line, itemName, itemStatus } = entry;
              const canCancel =
                (line.status === "pending" || line.status === "approved") &&
                itemStatus !== "checked_out";
              return (
                <div
                  className="flex items-center justify-between rounded-md border border-border bg-card p-3"
                  key={line.id}
                >
                  <div>
                    <p className="font-medium">{itemName}</p>
                    <InventoryStatusBadge status={itemStatus} />
                    <OverdueBadge entry={entry} />
                    {line.pickupBy && (
                      <p className="text-muted-foreground text-xs">
                        Pick up by <LocalTime dateOnly value={line.pickupBy} />
                      </p>
                    )}
                    {line.dueAt && (
                      <p className="text-muted-foreground text-xs">
                        Due <LocalTime dateOnly value={line.dueAt} />
                      </p>
                    )}
                    {entry.collectedBy && (
                      <p className="text-muted-foreground text-xs">
                        Collected by{" "}
                        {entry.collectedBy.name ?? entry.collectedBy.email}
                      </p>
                    )}
                  </div>
                  {canCancel && (
                    <Button
                      onClick={async () => {
                        await cancelRequestItem({
                          data: { requestItemId: line.id, note: null },
                        });
                        await refresh();
                      }}
                      size="sm"
                      variant="outline"
                    >
                      Cancel
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </TabsContent>

        <TabsContent value="history">
          <div className="space-y-2">
            {data.history.length === 0 && (
              <EmptyState>No history yet.</EmptyState>
            )}
            {data.history.map(({ line, itemName, collectedBy }) => (
              <div
                className="rounded-md border border-border bg-card p-3"
                key={line.id}
              >
                <p className="font-medium">{itemName}</p>
                <p className="text-muted-foreground text-xs">
                  Status: {line.status}
                </p>
                {collectedBy && (
                  <p className="text-muted-foreground text-xs">
                    Collected by {collectedBy.name ?? collectedBy.email}
                  </p>
                )}
                {line.closedReason && (
                  <p className="mt-1 text-sm">{line.closedReason}</p>
                )}
              </div>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
