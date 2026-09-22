// Run via `npm run db:seed:admin` (uses tsx --env-file=.env.local).
// Direct invocation requires env vars set in the shell.
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { user } from "../src/db/schema";
import { auth } from "../src/lib/auth";

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL;
  if (!email) {
    console.error("SEED_ADMIN_EMAIL must be set");
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

  // No password: sign in with an emailed code (#576).
  const result = await auth.api.createUser({
    body: { email, name: "Admin" },
  });
  await db
    .update(user)
    .set({ role: "admin", emailVerified: true })
    .where(eq(user.id, result.user.id));
  console.log(`Created admin ${email}`);
}

main().then(() => process.exit(0));
