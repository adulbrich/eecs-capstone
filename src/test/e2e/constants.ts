import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Values shared by the config, the global setup and the tests. The port is not
 * 3000 on purpose: `reuseExistingServer` is off for this suite, so a dev server
 * on the usual port would make the run fail to bind rather than silently test
 * the wrong build. Moving to 3001 keeps both runnable at once, and
 * BETTER_AUTH_URL moves with it so Better Auth's origin checks still pass.
 */
export const PORT = 3001;
export const BASE_URL = `http://localhost:${PORT}`;

// Absolute, because ESM has no __dirname and every caller would otherwise
// rebuild the same fileURLToPath dance.
const HERE = dirname(fileURLToPath(import.meta.url));
export const USER_AUTH = join(HERE, ".user-auth.json");
export const ADMIN_AUTH = join(HERE, ".admin-auth.json");

/**
 * A second plain user, for the flows that assert one student cannot see
 * another's. Those assertions need a signed-in viewer who is neither staff nor
 * the owner of the row under test, and `user@example.com` is the owner in every
 * one of them. Seeded by `scripts/seed-dev.ts` with role `user`.
 */
export const OTHER_AUTH = join(HERE, ".other-auth.json");
export const OTHER_EMAIL = "leej@oregonstate.edu";
