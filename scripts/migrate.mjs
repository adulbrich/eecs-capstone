/**
 * Production migration runner.
 *
 * Applies the SQL migrations in ./drizzle using drizzle-orm's runtime
 * migrator (node-postgres). Unlike `drizzle-kit migrate`, this needs only
 * the production dependencies (drizzle-orm + pg), so it runs from the same
 * container image the server uses. The deploy workflow invokes this as a
 * one-off ECS task before rolling out new application code.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL environment variable is not set");
}

const pool = new pg.Pool({ connectionString });

try {
  await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  console.log("Migrations applied successfully");
} finally {
  await pool.end();
}
