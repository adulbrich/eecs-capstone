import { describe, expect, it } from "vitest";
import {
  canEditProject,
  canSeePrivateNotes,
  canSeeProject,
  canSeeStatusHistory,
  canWritePrivateNotes,
  filterCommentsForViewer,
  type ProjectRow,
  projectDetailView,
  type VisibleProject,
} from "../project-visibility";
import { isStaff, type Viewer } from "../viewer";

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
  it("anon sees published and archived, non-deleted", () => {
    expect(canSeeProject(p({ status: "published" }), anon)).toBe(true);
    expect(canSeeProject(p({ status: "archived" }), anon)).toBe(true);
    expect(canSeeProject(p({ status: "draft" }), anon)).toBe(false);
    expect(canSeeProject(p({ status: "submitted" }), anon)).toBe(false);
    expect(
      canSeeProject(p({ status: "published", deletedAt: new Date() }), anon)
    ).toBe(false);
    expect(
      canSeeProject(p({ status: "archived", deletedAt: new Date() }), anon)
    ).toBe(false);
  });

  it("owner sees own in any non-deleted status", () => {
    expect(canSeeProject(p({ status: "draft" }), owner)).toBe(true);
    expect(canSeeProject(p({ status: "archived" }), owner)).toBe(true);
    expect(
      canSeeProject(p({ status: "draft", deletedAt: new Date() }), owner)
    ).toBe(false);
  });

  it("non-owner non-staff user sees published and archived, non-deleted", () => {
    expect(canSeeProject(p({ status: "published" }), other)).toBe(true);
    expect(canSeeProject(p({ status: "archived" }), other)).toBe(true);
    expect(canSeeProject(p({ status: "submitted" }), other)).toBe(false);
  });

  it("staff sees everything including soft-deleted", () => {
    expect(canSeeProject(p({ status: "draft" }), admin)).toBe(true);
    expect(
      canSeeProject(p({ status: "published", deletedAt: new Date() }), admin)
    ).toBe(true);
    expect(canSeeProject(p({ status: "draft" }), instructor)).toBe(true);
  });
});

describe("canSeeStatusHistory", () => {
  it("is visible to staff and the proposer only", () => {
    expect(canSeeStatusHistory(p({ status: "published" }), admin)).toBe(true);
    expect(canSeeStatusHistory(p({ status: "published" }), instructor)).toBe(
      true
    );
    expect(canSeeStatusHistory(p({ status: "published" }), owner)).toBe(true);
    expect(canSeeStatusHistory(p({ status: "published" }), other)).toBe(false);
    expect(canSeeStatusHistory(p({ status: "published" }), anon)).toBe(false);
    expect(canSeeStatusHistory(p({ status: "archived" }), anon)).toBe(false);
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
      canEditProject(p({ status: "draft", deletedAt: new Date() }), owner)
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
      canEditProject(p({ status: "draft", deletedAt: new Date() }), admin)
    ).toBe(false);
  });
});

describe("canSeePrivateNotes", () => {
  it("is true for staff", () => {
    expect(canSeePrivateNotes(p({}), admin)).toBe(true);
    expect(canSeePrivateNotes(p({}), instructor)).toBe(true);
  });

  it("is true for the proposer, who wrote them", () => {
    expect(canSeePrivateNotes(p({}), owner)).toBe(true);
  });

  it("is false for other signed-in users and anonymous viewers", () => {
    expect(canSeePrivateNotes(p({}), other)).toBe(false);
    expect(canSeePrivateNotes(p({}), anon)).toBe(false);
  });

  it("stays private on a published project", () => {
    expect(canSeePrivateNotes(p({ status: "published" }), other)).toBe(false);
    expect(canSeePrivateNotes(p({ status: "published" }), anon)).toBe(false);
  });
});

describe("canWritePrivateNotes", () => {
  it("matches read access: staff and the proposer", () => {
    expect(canWritePrivateNotes(p({}), admin)).toBe(true);
    expect(canWritePrivateNotes(p({}), owner)).toBe(true);
    expect(canWritePrivateNotes(p({}), other)).toBe(false);
    expect(canWritePrivateNotes(p({}), anon)).toBe(false);
  });
});

const DETAIL_KEYS = [
  "acceptingApplicants",
  "contactEmail",
  "contactName",
  "deletedAt",
  "description",
  "id",
  "imageUrl",
  "isSponsored",
  "licenseRestrictions",
  "mentorName",
  "minQualifications",
  "notes",
  "objectives",
  "prefQualifications",
  "problemStatement",
  "programId",
  "requiresNdaIp",
  "seekingMentor",
  "status",
  "studentProposed",
  "teamsSupported",
  "title",
  "url",
];

function row(overrides: Partial<ProjectRow> = {}): ProjectRow {
  return {
    ...p({}),
    title: "A project",
    description: "d",
    problemStatement: "ps",
    objectives: "o",
    minQualifications: "min",
    prefQualifications: "pref",
    url: "https://x.test",
    contactEmail: "contact@x.test",
    contactName: "Contact",
    imageUrl: "projects/x.webp",
    licenseRestrictions: "none",
    teamsSupported: 2,
    programId: "prog-1",
    mentorEmail: "mentor@x.test",
    mentorName: null,
    seekingMentor: false,
    studentProposed: false,
    acceptingApplicants: true,
    ...overrides,
  } as ProjectRow;
}

describe("projectDetailView", () => {
  const withPrivate = row({
    notes: "secret",
    proposerEmail: "who@x.com",
    status: "published",
  });

  it("carries notes for staff and for the proposer", () => {
    expect(projectDetailView(withPrivate, admin).notes).toBe("secret");
    expect(projectDetailView(withPrivate, owner).notes).toBe("secret");
  });

  it("nulls notes for anyone else", () => {
    expect(projectDetailView(withPrivate, other).notes).toBeNull();
    expect(projectDetailView(withPrivate, anon).notes).toBeNull();
  });

  it("names every field it returns", () => {
    // Built field by field rather than by nulling a copy of the row, which is
    // why a new column on projects cannot ride the public payload.
    expect(Object.keys(projectDetailView(withPrivate, admin)).sort()).toEqual(
      DETAIL_KEYS
    );
    expect(Object.keys(projectDetailView(withPrivate, anon)).sort()).toEqual(
      DETAIL_KEYS
    );
  });

  it("carries the mentor name and the seeking flag for every viewer, never the address", () => {
    const seeking = row({
      mentorEmail: null,
      seekingMentor: true,
      studentProposed: true,
    });
    for (const viewer of [anon, other, owner, admin]) {
      const view = projectDetailView(seeking, viewer);
      expect(view.studentProposed).toBe(true);
      expect(view.seekingMentor).toBe(true);
      expect(view.mentorName).toBeNull();
      expect("mentorEmail" in view).toBe(false);
    }
    const named = row({ mentorName: "Dana Lee" });
    expect(projectDetailView(named, anon).mentorName).toBe("Dana Lee");
  });

  it("omits the private link key and the machine columns, staff included", () => {
    const view = projectDetailView(withPrivate, admin);
    for (const key of [
      "proposerEmail",
      "mentorEmail",
      "proposerId",
      "publishedAt",
      "archivedAt",
      "searchVector",
      "embedding",
      "embeddingSourceHash",
      "embeddingUpdatedAt",
      "createdAt",
      "updatedAt",
    ]) {
      expect(view).not.toHaveProperty(key);
    }
  });

  it("does not mutate the row it was handed", () => {
    const original = row({ notes: "secret" });
    projectDetailView(original, other);
    expect(original.notes).toBe("secret");
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
