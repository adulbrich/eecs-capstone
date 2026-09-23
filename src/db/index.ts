import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import {
  logPoolErrors,
  poolConfig,
  startPoolMetrics,
} from "#/lib/_internal/db-pool";

// biome-ignore lint/performance/noNamespaceImport: drizzle needs the schema namespace object
import * as schema from "./schema.ts";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL environment variable is not set");
}

// Still one pool for the whole app, built here rather than by the drizzle
// string shortcut so the error listener is attached before anything can
// query it. The sizing and its budget live in src/lib/_internal/db-pool.ts
// (#521); the listener is what keeps a dropped connection from exiting the
// process (#525).
const pool = new Pool(poolConfig(databaseUrl));
logPoolErrors(pool);

// Production builds only, `npm run start` and the E2E server included: Nitro
// inlines NODE_ENV when it builds, so this is decided then, not at runtime.
// The line lands in CloudWatch as a metric in production, and in a dev console
// it would be one line of noise a minute (#558).
if (process.env.NODE_ENV === "production") {
  startPoolMetrics(pool);
}

export const db = drizzle({ client: pool, schema });
