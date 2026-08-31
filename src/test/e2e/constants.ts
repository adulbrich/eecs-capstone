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

/**
 * Where the built server's output is teed, so a test can read an email.
 *
 * The console email transport writes to stderr and there is no file transport,
 * so the verification and password-reset links exist nowhere else: Better Auth
 * signs those tokens rather than storing them, and the `verification` table is
 * empty after a sign-up. Playwright pipes the server's output into its own
 * reporter, which a test cannot read, so the config tees it here as well.
 *
 * Relative for the shell that runs the server, absolute for the test that reads
 * it, because the two have different working directories.
 */
export const SERVER_LOG_RELATIVE = "src/test/e2e/.server.log";
export const SERVER_LOG = join(HERE, ".server.log");
