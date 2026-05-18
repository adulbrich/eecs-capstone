// Run via `npm run db:seed:admin` (uses tsx --env-file=.env.local).
// Direct invocation requires env vars set in the shell.
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { user } from "../src/db/schema";
import { auth } from "../src/lib/auth";

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password) {
    console.error("SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD must be set");
    process.exit(1);
  }

  const [existing] = await db.select().from(user).where(eq(user.email, email));
  if (existing) {
    if (existing.role !== "admin") {
      await db
        .update(user)
        .set({ role: "admin" })
        .where(eq(user.id, existing.id));
      console.log(`Promoted ${email} to admin`);
    } else {
      console.log(`${email} is already admin`);
    }
    return;
  }

  const result = await auth.api.signUpEmail({
    body: { email, password, name: "Admin" },
  });
  if (!result?.user) {
    console.error("Sign-up did not return a user");
    process.exit(1);
  }
  await db
    .update(user)
    .set({ role: "admin", emailVerified: true })
    .where(eq(user.id, result.user.id));
  console.log(`Created admin ${email}`);
}

main().then(() => process.exit(0));
