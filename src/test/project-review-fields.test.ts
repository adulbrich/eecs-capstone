import { describe, expect, it } from "vitest";
import {
  FIELD_HEADINGS,
  FIELD_LABELS,
  IMPROVABLE_FIELDS,
} from "#/lib/project-review-fields";

/**
 * The form label and the project page heading are the same words in two
 * cases (#375). Pinned here because they are two hand-written constants: a
 * case transform would lowercase "IP" and "NDA".
 */
describe("FIELD_LABELS and FIELD_HEADINGS", () => {
  it("name every improvable field with the same words, Title Case on the form and sentence case on the page", () => {
    for (const field of IMPROVABLE_FIELDS) {
      const label = FIELD_LABELS[field].toLowerCase();
      const heading = FIELD_HEADINGS[field].toLowerCase();
      // The agreement heading covers the flag as well as the prose, so it
      // drops the trailing "notes" the field label carries.
      const expected =
        field === "licenseRestrictions" ? `${heading} notes` : heading;
      expect(label).toBe(expected);
      expect(FIELD_HEADINGS[field]).toBe(
        FIELD_HEADINGS[field][0] +
          FIELD_HEADINGS[field]
            .slice(1)
            .replace(/\b[A-Z][a-z]+/g, (w) => w.toLowerCase())
      );
    }
  });

  it("uses Title Case on the form: every word longer than a preposition starts upper", () => {
    for (const field of IMPROVABLE_FIELDS) {
      for (const word of FIELD_LABELS[field].split(" ")) {
        if (word === "/") {
          continue;
        }
        expect(word[0]).toBe(word[0].toUpperCase());
      }
    }
  });
});
