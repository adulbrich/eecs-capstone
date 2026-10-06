// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { clearCache, navigate } = vi.hoisted(() => ({
  clearCache: vi.fn(),
  navigate: vi.fn(),
}));

// Partial, as QUIRKS says a route module under test needs: the Start plugin
// injects its own router imports into the file.
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useNavigate: () => navigate,
  useRouter: () => ({ clearCache }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
vi.mock("#/server/projects-queries", () => ({ getProject: vi.fn() }));
// The form's own save is not under test; its button stands in for one that
// succeeded.
vi.mock("#/components/project-form", () => ({
  ProjectForm: ({ onSaved }: { onSaved: () => void }) => (
    <button onClick={onSaved} type="button">
      Save
    </button>
  ),
}));

import { Route } from "#/routes/_authed/projects/$projectId/edit";

const PROJECT_ID = "00000000-0000-4000-8000-000000000001";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  clearCache.mockReset();
  navigate.mockReset();
});

// `EditProject` is not exported, so this renders the route's component. The
// Start plugin splits it into a lazy chunk; `preload` loads that before the
// render rather than leaving the first test to wait out the import.
async function renderEditPage() {
  vi.spyOn(Route, "useLoaderData").mockReturnValue({
    project: {
      id: PROJECT_ID,
      title: "P",
      requiresNdaIp: false,
      teamsSupported: 1,
    },
  } as never);
  const EditProject = Route.options.component as (() => React.ReactNode) & {
    preload?: () => Promise<void>;
  };
  await EditProject.preload?.();
  render(<EditProject />);
}

// The project page keeps a hover preload for five minutes (#762), so a
// preload from before the save would otherwise be what the navigate shows.
describe("saving the edit form", () => {
  it("drops that project's cached page before navigating to it", async () => {
    await renderEditPage();
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));

    expect(clearCache).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith({
      to: "/projects/$projectId",
      params: { projectId: PROJECT_ID },
    });
    expect(clearCache.mock.invocationCallOrder[0]).toBeLessThan(
      navigate.mock.invocationCallOrder[0]
    );
  });

  it("matches only the project page's match for that project", async () => {
    await renderEditPage();
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));
    const { filter } = clearCache.mock.calls[0][0] as {
      filter: (match: {
        params: Record<string, string>;
        routeId: string;
      }) => boolean;
    };

    expect(
      filter({
        routeId: "/_public/projects/$projectId",
        params: { projectId: PROJECT_ID },
      })
    ).toBe(true);
    // The pathless layout's match carries the same params.
    expect(
      filter({ routeId: "/_public", params: { projectId: PROJECT_ID } })
    ).toBe(false);
    expect(
      filter({
        routeId: "/_public/projects/$projectId",
        params: { projectId: "00000000-0000-4000-8000-000000000002" },
      })
    ).toBe(false);
    expect(filter({ routeId: "/_public/projects/", params: {} })).toBe(false);
  });
});
