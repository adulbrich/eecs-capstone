import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { processImage } from "../_internal/image-processing";

const fixture = readFileSync(path.join(__dirname, "fixtures", "sample.jpg"));

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
});
