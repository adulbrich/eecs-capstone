// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The comment thread imports server functions, which cannot resolve under
// jsdom. Nothing here posts a comment.
vi.mock("#/server/comments", () => ({
  addComment: vi.fn(),
  updateComment: vi.fn(),
}));

import { ProjectPrivatePanel } from "#/components/project-private-panel";

afterEach(cleanup);

function renderPanel(notes: string | null) {
  render(
    <ProjectPrivatePanel
      canEdit={false}
      comments={[]}
      history={[]}
      notes={notes}
      onCommentsChanged={async () => {
        // no-op
      }}
      projectId="00000000-0000-0000-0000-0000000000p1"
      viewerIsOwner
      viewerIsStaff={false}
    />
  );
  return Array.from(document.querySelectorAll("h3")).map((h) => h.textContent);
}

describe("ProjectPrivatePanel section order", () => {
  // Status history first, so the notes and the comments, both written to the
  // other party, read as one conversation (#615).
  it("puts status history above private notes and comments", () => {
    expect(renderPanel("Bring a laptop.")).toEqual([
      "Status history",
      "Private notes",
      "Comments",
    ]);
  });

  it("leaves private notes out when the project has none", () => {
    expect(renderPanel(null)).toEqual(["Status history", "Comments"]);
  });
});
