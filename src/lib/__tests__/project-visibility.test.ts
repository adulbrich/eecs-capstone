import { describe, expect, it } from "vitest";
import {
  canEditProject,
  canSeeProject,
  filterCommentsForViewer,
  isStaff,
  stripStaffOnlyFields,
  type Viewer,
  type VisibleProject,
} from "../project-visibility";

const anon: Viewer = null;
const other: Viewer = { id: "u-other", role: "user" };
const owner: Viewer = { id: "u-owner", role: "user" };
const instructor: Viewer = { id: "u-staff", role: "instructor" };
const admin: Viewer = { id: "u-admin", role: "admin" };

function p(overrides: Partial<VisibleProject>): VisibleProject {
  return {
    id: "p1",
    proposerId: "u-owner",
    status: "draft",
    deletedAt: null,
    notes: "internal notes",
    ...overrides,
  } as VisibleProject;
}

describe("isStaff", () => {
  it("is true for admin", () => expect(isStaff(admin)).toBe(true));
  it("is true for instructor", () => expect(isStaff(instructor)).toBe(true));
  it("is false for user", () => expect(isStaff(other)).toBe(false));
  it("is false for anonymous", () => expect(isStaff(anon)).toBe(false));
});

describe("canSeeProject", () => {
  it("anon sees only published, non-deleted", () => {
    expect(canSeeProject(p({ status: "published" }), anon)).toBe(true);
    expect(canSeeProject(p({ status: "draft" }), anon)).toBe(false);
    expect(
      canSeeProject(p({ status: "published", deletedAt: new Date() }), anon),
    ).toBe(false);
  });

  it("owner sees own in any non-deleted status", () => {
    expect(canSeeProject(p({ status: "draft" }), owner)).toBe(true);
    expect(canSeeProject(p({ status: "archived" }), owner)).toBe(true);
    expect(
      canSeeProject(p({ status: "draft", deletedAt: new Date() }), owner),
    ).toBe(false);
  });

  it("non-owner non-staff user sees only published non-deleted", () => {
    expect(canSeeProject(p({ status: "published" }), other)).toBe(true);
    expect(canSeeProject(p({ status: "submitted" }), other)).toBe(false);
  });

  it("staff sees everything including soft-deleted", () => {
    expect(canSeeProject(p({ status: "draft" }), admin)).toBe(true);
    expect(
      canSeeProject(p({ status: "published", deletedAt: new Date() }), admin),
    ).toBe(true);
    expect(canSeeProject(p({ status: "draft" }), instructor)).toBe(true);
  });
});

describe("canEditProject", () => {
  it("anon cannot edit", () => {
    expect(canEditProject(p({ status: "draft" }), anon)).toBe(false);
  });

  it("owner can edit own in non-archived non-deleted statuses", () => {
    expect(canEditProject(p({ status: "draft" }), owner)).toBe(true);
    expect(canEditProject(p({ status: "submitted" }), owner)).toBe(true);
    expect(canEditProject(p({ status: "archived" }), owner)).toBe(false);
    expect(
      canEditProject(p({ status: "draft", deletedAt: new Date() }), owner),
    ).toBe(false);
  });

  it("non-owner non-staff cannot edit", () => {
    expect(canEditProject(p({ status: "draft" }), other)).toBe(false);
  });

  it("staff can edit any non-deleted", () => {
    expect(canEditProject(p({ status: "draft" }), admin)).toBe(true);
    expect(canEditProject(p({ status: "archived" }), admin)).toBe(true);
  });

  it("staff cannot edit a soft-deleted project (must restore first)", () => {
    expect(
      canEditProject(p({ status: "draft", deletedAt: new Date() }), admin),
    ).toBe(false);
  });
});

describe("stripStaffOnlyFields", () => {
  it("removes notes for non-staff", () => {
    const result = stripStaffOnlyFields(p({ notes: "secret" }), owner);
    expect(result.notes).toBeNull();
  });

  it("keeps notes for staff", () => {
    const result = stripStaffOnlyFields(p({ notes: "secret" }), admin);
    expect(result.notes).toBe("secret");
  });
});

describe("filterCommentsForViewer", () => {
  const comments = [
    { id: "c1", isInternal: false, content: "public" },
    { id: "c2", isInternal: true, content: "internal" },
  ];
  const project = p({ status: "published" });

  it("shows the submitter only non-internal comments", () => {
    const result = filterCommentsForViewer(comments, owner, project);
    expect(result).toEqual([comments[0]]);
  });

  it("keeps all for staff", () => {
    const result = filterCommentsForViewer(comments, admin, project);
    expect(result).toEqual(comments);
  });

  it("hides all comments from non-owner users", () => {
    const result = filterCommentsForViewer(comments, other, project);
    expect(result).toEqual([]);
  });

  it("hides all comments from anonymous viewers", () => {
    const result = filterCommentsForViewer(comments, anon, project);
    expect(result).toEqual([]);
  });
});
