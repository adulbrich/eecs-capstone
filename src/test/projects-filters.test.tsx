// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }));

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
  useNavigate: () => navigate,
}));

// Radix's RadioGroup and Switch measure themselves on mount; jsdom ships no
// ResizeObserver.
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

import {
  ARCHIVE_MODE_HINT,
  countActiveFilters,
  PROJECT_SWITCH_HINT,
  PROJECT_SWITCH_LABEL,
  PROJECT_SWITCH_LEGEND,
  PROJECTS_FILTER_DEFAULTS,
  ProjectsFilters,
  RecommendationPrompt,
} from "#/components/projects-filters";

afterEach(() => {
  cleanup();
  navigate.mockReset();
});

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
  it("counts a switch against its default, not against false", () => {
    // `acceptingOnly` defaults on (#419), so an untouched listing counts zero
    // and must not offer a Clear that would change nothing. Turning it off is
    // a departure from the default and does count, because that is what Clear
    // puts back.
    const untouched = {
      ...PROJECTS_FILTER_DEFAULTS,
      categories: [],
      program: null,
    };
    expect(countActiveFilters(untouched)).toBe(0);
    expect(countActiveFilters({ ...untouched, requiresNdaOnly: true })).toBe(1);
    expect(countActiveFilters({ ...untouched, acceptingOnly: false })).toBe(1);
  });

  it("completes the legend with one predicate per switch, lowercase", () => {
    // Legend plus label read as one sentence (#383): "Only show projects
    // that are looking for team members". Three switches since #402 and #383:
    // nothing about mentorship is public, and archive is a mode, not a
    // switch.
    expect(PROJECT_SWITCH_LEGEND).toBe("Only show projects that");
    expect(PROJECT_SWITCH_LABEL).toEqual({
      acceptingOnly: "are looking for team members",
      requiresNdaOnly: "require an NDA or IP agreement",
      studentProposedOnly: "were proposed by a student",
    });
    for (const label of Object.values(PROJECT_SWITCH_LABEL)) {
      expect(label[0]).toBe(label[0]?.toLowerCase());
    }
    // The one hint, and it says what the other position does, because this
    // switch is the only one that starts on.
    expect(PROJECT_SWITCH_HINT).toEqual({
      acceptingOnly: "Turn off to also show projects whose team is full.",
    });
    for (const text of Object.values(PROJECT_SWITCH_HINT)) {
      expect(text).not.toMatch(/applicant/i);
    }
  });
});

function renderFilters(
  overrides: Partial<Parameters<typeof ProjectsFilters>[0]> = {}
) {
  return render(
    <ProjectsFilters
      acceptingOnly={false}
      allCategories={[]}
      allPrograms={[]}
      archivedOnly={false}
      categories={[]}
      program={null}
      requiresNdaOnly={false}
      studentProposedOnly={false}
      {...overrides}
    />
  );
}

describe("ProjectsFilters archive mode and hints", () => {
  it("offers Current and Archived as a radio above the switches, with the hint", () => {
    renderFilters();
    const group = screen.getByRole("radiogroup", { name: "Show" });
    expect(
      screen
        .getByRole("radio", { name: "Current projects" })
        .getAttribute("aria-checked")
    ).toBe("true");
    expect(
      screen
        .getByRole("radio", { name: "Archived projects" })
        .getAttribute("aria-checked")
    ).toBe("false");
    expect(
      document.getElementById(group.getAttribute("aria-describedby") ?? "")
        ?.textContent
    ).toBe(ARCHIVE_MODE_HINT);
    // No Archived switch under the legend any more.
    expect(screen.queryByRole("switch", { name: /archived/i })).toBeNull();
    // The radio's fieldset comes before the switches' fieldset.
    const [first, second] = Array.from(document.querySelectorAll("fieldset"));
    expect(first?.contains(group)).toBe(true);
    expect(second?.textContent).toContain(PROJECT_SWITCH_LEGEND);
  });

  it("maps the radio onto archivedOnly, so pasted links keep working", () => {
    renderFilters();
    fireEvent.click(screen.getByRole("radio", { name: "Archived projects" }));
    expect(navigate).toHaveBeenCalledTimes(1);
    const reducer = navigate.mock.calls[0]?.[0].search;
    expect(reducer({ q: "", page: 3 })).toEqual({
      q: "",
      archivedOnly: true,
      page: 1,
    });
    cleanup();
    renderFilters({ archivedOnly: true });
    expect(
      screen
        .getByRole("radio", { name: "Archived projects" })
        .getAttribute("aria-checked")
    ).toBe("true");
  });

  it("counts the archive mode as a filter and Clear all returns it to current", () => {
    expect(
      countActiveFilters({
        ...PROJECTS_FILTER_DEFAULTS,
        archivedOnly: true,
        categories: [],
        program: null,
      })
    ).toBe(1);
    renderFilters({ archivedOnly: true });
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    const reducer = navigate.mock.calls[0]?.[0].search;
    const cleared = reducer({ archivedOnly: true, acceptingOnly: false });
    expect(cleared.archivedOnly).toBe(false);
    // Clear puts the openings switch back on, which is where it starts.
    expect(cleared.acceptingOnly).toBe(true);
  });

  it("describes the accepting switch by its hint", () => {
    renderFilters();
    const control = screen.getByRole("switch", {
      name: PROJECT_SWITCH_LABEL.acceptingOnly,
    });
    expect(
      document.getElementById(control.getAttribute("aria-describedby") ?? "")
        ?.textContent
    ).toBe(PROJECT_SWITCH_HINT.acceptingOnly);
    expect(
      screen
        .getByRole("switch", { name: PROJECT_SWITCH_LABEL.requiresNdaOnly })
        .getAttribute("aria-describedby")
    ).toBeNull();
  });
});
