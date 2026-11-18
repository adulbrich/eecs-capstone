// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EditLogList,
  type EditLogValuesSource,
} from "#/components/edit-log-list";
import { renderWithQueryClient } from "./shared/query-client";

afterEach(cleanup);

const ROWS = [
  {
    changedFields: ["title", "description"],
    createdAt: "2026-11-18T22:00:00Z",
    editorName: "Pat",
    id: "row-1",
  },
];

function source(load: EditLogValuesSource["load"]): EditLogValuesSource {
  return { load, queryKey: (id) => ["edit-log-values", id] };
}

describe("EditLogList", () => {
  it("names the fields and loads no values until a row is opened", () => {
    const load = vi.fn();
    renderWithQueryClient(<EditLogList rows={ROWS} values={source(load)} />);
    expect(screen.getByText("Changed: title, description")).toBeTruthy();
    expect(load).not.toHaveBeenCalled();
  });

  it("shows a row's old and new values when it is opened", async () => {
    const load = vi.fn(() =>
      Promise.resolve({
        changedFields: ["title", "description"],
        newValues: { description: "Line one\nLine two", title: "New title" },
        oldValues: { description: null, title: "Old title" },
      })
    );
    renderWithQueryClient(<EditLogList rows={ROWS} values={source(load)} />);

    const toggle = screen.getByRole("button", { name: "Show values" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);

    const list = (await screen.findByText("New title")).closest(
      "dl"
    ) as HTMLElement;
    expect(load).toHaveBeenCalledWith("row-1");
    expect(within(list).getByText("Title")).toBeTruthy();
    expect(within(list).getByText("Old title")).toBeTruthy();
    expect(within(list).getByText("New title")).toBeTruthy();
    expect(within(list).getByText("Description")).toBeTruthy();
    expect(within(list).getByText("(empty)")).toBeTruthy();
    expect(within(list).getByText(/Line one\s+Line two/u)).toBeTruthy();

    const hide = screen.getByRole("button", { name: "Hide values" });
    expect(hide.getAttribute("aria-expanded")).toBe("true");
    expect(hide.getAttribute("aria-controls")).toBe(list.id);
  });

  it("says so when a row's values cannot be loaded", async () => {
    const load = vi.fn(() => Promise.reject(new Error("Forbidden")));
    renderWithQueryClient(<EditLogList rows={ROWS} values={source(load)} />);
    fireEvent.click(screen.getByRole("button", { name: "Show values" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Forbidden");
  });

  it("offers no values without a source, as on the item panel", () => {
    renderWithQueryClient(<EditLogList rows={ROWS} />);
    expect(screen.queryByRole("button", { name: "Show values" })).toBeNull();
  });
});
