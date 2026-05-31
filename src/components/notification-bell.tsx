import { Bell, BellRing } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  listMyNotifications,
  markAllRead,
  markRead,
  unreadCount,
} from "#/server/notifications";

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

  async function onClickNotification(n: Notification) {
    if (!n.read) {
      await markRead({ data: { id: n.id } });
    }
    setOpen(false);
    if (n.link) {
      window.location.href = n.link;
    } else {
      await refresh();
    }
  }

  async function onMarkAllRead() {
    await markAllRead();
    await refresh();
  }

  return (
    <div className="relative">
      <button
        aria-label="Notifications"
        className="relative rounded-md px-2 py-1 hover:bg-secondary"
        onClick={() => {
          setOpen((v) => !v);
          void refresh();
        }}
        type="button"
      >
        {unread > 0 ? (
          <BellRing
            aria-hidden="true"
            className="h-5 w-5"
            style={{ color: "var(--status-warning)" }}
          />
        ) : (
          <Bell aria-hidden="true" className="h-5 w-5" />
        )}
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[1.25rem] rounded-full bg-destructive px-1 text-center text-white text-xs">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-1 w-80 rounded-md border border-border bg-card shadow-lg">
          <div className="border-border border-b p-2 font-medium text-sm">
            Notifications
          </div>
          {rows.length === 0 ? (
            <p className="p-4 text-muted-foreground text-sm">Nothing yet.</p>
          ) : (
            <ul>
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
                    className="block w-full p-2 text-left text-sm hover:bg-secondary"
                    onClick={() => void onClickNotification(n)}
                    type="button"
                  >
                    <div className="font-medium">{n.title}</div>
                    <div className="text-muted-foreground text-xs">
                      {new Date(n.createdAt).toLocaleString()}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {rows.length > 0 && (
            <button
              className="block w-full p-2 text-center text-xs hover:bg-secondary"
              onClick={() => void onMarkAllRead()}
              type="button"
            >
              Mark all read
            </button>
          )}
        </div>
      )}
    </div>
  );
}
