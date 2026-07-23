import { useQueryClient } from "@tanstack/react-query";
import {
  createFileRoute,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { EmptyState } from "#/components/empty-state";
import { InventoryStatusBadge } from "#/components/inventory-status-badge";
import { Button } from "#/components/ui/button";
import { Textarea } from "#/components/ui/textarea";
import {
  cancelRequestItem,
  listMyItems,
  removeFromCart,
  submitCart,
} from "#/server/inventory";

const searchSchema = z.object({
  tab: z.enum(["cart", "active", "history"]).default("active"),
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

  const tab =
    data.cart.length > 0 && search.tab === "active" ? "cart" : search.tab;

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 md:p-8">
      <h1 className="font-semibold text-2xl">My Items</h1>
      <div className="mt-4 flex gap-4 border-border border-b">
        {(["cart", "active", "history"] as const).map((t) => (
          <button
            className={
              t === tab
                ? "border-b-2 px-2 py-1 font-medium"
                : "px-2 py-1 text-muted-foreground hover:text-foreground"
            }
            key={t}
            onClick={() => navigate({ search: () => ({ tab: t }) })}
            style={
              t === tab
                ? { borderBottomColor: "var(--brand-primary)" }
                : undefined
            }
            type="button"
          >
            {(() => {
              if (t === "cart") {
                return `Cart (${data.cart.length})`;
              }
              if (t === "active") {
                return `Active (${data.active.length})`;
              }
              return "History";
            })()}
          </button>
        ))}
      </div>

      {tab === "cart" && (
        <div className="mt-4 space-y-2">
          {data.cart.length === 0 && (
            <EmptyState>Your cart is empty.</EmptyState>
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
                    alert(
                      `Submitted ${result.submitted.length}; skipped ${result.skipped.length} (no longer available).`
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
      )}

      {tab === "active" && (
        <div className="mt-4 space-y-2">
          {data.active.length === 0 && (
            <p className="text-muted-foreground">No active requests.</p>
          )}
          {data.active.map(({ line, item }) => {
            const canCancel =
              (line.status === "pending" || line.status === "approved") &&
              item.status !== "checked_out";
            return (
              <div
                className="flex items-center justify-between rounded-md border border-border bg-card p-3"
                key={line.id}
              >
                <div>
                  <p className="font-medium">{item.name}</p>
                  <InventoryStatusBadge status={item.status as "available"} />
                  {line.pickupBy && (
                    <p className="text-muted-foreground text-xs">
                      Pick up by {line.pickupBy.toLocaleDateString()}
                    </p>
                  )}
                  {line.dueAt && (
                    <p className="text-muted-foreground text-xs">
                      Due {line.dueAt.toLocaleDateString()}
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
      )}

      {tab === "history" && (
        <div className="mt-4 space-y-2">
          {data.history.length === 0 && (
            <EmptyState>No history yet.</EmptyState>
          )}
          {data.history.map(({ line, item }) => (
            <div
              className="rounded-md border border-border bg-card p-3"
              key={line.id}
            >
              <p className="font-medium">{item.name}</p>
              <p className="text-muted-foreground text-xs">
                Status: {line.status}
              </p>
              {line.closedReason && (
                <p className="mt-1 text-sm">{line.closedReason}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
