import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "#/db";
import { projects, user } from "#/db/schema";
import { auth } from "#/lib/auth";
import { claimProjectsForVerifiedUser } from "#/server/_internal/claim-projects";

async function makeProject(fields: {
  proposerEmail: string | null;
  proposerId?: string | null;
  deletedAt?: Date | null;
}) {
  const [row] = await db
    .insert(projects)
    .values({
      title: "P",
      status: "draft",
      proposerEmail: fields.proposerEmail,
      proposerId: fields.proposerId ?? null,
      deletedAt: fields.deletedAt ?? null,
    })
    .returning();
  return row;
}

async function makeAccount(email: string) {
  await auth.api.signUpEmail({
    body: { email, password: "Password1!", name: email },
  });
  const [u] = await db.select().from(user).where(eq(user.email, email));
  return u;
}

async function statusOf(id: string) {
  const [row] = await db.select().from(projects).where(eq(projects.id, id));
  return row;
}

describe("claimProjectsForVerifiedUser", () => {
  it("claims an unlinked project whose proposer email matches", async () => {
    const account = await makeAccount("claim1@x.edu");
    const project = await makeProject({ proposerEmail: "claim1@x.edu" });

    const count = await claimProjectsForVerifiedUser(
      account.id,
      "claim1@x.edu"
    );

    expect(count).toBe(1);
    expect((await statusOf(project.id)).proposerId).toBe(account.id);
  });

  it("matches case-insensitively", async () => {
    const account = await makeAccount("claim2@x.edu");
    const project = await makeProject({ proposerEmail: "Claim2@X.EDU" });

    await claimProjectsForVerifiedUser(account.id, "claim2@x.edu");

    expect((await statusOf(project.id)).proposerId).toBe(account.id);
  });

  it("never steals a project that is already linked to someone else", async () => {
    const owner = await makeAccount("owner-c@x.edu");
    const other = await makeAccount("other-c@x.edu");
    const project = await makeProject({
      proposerEmail: "other-c@x.edu",
      proposerId: owner.id,
    });

    const count = await claimProjectsForVerifiedUser(other.id, "other-c@x.edu");

    expect(count).toBe(0);
    expect((await statusOf(project.id)).proposerId).toBe(owner.id);
  });

  it("claims soft-deleted projects so a restore is not orphaned", async () => {
    const account = await makeAccount("claim3@x.edu");
    const project = await makeProject({
      proposerEmail: "claim3@x.edu",
      deletedAt: new Date(),
    });

    await claimProjectsForVerifiedUser(account.id, "claim3@x.edu");

    expect((await statusOf(project.id)).proposerId).toBe(account.id);
  });

  it("is idempotent", async () => {
    const account = await makeAccount("claim4@x.edu");
    await makeProject({ proposerEmail: "claim4@x.edu" });

    expect(await claimProjectsForVerifiedUser(account.id, "claim4@x.edu")).toBe(
      1
    );
    expect(await claimProjectsForVerifiedUser(account.id, "claim4@x.edu")).toBe(
      0
    );
  });

  it("claims nothing for a blank or non-matching address", async () => {
    const account = await makeAccount("claim5@x.edu");
    await makeProject({ proposerEmail: "someone-else@x.edu" });

    expect(await claimProjectsForVerifiedUser(account.id, "")).toBe(0);
    expect(await claimProjectsForVerifiedUser(account.id, "claim5@x.edu")).toBe(
      0
    );
  });
});

describe("the verification boundary", () => {
  it("does not claim on an unverified password sign-up", async () => {
    const project = await makeProject({ proposerEmail: "unverified@x.edu" });

    const account = await makeAccount("unverified@x.edu");

    // signUpEmail leaves emailVerified false, so the create hook's guard must
    // decline. This is the whole security property: registering at an address
    // must not claim its projects.
    expect(account.emailVerified).toBe(false);
    expect((await statusOf(project.id)).proposerId).toBeNull();
  });
});
