# Accessibility Test Suite Design

**Date:** 2026-05-26
**Status:** Approved

## Overview

A full WCAG 2.1 AA accessibility test suite using Playwright and `@axe-core/playwright`. Every page in the application is scanned in both light and dark color schemes using a real Chromium browser, enabling genuine color contrast validation against the CSS custom property-based theme.

## Architecture

### Tool choice

`@axe-core/playwright` runs axe-core inside a real browser via Playwright. This is necessary because the dark theme is driven by `@media (prefers-color-scheme: dark)` CSS custom properties -- jsdom does not compute these, so color contrast checks would silently pass or fail incorrectly in a Vitest/jsdom environment.

Playwright's `colorScheme` context option emulates the OS preference at the browser level, which triggers the correct CSS variable values and allows axe to evaluate real computed colors.

### File layout

```
playwright.a11y.config.ts          # Playwright config: 2 projects (light/dark), webServer, globalSetup
src/test/a11y/
  global-setup.ts                  # Seeds DB, logs in, writes storage state + fixture IDs
  helpers.ts                       # checkA11y() wrapper around AxeBuilder
  public.a11y.test.ts              # Public pages (no auth required)
  user.a11y.test.ts                # User-authenticated pages
  admin.a11y.test.ts               # Admin-authenticated pages
  .user-auth.json                  # Generated -- gitignored
  .admin-auth.json                 # Generated -- gitignored
  .fixtures.json                   # Generated -- gitignored
```

### Playwright projects

The config defines two named projects sharing the same test files:

| Project         | `colorScheme` | Storage state       |
|-----------------|---------------|---------------------|
| `chromium-light`| `light`       | per test file       |
| `chromium-dark` | `dark`        | per test file       |

Every test runs twice -- once per project -- with no duplication in test code.

### webServer

Playwright starts `npm run dev` (port 3000) and waits for it to be ready. Locally it reuses an already-running server (`reuseExistingServer: true`); in CI it always starts fresh.

## Auth and Fixture Setup

`global-setup.ts` runs once before the full test suite. It has three responsibilities:

### 1. Seed test users

Ensures the three dev seed accounts exist with verified emails:

| Email                      | Password   | Role        |
|----------------------------|------------|-------------|
| `user@example.com`         | `password` | `user`      |
| `instructor@example.com`   | `password` | `instructor`|
| `admin@example.com`        | `password` | `admin`     |

Uses the DB directly (same `#/db` import pattern as integration tests). Idempotent -- safe to re-run.

### 2. Create content fixtures

Dynamic routes require real database IDs. The global setup inserts the following records if they do not already exist, keyed by a stable name so re-runs are safe:

- One published project (owned by `user@example.com`)
- One inventory item
- One category
- One program

The resulting IDs are written to `src/test/a11y/.fixtures.json`. Test files read this file to construct URLs for dynamic routes.

### 3. Log in and save storage state

Launches a headless Chromium instance, navigates to `/sign-in`, submits credentials for each account, and saves the resulting session cookies:

- `user@example.com` -> `.user-auth.json`
- `admin@example.com` -> `.admin-auth.json`

Test files declare which storage state to use via `test.use({ storageState })`, so authenticated pages load with a valid session without repeating the login flow.

## Page Coverage

### Public pages (`public.a11y.test.ts`, no auth)

| URL                          | Notes                              |
|------------------------------|------------------------------------|
| `/`                          | Home / landing                     |
| `/sign-in`                   | Auth form                          |
| `/sign-up`                   | Auth form                          |
| `/verify-email`              | Post-signup email gate             |
| `/forgot-password`           | Password reset request form        |
| `/reset-password`            | Password reset form                |
| `/projects`                  | Public project list                |
| `/projects/:projectId`       | Project detail (fixture ID)        |
| `/inventory`                 | Public inventory list              |
| `/inventory/:itemId`         | Inventory detail (fixture ID)      |

### User pages (`user.a11y.test.ts`, `user@example.com`)

| URL                               | Notes                          |
|-----------------------------------|--------------------------------|
| `/my/projects`                    | My projects list               |
| `/my/bookmarks`                   | Bookmarked projects            |
| `/my/items`                       | My borrowed/requested items    |
| `/profile`                        | Edit profile                   |
| `/projects/new`                   | New project form               |
| `/projects/:projectId/edit`       | Edit project (fixture ID)      |

### Admin pages (`admin.a11y.test.ts`, `admin@example.com`)

| URL                                    | Notes                         |
|----------------------------------------|-------------------------------|
| `/admin`                               | Admin dashboard               |
| `/admin/inventory`                     | Inventory list                |
| `/admin/inventory/new`                 | New inventory item form       |
| `/admin/inventory/:itemId`             | Inventory item detail         |
| `/admin/inventory/:itemId/edit`        | Edit inventory item form      |
| `/admin/inventory/requests`            | Request queue                 |
| `/admin/projects`                      | All projects list             |
| `/admin/users`                         | User list                     |
| `/admin/users/:userId`                 | User detail                   |
| `/admin/categories`                    | Category list                 |
| `/admin/categories/:categoryId`        | Category detail (fixture ID)  |
| `/admin/programs`                      | Program list                  |
| `/admin/programs/:programId`           | Program detail (fixture ID)   |

**Total: 29 pages, each scanned twice = 58 axe runs per test invocation.**

## Test Structure

### `helpers.ts`

```ts
export async function checkA11y(page: Page) {
  await page.waitForLoadState('networkidle');
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);
}
```

### Per-test pattern

```ts
test('sign-in page', async ({ page }) => {
  await page.goto('/sign-in');
  await checkA11y(page);
});
```

No special light/dark branching in test code. The Playwright project config handles color scheme emulation transparently.

### Suppressing false positives

If a known false positive needs suppression, add a targeted `.exclude()` call in the specific test (not globally in `checkA11y`) with a comment explaining the reason. No blanket rule disables.

## axe Rule Coverage

Tags applied: `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`

This covers, among others:

- Color contrast (4.5:1 for normal text, 3:1 for large text) -- light and dark separately
- Keyboard accessibility and focus order
- ARIA labels, roles, and attribute validity
- Landmark regions (`main`, `nav`, `header`, `footer`)
- Form label associations
- Image alternative text
- Link purpose (in context)
- Heading hierarchy
- Language of page
- Focus visible indicator

Violations fail the test immediately. There is no warning-only mode. The axe violation output includes the WCAG rule ID, impact level, failing CSS selector, and a remediation link to Deque's rule documentation.

## Package.json Integration

### New devDependencies

- `@playwright/test`
- `@axe-core/playwright`

### New script

```json
"test:accessibility": "playwright test --config playwright.a11y.config.ts"
```

### .gitignore additions

```
src/test/a11y/.user-auth.json
src/test/a11y/.admin-auth.json
src/test/a11y/.fixtures.json
```

## What This Does Not Cover

- **Keyboard navigation flow testing** -- axe checks whether focusable elements exist and have accessible names, but does not simulate tab order traversal or test custom keyboard interactions (e.g. modal focus traps, combobox arrow keys). These require separate manual or scripted tests.
- **Screen reader announcement testing** -- axe validates ARIA markup but cannot verify that a screen reader actually announces content correctly.
- **Motion / reduced-motion preference** -- not part of this suite.
- **WCAG 2.2** -- axe-core's `wcag22aa` tag exists but has partial coverage; excluded to avoid noisy partial results.
