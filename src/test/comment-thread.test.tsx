// @vitest-environment jsdom
import {
  act,
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

function renderThread(
  comments: ThreadComment[],
  viewerIsStaff = true,
  viewerIsOwner = false,
  onChanged: () => Promise<void> = () => Promise.resolve()
) {
  return render(
    <CommentThread
      comments={comments}
      onChanged={onChanged}
      projectId={PROJECT_ID}
      viewerIsOwner={viewerIsOwner}
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

    const checkbox = replyForm().getByRole("checkbox", {
      name: "Internal (staff only)",
    });
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
        // Internal mails nobody, and the wire says so (#399).
        sendEmail: false,
      },
    });
  });

  it("leaves the choice open when replying to a public comment", () => {
    renderThread([comment({ isInternal: false })]);
    openReplyAndType("public follow-up");

    const checkbox = replyForm().getByRole("checkbox", {
      name: "Internal (staff only)",
    });
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
    fireEvent.click(
      replyForm().getByRole("checkbox", { name: "Internal (staff only)" })
    );
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

describe("CommentThread email skip", () => {
  it("posts sendEmail: false from the new-comment form when the box is unchecked", async () => {
    renderThread([]);
    const box = screen.getByRole("checkbox", { name: "Email the proposer" });
    expect(box.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(box);
    fireEvent.change(screen.getByPlaceholderText("Add a comment"), {
      target: { value: "quiet note" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Post comment" }));

    await waitFor(() => expect(addComment).toHaveBeenCalledTimes(1));
    expect(addComment).toHaveBeenCalledWith({
      data: {
        projectId: PROJECT_ID,
        content: "quiet note",
        isInternal: false,
        sendEmail: false,
      },
    });
    // Checked again for the next comment: the skip was about that one.
    await waitFor(() =>
      expect(
        screen
          .getByRole("checkbox", { name: "Email the proposer" })
          .getAttribute("aria-checked")
      ).toBe("true")
    );
  });

  it("keeps the box mounted, unchecked and disabled while Internal is on, and under an internal parent", () => {
    renderThread([comment({ isInternal: true })]);
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Internal (staff only)" })
    );
    const box = screen.getByRole("checkbox", { name: "Email the proposer" });
    expect(box.getAttribute("aria-checked")).toBe("false");
    expect(box.hasAttribute("disabled")).toBe(true);

    openReplyAndType("internal follow-up");
    const replyBox = replyForm().getByRole("checkbox", {
      name: "Email the proposer",
    });
    expect(replyBox.getAttribute("aria-checked")).toBe("false");
    expect(replyBox.hasAttribute("disabled")).toBe(true);
  });

  it("returns the box to checked when Internal is unchecked, whatever it was before", () => {
    renderThread([]);
    const emailBox = () =>
      screen.getByRole("checkbox", { name: "Email the proposer" });
    const internal = screen.getByRole("checkbox", {
      name: "Internal (staff only)",
    });
    fireEvent.click(emailBox());
    expect(emailBox().getAttribute("aria-checked")).toBe("false");
    fireEvent.click(internal);
    expect(emailBox().hasAttribute("disabled")).toBe(true);
    fireEvent.click(internal);
    expect(emailBox().getAttribute("aria-checked")).toBe("true");
    expect(emailBox().hasAttribute("disabled")).toBe(false);
  });

  it("posts sendEmail: false for an internal comment", async () => {
    renderThread([]);
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Internal (staff only)" })
    );
    fireEvent.change(screen.getByPlaceholderText("Add a comment"), {
      target: { value: "staff only" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Post comment" }));
    await waitFor(() => expect(addComment).toHaveBeenCalledTimes(1));
    expect(addComment).toHaveBeenCalledWith({
      data: {
        projectId: PROJECT_ID,
        content: "staff only",
        isInternal: true,
        sendEmail: false,
      },
    });
  });

  it("posts the reply's choice, and offers none to a non-staff viewer", async () => {
    renderThread([comment({ isInternal: false })]);
    openReplyAndType("reply quietly");
    fireEvent.click(
      replyForm().getByRole("checkbox", { name: "Email the proposer" })
    );
    fireEvent.click(replyForm().getByRole("button", { name: "Post" }));
    await waitFor(() => expect(addComment).toHaveBeenCalledTimes(1));
    expect(addComment.mock.calls[0][0].data.sendEmail).toBe(false);

    cleanup();
    renderThread([comment({ isInternal: false })], false);
    expect(
      screen.queryByRole("checkbox", { name: "Email the proposer" })
    ).toBeNull();
  });

  it("offers no box to staff on their own project, where nobody is emailed", () => {
    renderThread([comment({ isInternal: false })], true, true);
    expect(
      screen.getByRole("checkbox", { name: "Internal (staff only)" })
    ).toBeTruthy();
    expect(
      screen.queryByRole("checkbox", { name: "Email the proposer" })
    ).toBeNull();
    openReplyAndType("own project");
    expect(
      replyForm().queryByRole("checkbox", { name: "Email the proposer" })
    ).toBeNull();
  });
});

describe("CommentThread forms while a post is in flight", () => {
  function pendingPost() {
    let resolvePost: (value: unknown) => void = () => undefined;
    addComment.mockReturnValue(
      new Promise((resolve) => {
        resolvePost = resolve;
      })
    );
    return () => resolvePost({ id: "new-comment" });
  }

  it("disables the new-comment form until the post lands, then clears it", async () => {
    const land = pendingPost();
    renderThread([]);
    const box = screen.getByLabelText("Comment") as HTMLTextAreaElement;
    const post = screen.getByRole("button", { name: "Post comment" });
    fireEvent.change(box, { target: { value: "first" } });
    fireEvent.click(post);

    await waitFor(() => expect(box.disabled).toBe(true));
    expect(post.hasAttribute("disabled")).toBe(true);
    // A second click while busy posts nothing twice.
    fireEvent.click(post);
    expect(addComment).toHaveBeenCalledTimes(1);

    land();
    await waitFor(() => expect(box.disabled).toBe(false));
    expect(box.value).toBe("");
  });

  it("disables the reply form the same way and closes it once the reply lands", async () => {
    const land = pendingPost();
    renderThread([comment({})]);
    openReplyAndType("follow-up");
    const box = screen.getByPlaceholderText("Reply") as HTMLTextAreaElement;
    fireEvent.click(replyForm().getByRole("button", { name: "Post" }));

    await waitFor(() => expect(box.disabled).toBe(true));
    const post = replyForm().getByRole("button", { name: "Post" });
    expect(post.hasAttribute("disabled")).toBe(true);
    fireEvent.click(post);
    expect(addComment).toHaveBeenCalledTimes(1);

    land();
    await waitFor(() =>
      expect(screen.queryByPlaceholderText("Reply")).toBeNull()
    );
    expect(addComment).toHaveBeenCalledTimes(1);
  });

  it("keeps a reply draft when another post lands and the thread refreshes", async () => {
    // Step 3 of #188's triage: onChanged is shared, so a post from the
    // new-comment form must not disturb a reply being drafted at the same
    // time. The refresh it triggers is a rerender with a longer comments
    // array; the reply form is keyed under its comment and keeps its state.
    const land = pendingPost();
    const first = comment({});
    const view = renderThread([first]);
    openReplyAndType("reply in progress");

    fireEvent.change(screen.getByLabelText("Comment"), {
      target: { value: "unrelated post" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Post comment" }));
    await waitFor(() =>
      expect(
        (screen.getByLabelText("Comment") as HTMLTextAreaElement).disabled
      ).toBe(true)
    );
    land();
    await waitFor(() =>
      expect(
        (screen.getByLabelText("Comment") as HTMLTextAreaElement).disabled
      ).toBe(false)
    );
    view.rerender(
      <CommentThread
        comments={[first, comment({ id: "c2", content: "unrelated post" })]}
        onChanged={() => Promise.resolve()}
        projectId={PROJECT_ID}
        viewerIsOwner={false}
        viewerIsStaff={true}
      />
    );

    const reply = screen.getByPlaceholderText("Reply") as HTMLTextAreaElement;
    expect(reply.value).toBe("reply in progress");
    expect(reply.disabled).toBe(false);
  });

  it("does not carry a cancelled reply's failure into the next draft", async () => {
    let failPost: (reason: Error) => void = () => undefined;
    addComment.mockReturnValue(
      new Promise((_, reject) => {
        failPost = reject;
      })
    );
    renderThread([comment({})]);
    openReplyAndType("doomed reply");
    fireEvent.click(replyForm().getByRole("button", { name: "Post" }));
    fireEvent.click(replyForm().getByRole("button", { name: "Cancel" }));
    expect(screen.queryByPlaceholderText("Reply")).toBeNull();

    failPost(new Error("Forbidden"));
    await waitFor(() => expect(addComment).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    expect(screen.queryByText("Forbidden")).toBeNull();
  });

  it("clears a posted reply even when Cancel lands during the refresh", async () => {
    // The clear runs on the write, not after the refetch that follows it.
    // Deferred past the refetch, a Cancel inside that window bumps the attempt
    // number, the clear is skipped, and reopening Reply hands back the text
    // that already posted, one click from posting it twice.
    let releaseRefresh = () => {
      // replaced below, before anything awaits the promise
    };
    const refreshed = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    renderThread([comment({})], true, false, () => refreshed);

    openReplyAndType("posted once");
    fireEvent.click(replyForm().getByRole("button", { name: "Post" }));
    await waitFor(() => expect(addComment).toHaveBeenCalledTimes(1));

    // The reply has landed and the thread is refetching. Cancel is live here
    // on purpose (#247), and the form is still open because the close waits
    // for the refetch.
    fireEvent.click(replyForm().getByRole("button", { name: "Cancel" }));
    releaseRefresh();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    const box = screen.getByPlaceholderText("Reply") as HTMLTextAreaElement;
    expect(box.value).toBe("");
  });

  it("holds the second attempt disabled when a cancelled one lands", async () => {
    // One busy flag per form meant the cancelled attempt's answer landed on
    // whatever replaced it: its `finally` re-enabled the fields mid-flight
    // (#247). Its `catch` could write an error there too, which is the same
    // bug from the other side.
    const settlers: ((value: unknown) => void)[] = [];
    addComment.mockImplementation(
      () =>
        new Promise((resolve) => {
          settlers.push(resolve);
        })
    );

    renderThread([comment({})]);
    openReplyAndType("first try");
    fireEvent.click(replyForm().getByRole("button", { name: "Post" }));
    fireEvent.click(replyForm().getByRole("button", { name: "Cancel" }));

    // Reopening has to give back a form that can be typed into: the first
    // request is still out, and the person cancelled it precisely to start
    // again.
    fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    const box = screen.getByPlaceholderText("Reply") as HTMLTextAreaElement;
    expect(box.disabled).toBe(false);

    fireEvent.change(box, { target: { value: "second try" } });
    fireEvent.click(replyForm().getByRole("button", { name: "Post" }));
    expect(addComment).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(box.disabled).toBe(true));

    // The cancelled attempt answers. Its continuation runs on the next
    // microtasks, and must leave the second attempt's form alone.
    settlers[0]({ id: "first" });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(box.disabled).toBe(true);
    expect(screen.getByPlaceholderText("Reply")).toBe(box);

    settlers[1]({ id: "second" });
    await waitFor(() =>
      expect(screen.queryByPlaceholderText("Reply")).toBeNull()
    );
  });

  it("keeps a cancelled attempt's failure off the attempt that replaced it", async () => {
    // The catch side of the case above. #242 cleared the error when the form
    // reopens, which covers a failure that lands first; this covers one that
    // lands after, with a second attempt already in flight.
    const rejecters: ((reason: Error) => void)[] = [];
    addComment.mockImplementation(
      () =>
        new Promise((_, reject) => {
          rejecters.push(reject);
        })
    );

    renderThread([comment({})]);
    openReplyAndType("doomed reply");
    fireEvent.click(replyForm().getByRole("button", { name: "Post" }));
    fireEvent.click(replyForm().getByRole("button", { name: "Cancel" }));

    fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    const box = screen.getByPlaceholderText("Reply") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "second try" } });
    fireEvent.click(replyForm().getByRole("button", { name: "Post" }));
    await waitFor(() => expect(box.disabled).toBe(true));

    rejecters[0](new Error("Forbidden"));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.queryByText("Forbidden")).toBeNull();
    expect(box.disabled).toBe(true);

    rejecters[1](new Error("Still forbidden"));
    await waitFor(() =>
      expect(screen.getByText("Still forbidden")).toBeTruthy()
    );
    expect(box.disabled).toBe(false);
  });
});
