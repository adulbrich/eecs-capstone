import { createServerFn } from "@tanstack/react-start";
import { and, isNull, sql } from "drizzle-orm";
import { db } from "#/db";
import { projects, user } from "#/db/schema";
import { requireUser } from "#/lib/_internal/auth-guards";
import { isStaff } from "#/lib/project-visibility";

function count() {
  return sql<number>`count(*)::int`;
}

export const getAdminStats = createServerFn({ method: "GET" }).handler(
  async () => {
    const viewer = await requireUser();
    if (!isStaff(viewer)) {
      throw new Error("Forbidden");
    }

    const [[{ total }], [{ published }], [{ submitted }], [{ userTotal }]] =
      await Promise.all([
        db
          .select({ total: count() })
          .from(projects)
          .where(isNull(projects.deletedAt)),
        db
          .select({ published: count() })
          .from(projects)
          .where(
            and(
              sql`${projects.status} = 'published'`,
              isNull(projects.deletedAt)
            )
          ),
        db
          .select({ submitted: count() })
          .from(projects)
          .where(
            and(
              sql`${projects.status} = 'submitted'`,
              isNull(projects.deletedAt)
            )
          ),
        db.select({ userTotal: count() }).from(user),
      ]);

    return { total, published, submitted, userTotal };
  }
);
