import { createServerFn } from "@tanstack/react-start";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "#/db";
import { inventoryRequestItems, projects, user } from "#/db/schema";
import { requireUser } from "#/lib/_internal/auth-guards";
import { isStaff } from "#/lib/viewer";

function count() {
  return sql<number>`count(*)::int`;
}

export const getAdminStats = createServerFn({ method: "GET" }).handler(
  async () => {
    const viewer = await requireUser();
    if (!isStaff({ id: viewer.id, role: viewer.role ?? null })) {
      throw new Error("Forbidden");
    }

    const [
      [{ total }],
      [{ published }],
      [{ publishedTeamCapacity }],
      [{ submitted }],
      [{ userTotal }],
      [mentorStats],
      [{ pendingRequests }],
    ] = await Promise.all([
      db
        .select({ total: count() })
        .from(projects)
        .where(isNull(projects.deletedAt)),
      db
        .select({ published: count() })
        .from(projects)
        .where(
          and(sql`${projects.status} = 'published'`, isNull(projects.deletedAt))
        ),
      // Team slots the published catalog currently offers, which is the number
      // staff plan intake against; the project count alone understates it,
      // since one project can take up to five teams.
      db
        .select({
          publishedTeamCapacity: sql<number>`coalesce(sum(${projects.teamsSupported}), 0)::int`,
        })
        .from(projects)
        .where(
          and(sql`${projects.status} = 'published'`, isNull(projects.deletedAt))
        ),
      db
        .select({ submitted: count() })
        .from(projects)
        .where(
          and(sql`${projects.status} = 'submitted'`, isNull(projects.deletedAt))
        ),
      db.select({ userTotal: count() }).from(user),
      // Mentors and the teams they have signed up to take, the supply side of
      // the same question the published-projects card answers for demand.
      db
        .select({
          mentorTotal: count(),
          mentorTeamCapacity: sql<number>`coalesce(sum(${user.mentorTeamCount}), 0)::int`,
        })
        .from(user)
        .where(eq(user.wantsToMentor, true)),
      // Distinct requests with at least one pending line, matching the number
      // of cards shown on /admin/inventory/requests?tab=pending.
      db
        .select({
          pendingRequests: sql<number>`count(distinct ${inventoryRequestItems.requestId})::int`,
        })
        .from(inventoryRequestItems)
        .where(eq(inventoryRequestItems.status, "pending")),
    ]);

    return {
      total,
      published,
      publishedTeamCapacity,
      mentorTotal: mentorStats?.mentorTotal ?? 0,
      mentorTeamCapacity: mentorStats?.mentorTeamCapacity ?? 0,
      submitted,
      userTotal,
      pendingRequests,
    };
  }
);
