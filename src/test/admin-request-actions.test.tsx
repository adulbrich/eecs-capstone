// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AdminRequestActions } from "#/components/admin-request-actions";

afterEach(() => {
  cleanup();
});

describe("AdminRequestActions", () => {
  it("offers Approve and Reject for a pending line", () => {
    render(
      <AdminRequestActions
        lineId="line-1"
        onDone={() => undefined}
        status="pending"
      />
    );

    expect(screen.getByRole("button", { name: "Approve" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reject" })).toBeTruthy();
  });

  it("offers nothing once the line has been decided", () => {
    // Approving or rejecting is a one-way door: the queue must not offer a
    // second decision on a line that already has one.
    render(
      <AdminRequestActions
        lineId="line-1"
        onDone={() => undefined}
        status="approved"
      />
    );

    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reject" })).toBeNull();
  });
});
