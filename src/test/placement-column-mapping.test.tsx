// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// Radix Select reads a few DOM APIs jsdom omits. Same stub set as
// placement-download-as.test.tsx.
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

import { ColumnMappingEditor } from "#/components/placement/column-mapping";
import {
  type ColumnMapping,
  serializeMapping,
} from "#/lib/placement/plugins/custom-mapping";

afterEach(cleanup);

// The bids column mapping editor reading a file wide (#736). Invented names
// and example.edu addresses only (#648).

const FORM = [
  "Timestamp,Email Address,Rank the projects [Tide Clock],Rank the projects [Robot Arm],Rank the projects comments [Moon Base]",
  "2026-09-28 10:00,ada@example.edu,2,1,3",
].join("\n");

function editor(text = FORM) {
  const onApply = vi.fn();
  render(
    <ColumnMappingEditor
      dataset="bids"
      filename="form.csv"
      kept
      onApply={onApply}
      onCancel={vi.fn()}
      text={text}
    />
  );
  return onApply;
}

const choose = (column: string, header: string) => {
  fireEvent.keyDown(
    screen.getByRole("combobox", { name: `File column for ${column}` }),
    { key: "ArrowDown" }
  );
  fireEvent.click(screen.getByRole("option", { name: header }));
};

const radio = (name: string) =>
  fireEvent.click(screen.getByRole("radio", { name }));

const apply = () =>
  screen.getByRole("button", { name: "Apply column mapping" });

function readWide() {
  radio("One row per student, one column per project");
  choose("email", "Email Address");
  radio("The text inside the last square brackets");
}

describe("the bids column mapping editor, reading wide (#736)", () => {
  it("reads only the columns staff tick", () => {
    const onApply = editor();
    readWide();
    radio("The columns I tick");
    expect(apply()).toHaveProperty("disabled", true);
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Rank the projects [Robot Arm]" })
    );
    expect(screen.getByText("1 project column: Robot Arm (D).")).toBeTruthy();
    fireEvent.click(apply());
    expect(onApply).toHaveBeenCalledWith({
      version: 2,
      dataset: "bids",
      columns: { "Email Address": "email" },
      wide: {
        projectColumns: {
          by: "headers",
          headers: ["Rank the projects [Robot Arm]"],
        },
        title: { by: "brackets" },
      },
    });
  });

  it("keeps the wide settings while staff look at one row per bid", () => {
    editor();
    readWide();
    fireEvent.change(
      screen.getByLabelText("Project columns' headers start with"),
      { target: { value: "Rank the projects [" } }
    );
    radio("One row per bid");
    expect(
      screen.getByRole("combobox", { name: "File column for priority" })
    ).toBeTruthy();
    radio("One row per student, one column per project");
    expect(
      screen.getByLabelText<HTMLInputElement>(
        "Project columns' headers start with"
      ).value
    ).toBe("Rank the projects [");
    expect(screen.getByText(/^2 project columns:/)).toBeTruthy();
  });

  it("shows a column the prefix takes that staff may not have meant", () => {
    editor();
    readWide();
    fireEvent.change(
      screen.getByLabelText("Project columns' headers start with"),
      { target: { value: "Rank the projects" } }
    );
    expect(
      screen.getByText(
        "3 project columns: Tide Clock (C), Robot Arm (D), Moon Base (E)."
      )
    ).toBeTruthy();
    expect(screen.getByRole("table").textContent).toContain("Moon Base");
  });

  it("holds Apply for two columns that give one project, naming both", () => {
    editor("Mail,Pick1 [Tide Clock],Pick2 [tide clock]\nada@example.edu,1,2");
    radio("One row per student, one column per project");
    choose("email", "Mail");
    radio("The text inside the last square brackets");
    fireEvent.change(
      screen.getByLabelText("Project columns' headers start with"),
      { target: { value: "Pick" } }
    );
    expect(apply()).toHaveProperty("disabled", true);
    expect(
      screen.getByText(
        'Column C, "Pick2 [tide clock]", gives the same project as column B, "Pick1 [Tide Clock]"; tick or name one of them. Change the column mapping to apply it.'
      )
    ).toBeTruthy();
  });

  it("loads a version 2 column mapping file, wide reading and all", async () => {
    const onApply = editor();
    const saved: ColumnMapping = {
      version: 2,
      dataset: "bids",
      columns: { "Email Address": "email" },
      wide: {
        projectColumns: { by: "prefix", prefix: "Rank the projects [" },
        title: { by: "brackets" },
      },
    };
    fireEvent.change(screen.getByLabelText("Column mapping file"), {
      target: {
        files: [
          new File([serializeMapping(saved)], "form (column mapping).json", {
            type: "application/json",
          }),
        ],
      },
    });
    await waitFor(() =>
      expect(
        screen.getByRole("radio", {
          name: "One row per student, one column per project",
        })
      ).toHaveProperty("ariaChecked", "true")
    );
    expect(
      screen.getByText("2 project columns: Tide Clock (C), Robot Arm (D).")
    ).toBeTruthy();
    fireEvent.click(apply());
    expect(onApply).toHaveBeenCalledWith(saved);
  });
});
