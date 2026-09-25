import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, BellRing } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { authClient } from "#/lib/auth-client";
import { useAction } from "#/lib/use-action";
import { useHasMounted } from "#/lib/use-has-mounted";
import {
  listMyNotifications,
  markAllRead,
  markRead,
  unreadCount,
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
 * The header mounts this twice for a signed-in viewer, once per breakpoint
 * row, and CSS hides one. Both read one query key, so a mount, a focus or a
 * mark-read makes one read between them rather than one each (#634). Each
 * observer arms its own interval timer, but the first tick's fetch updates
 * every observer on the key and each re-arms its timer from there, so one tick
 * fires per minute.
 *
 * The poll pauses while the tab is hidden, and Query's focus refetch fires when
 * it is shown again. That is narrower than the hand-rolled `focus` listener it
 * replaced: Query listens for `visibilitychange`, so switching back to a
 * browser window whose tab stayed visible no longer refetches, and the next
 * tick picks the change up instead.
 *
 * The key carries the user id. Signing out reloads the page, but a session can
 * also end without one (another tab, expiry, a ban), and signing in navigates
 * on the client, so a bare key would show the next user the previous user's
 * cached notifications until their own read answered.
 */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  // `useSignedIn`'s gate, keeping the id: false until mounted, so the first
  // client render matches the signed-out markup the server produced.
  const { data: session } = authClient.useSession();
  const hasMounted = useHasMounted();
  const userId = hasMounted ? session?.user?.id : undefined;
  const queryClient = useQueryClient();
  const { data, refetch } = useQuery({
    queryKey: [...NOTIFICATIONS_KEY, userId],
    queryFn: async () => {
      const [{ count }, { rows }] = await Promise.all([
        unreadCount(),
        listMyNotifications(),
      ]);
      return { count, rows: rows as Notification[] };
    },
    enabled: userId !== undefined,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    // The next tick is the retry; a refusal (a session that ended in another
    // tab) should cost the two reads once a minute, not four times each.
    retry: false,
  });
  const unread = data?.count ?? 0;
  const rows = data?.rows ?? [];

  // After a write, by prefix, so it reaches the entry whatever id it is under;
  // opening the popover refetches this viewer's entry directly instead.
  function refresh() {
    return queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
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
          void refetch();
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
