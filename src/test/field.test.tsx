// @vitest-environment jsdom
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Field, FieldError, FieldLabel } from "#/components/ui/field";
import { Input } from "#/components/ui/input";

afterEach(cleanup);

describe("Field", () => {
  it("associates the label with the input", () => {
    render(
      <Field>
        <FieldLabel htmlFor="email">Email</FieldLabel>
        <Input id="email" name="email" />
      </Field>
    );
    // The pairing the 6 placeholder-only inputs are missing.
    expect(screen.getByLabelText("Email")).toBeTruthy();
  });

  it("renders nothing when there are no errors", () => {
    const { container } = render(<FieldError errors={[]} />);
    expect(container.textContent).toBe("");
  });

  it("renders a bare string error", () => {
    render(<FieldError errors={["Required"]} />);
    expect(screen.getByText("Required")).toBeTruthy();
  });

  it("renders a Standard Schema issue object", () => {
    render(<FieldError errors={[{ message: "Too short" }]} />);
    expect(screen.getByText("Too short")).toBeTruthy();
  });

  // Ported from src/test/field-errors.test.tsx, which tested FieldErrors
  // directly. FieldError inherits that component's entire contract.
  it("renders a string entry", () => {
    render(<FieldError errors={["Title is required"]} />);
    expect(screen.getByText("Title is required")).toBeTruthy();
  });

  it("renders the message off an object entry", () => {
    // Standard Schema issues are objects, so this is the common path now that
    // the schema is passed to the validator directly.
    render(<FieldError errors={[{ message: "Must be a valid email" }]} />);
    expect(screen.getByText("Must be a valid email")).toBeTruthy();
  });

  it("joins a mixed array", () => {
    render(<FieldError errors={["first", { message: "second" }]} />);
    expect(screen.getByText("first, second")).toBeTruthy();
  });

  it("falls back to String() for an entry with no message", () => {
    render(<FieldError errors={[42]} />);
    expect(screen.getByText("42")).toBeTruthy();
  });
});

describe("every Input and Textarea", () => {
  it("has an id or an aria-label", () => {
    const offenders: string[] = [];
    for (const file of walk("src")) {
      if (file.includes("components/ui/") || file.includes("src/test/")) {
        continue;
      }
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(
        /<(Input|Textarea)\b([\s\S]*?)\/?>/g
      )) {
        if (!(/\bid=/.test(match[2]) || /aria-label/.test(match[2]))) {
          offenders.push(`${file}: <${match[1]}>`);
        }
      }
    }
    expect(
      offenders,
      "A placeholder is not a label: it disappears when the user types, and axe\n" +
        "will not report it. Give the control an id paired with a FieldLabel, or\n" +
        "an aria-label when there is no visible label.\n\n" +
        offenders.join("\n")
    ).toEqual([]);
  });
});

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return walk(full);
    }
    return full.endsWith(".tsx") ? [full] : [];
  });
}
