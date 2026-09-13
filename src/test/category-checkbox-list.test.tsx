// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CategoryCheckboxList } from "#/components/category-checkbox-list";

afterEach(cleanup);

const categories = [
  { id: "11111111-1111-4111-8111-111111111111", name: "Cameras" },
  { id: "22222222-2222-4222-8222-222222222222", name: "Drills" },
];

describe("CategoryCheckboxList", () => {
  it("renders a checkbox per category, checked according to selection", () => {
    const { getByLabelText } = render(
      <CategoryCheckboxList
        categories={categories}
        onChange={() => {}}
        selected={[categories[0].id]}
      />
    );
    expect(getByLabelText("Cameras").getAttribute("aria-checked")).toBe("true");
    expect(getByLabelText("Drills").getAttribute("aria-checked")).toBe("false");
  });

  it("toggles a category on and off through onChange", () => {
    const onChange = vi.fn();
    const { getByLabelText } = render(
      <CategoryCheckboxList
        categories={categories}
        onChange={onChange}
        selected={[categories[0].id]}
      />
    );
    fireEvent.click(getByLabelText("Drills"));
    expect(onChange).toHaveBeenCalledWith([categories[0].id, categories[1].id]);
    fireEvent.click(getByLabelText("Cameras"));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("renders nothing when there are no categories", () => {
    const { container } = render(
      <CategoryCheckboxList categories={[]} onChange={() => {}} selected={[]} />
    );
    expect(container.innerHTML).toBe("");
  });
});
