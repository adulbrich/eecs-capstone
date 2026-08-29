import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import { eq, like } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
// biome-ignore lint/performance/noNamespaceImport: drizzle needs the schema namespace object
import * as schema from "../../db/schema";
import { SEED_PASSWORD, saveStorageState } from "../shared/playwright";

// Prefixes used by the create-dialog-plus-dropdown coverage in
// admin.a11y.test.ts. Those rows are deleted by the test itself on success,
// but a failed assertion partway through would otherwise leave one behind
// forever. Sweeping by prefix here makes a failed run self-heal on the next
// one, the same role the rest of this file's select-first fixtures play.
const DIALOG_CATEGORY_NAME_PREFIX = "A11y Dialog Category ";
const DIALOG_PROGRAM_COURSE_ID_PREFIX = "A11Y-DLG-";
// Extra users so /admin/users has more than one page of real rows (pageSize
// is 20). The dev seed alone never clears that bar, and the pagination-reset
// assertion in admin.a11y.test.ts needs an actual second page to sort from,
// not just a page=2 URL with nothing behind it.
const PAGINATION_USER_COUNT = 15;

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE_URL = "http://localhost:3000";

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
    saveStorageState({
      baseURL: BASE_URL,
      email: "user@example.com",
      password: SEED_PASSWORD,
      outputPath: join(__dirname, ".user-auth.json"),
    }),
    saveStorageState({
      baseURL: BASE_URL,
      email: "admin@example.com",
      password: SEED_PASSWORD,
      outputPath: join(__dirname, ".admin-auth.json"),
    }),
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
  // instructor is only used as a program_instructors DB fixture: no auth session needed.

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

  // Self-heal any row left behind by a create-dialog test that failed after
  // creating but before its own cleanup ran.
  await db
    .delete(schema.categories)
    .where(like(schema.categories.name, `${DIALOG_CATEGORY_NAME_PREFIX}%`));
  await db
    .delete(schema.programs)
    .where(
      like(schema.programs.courseId, `${DIALOG_PROGRAM_COURSE_ID_PREFIX}%`)
    );

  // Idempotent, select-first, same pattern as the rest of this function.
  // Explicit, spread-out createdAt values matter here: userOrderBy's
  // `createdAt DESC` has no tiebreaker, and rows sharing the same
  // defaultNow() timestamp would make LIMIT/OFFSET pagination unstable
  // across the two pages the sort-reset test depends on.
  for (let i = 0; i < PAGINATION_USER_COUNT; i++) {
    const email = `a11y-pagination-user-${i}@example.com`;
    const [existingPaginationUser] = await db
      .select()
      .from(schema.user)
      .where(eq(schema.user.email, email));
    if (!existingPaginationUser) {
      await db.insert(schema.user).values({
        id: randomUUID(),
        name: `A11y Pagination User ${i}`,
        email,
        emailVerified: true,
        role: "user",
        createdAt: new Date(Date.now() - (i + 1) * 60_000),
      });
    }
  }

  // Note: select-first is non-atomic. Concurrent global-setup runs could produce
  // duplicate rows since these tables have no UNIQUE constraint on their sentinel
  // values. Acceptable for single-worker CI; revisit if workers > 1.

  // Category (no unique constraint on name, hence the select-first pattern)
  let [category] = await db
    .select()
    .from(schema.categories)
    .where(eq(schema.categories.name, "a11y-test-category"));
  if (!category) {
    [category] = await db
      .insert(schema.categories)
      .values({
        name: "a11y-test-category",
        domain: "project",
        type: "technology",
      })
      .returning();
  }

  // Program (no unique constraint on courseId, hence the select-first pattern)
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

  // Program instructor join (has composite PK, so onConflictDoNothing is safe)
  await db
    .insert(schema.programInstructors)
    .values({ programId: program.id, userId: instructor.id })
    .onConflictDoNothing();

  // Project (no unique constraint on title, hence the select-first pattern)
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

  // Inventory item (no unique constraint on name, hence the select-first pattern)
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

  // Draft project owned by the fixture user (no unique constraint on title,
  // select-first pattern). user.a11y.test.ts needs a draft it can sign in as
  // user@example.com and see a delete trigger on: the dev seed's only draft
  // (71203d97-6bfe-4580-a318-594522c1ef8e) is proposed by
  // riveras@oregonstate.edu, not the fixture owner, so OwnerProjectActions
  // never renders the delete confirmation dialog for that user.
  let [draftProject] = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.title, "A11Y Test Draft Project"));
  if (!draftProject) {
    [draftProject] = await db
      .insert(schema.projects)
      .values({
        title: "A11Y Test Draft Project",
        description:
          "A draft project owned by the fixture user, used to " +
          "scan the delete confirmation dialog in its open and closed states.",
        status: "draft",
        proposerId: owner.id,
        proposerEmail: owner.email,
      })
      .returning();
  }

  writeFileSync(
    join(__dirname, ".fixtures.json"),
    JSON.stringify(
      {
        projectId: project.id,
        draftProjectId: draftProject.id,
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
