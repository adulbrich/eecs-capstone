// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const { downloadText } = vi.hoisted(() => ({ downloadText: vi.fn() }));
vi.mock("#/lib/placement/download", () => ({ downloadText }));

// Radix Select reads a few DOM APIs jsdom omits. Same stub set as
// admin-user-email-skip.test.tsx.
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

import { DownloadAs } from "#/components/placement/download-as";

afterEach(() => {
  cleanup();
  downloadText.mockReset();
});

// Invented names only (#648).

function downloadAsCanvas(text: string) {
  render(
    <DownloadAs
      dataset="placement"
      filename="placement-2026-10-04.csv"
      text={() => text}
    >
      Download placement
    </DownloadAs>
  );
  fireEvent.keyDown(screen.getByRole("combobox", { name: "Download as" }), {
    key: "ArrowDown",
  });
  fireEvent.click(screen.getByRole("option", { name: "Canvas groups" }));
  fireEvent.click(screen.getByRole("button", { name: "Download placement" }));
}

describe("DownloadAs (#734)", () => {
  it("names the plugin's file, not the placement, when it cannot be written", () => {
    downloadAsCanvas("email,name\nada@example.edu,Ada Park");
    const problems = screen.getByRole("region", {
      name: "Problems in the Canvas groups file",
    });
    expect(problems.textContent).toContain(
      "The Canvas groups file was not written"
    );
    expect(downloadText).not.toHaveBeenCalled();
  });

  it("downloads a file with a warning, and shows the warning", () => {
    downloadAsCanvas(
      [
        "email,name,project,team",
        "ada@example.edu,Ada Park,Robot (Team 1),1",
        "kim@example.edu,Kim Lee,Robot,1",
        "lou@example.edu,Lou Ma,Robot,2",
      ].join("\n")
    );
    expect(downloadText).toHaveBeenCalledWith(
      "placement-2026-10-04 (Canvas groups).csv",
      expect.stringContaining("name,login_id,group_name"),
      "text/csv"
    );
    expect(
      screen.getByRole("region", { name: "Problems in the Canvas groups file" })
        .textContent
    ).toContain("1 warning");
  });
});
