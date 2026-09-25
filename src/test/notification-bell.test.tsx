// @vitest-environment jsdom
import {
  focusManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installResizeObserver } from "./radix-jsdom";

let session: { user: { id: string } } | null = null;
let unread = 2;

vi.mock("#/server/notifications", () => ({
  listMyNotifications: vi.fn(() =>
    Promise.resolve({
      rows: [
        {
          createdAt: "2026-09-01T12:00:00Z",
          id: "n1",
          link: null,
          message: "m",
          read: unread === 0,
          title: "Your hold is ready",
          type: "hold",
        },
      ],
    })
  ),
  markAllRead: vi.fn(() => Promise.resolve({ ok: true })),
  markRead: vi.fn(() => {
    unread = 0;
    return Promise.resolve({ ok: true });
  }),
  unreadCount: vi.fn(() => Promise.resolve({ count: unread })),
}));

vi.mock("#/lib/auth-client", () => ({
  authClient: { useSession: () => ({ data: session, isPending: false }) },
}));

import { NotificationBell } from "#/components/notification-bell";
import {
  listMyNotifications,
  markRead,
  unreadCount,
} from "#/server/notifications";

const mockedCount = vi.mocked(unreadCount);
const mockedList = vi.mocked(listMyNotifications);

beforeAll(() => {
  installResizeObserver();
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn();
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
  focusManager.setFocused(undefined);
  session = null;
  unread = 2;
});

// The header's two rows, one per breakpoint: CSS hides one, both mount.
function renderTwoBells() {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <NotificationBell />
      <NotificationBell />
    </QueryClientProvider>
  );
}

function bells() {
  return screen.getAllByRole("button", { name: "Notifications" });
}

async function settledOnMount() {
  await waitFor(() => {
    for (const bell of bells()) {
      expect(bell.textContent).toBe("2");
    }
  });
}

describe("NotificationBell, mounted twice", () => {
  it("makes one read of each on mount", async () => {
    session = { user: { id: "u1" } };
    renderTwoBells();
    await settledOnMount();
    expect(mockedCount).toHaveBeenCalledTimes(1);
    expect(mockedList).toHaveBeenCalledTimes(1);
  });

  it("makes one read of each per 60 second tick", async () => {
    // Only the interval is faked, so waitFor keeps its real setTimeout.
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    session = { user: { id: "u1" } };
    renderTwoBells();
    await settledOnMount();

    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    await waitFor(() => expect(mockedCount).toHaveBeenCalledTimes(2));
    expect(mockedList).toHaveBeenCalledTimes(2);

    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    await waitFor(() => expect(mockedCount).toHaveBeenCalledTimes(3));
    expect(mockedList).toHaveBeenCalledTimes(3);
  });

  it("makes one read of each when the window regains focus", async () => {
    session = { user: { id: "u1" } };
    renderTwoBells();
    await settledOnMount();
    expect(mockedCount).toHaveBeenCalledTimes(1);

    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await waitFor(() => expect(mockedCount).toHaveBeenCalledTimes(2));
    expect(mockedList).toHaveBeenCalledTimes(2);
    // A second focus-driven read would land here if each bell refetched.
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockedCount).toHaveBeenCalledTimes(2);
  });

  it("clears the count in both bells after one mark-read, with one read", async () => {
    session = { user: { id: "u1" } };
    renderTwoBells();
    await settledOnMount();

    // Opening the popover refreshes it, as it did before.
    fireEvent.click(bells()[0]);
    await waitFor(() => expect(mockedCount).toHaveBeenCalledTimes(2));
    const row = await screen.findByRole("button", {
      name: /Your hold is ready/,
    });
    await waitFor(() => expect(row.hasAttribute("disabled")).toBe(false));

    fireEvent.click(row);
    await waitFor(() => {
      for (const bell of bells()) {
        expect(bell.textContent).toBe("");
      }
    });
    expect(vi.mocked(markRead)).toHaveBeenCalledTimes(1);
    expect(mockedCount).toHaveBeenCalledTimes(3);
    expect(mockedList).toHaveBeenCalledTimes(3);
  });

  it("never shows one user's notifications to the next in the same tab", async () => {
    session = { user: { id: "u1" } };
    const qc = new QueryClient();
    const tree = () => (
      <QueryClientProvider client={qc}>
        <NotificationBell />
        <NotificationBell />
      </QueryClientProvider>
    );
    const { rerender } = render(tree());
    await settledOnMount();

    // u1's session ends without a reload and u2 signs in on the client. u2's
    // read never answers, so anything the bells show is u1's cache.
    const pending = () => new Promise<never>(() => undefined);
    mockedCount.mockImplementationOnce(pending);
    mockedList.mockImplementationOnce(pending);
    session = { user: { id: "u2" } };
    rerender(tree());

    await waitFor(() => expect(mockedCount).toHaveBeenCalledTimes(2));
    for (const bell of bells()) {
      expect(bell.textContent).toBe("");
    }
  });

  it("makes no request for a signed-out viewer", async () => {
    renderTwoBells();
    await act(async () => {
      await Promise.resolve();
    });
    expect(bells()).toHaveLength(2);
    expect(mockedCount).not.toHaveBeenCalled();
    expect(mockedList).not.toHaveBeenCalled();
  });
});
