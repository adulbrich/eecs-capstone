import { drizzle } from "drizzle-orm/node-postgres";
import { poolConfig } from "#/lib/_internal/db-pool";

// biome-ignore lint/performance/noNamespaceImport: drizzle needs the schema namespace object
import * as schema from "./schema.ts";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL environment variable is not set");
}

// The pool is sized on purpose. The numbers and their budget live in
// src/lib/_internal/db-pool.ts, where a unit test holds them to the RDS
// ceiling (#521).
export const db = drizzle({ connection: poolConfig(databaseUrl), schema });
