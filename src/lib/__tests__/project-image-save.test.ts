import { describe, expect, it, vi } from "vitest";
import { projectImageUrlToSave } from "../project-image-save";

function file() {
  return new File([new Uint8Array([1, 2, 3])], "x.webp", {
    type: "image/webp",
  });
}

describe("projectImageUrlToSave", () => {
  it("keeps the current key when the user did not touch the image", async () => {
    const upload = vi.fn();
    await expect(
      projectImageUrlToSave({
        currentImageUrl: "projects/p1/old.webp",
        pendingImage: null,
        projectId: "p1",
        upload,
      })
    ).resolves.toBe("projects/p1/old.webp");
    expect(upload).not.toHaveBeenCalled();
  });

  it("keeps the empty string when the user removed the image", async () => {
    // Remove clears the form field rather than sending a sentinel, so an empty
    // current value IS the removal, and it must not be confused for "unchanged".
    const upload = vi.fn();
    await expect(
      projectImageUrlToSave({
        currentImageUrl: "",
        pendingImage: null,
        projectId: "p1",
        upload,
      })
    ).resolves.toBe("");
    expect(upload).not.toHaveBeenCalled();
  });

  it("uploads the pending file and returns the key the save writes", async () => {
    const upload = vi.fn().mockResolvedValue({ key: "projects/p1/new.webp" });
    await expect(
      projectImageUrlToSave({
        currentImageUrl: "projects/p1/old.webp",
        pendingImage: file(),
        projectId: "p1",
        upload,
      })
    ).resolves.toBe("projects/p1/new.webp");

    const form = upload.mock.calls[0][0].data as FormData;
    expect(form.get("projectId")).toBe("p1");
    expect(form.get("file")).toBeInstanceOf(File);
  });

  it("rejects when the upload rejects, so no key reaches the save", async () => {
    // This is the half-save defect in #88 stated as a contract. The row write
    // consumes this function's result, so a rejection here means the write
    // cannot run, rather than running first and being contradicted.
    const upload = vi
      .fn()
      .mockRejectedValue(new Error("Unsupported image type"));
    await expect(
      projectImageUrlToSave({
        currentImageUrl: "projects/p1/old.webp",
        pendingImage: file(),
        projectId: "p1",
        upload,
      })
    ).rejects.toThrow(/Unsupported image type/);
  });
});
