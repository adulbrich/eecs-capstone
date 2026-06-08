/**
 * Promote an existing user to admin (production bootstrap).
 *
 * The user must already exist (have signed up through the app), so their
 * password is hashed correctly by Better Auth. This script only flips the
 * role to `admin` and marks the email verified, using nothing but the
 * production `pg` dependency. Run it as a one-off ECS task:
 *
 *   ... run-task ... --overrides '{"containerOverrides":[{
 *     "name":"app",
 *     "command":["node","scripts/promote-admin.mjs"],
 *     "environment":[{"name":"ADMIN_EMAIL","value":"you@example.edu"}]
 *   }]}'
 *
 * Keep at least TWO admins in production (the app blocks a sole admin from
 * demoting or banning themselves).
 */
import pg from "pg";

const email = process.env.ADMIN_EMAIL ?? process.argv[2];
if (!email) {
  throw new Error("ADMIN_EMAIL (or first CLI argument) is required");
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL environment variable is not set");
}

const pool = new pg.Pool({ connectionString });

try {
  const result = await pool.query(
    `UPDATE "user"
        SET role = 'admin', email_verified = true
      WHERE email = $1
      RETURNING id, email, role`,
    [email]
  );

  if (result.rowCount === 0) {
    console.error(`No user found with email ${email}. Sign up via the app first.`);
    process.exit(1);
  }

  console.log(`Promoted ${email} to admin`);
} finally {
  await pool.end();
}
