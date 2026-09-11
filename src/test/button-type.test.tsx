// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "#/components/ui/button";

/**
 * The rule lives in the types, so this file is checked by `npm run typecheck`
 * before it is run: an `@ts-expect-error` with nothing to expect is itself a
 * compile error, which is what fails the build if a shadcn resync of
 * `button.tsx` ever drops the required `type` again (#305, #307).
 */
describe("Button requires a type", () => {
  it("renders the type it is given", () => {
    const { container } = render(<Button type="button">Act</Button>);
    expect(container.querySelector("button")?.type).toBe("button");
  });

  it("rejects a rendered button with no type", () => {
    // @ts-expect-error type is required when the Button renders a <button>
    const element = <Button>Act</Button>;
    expect(element).toBeDefined();
  });

  it("rejects a type on an asChild button", () => {
    const element = (
      // @ts-expect-error asChild renders the child, which takes no type
      <Button asChild type="button">
        <a href="/">Go</a>
      </Button>
    );
    expect(element).toBeDefined();
  });
});
