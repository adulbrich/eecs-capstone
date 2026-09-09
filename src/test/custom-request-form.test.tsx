// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CustomRequestForm,
  customRequestFormSchema,
} from "#/components/custom-request-form";
import { submitCustomRequest } from "#/server/inventory-custom";

vi.mock("#/server/inventory-custom", () => ({
  submitCustomRequest: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.mocked(submitCustomRequest).mockReset();
});

describe("customRequestFormSchema", () => {
  it("wants a name, a reason and a quantity of at least one", () => {
    const line = {
      name: "Thermal camera",
      reason: "Heat maps",
      quantity: 1,
      link: "",
    };
    expect(
      customRequestFormSchema.safeParse({ lines: [line], note: "" }).success
    ).toBe(true);
    expect(
      customRequestFormSchema.safeParse({
        lines: [{ ...line, quantity: 0 }],
        note: "",
      }).success
    ).toBe(false);
    expect(
      customRequestFormSchema.safeParse({
        lines: [{ ...line, reason: "" }],
        note: "",
      }).success
    ).toBe(false);
    expect(
      customRequestFormSchema.safeParse({ lines: [], note: "" }).success
    ).toBe(false);
  });
});

describe("CustomRequestForm", () => {
  it("seeds the first card from the search, adds a card, and submits every line", async () => {
    vi.mocked(submitCustomRequest).mockResolvedValue({
      requestId: "req-1",
      lineIds: ["a", "b"],
    });
    const onSubmitted = vi.fn();
    render(
      <CustomRequestForm
        initialName="Thermal camera"
        onSubmitted={onSubmitted}
      />
    );

    const firstName = screen.getByLabelText("Name") as HTMLInputElement;
    expect(firstName.value).toBe("Thermal camera");
    fireEvent.change(screen.getByLabelText("Why you need it"), {
      target: { value: "Heat maps for the greenhouse" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Add another thing" }));
    const names = screen.getAllByLabelText("Name");
    expect(names).toHaveLength(2);
    fireEvent.change(names[1], { target: { value: "Lidar" } });
    fireEvent.change(screen.getAllByLabelText("Why you need it")[1], {
      target: { value: "Mapping" },
    });
    fireEvent.change(screen.getAllByLabelText("Quantity")[1], {
      target: { value: "2" },
    });
    fireEvent.change(screen.getByLabelText("Note for staff (optional)"), {
      target: { value: "Same rig" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Submit request" }));

    await waitFor(() => expect(onSubmitted).toHaveBeenCalledWith("req-1"));
    expect(submitCustomRequest).toHaveBeenCalledWith({
      data: {
        lines: [
          {
            name: "Thermal camera",
            reason: "Heat maps for the greenhouse",
            quantity: 1,
            link: null,
          },
          { name: "Lidar", reason: "Mapping", quantity: 2, link: null },
        ],
        note: "Same rig",
      },
    });
  });

  it("removes a card, and never the last one", () => {
    render(<CustomRequestForm onSubmitted={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add another thing" }));
    expect(screen.getAllByLabelText("Name")).toHaveLength(2);
    fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[0]);
    expect(screen.getAllByLabelText("Name")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
  });

  it("refuses to submit an empty reason and shows the server's refusal", async () => {
    render(<CustomRequestForm initialName="Probe" onSubmitted={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Submit request" }));
    await waitFor(() =>
      expect(screen.getByText("Reason is required")).toBeDefined()
    );
    expect(submitCustomRequest).not.toHaveBeenCalled();

    vi.mocked(submitCustomRequest).mockRejectedValue(
      new Error("Sign in required")
    );
    fireEvent.change(screen.getByLabelText("Why you need it"), {
      target: { value: "Bench work" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit request" }));
    await waitFor(() =>
      expect(screen.getByText("Sign in required")).toBeDefined()
    );
  });
});
