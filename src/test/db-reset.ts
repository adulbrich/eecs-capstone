import { sql } from "drizzle-orm";
import { db } from "#/db";

const TABLES = [
  // Rate-limit counters leak across tests otherwise: a limiter test would see
  // rows from the test before it and block a call it expected to allow.
  "ai_review_usage",
  "notifications",
  "inventory_requests",
  "inventory_items",
  "project_bookmarks",
  "project_assignments",
  "project_bids",
  "project_status_history",
  "project_comments",
  "project_collaborators",
  "project_categories",
  "projects",
  "categories",
  "program_instructors",
  "programs",
  "verification",
  "account",
  "session",
  "user_interests",
  "user",
];

export async function resetDatabase() {
  for (const t of TABLES) {
    await db.execute(sql.raw(`TRUNCATE TABLE "${t}" CASCADE;`));
  }
}
