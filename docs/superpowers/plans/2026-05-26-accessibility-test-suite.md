# Accessibility Test Suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Playwright + axe-core accessibility test suite that scans every page in both light and dark color schemes against WCAG 2.1 AA rules, with a `test:accessibility` npm script.

**Architecture:** A dedicated `playwright.a11y.config.ts` defines two Playwright browser projects (`chromium-light` / `chromium-dark`) that share all test files, so every page is scanned twice with no code duplication. A global setup function seeds the database with content fixtures, logs in as `user@example.com` and `admin@example.com`, and saves their session cookies as storage-state files that the user/admin test files consume.

**Tech Stack:** `@playwright/test`, `@axe-core/playwright`, `drizzle-orm/node-postgres`, `pg` (already in deps), `dotenv` (already in devDeps)

**Prerequisites:** Before the first run, `npm run db:seed:dev` must have been executed. This creates `user@example.com`, `instructor@example.com`, and `admin@example.com` with password `password`. The accessibility global setup depends on these users existing.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `playwright.a11y.config.ts` | Playwright config: 2 projects, webServer, globalSetup |
| Create | `src/test/a11y/global-setup.ts` | Seed DB fixtures, save auth storage state |
| Create | `src/test/a11y/helpers.ts` | `checkA11y()` axe wrapper |
| Create | `src/test/a11y/public.a11y.test.ts` | 10 public pages (no auth) |
| Create | `src/test/a11y/user.a11y.test.ts` | 6 user-authenticated pages |
| Create | `src/test/a11y/admin.a11y.test.ts` | 13 admin-authenticated pages |
| Modify | `package.json` | Add `test:accessibility`, update `test` exclude |
| Modify | `.gitignore` | Ignore generated auth/fixture files and Playwright output |

---

## Task 1: Install Dependencies and Update .gitignore

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Install Playwright and axe**

```bash
npm install --save-dev @playwright/test @axe-core/playwright
```

Expected output: both packages added to `devDependencies` in `package.json`.

- [ ] **Step 2: Install Chromium browser binary**

```bash
npx playwright install chromium
```

Expected output: `Chromium X.Y.Z (playwright build NNNN) downloaded to ...`

- [ ] **Step 3: Update .gitignore**

Open `.gitignore` and append:

```
src/test/a11y/.user-auth.json
src/test/a11y/.admin-auth.json
src/test/a11y/.fixtures.json
playwright-report/
test-results/
```

- [ ] **Step 4: Commit**

```bash
git add .gitignore package.json package-lock.json
git commit -m "chore: install playwright and axe-core for accessibility testing"
```

---

## Task 2: Create `playwright.a11y.config.ts`

**Files:**
- Create: `playwright.a11y.config.ts`

- [ ] **Step 1: Write the config**

Create `playwright.a11y.config.ts` at the project root:

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './src/test/a11y',
  testMatch: '**/*.a11y.test.ts',
  globalSetup: './src/test/a11y/global-setup.ts',
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report/a11y', open: 'never' }],
  ],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium-light',
      use: { ...devices['Desktop Chrome'], colorScheme: 'light' },
    },
    {
      name: 'chromium-dark',
      use: { ...devices['Desktop Chrome'], colorScheme: 'dark' },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
```

- [ ] **Step 2: Verify the config parses**

```bash
npx playwright test --config playwright.a11y.config.ts --list
```

Expected output: A table of test files (may be empty if test files don't exist yet). No import errors.

- [ ] **Step 3: Commit**

```bash
git add playwright.a11y.config.ts
git commit -m "chore: add playwright accessibility config"
```

---

## Task 3: Create `src/test/a11y/global-setup.ts`

**Files:**
- Create: `src/test/a11y/global-setup.ts`

This file runs once before any tests. It seeds content fixtures (project, inventory item, category, program) and saves Playwright storage state for two users. It accesses the database directly using the same `drizzle-orm/node-postgres` driver the app uses, but opens its own connection to avoid importing from `#/db` (which has a path-alias that Playwright's transpiler does not resolve).

- [ ] **Step 1: Write global-setup.ts**

```ts
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
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith('/sign-in'), {
    timeout: 15_000,
  });

  await context.storageState({ path: outputPath });
  await browser.close();
}
```

- [ ] **Step 2: Run only the global setup to verify it works**

Ensure the dev server is NOT running yet (global setup starts it via webServer):

```bash
npm run db:seed:dev
npx playwright test --config playwright.a11y.config.ts --list
```

The `--list` flag will trigger global setup without running tests. Expected outcome: no errors, `.fixtures.json`, `.user-auth.json`, `.admin-auth.json` created in `src/test/a11y/`. Verify:

```bash
cat src/test/a11y/.fixtures.json
```

Expected: JSON with `projectId`, `itemId`, `categoryId`, `programId`, `userId` all as UUIDs.

- [ ] **Step 3: Commit**

```bash
git add src/test/a11y/global-setup.ts
git commit -m "test(a11y): add global setup for fixture seeding and auth storage"
```

---

## Task 4: Create `src/test/a11y/helpers.ts`

**Files:**
- Create: `src/test/a11y/helpers.ts`

- [ ] **Step 1: Write helpers.ts**

```ts
import { expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

export async function checkA11y(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: 15_000 });
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/test/a11y/helpers.ts
git commit -m "test(a11y): add checkA11y helper"
```

---

## Task 5: Create `src/test/a11y/public.a11y.test.ts`

**Files:**
- Create: `src/test/a11y/public.a11y.test.ts`

These tests run without any auth storage state. Dynamic routes (`/projects/:id` and `/inventory/:id`) read IDs from `.fixtures.json`.

- [ ] **Step 1: Write public.a11y.test.ts**

```ts
import { test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkA11y } from './helpers';

const { projectId, itemId } = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '.fixtures.json'),
    'utf-8',
  ),
) as { projectId: string; itemId: string };

test('home page', async ({ page }) => {
  await page.goto('/');
  await checkA11y(page);
});

test('sign-in page', async ({ page }) => {
  await page.goto('/sign-in');
  await checkA11y(page);
});

test('sign-up page', async ({ page }) => {
  await page.goto('/sign-up');
  await checkA11y(page);
});

test('verify-email page', async ({ page }) => {
  await page.goto('/verify-email');
  await checkA11y(page);
});

test('forgot-password page', async ({ page }) => {
  await page.goto('/forgot-password');
  await checkA11y(page);
});

test('reset-password page', async ({ page }) => {
  await page.goto('/reset-password');
  await checkA11y(page);
});

test('projects list', async ({ page }) => {
  await page.goto('/projects');
  await checkA11y(page);
});

test('project detail', async ({ page }) => {
  await page.goto(`/projects/${projectId}`);
  await checkA11y(page);
});

test('inventory list', async ({ page }) => {
  await page.goto('/inventory');
  await checkA11y(page);
});

test('inventory item detail', async ({ page }) => {
  await page.goto(`/inventory/${itemId}`);
  await checkA11y(page);
});
```

- [ ] **Step 2: Run the public tests to verify they execute**

```bash
npx playwright test --config playwright.a11y.config.ts public.a11y.test.ts --project chromium-light
```

Expected: tests run (20 total: 10 pages × 2 projects, but this command runs only light). Any failures due to axe violations are real accessibility issues in the app — note them but do not block the plan on fixing them. Infrastructure failures (404s, timeout errors, import errors) must be resolved.

- [ ] **Step 3: Commit**

```bash
git add src/test/a11y/public.a11y.test.ts
git commit -m "test(a11y): add public page accessibility tests"
```

---

## Task 6: Create `src/test/a11y/user.a11y.test.ts`

**Files:**
- Create: `src/test/a11y/user.a11y.test.ts`

These tests run as `user@example.com`. The fixture project is owned by this user, so `/projects/:id/edit` will render the edit form.

- [ ] **Step 1: Write user.a11y.test.ts**

```ts
import { test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkA11y } from './helpers';

const __dir = dirname(fileURLToPath(import.meta.url));

const { projectId } = JSON.parse(
  readFileSync(join(__dir, '.fixtures.json'), 'utf-8'),
) as { projectId: string };

test.use({ storageState: join(__dir, '.user-auth.json') });

test('my projects', async ({ page }) => {
  await page.goto('/my/projects');
  await checkA11y(page);
});

test('my bookmarks', async ({ page }) => {
  await page.goto('/my/bookmarks');
  await checkA11y(page);
});

test('my items', async ({ page }) => {
  await page.goto('/my/items');
  await checkA11y(page);
});

test('profile page', async ({ page }) => {
  await page.goto('/profile');
  await checkA11y(page);
});

test('new project form', async ({ page }) => {
  await page.goto('/projects/new');
  await checkA11y(page);
});

test('edit project form', async ({ page }) => {
  await page.goto(`/projects/${projectId}/edit`);
  await checkA11y(page);
});
```

- [ ] **Step 2: Run the user tests to verify they execute**

```bash
npx playwright test --config playwright.a11y.config.ts user.a11y.test.ts --project chromium-light
```

Expected: 6 tests run, authenticated pages load (not redirected to sign-in). If any test redirects to `/sign-in`, the storage state was not saved correctly — re-run `npx playwright test --config playwright.a11y.config.ts --list` to regenerate it.

- [ ] **Step 3: Commit**

```bash
git add src/test/a11y/user.a11y.test.ts
git commit -m "test(a11y): add user-authenticated page accessibility tests"
```

---

## Task 7: Create `src/test/a11y/admin.a11y.test.ts`

**Files:**
- Create: `src/test/a11y/admin.a11y.test.ts`

These tests run as `admin@example.com`. All 13 admin routes are covered, including all dynamic ID routes using fixture IDs.

- [ ] **Step 1: Write admin.a11y.test.ts**

```ts
import { test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkA11y } from './helpers';

const __dir = dirname(fileURLToPath(import.meta.url));

const { itemId, categoryId, programId, userId } = JSON.parse(
  readFileSync(join(__dir, '.fixtures.json'), 'utf-8'),
) as {
  itemId: string;
  categoryId: string;
  programId: string;
  userId: string;
};

test.use({ storageState: join(__dir, '.admin-auth.json') });

test('admin dashboard', async ({ page }) => {
  await page.goto('/admin');
  await checkA11y(page);
});

test('admin inventory list', async ({ page }) => {
  await page.goto('/admin/inventory');
  await checkA11y(page);
});

test('admin inventory new', async ({ page }) => {
  await page.goto('/admin/inventory/new');
  await checkA11y(page);
});

test('admin inventory item detail', async ({ page }) => {
  await page.goto(`/admin/inventory/${itemId}`);
  await checkA11y(page);
});

test('admin inventory item edit', async ({ page }) => {
  await page.goto(`/admin/inventory/${itemId}/edit`);
  await checkA11y(page);
});

test('admin inventory requests', async ({ page }) => {
  await page.goto('/admin/inventory/requests');
  await checkA11y(page);
});

test('admin projects list', async ({ page }) => {
  await page.goto('/admin/projects');
  await checkA11y(page);
});

test('admin users list', async ({ page }) => {
  await page.goto('/admin/users');
  await checkA11y(page);
});

test('admin user detail', async ({ page }) => {
  await page.goto(`/admin/users/${userId}`);
  await checkA11y(page);
});

test('admin categories list', async ({ page }) => {
  await page.goto('/admin/categories');
  await checkA11y(page);
});

test('admin category detail', async ({ page }) => {
  await page.goto(`/admin/categories/${categoryId}`);
  await checkA11y(page);
});

test('admin programs list', async ({ page }) => {
  await page.goto('/admin/programs');
  await checkA11y(page);
});

test('admin program detail', async ({ page }) => {
  await page.goto(`/admin/programs/${programId}`);
  await checkA11y(page);
});
```

- [ ] **Step 2: Run the admin tests to verify they execute**

```bash
npx playwright test --config playwright.a11y.config.ts admin.a11y.test.ts --project chromium-light
```

Expected: 13 tests run, admin pages load without redirect. If a route returns a 404 or redirects to sign-in, check that the fixture IDs in `.fixtures.json` are correct and that the admin user has the right role in the database.

- [ ] **Step 3: Commit**

```bash
git add src/test/a11y/admin.a11y.test.ts
git commit -m "test(a11y): add admin page accessibility tests"
```

---

## Task 8: Update `package.json` and Run Full Suite

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add `test:accessibility` and update `test` to exclude a11y files**

In `package.json`, change the `scripts` section:

```json
"test": "vitest run --exclude '**/*.integration.test.ts' --exclude '**/*.a11y.test.ts'",
"test:accessibility": "playwright test --config playwright.a11y.config.ts",
```

The `test` script change is necessary because Vitest's default include pattern (`**/*.test.ts`) would otherwise pick up the Playwright test files and fail to run them (they use `@playwright/test` imports, not `vitest`).

- [ ] **Step 2: Verify `npm test` still works**

```bash
npm test
```

Expected: only Vitest unit tests run (no `.a11y.test.ts` or `.integration.test.ts` files). Green output.

- [ ] **Step 3: Run the full accessibility suite**

```bash
npm run test:accessibility
```

Expected: 58 test runs (29 pages × 2 color schemes). The suite may report failures if there are real axe violations in the app — that is correct behavior; those violations are genuine accessibility issues to address separately. The infrastructure is working correctly if:
- All 58 tests execute (none timeout or error on import/navigation)
- Each test produces a clear pass or axe-violation failure message
- The HTML report is generated at `playwright-report/a11y/index.html`

- [ ] **Step 4: Open the HTML report to confirm output is readable**

```bash
npx playwright show-report playwright-report/a11y
```

Expected: browser opens to Playwright's HTML reporter showing a grid of passed/failed tests grouped by file and color scheme.

- [ ] **Step 5: Commit**

```bash
git add package.json
git commit -m "test(a11y): add test:accessibility script and exclude a11y from vitest"
```

---

## Notes for Addressing Violations Found

When axe reports violations, each failure includes:
- `id`: the WCAG rule ID (e.g. `color-contrast`, `label`, `aria-required-attr`)
- `impact`: `critical` | `serious` | `moderate` | `minor`
- `nodes[].target`: the CSS selector for the failing element
- `helpUrl`: link to Deque's documentation for the rule

Address violations by fixing the underlying component or page markup. To suppress a confirmed false positive (rare), add a targeted `.exclude('selector')` call in the specific test, not in `checkA11y`:

```ts
// In the specific test only — never in helpers.ts
test('some page', async ({ page }) => {
  await page.goto('/some-path');
  await page.waitForLoadState('networkidle', { timeout: 15_000 });
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .exclude('#known-false-positive-selector') // reason: <explain why>
    .analyze();
  expect(results.violations).toEqual([]);
});
```
