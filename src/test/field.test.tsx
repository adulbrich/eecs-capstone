// @vitest-environment jsdom
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FieldError } from "#/components/ui/field";

afterEach(cleanup);

describe("FieldError", () => {
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

  // The `message` half, which the forty sites that used to write the paragraph
  // by hand pass instead of an array (#411).
  it("renders a message string", () => {
    render(<FieldError message="Could not save" />);
    expect(screen.getByText("Could not save")).toBeTruthy();
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["an empty string", ""],
  ])("renders nothing for %s, so a caller needs no guard", (_label, value) => {
    const { container } = render(<FieldError message={value} />);
    expect(container.textContent).toBe("");
  });

  // The reason the component exists at all: all but two of the hand-written
  // copies announced nothing.
  it("announces, whichever prop it was given", () => {
    const { unmount } = render(<FieldError message="Could not save" />);
    expect(screen.getByRole("alert").textContent).toBe("Could not save");
    unmount();

    render(<FieldError errors={["Required"]} />);
    expect(screen.getByRole("alert").textContent).toBe("Required");
  });

  // What a field's `aria-describedby` points at, as the sign-in code does.
  it("carries the id it was given", () => {
    render(<FieldError id="code-otp-error" message="Could not save" />);
    expect(screen.getByRole("alert").id).toBe("code-otp-error");
  });

  // An empty alert sitting in the DOM would announce on every later change,
  // which is why nothing renders rather than an empty paragraph.
  it("leaves no empty alert behind when there is nothing to say", () => {
    render(<FieldError message={null} />);
    expect(screen.queryByRole("alert")).toBeNull();
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
        "will not report it. Give the control an id paired with a Label, or\n" +
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
