// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("#/components/program-select", () => ({
  ProgramSelect: () => null,
}));
// Renders a button rather than null, because a pending image is the only way
// to reach the upload-then-save ordering the tests below are about. Same shape
// as the inventory form's stub.
vi.mock("#/components/project-image-uploader", () => ({
  ProjectImageUploader: ({
    onChange,
  }: {
    onChange: (file: File | null) => void;
  }) => (
    <button
      onClick={() =>
        onChange(
          new File([new Uint8Array([1, 2, 3])], "x.webp", {
            type: "image/webp",
          })
        )
      }
      type="button"
    >
      pick image
    </button>
  ),
}));
vi.mock("#/server/project-review", () => ({
  reviewProject: vi.fn(),
}));
vi.mock("#/server/projects", () => ({
  createProject: vi.fn(),
  updateProject: vi.fn(),
}));
vi.mock("#/server/uploads", () => ({
  uploadProjectImage: vi.fn(),
}));

import { ProjectForm } from "#/components/project-form";
import { createProject, updateProject } from "#/server/projects";
import { uploadProjectImage } from "#/server/uploads";
import { installResizeObserver } from "./radix-jsdom";

const createMock = createProject as unknown as ReturnType<typeof vi.fn>;
const updateMock = updateProject as unknown as ReturnType<typeof vi.fn>;
const uploadMock = uploadProjectImage as unknown as ReturnType<typeof vi.fn>;

const PROJECT_ID = "00000000-0000-0000-0000-000000000001";

beforeAll(installResizeObserver);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function submit() {
  fireEvent.click(screen.getByRole("button", { name: /save|create/i }));
}

function fillTitle(value = "A project") {
  fireEvent.change(screen.getByLabelText("Title"), { target: { value } });
}

describe("ProjectForm create", () => {
  it("sends null, not an empty string, for a blank program and notes", async () => {
    // Both columns are nullable and "" is not the same as unset to a filter or
    // to `??`. Each route used to spell this coercion out for itself, which is
    // what let the two drift.
    createMock.mockResolvedValue({ id: PROJECT_ID });

    render(<ProjectForm showNotes submitLabel="Create draft" />);
    fillTitle();
    submit();

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    const sent = createMock.mock.calls[0][0].data;
    expect(sent.programId).toBeNull();
    expect(sent.notes).toBeNull();
  });

  it("uploads after create, then saves the key in a second write", async () => {
    // The subtlety #88 needed a throwaway integration probe to find. Create
    // cannot upload first, because the key is `projects/<id>/...`, so the
    // image needs a second write.
    createMock.mockResolvedValue({ id: PROJECT_ID });
    uploadMock.mockResolvedValue({ key: "projects/p/new.webp" });
    updateMock.mockResolvedValue({ id: PROJECT_ID, updated: true });

    render(<ProjectForm showNotes submitLabel="Create draft" />);
    fillTitle();
    fireEvent.click(screen.getByRole("button", { name: /pick image/i }));
    submit();

    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1));
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(uploadMock).toHaveBeenCalledTimes(1);
    const sent = updateMock.mock.calls[0][0].data;
    expect(sent.id).toBe(PROJECT_ID);
    expect(sent.imageUrl).toBe("projects/p/new.webp");
  });

  it("does not write the row when the upload fails", async () => {
    // Create writes the row first by necessity, so the failure it must not
    // swallow is the one on the image save, not on the create.
    createMock.mockResolvedValue({ id: PROJECT_ID });
    uploadMock.mockRejectedValue(new Error("Unsupported image type"));

    render(<ProjectForm showNotes submitLabel="Create draft" />);
    fillTitle();
    fireEvent.click(screen.getByRole("button", { name: /pick image/i }));
    submit();

    await waitFor(() =>
      expect(screen.getByText(/Unsupported image type/)).toBeTruthy()
    );
    expect(updateMock).not.toHaveBeenCalled();
  });
});

describe("ProjectForm edit", () => {
  it("calls updateProject with the id rather than creating", async () => {
    updateMock.mockResolvedValue({ id: PROJECT_ID, updated: true });

    render(
      <ProjectForm
        initial={{ title: "Old title" }}
        projectId={PROJECT_ID}
        showNotes
        submitLabel="Save"
      />
    );
    submit();

    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1));
    expect(createMock).not.toHaveBeenCalled();
    expect(updateMock.mock.calls[0][0].data.id).toBe(PROJECT_ID);
  });

  it("uploads before the row write, and does not write when it fails", async () => {
    // The ordering image-save.ts exists to make observable. A failed upload
    // must not leave the edit committed with the image change missing from
    // the edit log.
    uploadMock.mockRejectedValue(new Error("Unsupported image type"));

    render(
      <ProjectForm
        initial={{ title: "Old title" }}
        projectId={PROJECT_ID}
        showNotes
        submitLabel="Save"
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /pick image/i }));
    submit();

    await waitFor(() =>
      expect(screen.getByText(/Unsupported image type/)).toBeTruthy()
    );
    expect(uploadMock).toHaveBeenCalledTimes(1);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("saves the uploaded key as an ordinary field", async () => {
    uploadMock.mockResolvedValue({ key: "projects/p/new.webp" });
    updateMock.mockResolvedValue({ id: PROJECT_ID, updated: true });

    render(
      <ProjectForm
        initial={{ title: "Old title" }}
        projectId={PROJECT_ID}
        showNotes
        submitLabel="Save"
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /pick image/i }));
    submit();

    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1));
    expect(updateMock.mock.calls[0][0].data.imageUrl).toBe(
      "projects/p/new.webp"
    );
  });
});

describe("ProjectForm onSaved", () => {
  it("hands the route the created id, not the one it did not have", async () => {
    createMock.mockResolvedValue({ id: PROJECT_ID });
    const onSaved = vi.fn();

    render(
      <ProjectForm onSaved={onSaved} showNotes submitLabel="Create draft" />
    );
    fillTitle();
    submit();

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(PROJECT_ID));
  });

  it("is not called when the save throws", async () => {
    // Navigating away from a failed save would hide the error banner the form
    // just set.
    createMock.mockRejectedValue(new Error("Save failed"));
    const onSaved = vi.fn();

    render(
      <ProjectForm onSaved={onSaved} showNotes submitLabel="Create draft" />
    );
    fillTitle();
    submit();

    await waitFor(() => expect(screen.getByText(/Save failed/)).toBeTruthy());
    expect(onSaved).not.toHaveBeenCalled();
  });
});
