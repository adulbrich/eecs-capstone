import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "#/db";
import {
  account,
  aiReviewUsage,
  inventoryCartItems,
  inventoryItemStatusHistory,
  inventoryItems,
  inventoryRequestItems,
  inventoryRequests,
  notifications,
  programInstructors,
  programs,
  projectBookmarks,
  projectCollaborators,
  projects,
  session,
  user,
  userInterests,
} from "#/db/schema";
import { auth } from "#/lib/auth";
import {
  CASCADE_TABLES,
  deleteAccountAs,
  getAccountDeletionPreviewAs,
} from "#/server/_internal/account";
import { claimProjectsForVerifiedUser } from "#/server/_internal/claim-projects";
import {
  createProjectAs,
  forceTransitionAs,
} from "#/server/_internal/projects";
import { getProjectAs } from "#/server/_internal/projects-queries";

async function makeUser(email: string, role: "user" | "instructor" | "admin") {
  await auth.api.signUpEmail({
    body: { email, password: "Password1!", name: `Name of ${email}` },
  });
  await db
    .update(user)
    .set({ emailVerified: true, ...(role === "user" ? {} : { role }) })
    .where(eq(user.email, email));
  const [u] = await db.select().from(user).where(eq(user.email, email));
  return { id: u.id, role: u.role, email: u.email, image: u.image };
}

function baseProject() {
  return {
    title: "P",
    description: null,
    problemStatement: null,
    objectives: null,
    minQualifications: null,
    prefQualifications: null,
    url: "",
    contactEmail: "",
    contactName: null,
    imageUrl: "",
    licenseRestrictions: null,
    programId: null,
    notes: null,
    teamsSupported: 1,
  };
}

async function makeItem(name: string) {
  const [row] = await db.insert(inventoryItems).values({ name }).returning();
  return row;
}

async function makeProgram() {
  const [row] = await db
    .insert(programs)
    .values({ courseId: `CS ${Date.now() % 1000}`, courseName: "Capstone" })
    .returning();
  return row;
}

async function countWhere(
  table: typeof session | typeof account | typeof notifications,
  userId: string
) {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(table)
    .where(eq(table.userId, userId));
  return row.n;
}

describe("getAccountDeletionPreviewAs", () => {
  it("blocks with a held item, by account or by address, and not once it is back", async () => {
    const u = await makeUser(`pv-${Date.now()}@x.com`, "user");
    const byId = await makeItem("Held by id");
    const byEmail = await makeItem("Held by address");
    await db
      .update(inventoryItems)
      .set({ status: "checked_out", currentHolderId: u.id })
      .where(eq(inventoryItems.id, byId.id));
    await db
      .update(inventoryItems)
      .set({ status: "reserved", currentHolderEmail: u.email.toUpperCase() })
      .where(eq(inventoryItems.id, byEmail.id));

    let preview = await getAccountDeletionPreviewAs(u);
    expect(preview.blockers.items.map((i) => i.name).sort()).toEqual([
      "Held by address",
      "Held by id",
    ]);
    expect(preview.email).toBe(u.email);

    await db
      .update(inventoryItems)
      .set({
        status: "available",
        currentHolderId: null,
        currentHolderEmail: null,
      })
      .where(sql`${inventoryItems.id} in (${byId.id}, ${byEmail.id})`);
    preview = await getAccountDeletionPreviewAs(u);
    expect(preview.blockers.items).toEqual([]);
  });

  it("blocks with an approved request line and not with a returned one", async () => {
    const u = await makeUser(`pr-${Date.now()}@x.com`, "user");
    const item = await makeItem("Awaiting collection");
    const [request] = await db
      .insert(inventoryRequests)
      .values({ userId: u.id })
      .returning();
    const [line] = await db
      .insert(inventoryRequestItems)
      .values({ requestId: request.id, itemId: item.id, status: "approved" })
      .returning();

    expect(
      (await getAccountDeletionPreviewAs(u)).blockers.items.map((i) => i.id)
    ).toEqual([item.id]);

    await db
      .update(inventoryRequestItems)
      .set({ status: "returned" })
      .where(eq(inventoryRequestItems.id, line.id));
    expect((await getAccountDeletionPreviewAs(u)).blockers.items).toEqual([]);
  });

  it("blocks the only admin and not one of two", async () => {
    const admin = await makeUser(`pa-${Date.now()}@x.com`, "admin");
    expect((await getAccountDeletionPreviewAs(admin)).blockers.lastAdmin).toBe(
      true
    );
    await makeUser(`pb-${Date.now()}@x.com`, "admin");
    expect((await getAccountDeletionPreviewAs(admin)).blockers.lastAdmin).toBe(
      false
    );
  });

  it("lists the programs an instructor will disappear from", async () => {
    const u = await makeUser(`pi-${Date.now()}@x.com`, "instructor");
    const program = await makeProgram();
    await db
      .insert(programInstructors)
      .values({ programId: program.id, userId: u.id });
    const preview = await getAccountDeletionPreviewAs(u);
    expect(preview.programs).toEqual([
      {
        courseId: program.courseId,
        courseName: program.courseName,
        id: program.id,
      },
    ]);
    expect(preview.blockers.items).toEqual([]);
    expect(preview.blockers.lastAdmin).toBe(false);
  });
});

describe("deleteAccountAs", () => {
  it("scrubs every column in the table and keeps the id", async () => {
    const u = await makeUser(`ds-${Date.now()}@x.com`, "instructor");
    await db
      .update(user)
      .set({
        affiliation: "OSU",
        linkedin: "https://linkedin.com/in/x",
        wantsToMentor: true,
        mentorTeamCount: 3,
        image: `avatars/${u.id}/old.webp`,
        banned: true,
        banReason: "free text a staff member wrote",
        banExpires: new Date(),
      })
      .where(eq(user.id, u.id));
    const [before] = await db.select().from(user).where(eq(user.id, u.id));

    await deleteAccountAs(
      { ...u, image: before.image },
      {
        confirmEmail: u.email.toUpperCase(),
      }
    );

    const [row] = await db.select().from(user).where(eq(user.id, u.id));
    expect(row.id).toBe(u.id);
    expect(row.name).toBe("Deleted user");
    expect(row.email).toBe(`deleted-${u.id}@invalid`);
    expect(row.emailVerified).toBe(false);
    expect(row.image).toBeNull();
    expect(row.role).toBe("user");
    expect(row.banned).toBe(false);
    expect(row.banReason).toBeNull();
    expect(row.banExpires).toBeNull();
    expect(row.affiliation).toBeNull();
    expect(row.linkedin).toBeNull();
    expect(row.wantsToMentor).toBe(false);
    expect(row.mentorTeamCount).toBe(1);
    expect(row.deletedAt).not.toBeNull();
    expect(row.createdAt).toEqual(before.createdAt);
  });

  it("deletes every row a real DELETE would cascade, and the list matches the schema", async () => {
    const u = await makeUser(`dc-${Date.now()}@x.com`, "instructor");
    const admin = await makeUser(`dca-${Date.now()}@x.com`, "admin");
    const item = await makeItem("Carted");
    const program = await makeProgram();
    const { id: projectId } = await createProjectAs(admin, baseProject());
    await db.insert(session).values({
      id: `s-${u.id}`,
      token: `t-${u.id}`,
      userId: u.id,
      expiresAt: new Date(Date.now() + 60_000),
    });
    await db
      .insert(userInterests)
      .values({ userId: u.id, interestsText: "robots" });
    await db
      .insert(programInstructors)
      .values({ programId: program.id, userId: u.id });
    await db.insert(projectCollaborators).values({ projectId, userId: u.id });
    await db.insert(projectBookmarks).values({ projectId, userId: u.id });
    await db
      .insert(inventoryCartItems)
      .values({ itemId: item.id, userId: u.id });
    await db.insert(notifications).values({
      userId: u.id,
      type: "t",
      title: "x",
      message: "y",
    });
    await db.insert(aiReviewUsage).values({
      userId: u.id,
      model: "m",
      reasoningEffort: "low",
      outcome: "ok",
    });
    expect(await countWhere(account, u.id)).toBeGreaterThan(0);

    await deleteAccountAs(u, { confirmEmail: u.email });

    expect(await countWhere(session, u.id)).toBe(0);
    expect(await countWhere(account, u.id)).toBe(0);
    expect(await countWhere(notifications, u.id)).toBe(0);
    for (const table of [
      userInterests,
      programInstructors,
      projectCollaborators,
      projectBookmarks,
      inventoryCartItems,
      aiReviewUsage,
    ]) {
      const [row] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(table)
        .where(eq(table.userId, u.id));
      expect(row.n).toBe(0);
    }
    // The program itself survives; only the membership went.
    expect(
      await db.select().from(programs).where(eq(programs.id, program.id))
    ).toHaveLength(1);

    // The list the impl deletes from is pinned to the schema, so a new
    // cascade edge into user.id without a matching delete here is a red
    // test rather than a row that outlives the account.
    const cascadeEdges: string[] = [];
    for (const file of ["schema.ts", "auth-schema.ts"]) {
      const source = readFileSync(
        join(process.cwd(), "src", "db", file),
        "utf-8"
      );
      const blocks = source.split(/(?=pgTable\(\s*")/);
      for (const block of blocks) {
        const name = block.match(/pgTable\(\s*"([a-z_]+)"/)?.[1];
        if (name && /user\.id,\s*\{\s*onDelete:\s*"cascade"/.test(block)) {
          cascadeEdges.push(name);
        }
      }
    }
    expect([...CASCADE_TABLES].sort()).toEqual(cascadeEdges.sort());
  });

  it("keeps a proposed project public, attributed to Deleted user, with proposer_email scrubbed and contact details intact", async () => {
    const u = await makeUser(`dp-${Date.now()}@x.com`, "user");
    const admin = await makeUser(`dpa-${Date.now()}@x.com`, "admin");
    const { id } = await createProjectAs(u, {
      ...baseProject(),
      contactEmail: "typed@x.com",
      contactName: "Typed Name",
    });
    await forceTransitionAs(admin, id, "published", undefined, {
      sendEmail: false,
    });

    await deleteAccountAs(u, { confirmEmail: u.email });

    const { project } = await getProjectAs(null, { id });
    expect(project?.contactEmail).toBe("typed@x.com");
    expect(project?.contactName).toBe("Typed Name");
    const [row] = await db
      .select({
        proposerId: projects.proposerId,
        proposerEmail: projects.proposerEmail,
        proposerName: user.name,
      })
      .from(projects)
      .innerJoin(user, eq(projects.proposerId, user.id))
      .where(eq(projects.id, id));
    expect(row.proposerId).toBe(u.id);
    expect(row.proposerEmail).toBeNull();
    expect(row.proposerName).toBe("Deleted user");
  });

  it("claims nothing for the same address registered again", async () => {
    const email = `dr-${Date.now()}@x.com`;
    const u = await makeUser(email, "user");
    const { id } = await createProjectAs(u, baseProject());
    await deleteAccountAs(u, { confirmEmail: email });

    const again = await makeUser(email, "user");
    expect(again.id).not.toBe(u.id);
    expect(await claimProjectsForVerifiedUser(again.id, email)).toBe(0);
    const [row] = await db
      .select({ proposerId: projects.proposerId })
      .from(projects)
      .where(eq(projects.id, id));
    expect(row.proposerId).toBe(u.id);
  });

  it("nulls a mentor_email that matches the address, case-insensitively, and no other", async () => {
    const u = await makeUser(`dm-${Date.now()}@x.com`, "user");
    const admin = await makeUser(`dma-${Date.now()}@x.com`, "admin");
    const { id: mine } = await createProjectAs(admin, baseProject());
    const { id: other } = await createProjectAs(admin, baseProject());
    await db
      .update(projects)
      .set({ mentorEmail: u.email.toUpperCase(), studentProposed: true })
      .where(eq(projects.id, mine));
    await db
      .update(projects)
      .set({ mentorEmail: "someone-else@x.com" })
      .where(eq(projects.id, other));

    await deleteAccountAs(u, { confirmEmail: u.email });

    const rows = await db
      .select({ id: projects.id, mentorEmail: projects.mentorEmail })
      .from(projects)
      .where(sql`${projects.id} in (${mine}, ${other})`);
    expect(rows.find((r) => r.id === mine)?.mentorEmail).toBeNull();
    expect(rows.find((r) => r.id === other)?.mentorEmail).toBe(
      "someone-else@x.com"
    );
  });

  it("refuses a wrong confirmation and changes nothing", async () => {
    const u = await makeUser(`dw-${Date.now()}@x.com`, "user");
    await expect(
      deleteAccountAs(u, { confirmEmail: "nope@x.com" })
    ).rejects.toThrow("does not match");
    const [row] = await db.select().from(user).where(eq(user.id, u.id));
    expect(row.email).toBe(u.email);
    expect(row.deletedAt).toBeNull();
  });

  it("refuses while an item is out or the user is the last admin, and changes nothing", async () => {
    const holder = await makeUser(`dh-${Date.now()}@x.com`, "user");
    const item = await makeItem("Still out");
    await db
      .update(inventoryItems)
      .set({ status: "checked_out", currentHolderId: holder.id })
      .where(eq(inventoryItems.id, item.id));
    await expect(
      deleteAccountAs(holder, { confirmEmail: holder.email })
    ).rejects.toThrow("outstanding");

    const admin = await makeUser(`dl-${Date.now()}@x.com`, "admin");
    await expect(
      deleteAccountAs(admin, { confirmEmail: admin.email })
    ).rejects.toThrow("last admin");

    for (const id of [holder.id, admin.id]) {
      const [row] = await db.select().from(user).where(eq(user.id, id));
      expect(row.deletedAt).toBeNull();
      expect(row.name).not.toBe("Deleted user");
    }
  });

  it("leaves the equipment chain of custody untouched", async () => {
    const u = await makeUser(`dq-${Date.now()}@x.com`, "user");
    const staff = await makeUser(`dqs-${Date.now()}@x.com`, "admin");
    const item = await makeItem("Returned already");
    const [history] = await db
      .insert(inventoryItemStatusHistory)
      .values({
        itemId: item.id,
        oldStatus: "available",
        newStatus: "checked_out",
        changedBy: staff.id,
        holderId: u.id,
        holderEmail: u.email,
        holderName: "Real Name",
        holderProgram: "CS 461",
      })
      .returning();

    await deleteAccountAs(u, { confirmEmail: u.email });

    const [after] = await db
      .select()
      .from(inventoryItemStatusHistory)
      .where(eq(inventoryItemStatusHistory.id, history.id));
    expect(after).toEqual(history);
  });
});
