// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import type * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SimilarProject } from "#/server/projects-queries";

let similar: SimilarProject[] = [];

vi.mock("#/server/projects-queries", () => ({
  getSimilarProjects: () => Promise.resolve(similar),
}));

// An href, so the anchor has the link role the queries below look for.
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    params,
    ...rest
  }: {
    children: React.ReactNode;
    to: string;
    params?: { projectId: string };
  } & Record<string, unknown>) => (
    <a href={to.replace("$projectId", params?.projectId ?? "")} {...rest}>
      {children}
    </a>
  ),
}));

import { SimilarProjectsLayout } from "#/components/similar-projects";

const ROWS: SimilarProject[] = [
  { id: "p1", title: "Drone mapping", excerpt: "Map the quad from above." },
  { id: "p2", title: "Rover telemetry", excerpt: "" },
];

afterEach(() => {
  cleanup();
  similar = [];
});

function renderLayout() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SimilarProjectsLayout projectId="viewed">
        <p>Project body</p>
      </SimilarProjectsLayout>
    </QueryClientProvider>
  );
}

describe("SimilarProjectsLayout", () => {
  // jsdom applies no Tailwind, so the xl aside and the floating card are both
  // in the tree here; CSS shows one per width. Each must carry the list.
  it("lists each similar project as a link, with its excerpt, in every form", async () => {
    similar = ROWS;
    const { findAllByRole } = renderLayout();

    const asides = await findAllByRole("complementary", {
      name: "Similar projects",
    });
    expect(asides.length).toBe(2);
    for (const aside of asides) {
      const links = within(aside).getAllByRole("link");
      expect(links.map((a) => a.getAttribute("href"))).toEqual([
        "/projects/p1",
        "/projects/p2",
      ]);
      expect(links[0].textContent).toContain("Drone mapping");
      expect(within(aside).getByText("Map the quad from above.")).toBeTruthy();
    }
  });
});

describe("SimilarProjectsLayout, empty", () => {
  it("renders the page and no list when nothing is similar", async () => {
    similar = [];
    const { findByText, queryByText, queryAllByRole } = renderLayout();

    await findByText("Project body");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(queryByText("Similar projects")).toBeNull();
    expect(queryAllByRole("button")).toEqual([]);
  });
});

describe("SimilarProjectsLayout, floating card", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("starts open and remembers a collapse on the next project page", async () => {
    similar = ROWS;
    const first = renderLayout();
    const hide = await first.findByRole("button", {
      name: "Hide similar projects",
    });
    expect(hide.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(hide);
    const pill = first.getByRole("button", { name: "Similar projects" });
    expect(pill.getAttribute("aria-expanded")).toBe("false");
    first.unmount();

    const second = renderLayout();
    await second.findByRole("button", { name: "Similar projects" });
    expect(
      second.queryByRole("button", { name: "Hide similar projects" })
    ).toBeNull();

    fireEvent.click(second.getByRole("button", { name: "Similar projects" }));
    expect(
      second.getByRole("button", { name: "Hide similar projects" })
    ).toBeTruthy();
  });

  it("stays open and still collapses when storage throws", async () => {
    similar = ROWS;
    const getItem = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("denied");
      });
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("denied");
      });
    try {
      const { findByRole, getByRole } = renderLayout();
      fireEvent.click(
        await findByRole("button", { name: "Hide similar projects" })
      );
      expect(getByRole("button", { name: "Similar projects" })).toBeTruthy();
    } finally {
      getItem.mockRestore();
      setItem.mockRestore();
    }
  });
});

describe("SimilarProjectsLayout, phone", () => {
  it("opens the list in a sheet from the icon button and closes it on a link", async () => {
    similar = ROWS;
    const { findByRole, getByRole, queryByRole } = renderLayout();

    const open = await findByRole("button", { name: "Open similar projects" });
    expect(open.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(open);

    const sheet = getByRole("dialog", { name: "Similar projects" });
    fireEvent.click(within(sheet).getByRole("link", { name: /Rover/ }));
    expect(queryByRole("dialog")).toBeNull();
  });
});
