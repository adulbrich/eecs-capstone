import { config as loadDotenv } from 'dotenv';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from '../../db/schema';

const __dir = dirname(fileURLToPath(import.meta.url));
const BASE_URL = 'http://localhost:3000';
const PASSWORD = 'password';

export default async function globalSetup() {
  loadDotenv({ path: ['.env.local', '.env'] });

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool, { schema });

  try {
    await createFixtures(db);
  } finally {
    await pool.end();
  }

  await saveStorageState('user@example.com', join(__dir, '.user-auth.json'));
  await saveStorageState('admin@example.com', join(__dir, '.admin-auth.json'));
}

async function createFixtures(db: NodePgDatabase<typeof schema>) {
  const [owner] = await db
    .select()
    .from(schema.user)
    .where(eq(schema.user.email, 'user@example.com'));
  if (!owner) {
    throw new Error(
      'user@example.com not found in database. Run: npm run db:seed:dev',
    );
  }

  const [instructor] = await db
    .select()
    .from(schema.user)
    .where(eq(schema.user.email, 'instructor@example.com'));
  if (!instructor) {
    throw new Error(
      'instructor@example.com not found in database. Run: npm run db:seed:dev',
    );
  }

  // Category (no unique constraint on name — select-first pattern)
  let [category] = await db
    .select()
    .from(schema.categories)
    .where(eq(schema.categories.name, 'a11y-test-category'));
  if (!category) {
    [category] = await db
      .insert(schema.categories)
      .values({ name: 'a11y-test-category', type: 'technology' })
      .returning();
  }

  // Program (no unique constraint on courseId — select-first pattern)
  let [program] = await db
    .select()
    .from(schema.programs)
    .where(eq(schema.programs.courseId, 'A11Y-101'));
  if (!program) {
    [program] = await db
      .insert(schema.programs)
      .values({ courseId: 'A11Y-101', courseName: 'Accessibility Test Program' })
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
    .where(eq(schema.projects.title, 'A11Y Test Project'));
  if (!project) {
    [project] = await db
      .insert(schema.projects)
      .values({
        title: 'A11Y Test Project',
        description: 'A project created for accessibility testing.',
        status: 'published',
        proposerId: owner.id,
      })
      .returning();
  }

  // Inventory item (no unique constraint on name — select-first pattern)
  let [item] = await db
    .select()
    .from(schema.inventoryItems)
    .where(eq(schema.inventoryItems.name, 'A11Y Test Item'));
  if (!item) {
    [item] = await db
      .insert(schema.inventoryItems)
      .values({
        name: 'A11Y Test Item',
        description: 'An item for accessibility testing.',
      })
      .returning();
  }

  writeFileSync(
    join(__dir, '.fixtures.json'),
    JSON.stringify(
      {
        projectId: project.id,
        itemId: item.id,
        categoryId: category.id,
        programId: program.id,
        userId: owner.id,
      },
      null,
      2,
    ),
  );
}

async function saveStorageState(email: string, outputPath: string) {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(`${BASE_URL}/sign-in`);
  // Wait for the submit button to appear and React to finish hydrating.
  // Vite's HMR keeps connections open so networkidle never fires; instead
  // we wait for the button to be visible, then give React 1 s to attach its
  // event listeners before submitting.
  await page.waitForSelector('button[type="submit"]:not([disabled])', {
    state: 'visible',
    timeout: 15_000,
  });
  await page.waitForTimeout(1_000);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith('/sign-in'), {
    timeout: 15_000,
  });

  await context.storageState({ path: outputPath });
  await browser.close();
}
