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

const { addComment, updateComment } = vi.hoisted(() => ({
  addComment: vi.fn(),
  updateComment: vi.fn(),
}));
vi.mock("#/server/comments", () => ({ addComment, updateComment }));

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
  updateComment.mockReset();
  updateComment.mockResolvedValue({ id: "c1" });
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
    editedAt: null,
    hasReply: false,
    isMine: false,
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

/**
 * Two submits inside one tick, which is the case a `busy` state read cannot
 * cover: the flag only holds off the second submit once React has re-rendered
 * (#443). Dispatching both on the form is what puts them in the same tick;
 * two `fireEvent.submit` calls flush between and prove nothing.
 *
 * Both forms here are covered, because they guard differently. The composer
 * took `useAction` and its ref; the reply form keeps its own, since its
 * cancel-and-reopen behaviour needs a cancelled attempt's answer to leave the
 * flag alone, which the hook does not model.
 */
describe("CommentThread double submit", () => {
  function submitTwice(form: HTMLFormElement) {
    return act(() => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true })
      );
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true })
      );
      return Promise.resolve();
    });
  }

  it("posts one comment when the composer is submitted twice in one tick", async () => {
    renderThread([comment({})]);
    const box = screen.getByPlaceholderText("Add a comment");
    fireEvent.change(box, { target: { value: "One comment" } });

    await submitTwice(box.closest("form") as HTMLFormElement);

    expect(addComment).toHaveBeenCalledTimes(1);
  });

  it("posts one reply when the reply form is submitted twice in one tick", async () => {
    renderThread([comment({})]);
    openReplyAndType("One reply");

    await submitTwice(
      screen.getByPlaceholderText("Reply").closest("form") as HTMLFormElement
    );

    expect(addComment).toHaveBeenCalledTimes(1);
  });
});

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

describe("CommentThread editing", () => {
  /** Opens the editor on the only editable comment and replaces its text. */
  function openEditorAndType(text: string) {
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByPlaceholderText("Edit comment"), {
      target: { value: text },
    });
  }

  it("offers Edit on the viewer's own comment", () => {
    renderThread([comment({ isMine: true })]);
    expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
  });

  it("offers no Edit on somebody else's comment", () => {
    renderThread([comment({ isMine: false })]);
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });

  it("offers no Edit once the comment has a reply", () => {
    // The reply itself may be invisible to this viewer, which is why the lock
    // arrives as `hasReply` rather than being counted from the rendered
    // children (#503).
    renderThread([comment({ isMine: true, hasReply: true })]);
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });

  it("offers Edit on the viewer's own reply", () => {
    renderThread([
      comment({}),
      comment({ id: "c2", parentId: "c1", isMine: true, content: "Mine." }),
    ]);
    expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
  });

  it("posts the new text and refetches the thread", async () => {
    const onChanged = vi.fn().mockResolvedValue(undefined);
    renderThread([comment({ isMine: true })], true, false, onChanged);
    openEditorAndType("Reworded.");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(updateComment).toHaveBeenCalledTimes(1));
    expect(updateComment.mock.calls[0]?.[0]).toEqual({
      data: { commentId: "c1", content: "Reworded." },
    });
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  });

  it("closes the editor after a successful save", async () => {
    renderThread([comment({ isMine: true })]);
    openEditorAndType("Reworded.");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(screen.queryByPlaceholderText("Edit comment")).toBeNull()
    );
  });

  it("keeps the typed text and shows the reason when the save is refused", async () => {
    updateComment.mockRejectedValue(
      new Error("This comment can no longer be edited")
    );
    renderThread([comment({ isMine: true })]);
    openEditorAndType("Too late.");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(
        screen.getByText("This comment can no longer be edited")
      ).toBeTruthy()
    );
    // Nothing the author typed is thrown away by a failure (#503).
    const box = screen.getByPlaceholderText(
      "Edit comment"
    ) as HTMLTextAreaElement;
    expect(box.value).toBe("Too late.");
  });

  it("restores the saved text on cancel and writes nothing", () => {
    renderThread([comment({ isMine: true })]);
    openEditorAndType("Half a thought");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(updateComment).not.toHaveBeenCalled();
    expect(screen.getByText("Looks good to me.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(
      (screen.getByPlaceholderText("Edit comment") as HTMLTextAreaElement).value
    ).toBe("Looks good to me.");
  });

  it("sends nothing when the text is unchanged", async () => {
    renderThread([comment({ isMine: true })]);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(screen.queryByPlaceholderText("Edit comment")).toBeNull()
    );
    expect(updateComment).not.toHaveBeenCalled();
  });

  it("marks an edited comment with when it was edited, and leaves an unedited one unmarked", () => {
    const { container } = renderThread([
      comment({ id: "c1", editedAt: "2026-05-28T11:00:00.000Z" }),
      comment({ id: "c2", content: "As posted." }),
    ]);
    expect(screen.getAllByText(/\(edited/)).toHaveLength(1);
    // The time itself, not just the word: a reader who cares that the words
    // moved cares when (#503).
    expect(
      container.querySelectorAll('time[datetime="2026-05-28T11:00:00.000Z"]')
    ).toHaveLength(1);
  });

  it("keeps an open editor and its text when the thread refetches", () => {
    // #188 and #190 are the two precedents: a refetch that lands while
    // somebody is typing must not take what they typed. `CommentNode` is keyed
    // by comment id, so this holds by construction, and the test is here to
    // keep it that way.
    const mine = comment({ isMine: true });
    const { rerender } = render(
      <CommentThread
        comments={[mine]}
        onChanged={() => Promise.resolve()}
        projectId={PROJECT_ID}
        viewerIsOwner={false}
        viewerIsStaff
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByPlaceholderText("Edit comment"), {
      target: { value: "Half a rewrite" },
    });

    rerender(
      <CommentThread
        comments={[
          mine,
          comment({ id: "c2", authorId: "someone-else", content: "Landed." }),
        ]}
        onChanged={() => Promise.resolve()}
        projectId={PROJECT_ID}
        viewerIsOwner={false}
        viewerIsStaff
      />
    );

    expect(screen.getByText("Landed.")).toBeTruthy();
    expect(
      (screen.getByPlaceholderText("Edit comment") as HTMLTextAreaElement).value
    ).toBe("Half a rewrite");
  });

  it("offers no Edit to a viewer who is not the author, staff or not", () => {
    renderThread([comment({ isMine: false })], false, true);
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });
});
