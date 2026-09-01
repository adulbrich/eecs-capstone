import { describe, expect, it } from "vitest";
import { findUniqueViolation } from "../pg-errors";

const INDEX = "categories_domain_type_name_unique_idx";

function violation(constraint: string) {
  return Object.assign(new Error("duplicate key value"), {
    code: "23505",
    constraint,
  });
}

describe("findUniqueViolation", () => {
  it("finds the driver error one level down the cause chain", () => {
    const wrapped = new Error("Failed query: insert into categories", {
      cause: violation(INDEX),
    });
    expect(findUniqueViolation(wrapped, INDEX)?.constraint).toBe(INDEX);
  });

  it("returns the bare driver error when nothing wraps it", () => {
    expect(findUniqueViolation(violation(INDEX), INDEX)?.code).toBe("23505");
  });

  it("ignores a unique violation on a different constraint", () => {
    const wrapped = new Error("Failed query", {
      cause: violation("some_other_idx"),
    });
    expect(findUniqueViolation(wrapped, INDEX)).toBeUndefined();
  });

  it("ignores errors with no SQLSTATE and non-error values", () => {
    expect(findUniqueViolation(new Error("plain"), INDEX)).toBeUndefined();
    expect(findUniqueViolation("string", INDEX)).toBeUndefined();
    expect(findUniqueViolation(null, INDEX)).toBeUndefined();
  });
});
