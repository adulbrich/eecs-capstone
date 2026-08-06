// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("#/server/users", () => ({ searchUsers: vi.fn() }));

import { HolderField } from "#/components/holder-field";

afterEach(cleanup);

const noop = () => {
  // no-op
};

function renderField(overrides: Partial<Parameters<typeof HolderField>[0]>) {
  return render(
    <HolderField
      email=""
      label=""
      name=""
      onEmailChange={noop}
      onLabelChange={noop}
      onNameChange={noop}
      onProgramChange={noop}
      program=""
      {...overrides}
    />
  );
}

describe("HolderField", () => {
  it("asks for a label only when the email is blank", () => {
    renderField({});
    expect(screen.getByLabelText(/label/i)).toBeTruthy();
    expect(screen.queryByLabelText(/^name$/i)).toBeNull();
  });

  it("hides the label field once an address is typed", () => {
    renderField({ email: "someone@nowhere.test" });
    expect(screen.queryByLabelText(/label/i)).toBeNull();
  });

  it("offers name and program for an address with no account", () => {
    renderField({ email: "someone@nowhere.test" });
    expect(screen.getByLabelText(/^name$/i)).toBeTruthy();
    expect(screen.getByLabelText(/program/i)).toBeTruthy();
  });
});
