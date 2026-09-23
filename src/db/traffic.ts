import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { logPoolErrors, trafficPoolConfig } from "#/lib/_internal/db-pool";
import { trafficEvents, trafficSalt } from "./schema.ts";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL environment variable is not set");
}

// The traffic writer's pool, separate from the app's in `index.ts` and capped
// at `CONNECTION_BUDGET.trafficPerTask` (ADR-0034). Only the traffic tables
// are in its schema, because nothing else may be written through it.
const pool = new Pool(trafficPoolConfig(databaseUrl));
logPoolErrors(pool);

export const trafficDb = drizzle({
  client: pool,
  schema: { trafficEvents, trafficSalt },
});

export type TrafficDb = typeof trafficDb;
