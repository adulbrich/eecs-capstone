import { describe, expect, it } from "vitest";
import {
  assertOwnedKey,
  avatarKeys,
  inventoryImageKeys,
  projectImageKeys,
} from "#/lib/_internal/storage";

const spaces = [
  { build: projectImageKeys, name: "projectImageKeys" },
  { build: inventoryImageKeys, name: "inventoryImageKeys" },
  { build: avatarKeys, name: "avatarKeys" },
] as const;

describe("KeySpace", () => {
  // The invariant `KeySpace`'s own doc comment leans on. Nothing else asserts
  // it, and a builder that started minting a subpath (a thumbnail, say) would
  // silently turn `deleteOwnedObject` into the permanent no-op that comment
  // warns about, with every integration test still green.
  for (const { build, name } of spaces) {
    it(`${name} owns what it mints`, () => {
      const space = build("row-1");
      expect(space.owns(space.newKey())).toBe(true);
    });
  }

  it("owns one plain filename under its prefix, not only what newKey mints", () => {
    // Looser than `<uuid>.webp` on purpose: a key naming nothing in the bucket
    // is a broken image, not a leak. Still one segment and one dot, which is
    // what makes the traversal case below fail.
    const space = projectImageKeys("p1");
    expect(space.owns("projects/p1/x.webp")).toBe(true);
    expect(space.owns("projects/p1/Photo.PNG")).toBe(true);
    expect(space.owns("projects/p1/IMG_1-2.jpeg")).toBe(true);
    expect(space.owns("projects/p1/my.photo.webp")).toBe(false);
    expect(space.owns("projects/p1/noextension")).toBe(false);
  });

  it("disowns another row's prefix, a traversal, and an absolute URL", () => {
    const space = projectImageKeys("p1");
    expect(space.owns("projects/p2/x.webp")).toBe(false);
    expect(space.owns("projects/p1/../p2/x.webp")).toBe(false);
    expect(space.owns("projects/p1/sub/x.webp")).toBe(false);
    expect(space.owns("https://example.com/x.png")).toBe(false);
  });

  it("disowns a prefix it merely starts with", () => {
    // `projects/p1` is a prefix of `projects/p10/`, and the trailing slash the
    // builder appends is what keeps the two apart.
    expect(projectImageKeys("p1").owns("projects/p10/x.webp")).toBe(false);
  });
});

describe("assertOwnedKey", () => {
  it("allows empty, because clearing an image is an ordinary edit", () => {
    const space = projectImageKeys("p1");
    expect(() => assertOwnedKey(null, space)).not.toThrow();
    expect(() => assertOwnedKey("", space)).not.toThrow();
    expect(() => assertOwnedKey(undefined, space)).not.toThrow();
  });

  it("refuses anything the space does not own", () => {
    const space = projectImageKeys("p1");
    expect(() => assertOwnedKey("https://example.com/x.png", space)).toThrow(
      "Invalid image"
    );
    expect(() => assertOwnedKey("projects/p2/x.webp", space)).toThrow(
      "Invalid image"
    );
  });
});
