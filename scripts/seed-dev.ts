// Run via `npm run db:seed:dev` (uses tsx --env-file=.env.local).
// Direct invocation requires env vars set in the shell.
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { user } from "../src/db/schema";
import { auth } from "../src/lib/auth";

const SEEDS = [
  { email: "user@example.com", name: "Dev User", role: "user" },
  { email: "instructor@example.com", name: "Dev Instructor", role: "instructor" },
  { email: "admin@example.com", name: "Dev Admin", role: "admin" },
] as const;

const PASSWORD = "password";

async function seed(seed: (typeof SEEDS)[number]) {
  const [existing] = await db.select().from(user).where(eq(user.email, seed.email));
  if (existing) {
    if (existing.role !== seed.role || !existing.emailVerified) {
      await db
        .update(user)
        .set({ role: seed.role, emailVerified: true })
        .where(eq(user.id, existing.id));
      console.log(`updated ${seed.email} (role=${seed.role}, emailVerified=true)`);
    } else {
      console.log(`${seed.email} already seeded`);
    }
    return;
  }
  const result = await auth.api.signUpEmail({
    body: { email: seed.email, password: PASSWORD, name: seed.name },
  });
  if (!result?.user) {
    console.error(`sign-up did not return a user for ${seed.email}`);
    process.exit(1);
  }
  await db
    .update(user)
    .set({ role: seed.role, emailVerified: true })
    .where(eq(user.id, result.user.id));
  console.log(`created ${seed.email} (role=${seed.role}, password=${PASSWORD})`);
}

async function main() {
  for (const s of SEEDS) {
    await seed(s);
  }
}

main().then(() => process.exit(0));
