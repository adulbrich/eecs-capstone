import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "#/db";
import {
  inventoryItems,
  notifications,
  projectBookmarks,
  projectComments,
  projectStatusHistory,
  projects,
  user,
} from "#/db/schema";
// The script is plain .mjs on purpose: it runs from the production container,
// which carries the built server rather than TypeScript. See its header.
import { inspectUser, purgeUser } from "../../../scripts/delete-user.mjs";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

afterAll(async () => {
  await pool.end();
});

async function makeUser(role: "user" | "admin" = "user") {
  const id = randomUUID();
  const email = `${id}@example.test`;
  await db.insert(user).values({ id, email, name: `Test ${id}`, role });
  return { id, email };
}

async function makeProject(proposerId: string | null, title = "A project") {
  const [row] = await db
    .insert(projects)
    .values({ title, proposerId })
    .returning({ id: projects.id });
  return row.id;
}

describe("delete-user script", () => {
  it("reports nothing for an address with no account", async () => {
    const result = await purgeUser(pool, "nobody@example.test");
    expect(result).toEqual({
      email: "nobody@example.test",
      found: false,
      deleted: false,
      dryRun: false,
      user: null,
      blockers: [],
      projects: [],
      cascades: [],
    });
  });

  it("purges the account, its projects, and its cascaded rows", async () => {
    const target = await makeUser();
    const bystander = await makeUser();
    const theirProject = await makeProject(target.id, "Their project");
    const otherProject = await makeProject(bystander.id, "Other project");

    // Activity on their own project is not a blocker: the project goes with
    // them and takes these rows with it.
    await db.insert(projectStatusHistory).values({
      projectId: theirProject,
      newStatus: "submitted",
      changedBy: target.id,
    });
    await db.insert(projectComments).values({
      projectId: theirProject,
      authorId: target.id,
      content: "Mine",
    });
    await db
      .insert(projectBookmarks)
      .values({ userId: target.id, projectId: otherProject });
    await db.insert(notifications).values({
      userId: target.id,
      type: "test",
      title: "t",
      message: "m",
    });

    const result = await purgeUser(pool, target.email);

    expect(result.deleted).toBe(true);
    expect(result.blockers).toEqual([]);
    expect(result.projects.map((p) => p.title)).toEqual(["Their project"]);
    expect(
      await db.select().from(user).where(eq(user.id, target.id))
    ).toHaveLength(0);
    expect(
      await db.select().from(projects).where(eq(projects.id, theirProject))
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(notifications)
        .where(eq(notifications.userId, target.id))
    ).toHaveLength(0);
    // The bystander keeps their project even though the deleted account had
    // bookmarked it.
    expect(
      await db.select().from(projects).where(eq(projects.id, otherProject))
    ).toHaveLength(1);
  });

  it("matches the address case-insensitively", async () => {
    const target = await makeUser();
    const result = await purgeUser(pool, target.email.toUpperCase());
    expect(result.deleted).toBe(true);
  });

  it("refuses when they commented on someone else's project", async () => {
    const target = await makeUser();
    const bystander = await makeUser();
    const otherProject = await makeProject(bystander.id);
    await db.insert(projectComments).values({
      projectId: otherProject,
      authorId: target.id,
      content: "Not mine",
    });

    const result = await purgeUser(pool, target.email);

    expect(result.deleted).toBe(false);
    expect(result.blockers.map((b) => b.relation)).toContain(
      "project_comments"
    );
    expect(
      await db.select().from(user).where(eq(user.id, target.id))
    ).toHaveLength(1);
  });

  it("refuses when they changed the status of someone else's project", async () => {
    const target = await makeUser();
    const bystander = await makeUser();
    const otherProject = await makeProject(bystander.id);
    await db.insert(projectStatusHistory).values({
      projectId: otherProject,
      newStatus: "approved",
      changedBy: target.id,
    });

    const result = await purgeUser(pool, target.email);

    expect(result.deleted).toBe(false);
    expect(result.blockers.map((b) => b.relation)).toContain(
      "project_status_history"
    );
  });

  it("refuses when they are the program manager of someone else's project", async () => {
    const target = await makeUser();
    const bystander = await makeUser();
    const otherProject = await makeProject(bystander.id);
    await db
      .update(projects)
      .set({ programManagerId: target.id })
      .where(eq(projects.id, otherProject));

    const result = await purgeUser(pool, target.email);

    expect(result.deleted).toBe(false);
    expect(result.blockers.map((b) => b.relation)).toContain(
      "projects.program_manager_id"
    );
  });

  it("refuses when they still hold an inventory item", async () => {
    const target = await makeUser();
    await db.insert(inventoryItems).values({
      name: "Oscilloscope",
      status: "checked_out",
      currentHolderId: target.id,
    });

    const result = await purgeUser(pool, target.email);

    expect(result.deleted).toBe(false);
    expect(result.blockers.map((b) => b.relation)).toContain(
      "inventory_items.current_holder_id"
    );
  });

  it("refuses an admin unless allowAdmin is set", async () => {
    const target = await makeUser("admin");

    const refused = await purgeUser(pool, target.email);
    expect(refused.deleted).toBe(false);
    expect(refused.blockers.map((b) => b.relation)).toContain("user.role");

    const allowed = await purgeUser(pool, target.email, { allowAdmin: true });
    expect(allowed.deleted).toBe(true);
  });

  it("writes nothing on a dry run", async () => {
    const target = await makeUser();
    const theirProject = await makeProject(target.id);

    const result = await purgeUser(pool, target.email, { dryRun: true });

    expect(result.deleted).toBe(false);
    expect(result.dryRun).toBe(true);
    expect(result.blockers).toEqual([]);
    expect(
      await db.select().from(user).where(eq(user.id, target.id))
    ).toHaveLength(1);
    expect(
      await db.select().from(projects).where(eq(projects.id, theirProject))
    ).toHaveLength(1);
  });

  it("inspectUser counts what will cascade without writing", async () => {
    const target = await makeUser();
    const bystander = await makeUser();
    const otherProject = await makeProject(bystander.id);
    await db
      .insert(projectBookmarks)
      .values({ userId: target.id, projectId: otherProject });

    const report = await inspectUser(pool, target.email);

    expect(report.blockers).toEqual([]);
    expect(report.cascades).toContainEqual({ label: "bookmarks", count: 1 });
    expect(
      await db.select().from(user).where(eq(user.id, target.id))
    ).toHaveLength(1);
  });
});
