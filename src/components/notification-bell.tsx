import { Bell, BellRing } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  listMyNotifications,
  markAllRead,
  markRead,
  unreadCount,
} from "#/server/notifications";

type Notification = {
  id: string;
  type: string;
  title: string;
  message: string;
  link: string | null;
  read: boolean | null;
  createdAt: Date | string;
};

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
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          void refresh();
        }}
        aria-label="Notifications"
        className="relative rounded-md px-2 py-1 hover:bg-secondary"
      >
        {unread > 0 ? (
          <BellRing
            className="h-5 w-5"
            style={{ color: "var(--status-warning)" }}
            aria-hidden="true"
          />
        ) : (
          <Bell className="h-5 w-5" aria-hidden="true" />
        )}
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 min-w-[1.25rem] rounded-full bg-destructive px-1 text-center text-xs text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-1 w-80 rounded-md border border-border bg-card shadow-lg">
          <div className="border-b border-border p-2 font-medium text-sm">
            Notifications
          </div>
          {rows.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">Nothing yet.</p>
          ) : (
            <ul>
              {rows.map((n) => (
                <li
                  key={n.id}
                  className={
                    n.read
                      ? "border-b border-border"
                      : "border-b border-border bg-[var(--brand-primary-tint)]"
                  }
                >
                  <button
                    type="button"
                    onClick={() => void onClickNotification(n)}
                    className="block w-full p-2 text-left text-sm hover:bg-secondary"
                  >
                    <div className="font-medium">{n.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(n.createdAt).toLocaleString()}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {rows.length > 0 && (
            <button
              type="button"
              onClick={() => void onMarkAllRead()}
              className="block w-full p-2 text-center text-xs hover:bg-secondary"
            >
              Mark all read
            </button>
          )}
        </div>
      )}
    </div>
  );
}
