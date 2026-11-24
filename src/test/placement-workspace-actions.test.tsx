// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { PlacementWorkspace } from "#/components/placement/use-placement-workspace";
import { WorkspaceActions } from "#/components/placement/workspace-actions";
import type { Workspace } from "#/lib/placement/workspace";
import { EMPTY_WORKSPACE } from "#/lib/placement/workspace";

// Radix's menu relies on DOM APIs jsdom omits (admin-data-table.test.tsx).
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn();
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  globalThis.ResizeObserver = class {
    observe() {
      // no-op
    }
    unobserve() {
      // no-op
    }
    disconnect() {
      // no-op
    }
  };
});

afterEach(cleanup);

const LOADED: Workspace = {
  ...EMPTY_WORKSPACE,
  // One project is enough for the workspace to have something to lose.
  projects: [{ key: "tide-clock", title: "Tide Clock" }],
} as unknown as Workspace;

function renderActions(workspace: Workspace) {
  const clear = vi.fn();
  render(
    <WorkspaceActions
      state={{ clear, replace: vi.fn() } as unknown as PlacementWorkspace}
      workspace={workspace}
    />
  );
  return { clear };
}

/** Radix opens a menu on pointerdown, not click. */
function openMenu() {
  fireEvent.pointerDown(screen.getByRole("button", { name: "Workspace" }), {
    button: 0,
    ctrlKey: false,
  });
}

describe("the Workspace menu (#739)", () => {
  it("opens no confirm from a disabled Clear on an empty workspace", () => {
    renderActions(EMPTY_WORKSPACE);
    openMenu();
    // A synthesized click, as assistive tech sends: it skips the pointer
    // events CSS blocks, and the disabled check Radix runs on select.
    fireEvent.click(screen.getByRole("menuitem", { name: "Clear all data" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("clears after the confirm, and closes the menu", async () => {
    const { clear } = renderActions(LOADED);
    openMenu();
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Clear all data..." })
    );
    fireEvent.click(await screen.findByRole("button", { name: "Clear" }));
    await vi.waitFor(() => expect(clear).toHaveBeenCalledOnce());
    // The dialog first: while it is up it hides the menu from the tree, so
    // the menu reads as closed whether it is or not.
    await vi.waitFor(() =>
      expect(screen.queryByRole("alertdialog")).toBeNull()
    );
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
