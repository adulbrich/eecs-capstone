import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "#/db";
import { projectEditLog, projects, user } from "#/db/schema";
import { auth } from "#/lib/auth";
import type { NotificationConfig } from "#/lib/email/config";
import type { RenderedEmail } from "#/lib/email/templates";
import { CLAIM_RECLAIM_MS, STAFF_EDIT_QUIET_MS } from "#/lib/staff-edit-email";
import type { ProjectStatus } from "#/lib/vocabularies";
import {
  createProjectAs,
  softDeleteProjectAs,
  updateProjectAs,
} from "#/server/_internal/projects";
import { getProjectEditLogValuesAs } from "#/server/_internal/projects-queries";
import { runStaffEditEmailSweep } from "#/server/_internal/staff-edit-emails";

const MINUTE = 60 * 1000;
const CONFIG: NotificationConfig = {
  appBaseUrl: "https://app.test",
  staffInbox: "staff@oregonstate.edu",
};

let seq = 0;
async function makeUser(role: "user" | "admin") {
  seq += 1;
  const email = `${role}-${seq}-${Date.now()}@example.com`;
  await auth.api.createUser({ body: { email, name: `Pat ${seq}` } });
  await db
    .update(user)
    .set({ emailVerified: true, role })
    .where(eq(user.email, email));
  const [u] = await db.select().from(user).where(eq(user.email, email));
  return { email: u.email, id: u.id, name: u.name, role: u.role };
}

function form(title: string) {
  return {
    title,
    description: null as string | null,
    problemStatement: null,
    objectives: null,
    minQualifications: null,
    prefQualifications: null,
    url: "",
    contactEmail: "",
    contactName: null as string | null,
    imageUrl: "",
    licenseRestrictions: null,
    notes: null as string | null,
    teamsSupported: 1,
  };
}

/** A proposer's project, moved straight to `status` the way a fixture may. */
async function projectIn(status: ProjectStatus) {
  const proposer = await makeUser("user");
  const admin = await makeUser("admin");
  const { id } = await createProjectAs(proposer, form("Fish ladder"));
  await db.update(projects).set({ status }).where(eq(projects.id, id));
  return { admin, id, proposer };
}

async function logRows(projectId: string) {
  return await db
    .select()
    .from(projectEditLog)
    .where(eq(projectEditLog.projectId, projectId))
    .orderBy(projectEditLog.createdAt);
}

function inbox() {
  const sent: { email: RenderedEmail; to: string }[] = [];
  const send = (to: string, email: RenderedEmail) => {
    sent.push({ email, to });
    return Promise.resolve();
  };
  return { send, sent };
}

const later = (ms: number) => new Date(Date.now() + ms);
const afterQuiet = () => later(STAFF_EDIT_QUIET_MS + MINUTE);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a save's staff email flag", () => {
  it.each(["approved", "published"] as const)(
    "is due for a proposer's save while %s",
    async (status) => {
      const { id, proposer } = await projectIn(status);
      await updateProjectAs(proposer, { ...form("Fish ladder v2"), id });
      const [row] = await logRows(id);
      expect(row.staffEmailDue).toBe(true);
      expect(row.staffEmailedAt).toBeNull();
    }
  );

  it.each(["draft", "submitted", "changes_requested"] as const)(
    "is not due for a proposer's save while %s",
    async (status) => {
      const { id, proposer } = await projectIn(status);
      await updateProjectAs(proposer, { ...form("Fish ladder v2"), id });
      const [row] = await logRows(id);
      expect(row.staffEmailDue).toBe(false);
    }
  );

  it("is not written for an archived project, which the proposer cannot edit", async () => {
    const { id, proposer } = await projectIn("archived");
    await expect(
      updateProjectAs(proposer, { ...form("Fish ladder v2"), id })
    ).rejects.toThrow("Forbidden");
    expect(await logRows(id)).toEqual([]);
  });

  it("is not due for a staff save to a published project", async () => {
    const { admin, id } = await projectIn("published");
    await updateProjectAs(admin, { ...form("Fish ladder v2"), id });
    const [row] = await logRows(id);
    expect(row.staffEmailDue).toBe(false);
  });

  it("is not due for staff editing a published project they proposed", async () => {
    const admin = await makeUser("admin");
    const { id } = await createProjectAs(admin, form("Fish ladder"));
    await db
      .update(projects)
      .set({ status: "published" })
      .where(eq(projects.id, id));
    await updateProjectAs(admin, { ...form("Fish ladder v2"), id });
    const [row] = await logRows(id);
    expect(row.staffEmailDue).toBe(false);
  });
});

describe("runStaffEditEmailSweep", () => {
  /** A published project its proposer has saved twice. */
  async function editedTwice() {
    const fixture = await projectIn("published");
    await updateProjectAs(fixture.proposer, {
      ...form("Fish ladder v2"),
      id: fixture.id,
    });
    await updateProjectAs(fixture.proposer, {
      ...form("Fish ladder v2"),
      contactName: "Sam",
      description: "A private rewrite",
      id: fixture.id,
    });
    return fixture;
  }

  it("sends nothing before the quiet period", async () => {
    const { id } = await editedTwice();
    const { send, sent } = inbox();
    const result = await runStaffEditEmailSweep({
      config: CONFIG,
      now: later(STAFF_EDIT_QUIET_MS - MINUTE),
      send,
    });
    expect(result.claimed).toBe(0);
    expect(sent).toEqual([]);
    const rows = await logRows(id);
    expect(rows.every((r) => r.staffEmailClaimedAt === null)).toBe(true);
  });

  it("sends one email after the quiet period, covering every due row, and stamps them all", async () => {
    const { id, proposer } = await editedTwice();
    const { send, sent } = inbox();
    await runStaffEditEmailSweep({ config: CONFIG, now: afterQuiet(), send });

    expect(sent).toHaveLength(1);
    const [{ email, to }] = sent;
    expect(to).toBe("staff@oregonstate.edu");
    expect(email.subject).toBe("Proposer edited a project: Fish ladder v2");
    expect(email.text).toContain(`${proposer.name} (${proposer.email})`);
    expect(email.text).toContain("2 saves between");
    expect(email.text).toContain('Title: "Fish ladder" to "Fish ladder v2".');
    expect(email.text).toContain('Contact Name: (empty) to "Sam".');
    expect(email.text).toContain("Also changed: Description.");
    expect(email.text).not.toContain("A private rewrite");
    expect(email.text).toContain(`https://app.test/projects/${id}#edit-log`);

    const rows = await logRows(id);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.staffEmailedAt !== null)).toBe(true);

    // Stamped means sent: a later sweep finds nothing.
    await runStaffEditEmailSweep({
      config: CONFIG,
      now: later(STAFF_EDIT_QUIET_MS * 4),
      send,
    });
    expect(sent).toHaveLength(1);
  });

  it("sends one email when two sweeps start together", async () => {
    const { id } = await editedTwice();
    const { send, sent } = inbox();
    const now = afterQuiet();
    const results = await Promise.all([
      runStaffEditEmailSweep({ config: CONFIG, now, send }),
      runStaffEditEmailSweep({ config: CONFIG, now, send }),
    ]);
    expect(results.map((r) => r.claimed).sort()).toEqual([0, 1]);
    expect(sent).toHaveLength(1);
    expect(sent[0].email.text).toContain("2 saves between");
    const rows = await logRows(id);
    expect(rows.every((r) => r.staffEmailedAt !== null)).toBe(true);
  });

  it("leaves a failed send's rows unstamped, and claimable once the claim is old", async () => {
    const { id } = await editedTwice();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {
      /* asserted below */
    });
    const first = afterQuiet();
    await runStaffEditEmailSweep({
      config: CONFIG,
      now: first,
      send: () => Promise.reject(new Error("SES is down")),
    });
    expect(logged).toHaveBeenCalledWith(
      `Staff edit email failed for project ${id}`,
      expect.any(String)
    );
    let rows = await logRows(id);
    expect(rows.every((r) => r.staffEmailClaimedAt !== null)).toBe(true);
    expect(rows.every((r) => r.staffEmailedAt === null)).toBe(true);

    // Still held by the failed claim.
    const { send, sent } = inbox();
    await runStaffEditEmailSweep({
      config: CONFIG,
      now: new Date(first.getTime() + CLAIM_RECLAIM_MS - MINUTE),
      send,
    });
    expect(sent).toEqual([]);

    // Old enough to take again.
    await runStaffEditEmailSweep({
      config: CONFIG,
      now: new Date(first.getTime() + CLAIM_RECLAIM_MS + MINUTE),
      send,
    });
    expect(sent).toHaveLength(1);
    rows = await logRows(id);
    expect(rows.every((r) => r.staffEmailedAt !== null)).toBe(true);
  });

  it("stamps a soft-deleted project's rows and sends nothing", async () => {
    const { admin, id } = await editedTwice();
    await softDeleteProjectAs(admin, id);
    const { send, sent } = inbox();
    await runStaffEditEmailSweep({ config: CONFIG, now: afterQuiet(), send });
    expect(sent).toEqual([]);
    const rows = await logRows(id);
    const due = rows.filter((r) => r.staffEmailDue);
    expect(due).toHaveLength(2);
    expect(due.every((r) => r.staffEmailedAt !== null)).toBe(true);
  });

  it("stamps a save and its undo and sends nothing", async () => {
    const { id, proposer } = await projectIn("published");
    await updateProjectAs(proposer, { ...form("Fish ladder v2"), id });
    await updateProjectAs(proposer, { ...form("Fish ladder"), id });
    const { send, sent } = inbox();
    await runStaffEditEmailSweep({ config: CONFIG, now: afterQuiet(), send });
    expect(sent).toEqual([]);
    const rows = await logRows(id);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.staffEmailedAt !== null)).toBe(true);
  });

  it("warns once and stamps the rows when no staff inbox is set", async () => {
    const { id } = await editedTwice();
    const warned = vi.spyOn(console, "warn").mockImplementation(() => {
      /* asserted below */
    });
    const { send, sent } = inbox();
    await runStaffEditEmailSweep({
      config: { ...CONFIG, staffInbox: null },
      now: afterQuiet(),
      send,
    });
    await runStaffEditEmailSweep({
      config: { ...CONFIG, staffInbox: null },
      now: later(STAFF_EDIT_QUIET_MS * 4),
      send,
    });
    expect(sent).toEqual([]);
    expect(warned).toHaveBeenCalledTimes(1);
    expect(warned).toHaveBeenCalledWith(
      `EMAIL_STAFF_INBOX is unset, so no proposer edit notice was sent for project ${id}`
    );
  });

  it("keeps a staff edit out of the burst, and says where the live value moved on", async () => {
    const { admin, id, proposer } = await projectIn("published");
    await updateProjectAs(proposer, { ...form("Proposer title"), id });
    await updateProjectAs(admin, { ...form("Staff title"), id });
    const { send, sent } = inbox();
    await runStaffEditEmailSweep({ config: CONFIG, now: afterQuiet(), send });
    expect(sent).toHaveLength(1);
    expect(sent[0].email.text).toContain("1 save at");
    expect(sent[0].email.text).toContain(
      'Title: "Fish ladder" to "Proposer title". It has changed since and is now "Staff title".'
    );
    const [staffRow] = await db
      .select()
      .from(projectEditLog)
      .where(
        and(
          eq(projectEditLog.projectId, id),
          eq(projectEditLog.editorId, admin.id)
        )
      );
    expect(staffRow.staffEmailDue).toBe(false);
    expect(staffRow.staffEmailedAt).toBeNull();
  });

  it("sends a save made after a burst went as the next burst", async () => {
    const { id, proposer } = await editedTwice();
    const { send, sent } = inbox();
    await runStaffEditEmailSweep({ config: CONFIG, now: afterQuiet(), send });
    await updateProjectAs(proposer, {
      ...form("Fish ladder v3"),
      contactName: "Sam",
      description: "A private rewrite",
      id,
    });
    // The new row is seconds old in the database's clock, so a sweep a quiet
    // period from now sends it.
    await runStaffEditEmailSweep({ config: CONFIG, now: afterQuiet(), send });
    expect(sent).toHaveLength(2);
    expect(sent[1].email.text).toContain(
      'Title: "Fish ladder v2" to "Fish ladder v3".'
    );
  });
});

describe("getProjectEditLogValuesAs", () => {
  it("returns one row's old and new values to staff", async () => {
    const { admin, id, proposer } = await projectIn("published");
    await updateProjectAs(proposer, {
      ...form("Fish ladder v2"),
      id,
      notes: "Gate code 4512",
    });
    const [row] = await logRows(id);
    await expect(
      getProjectEditLogValuesAs(admin, { id: row.id })
    ).resolves.toEqual({
      changedFields: ["title", "notes"],
      newValues: { notes: "Gate code 4512", title: "Fish ladder v2" },
      oldValues: { notes: null, title: "Fish ladder" },
    });
  });

  it("refuses anyone but staff, the project's own proposer included", async () => {
    const { id, proposer } = await projectIn("published");
    await updateProjectAs(proposer, { ...form("Fish ladder v2"), id });
    const [row] = await logRows(id);
    await expect(
      getProjectEditLogValuesAs(proposer, { id: row.id })
    ).rejects.toThrow();
    await expect(
      getProjectEditLogValuesAs(null, { id: row.id })
    ).rejects.toThrow();
  });
});
