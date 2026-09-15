import { Bell, BellRing } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useAction } from "#/lib/use-action";
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

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [rows, setRows] = useState<Notification[]>([]);

  const refresh = useCallback(async () => {
    try {
      const [{ count }, { rows: r }] = await Promise.all([
        unreadCount(),
        listMyNotifications(),
      ]);
      setUnread(count);
      setRows(r as Notification[]);
    } catch {
      // ignore (user not authenticated yet)
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(refresh, 60_000);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

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
