import { sql } from "drizzle-orm";
import { db } from "#/db";
import { clearAllReferenceListCaches } from "#/lib/_internal/reference-list-cache";

const TABLES = [
  // Rate-limit counters leak across tests otherwise: a limiter test would see
  // rows from the test before it and block a call it expected to allow.
  "ai_review_usage",
  "verification_sends",
  "traffic_events",
  "traffic_salt",
  "traffic_visits",
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
  "project_programs",
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
  // The integration config turns the reference list cache on, and a cached
  // list would outlive the rows this just truncated.
  clearAllReferenceListCaches();
}
