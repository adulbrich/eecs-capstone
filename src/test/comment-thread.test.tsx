// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { addComment } = vi.hoisted(() => ({ addComment: vi.fn() }));
vi.mock("#/server/comments", () => ({ addComment }));

// Radix's Checkbox measures itself on mount; jsdom ships no ResizeObserver.
class ResizeObserverStub {
  observe() {
    // no-op
  }
  unobserve() {
    // no-op
  }
  disconnect() {
    // no-op
  }
}
globalThis.ResizeObserver ??=
  ResizeObserverStub as unknown as typeof ResizeObserver;

import { CommentThread } from "#/components/comment-thread";

afterEach(cleanup);
beforeEach(() => {
  addComment.mockReset();
  addComment.mockResolvedValue({ id: "new-comment" });
});

const PROJECT_ID = "00000000-0000-0000-0000-0000000000p1";

type ThreadComment = Parameters<typeof CommentThread>[0]["comments"][number];

function comment(overrides: Partial<ThreadComment>): ThreadComment {
  return {
    id: "c1",
    projectId: PROJECT_ID,
    authorId: "user-abcdef123456",
    authorName: "Ada Lovelace",
    parentId: null,
    content: "Looks good to me.",
    isInternal: false,
    createdAt: "2026-05-28T10:00:00.000Z",
    ...overrides,
  };
}

function renderThread(comments: ThreadComment[], viewerIsStaff = true) {
  return render(
    <CommentThread
      comments={comments}
      onChanged={() => {
        // no-op
      }}
      projectId={PROJECT_ID}
      viewerIsStaff={viewerIsStaff}
    />
  );
}

/** Opens the reply form under the only top-level comment and fills it in. */
function openReplyAndType(text: string) {
  fireEvent.click(screen.getByRole("button", { name: "Reply" }));
  fireEvent.change(screen.getByPlaceholderText("Reply"), {
    target: { value: text },
  });
}

/**
 * The thread also renders a new-comment form with its own internal checkbox,
 * so every reply-form query has to be scoped or it matches both.
 */
function replyForm() {
  const form = screen.getByPlaceholderText("Reply").closest("form");
  if (!form) {
    throw new Error("reply form is not open");
  }
  return within(form);
}

describe("CommentThread author identity", () => {
  it("shows the author's name, not their id", () => {
    renderThread([comment({})]);
    expect(screen.getByText("Ada Lovelace")).toBeTruthy();
    expect(screen.queryByText("user-abc")).toBeNull();
    expect(screen.queryByText(/user-abcdef123456/)).toBeNull();
  });

  it("shows the author's name on replies too", () => {
    renderThread([
      comment({}),
      comment({
        id: "c2",
        parentId: "c1",
        authorId: "user-999",
        authorName: "Grace Hopper",
        content: "Agreed.",
      }),
    ]);
    expect(screen.getByText("Grace Hopper")).toBeTruthy();
  });

  it("falls back to a readable label when the name is missing", () => {
    renderThread([comment({ authorName: null })]);
    expect(screen.getByText("Unknown user")).toBeTruthy();
  });
});

describe("CommentThread internal replies", () => {
  it("forces a reply to an internal comment to be internal", () => {
    renderThread([comment({ isInternal: true })]);
    openReplyAndType("internal follow-up");

    const checkbox = replyForm().getByRole("checkbox");
    expect(checkbox.getAttribute("aria-checked")).toBe("true");
    expect(checkbox.hasAttribute("disabled")).toBe(true);
    expect(
      replyForm().getByText(
        "Replies to an internal comment are always internal."
      )
    ).toBeTruthy();
  });

  it("posts an inherited internal reply even though the box was never clicked", async () => {
    renderThread([comment({ isInternal: true })]);
    openReplyAndType("internal follow-up");
    fireEvent.click(replyForm().getByRole("button", { name: "Post" }));

    await waitFor(() => expect(addComment).toHaveBeenCalledTimes(1));
    expect(addComment).toHaveBeenCalledWith({
      data: {
        projectId: PROJECT_ID,
        parentId: "c1",
        content: "internal follow-up",
        isInternal: true,
      },
    });
  });

  it("leaves the choice open when replying to a public comment", () => {
    renderThread([comment({ isInternal: false })]);
    openReplyAndType("public follow-up");

    const checkbox = replyForm().getByRole("checkbox");
    expect(checkbox.getAttribute("aria-checked")).toBe("false");
    expect(checkbox.hasAttribute("disabled")).toBe(false);
    expect(
      replyForm().queryByText(
        "Replies to an internal comment are always internal."
      )
    ).toBeNull();
  });

  it("posts a public reply to a public comment by default", async () => {
    renderThread([comment({ isInternal: false })]);
    openReplyAndType("public follow-up");
    fireEvent.click(replyForm().getByRole("button", { name: "Post" }));

    await waitFor(() => expect(addComment).toHaveBeenCalledTimes(1));
    expect(addComment.mock.calls[0][0].data.isInternal).toBe(false);
  });

  it("lets staff start an internal side-thread under a public comment", async () => {
    renderThread([comment({ isInternal: false })]);
    openReplyAndType("staff aside");
    fireEvent.click(replyForm().getByRole("checkbox"));
    fireEvent.click(replyForm().getByRole("button", { name: "Post" }));

    await waitFor(() => expect(addComment).toHaveBeenCalledTimes(1));
    expect(addComment.mock.calls[0][0].data.isInternal).toBe(true);
  });

  it("offers no internal control to a non-staff viewer", () => {
    renderThread([comment({ isInternal: false })], false);
    openReplyAndType("proposer reply");
    expect(replyForm().queryByRole("checkbox")).toBeNull();
  });
});
