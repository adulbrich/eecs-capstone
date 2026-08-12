// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FieldErrors } from "#/components/field-errors";

afterEach(cleanup);

describe("FieldErrors", () => {
  it("renders a string entry", () => {
    const { getByText } = render(
      <FieldErrors errors={["Title is required"]} />
    );
    expect(getByText("Title is required")).toBeTruthy();
  });

  it("renders the message off an object entry", () => {
    // Standard Schema issues are objects, so this is the common path now that
    // the schema is passed to the validator directly.
    const { getByText } = render(
      <FieldErrors errors={[{ message: "Must be a valid email" }]} />
    );
    expect(getByText("Must be a valid email")).toBeTruthy();
  });

  it("joins a mixed array", () => {
    const { getByText } = render(
      <FieldErrors errors={["first", { message: "second" }]} />
    );
    expect(getByText("first, second")).toBeTruthy();
  });

  it("renders nothing when there are no errors", () => {
    const { container } = render(<FieldErrors errors={[]} />);
    expect(container.textContent).toBe("");
  });

  it("falls back to String() for an entry with no message", () => {
    const { getByText } = render(<FieldErrors errors={[42]} />);
    expect(getByText("42")).toBeTruthy();
  });
});
