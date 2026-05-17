import { BellAlertIcon, BellIcon } from "@heroicons/react/24/outline";
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
      const [{ count }, { rows }] = await Promise.all([
        unreadCount(),
        listMyNotifications(),
      ]);
      setUnread(count);
      setRows(rows as Notification[]);
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
        className="relative px-2 py-1 hover:bg-neutral-100"
      >
        {unread > 0 ? (
          <BellAlertIcon
            className="h-5 w-5 text-amber-600"
            aria-hidden="true"
          />
        ) : (
          <BellIcon className="h-5 w-5" aria-hidden="true" />
        )}
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[1.25rem] rounded-full bg-red-600 px-1 text-center text-white text-xs">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-1 w-80 border bg-white shadow-lg dark:bg-neutral-900">
          <div className="border-b p-2 font-medium text-sm">Notifications</div>
          {rows.length === 0 ? (
            <p className="p-4 text-neutral-500 text-sm">Nothing yet.</p>
          ) : (
            <ul>
              {rows.map((n) => (
                <li
                  key={n.id}
                  className={n.read ? "border-b" : "border-b bg-blue-50"}
                >
                  <button
                    type="button"
                    onClick={() => void onClickNotification(n)}
                    className="block w-full p-2 text-left text-sm hover:bg-neutral-50"
                  >
                    <div className="font-medium">{n.title}</div>
                    <div className="text-neutral-500 text-xs">
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
              className="block w-full p-2 text-center text-xs hover:bg-neutral-50"
            >
              Mark all read
            </button>
          )}
        </div>
      )}
    </div>
  );
}
