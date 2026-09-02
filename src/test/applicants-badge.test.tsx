// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ApplicantsBadge } from "#/components/applicants-badge";

afterEach(cleanup);

describe("ApplicantsBadge", () => {
  it("renders for a project that is not accepting applicants", () => {
    render(<ApplicantsBadge acceptingApplicants={false} />);
    expect(screen.getByText("Not accepting applicants")).toBeTruthy();
  });

  it("renders nothing for a project that is", () => {
    const { container } = render(<ApplicantsBadge acceptingApplicants />);
    expect(container.innerHTML).toBe("");
  });
});
