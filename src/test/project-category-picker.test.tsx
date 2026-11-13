// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { useState } from "react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { ProjectCategoryPicker } from "#/components/project-category-picker";
import { installResizeObserver } from "./radix-jsdom";
import { renderWithQueryClient } from "./shared/query-client";

const listCategories = vi.hoisted(() => vi.fn());
vi.mock("#/server/categories", () => ({ listCategories }));

beforeAll(() => {
  installResizeObserver();
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn();
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});

const ROWS = [
  { id: "t-react", name: "React", type: "Technology", domain: "project" },
  { id: "f-web", name: "Web Development", type: "Field", domain: "project" },
  { id: "f-games", name: "Game Development", type: "Field", domain: "project" },
  { id: "k-new", name: "New Build", type: "Kind of work", domain: "project" },
];

beforeEach(() => {
  listCategories.mockReset();
  listCategories.mockResolvedValue({ rows: ROWS });
});

afterEach(cleanup);

/** The picker with its own state, as the section holds it. */
function Harness({ initial }: { initial: string[] }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <ProjectCategoryPicker onChange={setValue} value={value} />
      <output data-testid="value">{value.join(",")}</output>
    </>
  );
}

async function chips() {
  const list = await screen.findByRole("list", {
    name: "Categories on this project",
  });
  return within(list)
    .getAllByRole("listitem")
    .map((li) => li.textContent);
}

describe("ProjectCategoryPicker", () => {
  it("shows the project's categories as chips, Kind of work and Field first", async () => {
    renderWithQueryClient(<Harness initial={["t-react", "f-web", "k-new"]} />);

    expect(await chips()).toEqual([
      "Kind of workNew Build",
      "FieldWeb Development",
      "TechnologyReact",
    ]);
  });

  it("removes a category with its chip's button", async () => {
    renderWithQueryClient(<Harness initial={["t-react", "f-web"]} />);
    await chips();

    fireEvent.click(screen.getByRole("button", { name: "Remove React" }));

    expect(screen.getByTestId("value").textContent).toBe("f-web");
    expect(document.activeElement).toBe(
      screen.getByRole("combobox", { name: "Add a category" })
    );
  });

  it("shows an id the list no longer has, so it can be removed", async () => {
    renderWithQueryClient(<Harness initial={["f-web", "gone"]} />);

    expect(await chips()).toContain("Unknown category");
    fireEvent.click(
      screen.getByRole("button", { name: "Remove Unknown category" })
    );
    expect(screen.getByTestId("value").textContent).toBe("f-web");
  });

  it("adds from a search that lists only the categories not yet chosen", async () => {
    renderWithQueryClient(<Harness initial={["f-web"]} />);
    await chips();
    const add = screen.getByRole("combobox", { name: "Add a category" });
    await vi.waitFor(() => expect(add.hasAttribute("disabled")).toBe(false));

    fireEvent.click(add);
    const options = (await screen.findAllByRole("option")).map(
      (o) => o.textContent
    );
    expect(options).toEqual(["New Build", "Game Development", "React"]);

    fireEvent.click(screen.getByRole("option", { name: "Game Development" }));
    expect(screen.getByTestId("value").textContent).toBe("f-web,f-games");
  });

  it("matches the search as a substring of the name or type", async () => {
    renderWithQueryClient(<Harness initial={[]} />);
    await screen.findByText("No categories on this project yet.");
    const add = screen.getByRole("combobox", { name: "Add a category" });
    await vi.waitFor(() => expect(add.hasAttribute("disabled")).toBe(false));
    fireEvent.click(add);
    const box = screen.getByPlaceholderText("Search categories");

    fireEvent.change(box, { target: { value: "ga" } });
    expect(
      (await screen.findAllByRole("option")).map((o) => o.textContent)
    ).toEqual(["Game Development"]);

    fireEvent.change(box, { target: { value: "field" } });
    expect(
      (await screen.findAllByRole("option")).map((o) => o.textContent)
    ).toEqual(["Game Development", "Web Development"]);
  });

  it("offers no way to create a category", async () => {
    renderWithQueryClient(<Harness initial={[]} />);
    expect(
      await screen.findByText("No categories on this project yet.")
    ).toBeTruthy();
    const add = screen.getByRole("combobox", { name: "Add a category" });
    await vi.waitFor(() => expect(add.hasAttribute("disabled")).toBe(false));
    fireEvent.click(add);
    fireEvent.change(screen.getByPlaceholderText("Search categories"), {
      target: { value: "Bioacoustics" },
    });

    expect(await screen.findByText("No category matches.")).toBeTruthy();
    expect(screen.queryByText(/Create/u)).toBeNull();
  });
});
