import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { EmptyState } from "./empty-state";
import { InventoryStatusBadge } from "./inventory-status-badge";
import { Button } from "./ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./ui/card";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";

export interface BorrowListRow {
  itemId: string;
  name: string;
  status: string;
}

/**
 * The borrow list as the request it is: rows, one note for the whole
 * request, and the submit, inside one bounded region (#64). It used to be a
 * list of rows with a note field after the last one, which read as a note on
 * that row. The server calls stay in the route; this only composes the form.
 */
export function BorrowListPanel({
  busy,
  onRemove,
  onSubmit,
  rows,
}: {
  busy: boolean;
  onRemove: (itemId: string) => void;
  onSubmit: (note: string) => void;
  rows: BorrowListRow[];
}) {
  const [note, setNote] = useState("");
  if (rows.length === 0) {
    return (
      <EmptyState>
        Your borrow list is empty. Browse the{" "}
        <Link to="/inventory">inventory</Link>, add the items you need, then
        submit them here as one request. Staff approve each line and tell you
        when to pick it up.
      </EmptyState>
    );
  }
  const count = rows.length;
  return (
    <Card asChild>
      <section aria-labelledby="borrow-list-heading">
        <CardHeader>
          <CardTitle id="borrow-list-heading">
            Request being assembled ({count} {count === 1 ? "item" : "items"})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <ul className="divide-y divide-border">
            {rows.map((row) => (
              <li
                className="flex items-center justify-between gap-3 py-2"
                key={row.itemId}
              >
                <div>
                  <p className="font-medium">{row.name}</p>
                  <InventoryStatusBadge status={row.status as "available"} />
                </div>
                <Button
                  disabled={busy}
                  onClick={() => onRemove(row.itemId)}
                  size="sm"
                  variant="ghost"
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
          <div className="space-y-1.5">
            <Label htmlFor="borrow-list-note">Note for staff (optional)</Label>
            <Textarea
              id="borrow-list-note"
              onChange={(e) => setNote(e.target.value)}
              placeholder="When you need it, or which project it is for"
              rows={2}
              value={note}
            />
          </div>
        </CardContent>
        <CardFooter className="justify-end">
          <Button
            disabled={busy}
            onClick={() => {
              onSubmit(note);
              setNote("");
            }}
          >
            {busy ? "Submitting..." : "Submit request"}
          </Button>
        </CardFooter>
      </section>
    </Card>
  );
}
