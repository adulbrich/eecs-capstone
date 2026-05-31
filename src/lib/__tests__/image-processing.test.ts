import { readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { processImage } from "../_internal/image-processing";

const fixture = readFileSync(
  path.join(import.meta.dirname, "fixtures", "sample.jpg")
);

describe("processImage", () => {
  it("returns a webp buffer no larger than the max dimensions", async () => {
    const result = await processImage(fixture, {
      maxWidth: 100,
      maxHeight: 100,
    });
    expect(result.contentType).toBe("image/webp");
    expect(result.buffer.length).toBeGreaterThan(0);
    expect(result.width).toBeLessThanOrEqual(100);
    expect(result.height).toBeLessThanOrEqual(100);
  });

  it("preserves the input aspect ratio (fit: inside)", async () => {
    const result = await processImage(fixture, {
      maxWidth: 50,
      maxHeight: 100,
    });
    expect(result.width).toBe(50);
    expect(result.height).toBe(50);
  });

  it("does not enlarge images smaller than the max", async () => {
    const result = await processImage(fixture, {
      maxWidth: 5000,
      maxHeight: 5000,
    });
    expect(result.width).toBe(200);
    expect(result.height).toBe(200);
  });

  it("strips EXIF metadata from the output", async () => {
    // Build a JPEG with EXIF orientation tagged on it.
    const withExif = await sharp({
      create: {
        width: 200,
        height: 200,
        channels: 3,
        background: { r: 0, g: 128, b: 255 },
      },
    })
      .withExif({ IFD0: { Orientation: "1" } })
      .jpeg()
      .toBuffer();

    // Sanity: the input fixture actually has EXIF metadata.
    const inputMeta = await sharp(withExif).metadata();
    expect(inputMeta.exif).toBeTruthy();

    const result = await processImage(withExif, {
      maxWidth: 100,
      maxHeight: 100,
    });
    const outMeta = await sharp(result.buffer).metadata();
    expect(outMeta.exif).toBeUndefined();
  });
});
