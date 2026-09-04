import { describe, expect, it } from "vitest";
import {
  assertAdmin,
  assertStaff,
  isAdmin,
  isStaff,
  type Viewer,
} from "../viewer";

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

describe("isAdmin", () => {
  it("is true for admin only", () => {
    expect(isAdmin(admin)).toBe(true);
  });

  it("is false for an instructor, who is staff but not admin", () => {
    // The whole reason this predicate exists beside isStaff. Widening the two
    // /admin/users routes to isStaff would hand instructors role changes and
    // bans (#266).
    expect(isStaff(instructor)).toBe(true);
    expect(isAdmin(instructor)).toBe(false);
  });

  it("is false for a student, a roleless account and anonymous", () => {
    expect(isAdmin(student)).toBe(false);
    expect(isAdmin(roleless)).toBe(false);
    expect(isAdmin(anon)).toBe(false);
  });
});

describe("assertAdmin", () => {
  it("passes an admin through and refuses an instructor", () => {
    expect(() => assertAdmin(admin)).not.toThrow();
    expect(() => assertAdmin(instructor)).toThrow(/Forbidden/);
    expect(() => assertAdmin(anon)).toThrow(/Forbidden/);
  });

  it("narrows the viewer to non-null", () => {
    const viewer: Viewer = admin;
    assertAdmin(viewer);
    const id: string = viewer.id;
    expect(id).toBe("u-admin");
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
