import { describe, expect, it } from "vitest";
import { assertStaff, isStaff, type Viewer } from "../viewer";

const admin: Viewer = { id: "u-admin", role: "admin" };
const instructor: Viewer = { id: "u-inst", role: "instructor" };
const student: Viewer = { id: "u-user", role: "user" };
const roleless: Viewer = { id: "u-none", role: null };
const anon: Viewer = null;

describe("isStaff", () => {
  it("is true for admin and instructor", () => {
    expect(isStaff(admin)).toBe(true);
    expect(isStaff(instructor)).toBe(true);
  });

  it("is false for a student, a roleless account and anonymous", () => {
    expect(isStaff(student)).toBe(false);
    expect(isStaff(roleless)).toBe(false);
    expect(isStaff(anon)).toBe(false);
  });

  it("is false for an unrecognized role", () => {
    // Fails closed. A role added to the database without being added here
    // must not inherit staff powers by default.
    expect(isStaff({ id: "u-x", role: "mentor" })).toBe(false);
  });
});

describe("assertStaff", () => {
  it("passes staff through", () => {
    expect(() => assertStaff(admin)).not.toThrow();
    expect(() => assertStaff(instructor)).not.toThrow();
  });

  it("throws Forbidden for everyone else", () => {
    expect(() => assertStaff(student)).toThrow(/Forbidden/);
    expect(() => assertStaff(anon)).toThrow(/Forbidden/);
  });

  it("narrows the viewer to non-null", () => {
    // The narrowing is load-bearing: call sites read viewer.id straight after
    // asserting, without a second null check.
    const viewer: Viewer = admin;
    assertStaff(viewer);
    const id: string = viewer.id;
    expect(id).toBe("u-admin");
  });
});
