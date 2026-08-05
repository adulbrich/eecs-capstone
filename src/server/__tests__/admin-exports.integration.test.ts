import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "#/db";
import { user } from "#/db/schema";
import { auth } from "#/lib/auth";
import { createProjectAs } from "#/server/_internal/projects";
import {
  exportAdminProjectsAs,
  listAdminProjectsAs,
} from "#/server/_internal/projects-queries";

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
