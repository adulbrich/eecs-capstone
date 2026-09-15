import { describe, expect, it } from "vitest";
import {
  PRIVATE_NOTES_FIELD_LABEL,
  PRIVATE_NOTES_LABEL,
} from "#/lib/private-notes";
import {
  FIELD_HEADINGS,
  FIELD_LABELS,
  IMPROVABLE_FIELDS,
} from "#/lib/project-review-fields";

/**
 * A form label and the page heading for the same field are the same words in
 * two cases (#375). Pinned here because each pair is two hand-written
 * constants: a case transform would lowercase "IP" and "NDA".
 */
describe("field labels and headings", () => {
  it("name every improvable field with the same words on the form and on the page", () => {
    for (const field of IMPROVABLE_FIELDS) {
      const label = FIELD_LABELS[field].toLowerCase();
      const heading = FIELD_HEADINGS[field].toLowerCase();
      // The agreement heading covers the flag as well as the prose, so it
      // drops the trailing "notes" the field label carries.
      const expected =
        field === "licenseRestrictions" ? `${heading} notes` : heading;
      expect(label).toBe(expected);
    }
  });

  it("name private notes with the same words on the form and in the panel", () => {
    expect(PRIVATE_NOTES_FIELD_LABEL.toLowerCase()).toBe(
      PRIVATE_NOTES_LABEL.toLowerCase()
    );
  });

  it("start every word of a form label with a capital", () => {
    for (const label of [
      ...Object.values(FIELD_LABELS),
      PRIVATE_NOTES_FIELD_LABEL,
    ]) {
      for (const word of label.split(" ")) {
        if (word === "/") {
          continue;
        }
        expect(word[0]).toBe(word[0].toUpperCase());
      }
    }
  });

  it("start a heading with a capital and keep the rest lower, acronyms aside", () => {
    for (const heading of [
      ...Object.values(FIELD_HEADINGS),
      PRIVATE_NOTES_LABEL,
    ]) {
      const [first, ...rest] = heading.split(" ");
      expect(first[0]).toBe(first[0].toUpperCase());
      for (const word of rest) {
        // "IP" and "NDA" stay upper; any other word is lower.
        if (word !== word.toUpperCase()) {
          expect(word).toBe(word.toLowerCase());
        }
      }
    }
  });
});
