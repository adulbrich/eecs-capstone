// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// Stub the heavy child components and the server function.
vi.mock("#/components/program-select", () => ({
  ProgramSelect: () => null,
}));
vi.mock("#/components/category-multi-select", () => ({
  CategoryMultiSelect: () => null,
}));
vi.mock("#/components/project-image-uploader", () => ({
  ProjectImageUploader: () => null,
}));
vi.mock("#/server/project-review", () => ({
  reviewProject: vi.fn(),
}));

import { ProjectForm } from "#/components/project-form";
import { reviewProject } from "#/server/project-review";
import { installResizeObserver } from "./radix-jsdom";

const mockedReview = vi.mocked(reviewProject);

beforeAll(installResizeObserver);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderForm() {
  return render(
    <ProjectForm
      enableAiReview
      initial={{ title: "Old title", description: "Old description" }}
      onSubmit={vi.fn()}
      projectId="00000000-0000-0000-0000-000000000001"
      showCategories={false}
      showNotes={false}
      submitLabel="Save"
    />
  );
}

describe("ProjectForm AI review", () => {
  it("applies a single field suggestion into the form field", async () => {
    mockedReview.mockResolvedValue({
      suggestions: {
        description: {
          suggestion: "Improved description.",
          rationale: "clearer",
        },
      },
      model: "test-model",
      reviewedFields: ["description"],
    } as never);

    const { getByText, findByText, getByLabelText } = renderForm();
    fireEvent.click(getByText("Review with AI"));

    await findByText("Improved description.");
    fireEvent.click(getByText("Apply"));

    await waitFor(() => {
      expect((getByLabelText("Description") as HTMLTextAreaElement).value).toBe(
        "Improved description."
      );
    });
  });

  it("applies all suggestions at once", async () => {
    mockedReview.mockResolvedValue({
      suggestions: {
        title: { suggestion: "New Title", rationale: "punchier" },
        description: { suggestion: "New Description", rationale: "clearer" },
      },
      model: "test-model",
      reviewedFields: ["title", "description"],
    } as never);

    const { getByText, findByText, getByLabelText } = renderForm();
    fireEvent.click(getByText("Review with AI"));
    await findByText("Apply all");
    fireEvent.click(getByText("Apply all"));

    await waitFor(() => {
      expect((getByLabelText("Title") as HTMLInputElement).value).toBe(
        "New Title"
      );
      expect((getByLabelText("Description") as HTMLTextAreaElement).value).toBe(
        "New Description"
      );
    });
  });

  it("shows an empty state when no improvements are suggested", async () => {
    mockedReview.mockResolvedValue({
      suggestions: {},
      model: "test-model",
      reviewedFields: [],
    } as never);

    const { getByText, findByText } = renderForm();
    fireEvent.click(getByText("Review with AI"));
    await findByText("No improvements suggested.");
  });

  it("shows an error and re-enables the button when the review fails", async () => {
    mockedReview.mockRejectedValue(new Error("Bedrock unavailable"));

    const { getByText, findByText } = renderForm();
    fireEvent.click(getByText("Review with AI"));

    await findByText("Bedrock unavailable");
    expect((getByText("Review with AI") as HTMLButtonElement).disabled).toBe(
      false
    );
  });
});

describe("ProjectForm AI review without a project", () => {
  function renderNewProjectForm(initial?: Record<string, string>) {
    return render(
      <ProjectForm
        enableAiReview
        {...(initial ? { initial } : {})}
        onSubmit={vi.fn()}
        showCategories={false}
        showNotes={false}
        submitLabel="Create draft"
      />
    );
  }

  it("offers the review on the submission page, where there is no projectId", () => {
    const { getByText } = renderNewProjectForm({ title: "Something" });
    expect(getByText("Improve with AI")).toBeTruthy();
  });

  it("omits projectId from the request when the project does not exist yet", async () => {
    mockedReview.mockResolvedValue({
      suggestions: { title: { suggestion: "Sharper", rationale: "punchier" } },
      model: "m",
      reviewedFields: ["title"],
    });
    const { getByRole } = renderNewProjectForm({ title: "Something" });

    fireEvent.click(getByRole("button", { name: "Review with AI" }));

    await waitFor(() => expect(mockedReview).toHaveBeenCalled());
    const sent = mockedReview.mock.calls[0][0] as {
      data: { projectId?: string };
    };
    // Sending an undefined projectId would fail the uuid validator; the key
    // has to be absent, not empty.
    expect("projectId" in sent.data).toBe(false);
  });

  it("disables the button on an empty form, since a blank review is free but useless", () => {
    const { getByRole } = renderNewProjectForm();
    expect(
      (getByRole("button", { name: "Review with AI" }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
  });

  it("enables the button once a reviewable field has content", async () => {
    const { getByRole, getByLabelText } = renderNewProjectForm();
    const button = getByRole("button", {
      name: "Review with AI",
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    fireEvent.change(getByLabelText(/Title/), {
      target: { value: "A real title" },
    });

    await waitFor(() => expect(button.disabled).toBe(false));
  });
});
