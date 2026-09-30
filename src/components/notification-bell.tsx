import { useQuery, useQueryClient } from "@tanstack/react-query";
import { isRedirect, useRouter } from "@tanstack/react-router";
import { Bell, BellRing } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useAction } from "#/lib/use-action";
import { useSignedInUserId } from "#/lib/use-signed-in";
import {
  getMyNotifications,
  markAllRead,
  markRead,
} from "#/server/notifications";
import { LocalTime } from "./local-time";
import { Button } from "./ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

interface Notification {
  createdAt: Date | string;
  id: string;
  link: string | null;
  message: string;
  read: boolean | null;
  title: string;
  type: string;
}

const NOTIFICATIONS_KEY = ["notifications"] as const;

/**
 * How long a read stays fresh: a navigation or a remount within this reads
 * nothing. Focus and opening the popover read whatever the age.
 */
const BELL_FRESH_FOR_MS = 30_000;

/**
 * The header mounts this twice for a signed-in viewer, once per breakpoint
 * row, and CSS hides one. Both read one query key, so a mount, a focus or a
 * mark-read makes one read between them rather than one each (#634).
 *
 * It does not poll (#725). It reads when it first mounts, when the tab is
 * shown again, when the popover opens, and after a client navigation or a
 * `router.invalidate()` (both emit `onResolved`) once the last read is 30 s
 * old. A failed read leaves the age where it was, so the next navigation
 * retries it. A minute's poll in every open signed-in tab was most of the
 * app's traffic at term start, most of it from tabs sitting on one page. The
 * cost is that a notification arriving while someone stays put badges on
 * their next navigation more than 30 s after the last read, a reload or a
 * return to the tab; the list itself is read
 * fresh whenever the popover opens. A hover preload does not emit
 * `onResolved`, so preloading reads nothing.
 *
 * The key carries the user id: see docs/QUIRKS.md, "A TanStack Query key for
 * the viewer's own data carries their user id".
 */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const userId = useSignedInUserId();
  const queryClient = useQueryClient();
  const router = useRouter();
  const queryKey = [...NOTIFICATIONS_KEY, userId];
  const { data } = useQuery({
    queryKey,
    queryFn: async () => {
      try {
        const { count, rows } = await getMyNotifications();
        return { count, rows: rows as Notification[] };
      } catch (error) {
        // The server ended the session (expiry, a ban) before this tab
        // heard. `requireUser` refuses with a redirect, and the router's
        // query integration navigates on any redirect a query throws, which
        // would carry a tab mid-edit to /sign-in on the next read.
        if (isRedirect(error)) {
          return { count: 0, rows: [] };
        }
        throw error;
      }
    },
    enabled: userId !== undefined,
    staleTime: BELL_FRESH_FOR_MS,
    // Showing the tab reads whatever the age: it is the one signal that
    // someone who stayed on a page is looking again.
    refetchOnWindowFocus: "always",
    // The next navigation or focus is the retry.
    retry: false,
  });

  // Both bells subscribe, and `cancelRefetch: false` makes the second join
  // the first one's read rather than cancel it and start another. The age is
  // read from the clock (`isStaleByTime`) rather than the `stale` filter,
  // which trusts a timer a background tab may not have run yet. The key is
  // built here rather than taken from `queryKey`, a new array each render,
  // which as a dependency would resubscribe on every render.
  useEffect(() => {
    if (userId === undefined) {
      return;
    }
    return router.subscribe("onResolved", () => {
      void queryClient.refetchQueries(
        {
          queryKey: [...NOTIFICATIONS_KEY, userId],
          predicate: (query) => query.isStaleByTime(BELL_FRESH_FOR_MS),
        },
        { cancelRefetch: false }
      );
    });
  }, [router, queryClient, userId]);
  const unread = data?.count ?? 0;
  const rows = data?.rows ?? [];

  // One read of this viewer's entry, shared by every mounted bell: after a
  // write, and when the popover opens.
  function refresh() {
    return queryClient.invalidateQueries({ queryKey });
  }

  // Both of these were awaited from a `void` call with no catch, so a refusal
  // was an unhandled rejection and the badge went on showing a count that was
  // no longer true. A toast, not inline text: this is a header control with no
  // panel to write into (#410).
  const { busy, run } = useAction({ onError: toast.error });

  function onClickNotification(n: Notification) {
    void run(async () => {
      if (!n.read) {
        await markRead({ data: { id: n.id } });
      }
      setOpen(false);
      if (n.link) {
        window.location.href = n.link;
        return;
      }
      await refresh();
    }, "Could not mark that as read");
  }

  function onMarkAllRead() {
    void run(async () => {
      await markAllRead();
      await refresh();
    }, "Could not mark them as read");
  }

  return (
    <Popover
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          void refresh();
        }
      }}
      open={open}
    >
      <PopoverTrigger asChild>
        <Button
          aria-label="Notifications"
          className="relative"
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          {unread > 0 ? (
            <BellRing
              aria-hidden="true"
              style={{ color: "var(--status-warning)" }}
            />
          ) : (
            <Bell aria-hidden="true" />
          )}
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[1.25rem] rounded-full bg-destructive px-1 text-center text-destructive-foreground text-xs">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 max-w-[calc(100vw-1rem)] p-0">
        <div className="border-border border-b p-2 font-medium text-sm">
          Notifications
        </div>
        {rows.length === 0 ? (
          <p className="p-4 text-muted-foreground text-sm">Nothing yet.</p>
        ) : (
          <ul className="max-h-[60vh] overflow-y-auto">
            {rows.map((n) => (
              <li
                className={
                  n.read
                    ? "border-border border-b"
                    : "border-border border-b bg-[var(--brand-primary-tint)]"
                }
                key={n.id}
              >
                <button
                  className="block w-full p-2 text-left text-sm outline-none hover:bg-secondary focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
                  disabled={busy}
                  onClick={() => onClickNotification(n)}
                  type="button"
                >
                  <div className="font-medium">{n.title}</div>
                  <div className="text-muted-foreground text-xs">
                    <LocalTime value={n.createdAt} />
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
        {rows.length > 0 && (
          <button
            className="block w-full border-border border-t p-2 text-center text-xs outline-none hover:bg-secondary focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
            disabled={busy}
            onClick={onMarkAllRead}
            type="button"
          >
            {busy ? "Marking..." : "Mark all read"}
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}
