import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "#/db";
import { session, user } from "#/db/schema";
import { auth } from "#/lib/auth";
import type { UserRole } from "#/lib/vocabularies";
import { recordReviewUsage } from "#/server/_internal/ai-review-usage";
import {
  banUserAs,
  getUserImpl,
  listUsersImpl,
  setUserRoleAs,
  unbanUserAs,
} from "#/server/_internal/users";

async function makeUser(email: string, role: UserRole) {
  await auth.api.signUpEmail({
    body: { email, password: "Password1!", name: email },
  });
  await db
    .update(user)
    .set({ emailVerified: true, role })
    .where(eq(user.email, email));
  const [u] = await db.select().from(user).where(eq(user.email, email));
  return { id: u.id, role: u.role };
}

/** One paid Bedrock call, written the way the review path writes it. */
function recordCall(
  userId: string,
  feature: "review" | "scope",
  tokens: { input: number; reasoning: number; output: number }
) {
  return recordReviewUsage({
    userId,
    feature,
    model: "test-model",
    reasoningEffort: "low",
    inputTokens: tokens.input,
    reasoningTokens: tokens.reasoning,
    outputTokens: tokens.output,
    outcome: "ok",
  });
}

describe("AI usage per user (#413)", () => {
  it("counts every row for the user, both features together", async () => {
    const heavy = await makeUser(`heavy-${Date.now()}@x.com`, "user");
    const quiet = await makeUser(`quiet-${Date.now()}@x.com`, "user");
    const tokens = { input: 10, reasoning: 5, output: 2 };
    await recordCall(heavy.id, "review", tokens);
    await recordCall(heavy.id, "review", tokens);
    await recordCall(heavy.id, "scope", tokens);

    const { rows } = await listUsersImpl({
      q: "",
      role: null,
      includeBanned: true,
      page: 1,
      pageSize: 50,
    });
    expect(rows.find((r) => r.id === heavy.id)?.aiCallCount).toBe(3);
    // Zero is a real answer, and a user with none stays in the listing rather
    // than being dropped by the count.
    expect(rows.find((r) => r.id === quiet.id)?.aiCallCount).toBe(0);
  });

  it("splits the detail figures per feature and totals the tokens", async () => {
    const u = await makeUser(`detail-${Date.now()}@x.com`, "user");
    await recordCall(u.id, "review", { input: 10, reasoning: 5, output: 2 });
    await recordCall(u.id, "review", { input: 20, reasoning: 1, output: 3 });
    await recordCall(u.id, "scope", { input: 7, reasoning: 0, output: 1 });

    const { aiUsage } = await getUserImpl({ id: u.id });
    // Every feature in AI_FEATURE_NOUN, in its key order, whether or not the
    // user touched it: the page fills the list out rather than reporting only
    // what has rows, so a feature nobody used reads as zero rather than absent.
    expect(aiUsage.byFeature).toEqual([
      { feature: "review", calls: 2 },
      { feature: "scope", calls: 1 },
      { feature: "social-summary", calls: 0 },
    ]);
    expect(aiUsage.inputTokens).toBe(37);
    expect(aiUsage.reasoningTokens).toBe(6);
    expect(aiUsage.outputTokens).toBe(3 + 2 + 1);
    expect(aiUsage.lastCallAt).toBeInstanceOf(Date);
  });

  it("reports a feature nobody used as zero, and no last call at all", async () => {
    const u = await makeUser(`onefeature-${Date.now()}@x.com`, "user");
    await recordCall(u.id, "scope", { input: 1, reasoning: 0, output: 1 });

    const used = await getUserImpl({ id: u.id });
    expect(used.aiUsage.byFeature).toEqual([
      { feature: "review", calls: 0 },
      { feature: "scope", calls: 1 },
      { feature: "social-summary", calls: 0 },
    ]);

    const quiet = await makeUser(`nocalls-${Date.now()}@x.com`, "user");
    const { aiUsage } = await getUserImpl({ id: quiet.id });
    expect(aiUsage.inputTokens).toBe(0);
    expect(aiUsage.lastCallAt).toBeNull();
    expect(aiUsage.byFeature.every((row) => row.calls === 0)).toBe(true);
  });
});

describe("listUsersImpl", () => {
  it("q matches email and name (separately)", async () => {
    await makeUser(`alice-${Date.now()}@x.com`, "user");
    await makeUser(`bob-${Date.now()}@x.com`, "user");

    const byEmail = await listUsersImpl({
      q: "alice",
      role: null,
      includeBanned: true,
      page: 1,
      pageSize: 50,
    });
    expect(byEmail.rows.some((r) => r.email.includes("alice"))).toBe(true);
    expect(byEmail.rows.some((r) => r.email.includes("bob"))).toBe(false);
  });

  it("role filter restricts results", async () => {
    await makeUser(`u1-${Date.now()}@x.com`, "user");
    await makeUser(`a1-${Date.now()}@x.com`, "admin");

    const admins = await listUsersImpl({
      q: "",
      role: "admin",
      includeBanned: true,
      page: 1,
      pageSize: 50,
    });
    expect(admins.rows.every((r) => r.role === "admin")).toBe(true);
  });

  it("includeBanned=false hides banned users", async () => {
    const admin = await makeUser(`a2-${Date.now()}@x.com`, "admin");
    const target = await makeUser(`t-${Date.now()}@x.com`, "user");
    await banUserAs(admin, {
      userId: target.id,
      reason: "test",
      expiresAt: null,
    });

    const withBanned = await listUsersImpl({
      q: "",
      role: null,
      includeBanned: true,
      page: 1,
      pageSize: 50,
    });
    expect(withBanned.rows.some((r) => r.id === target.id)).toBe(true);

    const hidden = await listUsersImpl({
      q: "",
      role: null,
      includeBanned: false,
      page: 1,
      pageSize: 50,
    });
    expect(hidden.rows.some((r) => r.id === target.id)).toBe(false);
  });
});

describe("setUserRoleAs", () => {
  it("admin can change another user's role", async () => {
    const admin = await makeUser(`a-${Date.now()}@x.com`, "admin");
    const target = await makeUser(`u-${Date.now()}@x.com`, "user");

    await setUserRoleAs(admin, { userId: target.id, role: "instructor" });
    const [updated] = await db
      .select()
      .from(user)
      .where(eq(user.id, target.id));
    expect(updated.role).toBe("instructor");
  });

  it("refuses self-action", async () => {
    const admin = await makeUser(`a2-${Date.now()}@x.com`, "admin");
    await expect(
      setUserRoleAs(admin, { userId: admin.id, role: "user" })
    ).rejects.toThrow(/yourself/);
  });

  it("refuses non-admin caller", async () => {
    const instructor = await makeUser(`i-${Date.now()}@x.com`, "instructor");
    const target = await makeUser(`u-${Date.now()}@x.com`, "user");
    await expect(
      setUserRoleAs(instructor, { userId: target.id, role: "admin" })
    ).rejects.toThrow();
  });
});

describe("banUserAs / unbanUserAs", () => {
  it("ban updates the three columns AND revokes sessions", async () => {
    const admin = await makeUser(`a-${Date.now()}@x.com`, "admin");
    const target = await makeUser(`t-${Date.now()}@x.com`, "user");

    // Insert a synthetic session row for the target to verify revoke.
    await db.insert(session).values({
      id: `s-${Date.now()}`,
      userId: target.id,
      token: `tok-${Date.now()}`,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60),
    });

    await banUserAs(admin, {
      userId: target.id,
      reason: "test ban",
      expiresAt: null,
    });

    const [updated] = await db
      .select()
      .from(user)
      .where(eq(user.id, target.id));
    expect(updated.banned).toBe(true);
    expect(updated.banReason).toBe("test ban");
    expect(updated.banExpires).toBeNull();

    const sessions = await db
      .select()
      .from(session)
      .where(eq(session.userId, target.id));
    expect(sessions.length).toBe(0);
  });

  it("ban refuses self-action", async () => {
    const admin = await makeUser(`a2-${Date.now()}@x.com`, "admin");
    await expect(
      banUserAs(admin, {
        userId: admin.id,
        reason: "x",
        expiresAt: null,
      })
    ).rejects.toThrow(/yourself/);
  });

  it("unban clears the three columns", async () => {
    const admin = await makeUser(`a3-${Date.now()}@x.com`, "admin");
    const target = await makeUser(`t2-${Date.now()}@x.com`, "user");
    await banUserAs(admin, {
      userId: target.id,
      reason: "test",
      expiresAt: null,
    });
    await unbanUserAs(admin, { userId: target.id });

    const [updated] = await db
      .select()
      .from(user)
      .where(eq(user.id, target.id));
    expect(updated.banned).toBe(false);
    expect(updated.banReason).toBeNull();
    expect(updated.banExpires).toBeNull();
  });
});

describe("account emails", () => {
  const ORIGINAL_ENV = { ...process.env };
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("emails a user when their role changes and when they are banned, not on unban", async () => {
    process.env.BETTER_AUTH_URL = "https://app";
    const admin = await makeUser(
      `admin-acct-mail-${Date.now()}@x.com`,
      "admin"
    );
    const targetEmail = `target-acct-mail-${Date.now()}@x.com`;
    const target = await makeUser(targetEmail, "user");
    const send = vi.fn().mockResolvedValue(undefined);

    await setUserRoleAs(
      admin,
      { userId: target.id, role: "instructor" },
      { send }
    );
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]?.[0]).toBe(targetEmail);
    expect(send.mock.calls[0]?.[1].subject).toBe("Your role is now instructor");

    send.mockClear();
    await banUserAs(
      admin,
      { userId: target.id, reason: "Repeated misuse", expiresAt: null },
      { send }
    );
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]?.[0]).toBe(targetEmail);
    expect(send.mock.calls[0]?.[1].subject).toBe("Your account was suspended");
    expect(send.mock.calls[0]?.[1].text).toContain("Repeated misuse");

    send.mockClear();
    await unbanUserAs(admin, { userId: target.id });
    expect(send).not.toHaveBeenCalled();
  });

  it("changes the role and bans without a word on sendEmail: false (#386)", async () => {
    process.env.BETTER_AUTH_URL = "https://app";
    const admin = await makeUser(
      `admin-acct-skip-${Date.now()}@x.com`,
      "admin"
    );
    const target = await makeUser(
      `target-acct-skip-${Date.now()}@x.com`,
      "user"
    );
    const send = vi.fn().mockResolvedValue(undefined);

    await setUserRoleAs(
      admin,
      { userId: target.id, role: "instructor" },
      { send, sendEmail: false }
    );
    expect(send).not.toHaveBeenCalled();
    let [row] = await db.select().from(user).where(eq(user.id, target.id));
    expect(row.role).toBe("instructor");

    await banUserAs(
      admin,
      { userId: target.id, reason: "Quietly", expiresAt: null },
      { send, sendEmail: false }
    );
    expect(send).not.toHaveBeenCalled();
    [row] = await db.select().from(user).where(eq(user.id, target.id));
    expect(row.banned).toBe(true);
    expect(row.banReason).toBe("Quietly");
  });
});
