// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQueryClient } from "./shared/query-client";

const { addComment, listProjectComments, updateComment } = vi.hoisted(() => ({
  addComment: vi.fn(),
  listProjectComments: vi.fn(),
  updateComment: vi.fn(),
}));
vi.mock("#/server/comments", () => ({ addComment, updateComment }));
vi.mock("#/server/projects-queries", () => ({ listProjectComments }));

let session: { user: { id: string } } | null = null;
vi.mock("#/lib/auth-client", () => ({
  authClient: { useSession: () => ({ data: session, isPending: false }) },
}));

import {
  ProjectPrivatePanel,
  projectCommentsKey,
} from "#/components/project-private-panel";

const PROJECT_ID = "00000000-0000-0000-0000-0000000000p1";

type Row = Awaited<ReturnType<typeof listProjectComments>>["rows"][number];

function comment(overrides: Record<string, unknown> = {}) {
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
    isMine: true,
    ...overrides,
  } as Row;
}

afterEach(() => {
  cleanup();
  session = null;
});
beforeEach(() => {
  addComment.mockReset();
  updateComment.mockReset();
  listProjectComments.mockReset();
  addComment.mockResolvedValue({ id: "c2" });
  updateComment.mockResolvedValue({ id: "c1" });
  listProjectComments.mockResolvedValue({ rows: [comment()] });
});

function renderPanel(notes: string | null = null) {
  return renderWithQueryClient(
    <ProjectPrivatePanel
      canEdit={false}
      history={[]}
      notes={notes}
      projectId={PROJECT_ID}
      viewerIsOwner
      viewerIsStaff={false}
    />
  );
}

function headings() {
  return Array.from(document.querySelectorAll("h3")).map((h) => h.textContent);
}

/** Lets a `setQueryData` notification reach the thread and render. */
function settle() {
  return act(() => new Promise((resolve) => setTimeout(resolve, 10)));
}

describe("ProjectPrivatePanel section order", () => {
  // Status history first, so the notes and the comments, both written to the
  // other party, read as one conversation (#615).
  it("puts status history above private notes and comments", () => {
    renderPanel("Bring a laptop.");
    expect(headings()).toEqual(["Status history", "Private notes", "Comments"]);
  });

  it("leaves private notes out when the project has none", () => {
    renderPanel(null);
    expect(headings()).toEqual(["Status history", "Comments"]);
  });
});

describe("ProjectPrivatePanel comments", () => {
  it("renders the comments it reads for the signed-in viewer", async () => {
    session = { user: { id: "u1" } };
    renderPanel();

    expect(await screen.findByText("Looks good to me.")).toBeTruthy();
    expect(listProjectComments).toHaveBeenCalledWith({
      data: { id: PROJECT_ID },
    });
  });

  it("reads the comments again after a post", async () => {
    session = { user: { id: "u1" } };
    renderPanel();
    await screen.findByText("Looks good to me.");
    listProjectComments.mockResolvedValue({
      rows: [comment(), comment({ id: "c2", content: "A second thought." })],
    });

    fireEvent.change(screen.getByRole("textbox", { name: "Comment" }), {
      target: { value: "A second thought." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Post comment" }));

    expect(await screen.findByText("A second thought.")).toBeTruthy();
    expect(listProjectComments).toHaveBeenCalledTimes(2);
  });

  it("keeps an open edit's draft when the comments' data changes", async () => {
    session = { user: { id: "u1" } };
    const { queryClient } = renderPanel();
    await screen.findByText("Looks good to me.");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const editor = screen.getByRole("textbox", {
      name: "Edit comment",
    }) as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: "Typed, not saved." } });

    queryClient.setQueryData(projectCommentsKey(PROJECT_ID, "u1"), [
      comment({ content: "Edited somewhere else." }),
      comment({ id: "c2", content: "A new reply." }),
    ]);
    await settle();

    // The thread moved with the data...
    expect(screen.getByText("A new reply.")).toBeTruthy();
    // ...and the open draft did not.
    expect(editor.value).toBe("Typed, not saved.");
  });

  it("reads nothing for a signed-out viewer", async () => {
    renderPanel();
    await settle();
    expect(listProjectComments).not.toHaveBeenCalled();
  });
});

describe("ProjectPrivatePanel comments on a revisit", () => {
  it("reads again on mount even inside the client's 30-second window", async () => {
    session = { user: { id: "u1" } };
    const view = renderPanel();
    view.queryClient.setDefaultOptions({
      queries: { retry: false, staleTime: 30_000 },
    });
    await waitFor(() => expect(listProjectComments).toHaveBeenCalledTimes(1));

    // A new key remounts the panel on the same client, as a revisit does.
    view.rerender(
      <ProjectPrivatePanel
        canEdit={false}
        history={[]}
        key="again"
        notes={null}
        projectId={PROJECT_ID}
        viewerIsOwner
        viewerIsStaff={false}
      />
    );

    await waitFor(() => expect(listProjectComments).toHaveBeenCalledTimes(2));
  });
});
