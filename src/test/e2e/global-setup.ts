/**
 * Global setup for the end-to-end suite.
 *
 * Deliberately thin compared to the accessibility suite's setup. That one
 * builds populated rows for axe to scan; this one only needs the seeded users
 * to exist, three storage states to sign in with, and last run's wreckage
 * swept. Anything a test mutates is created by the test, in `fixtures.ts`.
 */
import { eq } from "drizzle-orm";
// biome-ignore lint/performance/noNamespaceImport: drizzle needs the schema namespace object
import * as schema from "../../db/schema";
import { SEED_PASSWORD, saveStorageState } from "../shared/playwright";
import {
  ADMIN_AUTH,
  BASE_URL,
  OTHER_AUTH,
  OTHER_EMAIL,
  USER_AUTH,
} from "./constants";
import { type Db, openDb, sweepOrphans } from "./fixtures";

export default async function globalSetup() {
  const { db, close } = openDb();
  try {
    await requireSeededUser(db, "user@example.com", "user");
    await requireSeededUser(db, "admin@example.com", "admin");
    await requireSeededUser(db, OTHER_EMAIL, "user");
    await sweepOrphans(db);
  } finally {
    await close();
  }

  await Promise.all([
    saveStorageState({
      baseURL: BASE_URL,
      email: "user@example.com",
      password: SEED_PASSWORD,
      outputPath: USER_AUTH,
    }),
    saveStorageState({
      baseURL: BASE_URL,
      email: "admin@example.com",
      password: SEED_PASSWORD,
      outputPath: ADMIN_AUTH,
    }),
    // Paid by the smoke run on the pull-request path too, since both suites
    // share this setup. One more headless sign-in is small against that job's
    // 5-minute budget, and splitting the setup per suite would mean two files
    // that have to agree about the sweep.
    saveStorageState({
      baseURL: BASE_URL,
      email: OTHER_EMAIL,
      password: SEED_PASSWORD,
      outputPath: OTHER_AUTH,
    }),
  ]);
}

async function requireSeededUser(db: Db, email: string, role: string) {
  const [found] = await db
    .select()
    .from(schema.user)
    .where(eq(schema.user.email, email));
  if (!found) {
    throw new Error(`${email} not found in database. Run: npm run db:seed:dev`);
  }
  if (found.role !== role) {
    throw new Error(
      `${email} has role '${found.role}', expected '${role}'. Run: npm run db:seed:dev`
    );
  }
}
