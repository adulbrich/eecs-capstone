import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { config as loadDotenv } from "dotenv";
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
// biome-ignore lint/performance/noNamespaceImport: drizzle needs the schema namespace object
import * as schema from "../../db/schema";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE_URL = "http://localhost:3000";
// Must match the value set by scripts/seed-dev.ts.
const PASSWORD = "password";

export default async function globalSetup() {
  loadDotenv({ path: [".env.local", ".env"] });

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool, { schema });

  try {
    await createFixtures(db);
  } finally {
    await pool.end();
  }

  await Promise.all([
    saveStorageState("user@example.com", join(__dirname, ".user-auth.json")),
    saveStorageState("admin@example.com", join(__dirname, ".admin-auth.json")),
  ]);
}

async function createFixtures(db: NodePgDatabase<typeof schema>) {
  const [owner] = await db
    .select()
    .from(schema.user)
    .where(eq(schema.user.email, "user@example.com"));
  if (!owner) {
    throw new Error(
      "user@example.com not found in database. Run: npm run db:seed:dev"
    );
  }

  const [instructor] = await db
    .select()
    .from(schema.user)
    .where(eq(schema.user.email, "instructor@example.com"));
  if (!instructor) {
    throw new Error(
      "instructor@example.com not found in database. Run: npm run db:seed:dev"
    );
  }
  // instructor is only used as a program_instructors DB fixture — no auth session needed.

  const [adminUser] = await db
    .select()
    .from(schema.user)
    .where(eq(schema.user.email, "admin@example.com"));
  if (!adminUser) {
    throw new Error(
      "admin@example.com not found in database. Run: npm run db:seed:dev"
    );
  }
  if (adminUser.role !== "admin") {
    throw new Error(
      `admin@example.com has role '${adminUser.role}', expected 'admin'. Run: npm run db:seed:dev`
    );
  }

  // Opt the owner user into mentoring so /admin/mentors renders a populated
  // row (Input + Save/Remove buttons) for axe to scan, not just the empty state.
  await db
    .update(schema.user)
    .set({ wantsToMentor: true, mentorTeamCount: 2 })
    .where(eq(schema.user.id, owner.id));

  // Note: select-first is non-atomic. Concurrent global-setup runs could produce
  // duplicate rows since these tables have no UNIQUE constraint on their sentinel
  // values. Acceptable for single-worker CI; revisit if workers > 1.

  // Category (no unique constraint on name — select-first pattern)
  let [category] = await db
    .select()
    .from(schema.categories)
    .where(eq(schema.categories.name, "a11y-test-category"));
  if (!category) {
    [category] = await db
      .insert(schema.categories)
      .values({ name: "a11y-test-category", type: "technology" })
      .returning();
  }

  // Program (no unique constraint on courseId — select-first pattern)
  let [program] = await db
    .select()
    .from(schema.programs)
    .where(eq(schema.programs.courseId, "A11Y-101"));
  if (!program) {
    [program] = await db
      .insert(schema.programs)
      .values({
        courseId: "A11Y-101",
        courseName: "Accessibility Test Program",
      })
      .returning();
  }

  // Program instructor join (has composite PK — safe to use onConflictDoNothing)
  await db
    .insert(schema.programInstructors)
    .values({ programId: program.id, userId: instructor.id })
    .onConflictDoNothing();

  // Project (no unique constraint on title — select-first pattern)
  let [project] = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.title, "A11Y Test Project"));
  if (!project) {
    [project] = await db
      .insert(schema.projects)
      .values({
        title: "A11Y Test Project",
        description:
          "## Overview\n\nThis project was **created** for *accessibility testing* " +
          "of the markdown-authoring feature. See the [project charter]" +
          "(https://example.com/charter) for background.\n\n" +
          "Key aspects:\n\n" +
          "- Renders headings, lists, and links\n" +
          "- Exercises bold and italic emphasis\n" +
          "- Includes a fenced code block\n\n" +
          '```js\nconst status = "published";\n```',
        problemStatement:
          "# Problem Statement\n\n" +
          "Capstone teams currently **lack** a way to author *rich* project " +
          "descriptions. Without markdown support, students cannot:\n\n" +
          "1. Link to external references\n" +
          "2. Format code snippets\n" +
          "3. Structure long text with headings\n\n" +
          "See the [accessibility guidelines](https://example.com/a11y) for " +
          "more detail.\n\n```bash\nnpm run test:accessibility\n```",
        objectives:
          "## Objectives\n\n" +
          "The team will pursue the following *primary* and **secondary** goals:\n\n" +
          "1. Ship a markdown renderer that is accessible by default\n" +
          "2. Clamp author headings so page structure stays valid\n" +
          "3. Keep links [safe](https://example.com/safety) with proper `rel` attributes\n\n" +
          "- No raw HTML execution\n" +
          "- No layout regressions\n\n```ts\nexport const done = true;\n```",
        minQualifications:
          "## Minimum Qualifications\n\n" +
          "Applicants should be comfortable with **TypeScript** and *React*, " +
          "and have reviewed the [contribution guide]" +
          "(https://example.com/contributing).\n\n" +
          "Required skills:\n\n" +
          "- Familiarity with accessible markup\n" +
          "- Experience writing automated tests\n\n" +
          "1. Complete the onboarding checklist\n" +
          "2. Set up the local dev environment\n\n```sh\nnpm install\n```",
        status: "published",
        proposerId: owner.id,
      })
      .returning();
  }

  // Inventory item (no unique constraint on name — select-first pattern)
  let [item] = await db
    .select()
    .from(schema.inventoryItems)
    .where(eq(schema.inventoryItems.name, "A11Y Test Item"));
  if (!item) {
    [item] = await db
      .insert(schema.inventoryItems)
      .values({
        name: "A11Y Test Item",
        description: "An item for accessibility testing.",
      })
      .returning();
  }

  writeFileSync(
    join(__dirname, ".fixtures.json"),
    JSON.stringify(
      {
        projectId: project.id,
        itemId: item.id,
        categoryId: category.id,
        programId: program.id,
        userId: owner.id,
      },
      null,
      2
    )
  );
}

async function saveStorageState(email: string, outputPath: string) {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(`${BASE_URL}/sign-in`, { waitUntil: "load" });
    // Wait for React hydration before interacting with the form.
    await page.waitForFunction(
      () => {
        const form = document.querySelector("form");
        if (!form) {
          return false;
        }
        return Object.keys(form).some(
          (k) => k.startsWith("__reactFiber") || k.startsWith("__reactProps")
        );
      },
      { timeout: 15_000 }
    );
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"), {
      timeout: 15_000,
    });
    await context.storageState({ path: outputPath });
  } finally {
    await browser.close();
  }
}
