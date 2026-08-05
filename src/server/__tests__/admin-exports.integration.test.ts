import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "#/db";
import { user } from "#/db/schema";
import { auth } from "#/lib/auth";
import {
  createCategoryAs,
  setProjectCategoriesAs,
} from "#/server/_internal/categories";
import { createProjectAs } from "#/server/_internal/projects";
import {
  exportAdminProjectsAs,
  listAdminProjectsAs,
} from "#/server/_internal/projects-queries";
import {
  exportUsersAs,
  exportUsersImpl,
  listUsersImpl,
} from "#/server/_internal/users";

async function makeUser(email: string, role: "user" | "instructor" | "admin") {
  await auth.api.signUpEmail({
    body: { email, password: "Password1!", name: email },
  });
  await db
    .update(user)
    .set({ emailVerified: true, ...(role === "user" ? {} : { role }) })
    .where(eq(user.email, email));
  const [u] = await db.select().from(user).where(eq(user.email, email));
  return { id: u.id, role: u.role };
}

function baseProject(title: string) {
  return {
    title,
    description: null,
    problemStatement: "The stated problem",
    objectives: null,
    minQualifications: null,
    prefQualifications: null,
    url: "",
    contactEmail: "",
    contactName: null,
    imageUrl: "",
    licenseRestrictions: null,
    programId: null,
    notes: "Staff only",
  };
}

const ALL_PROJECTS = {
  includeSoftDeleted: false,
  program: null,
  proposer: null,
  q: "",
  status: "all" as const,
};

describe("admin project export", () => {
  it("returns the same rows the listing returns for the same filter", async () => {
    const admin = await makeUser(`a-${Date.now()}@x.com`, "admin");
    await createProjectAs(admin, baseProject("Alpha rover"));
    await createProjectAs(admin, baseProject("Beta sensor"));

    const filter = { ...ALL_PROJECTS, q: "Alpha" };
    const listed = await listAdminProjectsAs(admin, filter);
    const exported = await exportAdminProjectsAs(admin, filter);

    expect(exported.rows.map((r) => r.id).sort()).toEqual(
      listed.rows.map((r) => r.id).sort()
    );
    expect(exported.rows).toHaveLength(1);
  });

  it("carries fields the listing projection omits", async () => {
    const admin = await makeUser(`b-${Date.now()}@x.com`, "admin");
    await createProjectAs(admin, baseProject("Gamma probe"));

    const { rows } = await exportAdminProjectsAs(admin, {
      ...ALL_PROJECTS,
      q: "Gamma",
    });

    expect(rows[0].problemStatement).toBe("The stated problem");
    expect(rows[0].notes).toBe("Staff only");
  });

  it("joins categories as '; '-separated, ordered by type then name", async () => {
    const admin = await makeUser(`c-${Date.now()}@x.com`, "admin");
    const { id: projectId } = await createProjectAs(
      admin,
      baseProject("Delta lander")
    );
    // Chosen so name-only ordering ("Alpha" before "Zulu") and type-then-name
    // ordering ("alpha" before "zulu", so the Zulu/alpha row comes first)
    // disagree: this pins the ORDER BY, not just the join.
    const { id: catInAlphaType } = await createCategoryAs(admin, {
      name: "Zulu",
      type: "alpha",
    });
    const { id: catInZuluType } = await createCategoryAs(admin, {
      name: "Alpha",
      type: "zulu",
    });
    await setProjectCategoriesAs(admin, {
      projectId,
      categoryIds: [catInZuluType, catInAlphaType],
    });

    const { rows } = await exportAdminProjectsAs(admin, {
      ...ALL_PROJECTS,
      q: "Delta",
    });

    expect(rows[0].categories).toBe("Zulu; Alpha");
  });

  it("allows instructors and rejects students", async () => {
    const instructor = await makeUser(`i-${Date.now()}@x.com`, "instructor");
    const student = await makeUser(`s-${Date.now()}@x.com`, "user");

    await expect(
      exportAdminProjectsAs(instructor, ALL_PROJECTS)
    ).resolves.toBeDefined();
    await expect(exportAdminProjectsAs(student, ALL_PROJECTS)).rejects.toThrow(
      "Forbidden"
    );
  });
});

const ALL_USERS = {
  q: "",
  role: null,
  includeBanned: true,
  page: 1,
  pageSize: 20,
};

describe("admin user export", () => {
  it("returns every match rather than one page", async () => {
    const stamp = Date.now();
    for (let i = 0; i < 25; i++) {
      await makeUser(`bulk-${stamp}-${i}@x.com`, "user");
    }
    const filter = { ...ALL_USERS, q: `bulk-${stamp}-` };

    const listed = await listUsersImpl({ ...filter, pageSize: 10 });
    const exported = await exportUsersImpl(filter);

    expect(listed.rows).toHaveLength(10);
    expect(listed.total).toBe(25);
    expect(exported.rows).toHaveLength(25);
  });

  it("carries fields the listing projection omits", async () => {
    const stamp = Date.now();
    await makeUser(`fields-${stamp}@x.com`, "user");
    const { rows } = await exportUsersImpl({
      ...ALL_USERS,
      q: `fields-${stamp}@x.com`,
    });
    expect(rows[0].emailVerified).toBe(true);
    expect(rows[0].updatedAt).toBeInstanceOf(Date);
  });

  it("rejects an instructor as well as a student", async () => {
    const stamp = Date.now();
    const admin = await makeUser(`ga-${stamp}@x.com`, "admin");
    const instructor = await makeUser(`gi-${stamp}@x.com`, "instructor");
    const student = await makeUser(`gs-${stamp}@x.com`, "user");

    await expect(exportUsersAs(admin, ALL_USERS)).resolves.toBeDefined();
    await expect(exportUsersAs(instructor, ALL_USERS)).rejects.toThrow();
    await expect(exportUsersAs(student, ALL_USERS)).rejects.toThrow();
  });
});
