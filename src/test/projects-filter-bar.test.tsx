// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  // `to` becomes the href so the anchor has the link role. `search` is
  // serialised by hand for the one link that carries it, so the assertion
  // below can see the return address without the real router.
  Link: ({
    children,
    search,
    to,
    ...rest
  }: {
    children: React.ReactNode;
    search?: Record<string, string>;
    to: string;
  } & Record<string, unknown>) => (
    <a
      href={search ? `${to}?${new URLSearchParams(search).toString()}` : to}
      {...rest}
    >
      {children}
    </a>
  ),
  useNavigate: () => vi.fn(),
}));

import { ProjectsSearchBar } from "#/components/projects-filter-bar";

afterEach(cleanup);

function renderBar(viewer: { canRecommend: boolean; signedIn: boolean }) {
  return render(
    <ProjectsSearchBar
      canRecommend={viewer.canRecommend}
      order="relevance"
      q=""
      signedIn={viewer.signedIn}
      view="card"
    />
  );
}

/**
 * The three states of the recommendation gate (#321). The disabled state of
 * the "Recommended for you" item is a Radix Select item that only mounts
 * once the select is open, which the browser suite covers; here the prompts
 * are what is pinned, since they decide where a reader is sent.
 */
describe("ProjectsSearchBar recommendation prompt", () => {
  it("sends a visitor to sign in, with the listing as the return address", () => {
    renderBar({ canRecommend: false, signedIn: false });
    const link = screen.getByRole("link", {
      name: "Sign in to get recommendations",
    });
    expect(link.getAttribute("href")).toBe("/sign-in?redirect=%2Fprojects");
    expect(
      screen.queryByRole("link", { name: "Add your interests" })
    ).toBeNull();
  });

  it("sends a member without interests to the profile", () => {
    renderBar({ canRecommend: false, signedIn: true });
    expect(
      screen
        .getByRole("link", { name: "Add your interests" })
        .getAttribute("href")
    ).toBe("/profile");
    expect(
      screen.queryByRole("link", { name: "Sign in to get recommendations" })
    ).toBeNull();
  });

  it("shows no prompt to a member who already has interests", () => {
    renderBar({ canRecommend: true, signedIn: true });
    expect(
      screen.queryByRole("link", { name: "Add your interests" })
    ).toBeNull();
    expect(
      screen.queryByRole("link", { name: "Sign in to get recommendations" })
    ).toBeNull();
  });
});
