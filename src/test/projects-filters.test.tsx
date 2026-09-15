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

import {
  countActiveFilters,
  PROJECT_SWITCH_LABEL,
  RecommendationPrompt,
} from "#/components/projects-filters";

afterEach(cleanup);

function renderPrompt(viewer: { canRecommend: boolean; signedIn: boolean }) {
  return render(
    <RecommendationPrompt
      canRecommend={viewer.canRecommend}
      order="relevance"
      signedIn={viewer.signedIn}
    />
  );
}

/**
 * The three states of the recommendation gate (#321). The disabled state of
 * the "Recommended for you" item is a Radix Select item that only mounts
 * once the select is open, which the browser suite covers; here the prompts
 * are what is pinned, since they decide where a reader is sent.
 */
describe("RecommendationPrompt", () => {
  it("sends a visitor to sign in, with the listing as the return address", () => {
    renderPrompt({ canRecommend: false, signedIn: false });
    const link = screen.getByRole("link", {
      name: "Sign in to get recommendations",
    });
    expect(link.getAttribute("href")).toBe("/sign-in?redirect=%2Fprojects");
    expect(
      screen.queryByRole("link", { name: "Add your interests" })
    ).toBeNull();
  });

  it("sends a member without interests to the profile", () => {
    renderPrompt({ canRecommend: false, signedIn: true });
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
    renderPrompt({ canRecommend: true, signedIn: true });
    expect(
      screen.queryByRole("link", { name: "Add your interests" })
    ).toBeNull();
    expect(
      screen.queryByRole("link", { name: "Sign in to get recommendations" })
    ).toBeNull();
  });
});

describe("the switch labels and the active count", () => {
  it("counts the agreement switch with the other narrowing switches", () => {
    const off = {
      acceptingOnly: false,
      archivedOnly: false,
      categories: [],
      noMentorNeededOnly: false,
      program: null,
      requiresNdaOnly: false,
      seekingMentorOnly: false,
      studentProposedOnly: false,
    };
    expect(countActiveFilters(off)).toBe(0);
    expect(countActiveFilters({ ...off, requiresNdaOnly: true })).toBe(1);
    expect(countActiveFilters({ ...off, noMentorNeededOnly: true })).toBe(1);
  });

  it("completes the legend with one line per switch, the student one matching its badge", () => {
    expect(PROJECT_SWITCH_LABEL.requiresNdaOnly).toBe(
      "Requiring an NDA or IP agreement"
    );
    expect(PROJECT_SWITCH_LABEL.noMentorNeededOnly).toBe(
      "Run without a mentor"
    );
    // One string for the filter and the badge (#372).
    expect(PROJECT_SWITCH_LABEL.studentProposedOnly).toBe("Student proposed");
  });
});
