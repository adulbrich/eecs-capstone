# shadcn/ui Component Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hand-rolled destructive confirmations, status tabs, pagination, badges, and cards with the shadcn primitives that back them, gate the accessibility suite in CI, and correct the design system doc where it currently teaches the workaround.

**Architecture:** Every primitive this plan adds is written by hand into `src/components/ui/`, adapted from the upstream registry but importing from the unified `radix-ui` package this repo already depends on, not from per-component `@radix-ui/react-*`. `radix-ui@1.4.3` already exports `AlertDialog`, `Tabs`, `Separator`, and `ToggleGroup`, so groups 1 and 2 add no npm dependency at all. `sonner` is the only install in the plan, and it goes in without its `next-themes` companion. The four native `confirm()` calls collapse onto one `ConfirmDialog` wrapper rather than four inline dialogs, because the copy and shape are identical at every site.

**Tech Stack:** React 19, TanStack Start / Router / Query, shadcn/ui (new-york) on `radix-ui@1.4.3`, Tailwind v4, Vitest with jsdom and Testing Library, Playwright with `@axe-core/playwright`.

**Spec:** `docs/superpowers/specs/2026-08-22-shadcn-component-audit-design.md`

## Global Constraints

- **Never use emdashes** in prose, comments, copy, commit messages, or docs. Use commas, colons, semicolons, parens, or a new sentence. A `--` standing in for a sentence dash is the same violation.
- **No emojis** anywhere unless explicitly asked for.
- Run `npm run check` and `npm run typecheck` on the whole project before committing. Never per-file.
- Unit tests: `npm test`. Accessibility: `npm run test:accessibility` (needs the dev server, a migrated and seeded database, and object storage).
- Commit messages: Conventional Commits, lowercase imperative subject, area in parens. Keep the `Co-Authored-By` trailer. **Never publish a `claude.ai/code/session` link.**
- Stage files by name. Never `git add -A` or `git add .`.
- Never commit to `main`. Branch, push, open a PR.
- This app is pre-production. Delete and restructure rather than adding back-compat shims, aliases, or parallel code paths.
- **Import Radix from the unified package**: `import { Tabs as TabsPrimitive } from "radix-ui"`. Never `@radix-ui/react-tabs`. Every existing file in `src/components/ui/` follows this and a new one that does not will install a duplicate copy of Radix.
- **Do not run `npx shadcn@latest add`.** It writes `@radix-ui/react-*` imports and installs those packages alongside the unified one. Copy the registry source by hand and rewrite the import. Registry source for any component: `https://ui.shadcn.com/r/styles/new-york/<name>.json`, field `.files[0].content`.
- New `ui/` primitives keep the house conventions already visible in `src/components/ui/`: a `data-slot` attribute on each part, `cn()` from `#/lib/utils.ts`, and `React.ComponentProps<typeof X>` for prop types.
- Semantic color tokens only. No raw palette classes, no hardcoded hex. Status colors reference `var(--status-*)` directly.

---

## File Structure

| File | Responsibility |
|---|---|
| `.github/workflows/ci.yml` (modify) | New `accessibility` job. Third job, mirroring `integration`'s service setup. |
| `src/components/ui/alert-dialog.tsx` (new) | Radix AlertDialog wrapper. Styled parts only, no app logic. |
| `src/components/confirm-dialog.tsx` (new) | The app-level destructive confirmation. Owns the copy shape and the `asChild` trigger. |
| `src/components/ui/sonner.tsx` (new) | Toaster wrapper. `theme="system"`, no `next-themes`. |
| `src/routes/__root.tsx` (modify) | Mounts `<Toaster />` inside `BrandProvider`. |
| `src/components/ui/tabs.tsx` (new) | Radix Tabs wrapper with the brand underline treatment. |
| `src/components/ui/pagination.tsx` (new) | Pagination shell. Adapted for TanStack `Link` and real disabled semantics. |
| `src/components/ui/badge.tsx` (new) | The badge box. Variant `status` accepts caller-supplied tokens. |
| `src/components/ui/card.tsx` (new) | The repeated `rounded-lg border border-border bg-card` surface. |
| `src/components/ui/field.tsx` (new) | `Field`, `FieldLabel`, `FieldError`. Replaces the `space-y-1.5` idiom and `FieldErrors`. |
| `src/components/ui/slider.tsx` (delete) | Zero importers. |
| `src/components/field-errors.tsx` (delete) | Superseded by `FieldError`. |
| `src/components/owner-project-actions.tsx` (modify) | `confirm()` to `ConfirmDialog`. |
| `src/components/staff-project-panel.tsx` (modify) | `confirm()` to `ConfirmDialog`. |
| `src/routes/_authed/admin/programs/$programId.tsx` (modify) | `confirm()` to `ConfirmDialog`. |
| `src/routes/_authed/admin/categories/$categoryId.tsx` (modify) | `confirm()` to `ConfirmDialog`. |
| `src/routes/_authed/my/items.tsx` (modify) | `alert()` to toast; hand-rolled tabs to `Tabs`; unlabelled `Textarea`. |
| `src/routes/_authed/admin/categories/index.tsx` (modify) | Hand-rolled tabs to `Tabs`. |
| `src/routes/projects/index.tsx` (modify) | Link pagination to `Pagination`. |
| `src/routes/_authed/admin/users/index.tsx` (modify) | Link pagination to `Pagination`. |
| `src/routes/inventory/index.tsx` (modify) | Button pagination to `Pagination`. |
| `src/test/a11y/user.a11y.test.ts` (modify) | First interaction-state assertions. |
| `src/test/a11y/public.a11y.test.ts` (modify) | First interaction-state assertions. |
| `docs/UI-CONVENTIONS.md` (modify) | The 9 deltas from the spec. |

---

# Group 0: Gate the suite

The spec called this "one job, no code change." That was optimistic and this plan corrects it. `playwright.a11y.config.ts` starts `npm run dev`, and `src/test/a11y/global-setup.ts` opens a `Pool` on `DATABASE_URL`, reads seeded users (`user@example.com`, `instructor@example.com`, `admin@example.com`), and signs in through a real browser to save storage state. So the job needs Postgres with pgvector, object storage, a migrated schema, a dev seed, and a Chromium download. It is still one job and still no application code, but it is roughly the `integration` job plus a seed and a browser install.

### Task 1: Add the accessibility job to CI

**Files:**
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: nothing.
- Produces: a CI job named `accessibility` that runs `npm run test:accessibility`. No code artifact other tasks import.

- [ ] **Step 1: Confirm the suite passes locally before gating it**

Bringing up the local stack, if it is not already running:

```bash
docker compose up -d
npm run db:migrate
npm run storage:init
npm run db:seed:dev
```

Run: `npm run test:accessibility`

If this fails, **stop and report the failures rather than fixing them here**. A red suite is a finding for its own task, not something to bury inside a CI change. Groups 1 and 2 are expected to change what this suite covers; gating a suite that is already red would block them on unrelated work.

- [ ] **Step 2: Add the job**

Append to `.github/workflows/ci.yml`, after the `integration` job. The service block and the `.env.local` heredoc are copied from `integration` deliberately: the two jobs need the same stack, and a shared composite action is not worth the indirection for two call sites.

```yaml
  # The a11y suite has existed since 2026-05-26 and has never run in CI, so an
  # accessibility regression could reach main unnoticed. `npm test` excludes it
  # on purpose to keep the unit run fast; this is the other half of that trade,
  # which was never added. It needs the same stack as the integration job plus a
  # dev seed, because global-setup.ts signs in as the seeded users to capture
  # their storage state.
  accessibility:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: pgvector/pgvector:pg18
        env:
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: eecs_capstone
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 10
      rustfs:
        image: rustfs/rustfs:latest
        env:
          RUSTFS_ACCESS_KEY: rustfsadmin
          RUSTFS_SECRET_KEY: rustfsadmin
        ports:
          - 9000:9000
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 24.16.0
          cache: npm
      - run: npm ci

      - name: Write .env.local
        run: |
          cat > .env.local <<'EOF'
          DATABASE_URL=postgresql://postgres:postgres@localhost:5432/eecs_capstone
          BETTER_AUTH_SECRET=ci-not-a-real-secret
          BETTER_AUTH_URL=http://localhost:3000
          S3_ENDPOINT=http://localhost:9000
          S3_REGION=us-east-1
          S3_BUCKET=cs-capstone
          S3_ACCESS_KEY=rustfsadmin
          S3_SECRET_KEY=rustfsadmin
          VITE_STORAGE_PUBLIC_BASE=http://localhost:9000/cs-capstone
          EOF

      - name: Wait for object storage
        run: |
          for i in $(seq 1 30); do
            if curl -sf -o /dev/null http://localhost:9000 \
              || [ "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:9000)" != "000" ]; then
              echo "storage responding"; exit 0
            fi
            sleep 2
          done
          echo "storage did not come up"; exit 1

      - run: npm run db:migrate
      - run: npm run storage:init
      # global-setup.ts fails with an explicit "run npm run db:seed:dev" message
      # if these users are missing, so the seed is a hard prerequisite.
      - run: npm run db:seed:dev

      # Only chromium: playwright.a11y.config.ts defines chromium-light and
      # chromium-dark and no other browser.
      - run: npx playwright install --with-deps chromium

      - run: npm run test:accessibility

      - if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: a11y-report
          path: playwright-report/a11y
          retention-days: 7
```

- [ ] **Step 3: Verify the workflow parses**

Run: `npx --yes yaml-lint .github/workflows/ci.yml 2>/dev/null || node -e "require('js-yaml')" 2>/dev/null || python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml')); print('yaml ok')"`

Expected: `yaml ok`, or no output and exit 0.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "test(ci): run the accessibility suite on every pull request"
```

- [ ] **Step 5: Push and confirm the job actually runs green**

The point of this task is the green check on the PR, not the YAML. Push the branch, open the PR, and wait for the `accessibility` job. If it fails on infrastructure (seed timing, storage, browser download), fix it here. If it fails on a real axe violation, stop and report: that is a separate finding.

---

# Group 1: Destructive actions

Four `confirm()` calls and one `alert()`. Highest user-visible risk in the audit, and independent of groups 2 and 3.

### Task 2: The AlertDialog primitive and the ConfirmDialog that wraps it

Two files in one task because neither is testable without the other: the primitive is unstyled plumbing and the wrapper is what the app actually calls.

**Files:**
- Create: `src/components/ui/alert-dialog.tsx`
- Create: `src/components/confirm-dialog.tsx`
- Test: `src/test/confirm-dialog.test.tsx`

**Interfaces:**
- Consumes: `radix-ui`'s `AlertDialog` export (already installed at 1.4.3), `Button` and `buttonVariants` from `#/components/ui/button.tsx`, `cn` from `#/lib/utils.ts`.
- Produces:
  - From `ui/alert-dialog.tsx`: `AlertDialog`, `AlertDialogTrigger`, `AlertDialogContent`, `AlertDialogHeader`, `AlertDialogFooter`, `AlertDialogTitle`, `AlertDialogDescription`, `AlertDialogAction`, `AlertDialogCancel`.
  - From `confirm-dialog.tsx`:
    ```ts
    function ConfirmDialog(props: {
      children: React.ReactNode;   // the trigger, rendered via asChild
      confirmLabel?: string;       // defaults to "Delete"
      description: string;
      onConfirm: () => void | Promise<void>;
      title: string;
    }): React.JSX.Element
    ```

- [ ] **Step 1: Install the two test libraries this group needs**

The repo has `@testing-library/react` and `@testing-library/dom` and nothing else. Every test in `src/test/` today asserts with plain `toBeTruthy()` and drives nothing interactive, because until now nothing interactive was worth testing. This group adds three Radix components whose entire value is keyboard and screen-reader behavior, which needs both:

```bash
npm i -D @testing-library/user-event @testing-library/jest-dom
```

`user-event` rather than `fireEvent`: Radix opens its dialogs on `pointerdown`, not `click`, and dispatches the full pointer sequence that real Radix behavior depends on. `jest-dom` supplies `toHaveAccessibleName`, `toHaveAccessibleDescription`, `toHaveFocus`, and `toHaveAttribute`, which are the assertions that actually state what these components are for.

There is no `test` block in `vite.config.ts` and no setup file: every test declares its own environment with a `// @vitest-environment jsdom` pragma. Follow that convention rather than introducing global config. Each new test file imports the matchers itself:

```tsx
import "@testing-library/jest-dom/vitest";
```

Verify: `npm test -- src/test/overdue-badge.test.tsx`
Expected: PASS. The install changed nothing for existing tests.

- [ ] **Step 2: Write the failing test**

Create `src/test/confirm-dialog.test.tsx`:

```tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "#/components/confirm-dialog";
import { Button } from "#/components/ui/button";

afterEach(cleanup);

function setup(onConfirm: () => void) {
  return render(
    <ConfirmDialog
      description="This cannot be undone."
      onConfirm={onConfirm}
      title="Permanently delete this draft?"
    >
      <Button variant="destructive">Delete</Button>
    </ConfirmDialog>
  );
}

describe("ConfirmDialog", () => {
  it("does not run the action until the user confirms", async () => {
    const onConfirm = vi.fn();
    setup(onConfirm);
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await screen.findByRole("alertdialog");
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("runs the action on confirm", async () => {
    const onConfirm = vi.fn();
    setup(onConfirm);
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("alertdialog");
    // The dialog's own Delete, not the trigger. Both carry the same label.
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Delete" })
    );
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
  });

  it("does not run the action on cancel", async () => {
    const onConfirm = vi.fn();
    setup(onConfirm);
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("alertdialog");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Cancel" })
    );
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).toBeNull()
    );
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("names itself with the title and describes itself with the description", async () => {
    setup(vi.fn());
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("alertdialog");
    // This is the assertion that native confirm() could never satisfy: the
    // dialog carries its own accessible name and description.
    expect(dialog).toHaveAccessibleName("Permanently delete this draft?");
    expect(dialog).toHaveAccessibleDescription("This cannot be undone.");
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- src/test/confirm-dialog.test.tsx`
Expected: FAIL. The module `#/components/confirm-dialog` does not resolve.

Only that module should be missing. If a matcher is undefined instead, Step 1's install did not take.

- [ ] **Step 4: Write the AlertDialog primitive**

Create `src/components/ui/alert-dialog.tsx`. Adapted from the new-york registry, with the import rewritten to the unified package and `Button`'s variants reused rather than re-declared:

```tsx
import { AlertDialog as AlertDialogPrimitive } from "radix-ui";
import type * as React from "react";
import { buttonVariants } from "#/components/ui/button.tsx";
import { cn } from "#/lib/utils.ts";

function AlertDialog({
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Root>) {
  return <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />;
}

function AlertDialogTrigger({
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Trigger>) {
  return (
    <AlertDialogPrimitive.Trigger data-slot="alert-dialog-trigger" {...props} />
  );
}

function AlertDialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Overlay>) {
  return (
    <AlertDialogPrimitive.Overlay
      className={cn(
        "data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 fixed inset-0 z-50 bg-black/50 data-[state=closed]:animate-out data-[state=open]:animate-in",
        className
      )}
      data-slot="alert-dialog-overlay"
      {...props}
    />
  );
}

function AlertDialogContent({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Content>) {
  return (
    <AlertDialogPrimitive.Portal>
      <AlertDialogOverlay />
      <AlertDialogPrimitive.Content
        className={cn(
          "data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95 fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border border-border bg-card p-6 shadow-lg duration-200 data-[state=closed]:animate-out data-[state=open]:animate-in sm:max-w-lg",
          className
        )}
        data-slot="alert-dialog-content"
        {...props}
      />
    </AlertDialogPrimitive.Portal>
  );
}

function AlertDialogHeader({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex flex-col gap-2 text-center sm:text-left", className)}
      data-slot="alert-dialog-header"
      {...props}
    />
  );
}

function AlertDialogFooter({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className
      )}
      data-slot="alert-dialog-footer"
      {...props}
    />
  );
}

function AlertDialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Title>) {
  return (
    <AlertDialogPrimitive.Title
      className={cn("font-semibold text-lg", className)}
      data-slot="alert-dialog-title"
      {...props}
    />
  );
}

function AlertDialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Description>) {
  return (
    <AlertDialogPrimitive.Description
      className={cn("text-muted-foreground text-sm", className)}
      data-slot="alert-dialog-description"
      {...props}
    />
  );
}

function AlertDialogAction({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Action>) {
  return (
    <AlertDialogPrimitive.Action
      className={cn(buttonVariants(), className)}
      data-slot="alert-dialog-action"
      {...props}
    />
  );
}

function AlertDialogCancel({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Cancel>) {
  return (
    <AlertDialogPrimitive.Cancel
      className={cn(buttonVariants({ variant: "outline" }), className)}
      data-slot="alert-dialog-cancel"
      {...props}
    />
  );
}

export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogOverlay,
  AlertDialogTitle,
  AlertDialogTrigger,
};
```

`buttonVariants` is exported from `src/components/ui/button.tsx:64`, so reusing it here is correct and keeps the action button from re-declaring variants that already exist.

- [ ] **Step 5: Write the ConfirmDialog wrapper**

Create `src/components/confirm-dialog.tsx`:

```tsx
import type * as React from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "#/components/ui/alert-dialog.tsx";
import { buttonVariants } from "#/components/ui/button.tsx";
import { cn } from "#/lib/utils.ts";

/**
 * The one destructive confirmation in the app.
 *
 * Four call sites used the native `confirm()` before this existed. That call is
 * unstyled, ignores the brand and the dark palette, blocks the main thread, and
 * is invisible to the accessibility suite, because axe cannot scan a page whose
 * script is parked on a modal browser prompt. It also cannot be reached by any
 * test we write.
 *
 * The trigger is passed as `children` and rendered through `asChild`, so the
 * call site keeps its own Button and its own variant. Nothing here decides what
 * the destructive action looks like, only what confirming it looks like.
 */
export function ConfirmDialog({
  children,
  confirmLabel = "Delete",
  description,
  onConfirm,
  title,
}: {
  children: React.ReactNode;
  confirmLabel?: string;
  description: string;
  onConfirm: () => void | Promise<void>;
  title: string;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className={cn(buttonVariants({ variant: "destructive" }))}
            onClick={() => {
              onConfirm();
            }}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

Note the `onClick` wrapper rather than `onClick={onConfirm}`: `onConfirm` may return a promise, and passing it directly would hand React's synthetic event a floating thenable. The dialog closes immediately on action, which is what every current call site already assumes, since three of them navigate away.

- [ ] **Step 6: Run the tests**

Run: `npm test -- src/test/confirm-dialog.test.tsx`
Expected: PASS, 4 tests.

- [ ] **Step 7: Check and typecheck**

Run: `npm run check && npm run typecheck`
Expected: both clean. If `check` reports formatting, run `npm run format` and re-run.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json src/components/ui/alert-dialog.tsx src/components/confirm-dialog.tsx src/test/confirm-dialog.test.tsx
git commit -m "feat(ui): add AlertDialog and the ConfirmDialog that wraps it"
```

### Task 3: Replace all four native confirm() calls

**Files:**
- Modify: `src/components/owner-project-actions.tsx:37`
- Modify: `src/components/staff-project-panel.tsx:172`
- Modify: `src/routes/_authed/admin/programs/$programId.tsx:68`
- Modify: `src/routes/_authed/admin/categories/$categoryId.tsx:77`
- Test: `src/test/no-native-confirm.test.ts`

**Interfaces:**
- Consumes: `ConfirmDialog` from Task 2.
- Produces: nothing importable. Removes every `confirm(` call from `src/`.

- [ ] **Step 1: Write the failing guard test**

This one test replaces four per-site tests. The property being protected is global ("no native modal anywhere"), so a global assertion states it once and catches the fifth site nobody has written yet.

Create `src/test/no-native-confirm.test.ts`. It guards `confirm(` only. Task 4 extends the same test to `alert(` once the last one is gone, so both tasks end with a green tree rather than leaving a known failure between two commits.

```ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return walk(full);
    }
    return full.endsWith(".tsx") || full.endsWith(".ts") ? [full] : [];
  });
}

describe("native browser modals", () => {
  it("are not used anywhere in src", () => {
    const offenders: string[] = [];
    for (const file of walk("src")) {
      // Skip both test locations. `src/lib/email/__tests__/templates.test.ts`
      // asserts on the XSS fixture string `onerror=alert(1)`, which any regex
      // looking for a native modal will match forever.
      if (file.includes("src/test/") || file.includes("__tests__") || file.includes(".test.")) {
        continue;
      }
      const source = readFileSync(file, "utf8");
      source.split("\n").forEach((line, i) => {
        // Match a bare call, not `.confirm(` on some object, and not the word
        // inside a longer identifier such as `confirmPassword(`.
        if (/(^|[^.\w])confirm\s*\(/.test(line)) {
          offenders.push(`${file}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    expect(
      offenders,
      `Native confirm()/alert() block the main thread, ignore the brand and dark\n` +
        `palette, and cannot be scanned by axe. Use ConfirmDialog or a toast.\n\n` +
        offenders.join("\n")
    ).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- src/test/no-native-confirm.test.ts`
Expected: FAIL, listing exactly these 4 offenders:

```
src/components/owner-project-actions.tsx:37
src/components/staff-project-panel.tsx:172
src/routes/_authed/admin/categories/$categoryId.tsx:79
src/routes/_authed/admin/programs/$programId.tsx:73
```

If you see more or fewer, the regex or the exclusions drifted from what is written above.

- [ ] **Step 3: Replace the call in `owner-project-actions.tsx`**

The delete button is currently produced by a `buttons` array driven through `run(action)`. Lift it out of the array, because a `ConfirmDialog` has to wrap its own trigger and the array renders a bare `<Button>` per entry.

Remove the `delete` branch from `run`:

```tsx
      switch (action) {
        case "submit":
          await submitProject({ data: { id: project.id } });
          break;
        case "withdraw":
          await returnToDraft({ data: { id: project.id } });
          break;
        default:
          break;
      }
      onChanged();
```

Narrow the `action` parameter and the `buttons` entry ids from `"submit" | "withdraw" | "delete"` to `"submit" | "withdraw"`, drop the `delete` entry from the `buttons` array, and add a dedicated handler:

```tsx
  async function runDelete() {
    setError(null);
    setBusy(true);
    try {
      await hardDeleteProject({ data: { id: project.id } });
      window.location.href = "/my/projects";
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }
```

`setBusy(false)` sits only in the catch: the success path navigates away, and clearing it there would flash the button back to enabled during the redirect.

Render the trigger next to the array's buttons, guarded by the same `show` condition the deleted array entry carried (read it off the entry you removed and keep it identical):

```tsx
      <ConfirmDialog
        description="This cannot be undone."
        onConfirm={runDelete}
        title="Permanently delete this draft?"
      >
        <Button disabled={busy} variant="destructive">
          Delete draft
        </Button>
      </ConfirmDialog>
```

Add the import:

```tsx
import { ConfirmDialog } from "./confirm-dialog";
```

- [ ] **Step 4: Replace the call in `staff-project-panel.tsx`**

`runDelete` currently branches three ways and only `hardDelete` prompts. Split the prompting branch out so the other two keep their direct path:

```tsx
  async function runDelete(action: "softDelete" | "restore") {
    setError(null);
    try {
      if (action === "softDelete") {
        await softDeleteProject({ data: { id: project.id } });
      } else {
        await restoreProject({ data: { id: project.id } });
      }
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function runHardDelete() {
    setError(null);
    try {
      await hardDeleteProject({ data: { id: project.id } });
      window.location.href = "/admin/projects";
    } catch (err) {
      setError((err as Error).message);
    }
  }
```

Find the button that called `runDelete("hardDelete")` (it is in the "Danger zone" `PanelSection` near line 410) and wrap it:

```tsx
        <ConfirmDialog
          description="This cannot be undone."
          onConfirm={runHardDelete}
          title="Permanently delete this draft?"
        >
          <Button size="sm" variant="destructive">
            Delete permanently
          </Button>
        </ConfirmDialog>
```

Keep the trigger's existing label and size exactly as they are today. Only the wrapper and the handler name change.

- [ ] **Step 5: Replace the call in `programs/$programId.tsx`**

This one has conditional copy, which is why `ConfirmDialog` takes `description` as a prop rather than owning it. Delete the `confirm` guard from `onDelete`:

```tsx
  async function onDelete() {
    setError(null);
    try {
      await deleteProgram({ data: { id: program.id } });
      navigate({ to: "/admin/programs" });
    } catch (err) {
      setError((err as Error).message);
    }
  }
```

Compute the description where the component renders, keeping the two-branch copy verbatim:

```tsx
  const deleteDescription =
    projectCount > 0
      ? `${projectCount} project(s) will be unlinked but kept.`
      : "This cannot be undone.";
```

Wrap the existing delete button:

```tsx
      <ConfirmDialog
        description={deleteDescription}
        onConfirm={onDelete}
        title={`Delete program "${program.courseName}"?`}
      >
        <Button variant="destructive">Delete</Button>
      </ConfirmDialog>
```

The question moves from the body to the title, which is what gives the dialog its accessible name. Keep the trigger's existing size and label.

- [ ] **Step 6: Replace the call in `categories/$categoryId.tsx`**

```tsx
  async function onDelete() {
    setError(null);
    try {
      await deleteCategory({ data: { id: category.id } });
      navigate({ search: { tab: category.domain }, to: "/admin/categories" });
    } catch (err) {
      setError((err as Error).message);
    }
  }
```

Wrap the existing delete button, splitting the long single string into title and description:

```tsx
      <ConfirmDialog
        description="It will be removed from any projects and inventory items that use it. Those projects and items are unaffected otherwise."
        onConfirm={onDelete}
        title={`Delete category "${category.name}"?`}
      >
        <Button variant="destructive">Delete</Button>
      </ConfirmDialog>
```

Note the semicolon in the original copy became a period plus a new sentence. Do not reintroduce an emdash here.

- [ ] **Step 7: Run the guard test**

Run: `npm test -- src/test/no-native-confirm.test.ts`
Expected: PASS. Zero offenders. If any remain, you missed a site.

- [ ] **Step 8: Full unit run, check, typecheck**

Run: `npm test && npm run check && npm run typecheck`
Expected: all clean. Typecheck is what catches a missed narrowing on the `action` union in `owner-project-actions.tsx`.

- [ ] **Step 9: Commit**

```bash
git add src/components/owner-project-actions.tsx src/components/staff-project-panel.tsx "src/routes/_authed/admin/programs/\$programId.tsx" "src/routes/_authed/admin/categories/\$categoryId.tsx" src/test/no-native-confirm.test.ts
git commit -m "feat(ui): confirm destructive actions in a dialog instead of the browser prompt"
```

### Task 4: Toasts, and the last native alert

**Files:**
- Create: `src/components/ui/sonner.tsx`
- Modify: `src/routes/__root.tsx`
- Modify: `src/routes/_authed/my/items.tsx:121`
- Modify: `package.json` (adds `sonner`)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `Toaster` from `#/components/ui/sonner.tsx`, mounted once in the root document. Call sites import `toast` from `sonner` directly.

- [ ] **Step 1: Install sonner, and only sonner**

Run: `npm i sonner`

**Do not install `next-themes`**, even though the upstream registry entry declares it. The registry wrapper calls `useTheme()` from `next-themes` to pick a toast theme. This app has no JS theme state to read: `src/styles.css:7` declares `@custom-variant dark (@media (prefers-color-scheme: dark))` and the dark block at `styles.css:93` is a plain media query, with no theme class and no user-facing toggle. Installing `next-themes` would add a Next.js library to a TanStack Start app for a value that is already available to CSS.

Verify: `node -e "require('./package.json').dependencies['next-themes'] && process.exit(1); console.log('clean')"`
Expected: `clean`.

- [ ] **Step 2: Write the Toaster wrapper**

Create `src/components/ui/sonner.tsx`:

```tsx
import { Toaster as Sonner } from "sonner";
import type * as React from "react";

/**
 * The app's only non-blocking feedback channel.
 *
 * The upstream registry entry reads the active theme from `next-themes`. This
 * app has no JS theme state to read: dark mode is a `prefers-color-scheme`
 * media query in `styles.css` with no class and no toggle. `theme="system"` is
 * sonner's own media-query mode, so it tracks exactly what the CSS tracks and
 * the Next.js dependency is not needed.
 */
function Toaster({ ...props }: React.ComponentProps<typeof Sonner>) {
  return (
    <Sonner
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--card)",
          "--normal-border": "var(--border)",
          "--normal-text": "var(--card-foreground)",
        } as React.CSSProperties
      }
      theme="system"
      {...props}
    />
  );
}

export { Toaster };
```

All three tokens exist in `src/styles.css` and are redefined under the dark selector (`--card` at lines 60 and 143, `--card-foreground` at 61 and 144, `--border` at 74 and 158), so the toaster tracks the theme without reading it in JS. Do not substitute a hex value.

- [ ] **Step 3: Mount it in the root document**

In `src/routes/__root.tsx`, inside `BrandProvider` and after `{children}`, so a toast paints above page content and inherits the brand variables that `BrandProvider` sets:

```tsx
        <BrandProvider>
          <SiteHeader />
          {children}
          <Toaster />
          <TanStackDevtools
```

Add the import alongside the other component imports:

```tsx
import { Toaster } from "../components/ui/sonner";
```

Match the relative-import style already used in that file for `BrandProvider`.

- [ ] **Step 4: Replace the alert in `my/items.tsx`**

The current code blocks on a native `alert` to report a partial result nobody needs to acknowledge, then navigates. Replace it:

```tsx
              <Button
                onClick={async () => {
                  const result = await submitCart({
                    data: { note: note || null },
                  });
                  setNote("");
                  await refresh();
                  if (result.skipped.length > 0) {
                    toast.warning(
                      `Submitted ${result.submitted.length}, skipped ${result.skipped.length} (no longer available).`
                    );
                  }
                  navigate({ search: () => ({ tab: "active" }) });
                }}
              >
                Submit request
              </Button>
```

The semicolon in the original copy becomes a comma, because the sentence is short enough not to need it. Add the import:

```tsx
import { toast } from "sonner";
```

- [ ] **Step 5: Extend the Task 3 guard to cover `alert(` too**

Now that the last one is gone, widen the regex in `src/test/no-native-confirm.test.ts` so a new `alert(` cannot appear either:

```ts
        if (/(^|[^.\w])(confirm|alert)\s*\(/.test(line)) {
```

The `__tests__` and `.test.` exclusions already in that loop are what keep the XSS fixture string in `src/lib/email/__tests__/templates.test.ts` (`onerror=alert(1)`) from matching. Do not remove them.

Rename the test file to match its widened scope:

```bash
git mv src/test/no-native-confirm.test.ts src/test/no-native-modals.test.ts
```

Update the `describe` block's name to "native browser modals" if it is not already.

Run: `npm test -- src/test/no-native-modals.test.ts`
Expected: PASS. Zero offenders. This is the assertion that closes the group.

- [ ] **Step 6: Verify the toast in the running app**

Run: `npm run dev`, sign in as `user@example.com`, add an item to the cart, and submit. The partial-skip branch needs an item that became unavailable, which is hard to stage by hand. If you cannot reproduce it, at minimum confirm no console error from the `Toaster` mount on any page and that the app still renders.

- [ ] **Step 7: Full run**

Run: `npm test && npm run check && npm run typecheck`
Expected: all clean.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json src/components/ui/sonner.tsx src/routes/__root.tsx src/routes/_authed/my/items.tsx src/test/no-native-modals.test.ts
git commit -m "feat(ui): report background results with a toast instead of a browser alert"
```

---

# Group 2: The patterns the doc codified

`tabs` and `pagination` both fix real keyboard and screen-reader behavior, and both require rewriting a section of `docs/UI-CONVENTIONS.md` that currently teaches the hand-rolled version.

### Task 5: The Tabs primitive, and the two hand-rolled tab strips

**Files:**
- Create: `src/components/ui/tabs.tsx`
- Modify: `src/routes/_authed/my/items.tsx:50-75`
- Modify: `src/routes/_authed/admin/categories/index.tsx:323-341`
- Test: `src/test/tabs.test.tsx`

**Interfaces:**
- Consumes: `radix-ui`'s `Tabs` export, `cn`.
- Produces: `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` from `#/components/ui/tabs.tsx`.

- [ ] **Step 1: Write the failing test**

The point of this task is the semantics the raw buttons lacked, so that is what the test asserts. Create `src/test/tabs.test.tsx`:

```tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "#/components/ui/tabs";

afterEach(cleanup);

function Fixture() {
  return (
    <Tabs defaultValue="cart">
      <TabsList>
        <TabsTrigger value="cart">Cart (2)</TabsTrigger>
        <TabsTrigger value="active">Active (1)</TabsTrigger>
        <TabsTrigger value="history">History</TabsTrigger>
      </TabsList>
      <TabsContent value="cart">cart panel</TabsContent>
      <TabsContent value="active">active panel</TabsContent>
      <TabsContent value="history">history panel</TabsContent>
    </Tabs>
  );
}

describe("Tabs", () => {
  it("exposes a tablist with selected state", () => {
    render(<Fixture />);
    expect(screen.getByRole("tablist")).toBeTruthy();
    expect(
      screen.getByRole("tab", { name: "Cart (2)", selected: true })
    ).toBeTruthy();
    expect(
      screen.getByRole("tab", { name: "Active (1)", selected: false })
    ).toBeTruthy();
  });

  it("moves between tabs with the arrow keys", async () => {
    // The behavior the raw buttons could not offer: one tab stop for the whole
    // strip, arrows to move within it.
    render(<Fixture />);
    await userEvent.tab();
    expect(screen.getByRole("tab", { name: "Cart (2)" })).toHaveFocus();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Active (1)" })).toHaveFocus();
  });

  it("shows only the selected panel", async () => {
    render(<Fixture />);
    expect(screen.getByText("cart panel")).toBeTruthy();
    expect(screen.queryByText("active panel")).toBeNull();
    await userEvent.click(screen.getByRole("tab", { name: "Active (1)" }));
    expect(screen.getByText("active panel")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- src/test/tabs.test.tsx`
Expected: FAIL, `#/components/ui/tabs` does not resolve.

- [ ] **Step 3: Write the primitive**

Create `src/components/ui/tabs.tsx`. The visual treatment is carried over from the pattern being replaced, so nothing on screen changes: a brand-colored bottom border on the active trigger, muted foreground on the rest. The inline `style` the old markup used becomes a Tailwind arbitrary value keyed off Radix's `data-state`, which is what lets the class live in the component instead of at every call site.

```tsx
import { Tabs as TabsPrimitive } from "radix-ui";
import type * as React from "react";
import { cn } from "#/lib/utils.ts";

function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      className={cn("flex flex-col", className)}
      data-slot="tabs"
      {...props}
    />
  );
}

function TabsList({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn("flex gap-4 border-border border-b", className)}
      data-slot="tabs-list"
      {...props}
    />
  );
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "px-2 py-1 text-muted-foreground transition-colors hover:text-foreground",
        "focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2",
        "data-[state=active]:border-b-2 data-[state=active]:border-b-[var(--brand-primary)] data-[state=active]:font-medium data-[state=active]:text-foreground",
        className
      )}
      data-slot="tabs-trigger"
      {...props}
    />
  );
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      className={cn("mt-4", className)}
      data-slot="tabs-content"
      {...props}
    />
  );
}

export { Tabs, TabsContent, TabsList, TabsTrigger };
```

The active trigger gains `text-foreground`, which the old markup got implicitly by omitting `text-muted-foreground`. Check `src/components/ui/button.tsx` for the exact focus-ring classes this codebase uses and copy them rather than the ones above if they differ.

- [ ] **Step 4: Run the test**

Run: `npm test -- src/test/tabs.test.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 5: Convert `my/items.tsx`**

The tab state is a URL search param, so `Tabs` is controlled: `value` plus `onValueChange`, not `defaultValue`. Note `tab` is already derived (`data.cart.length > 0 && search.tab === "active" ? "cart" : search.tab`); keep that derivation exactly, it is the "jump to cart when something is in it" behavior.

Replace the `<div className="mt-4 flex gap-4 border-border border-b">` block and everything it wraps:

```tsx
      <Tabs
        onValueChange={(next) =>
          navigate({
            search: () => ({ tab: next as "active" | "cart" | "history" }),
          })
        }
        value={tab}
      >
        <TabsList>
          <TabsTrigger value="cart">Cart ({data.cart.length})</TabsTrigger>
          <TabsTrigger value="active">Active ({data.active.length})</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>
        <TabsContent value="cart">{/* existing cart markup */}</TabsContent>
        <TabsContent value="active">{/* existing active markup */}</TabsContent>
        <TabsContent value="history">{/* existing history markup */}</TabsContent>
      </Tabs>
```

The three triggers are now written out rather than mapped, because the labels differ in shape (two carry counts, one does not) and the map needed an IIFE with three branches to express that. Move the existing per-tab bodies into the matching `TabsContent` unchanged. Whatever currently switches on `tab` to decide which body renders is deleted: `TabsContent` does that now, and leaving both would render nothing.

Add the import:

```tsx
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "#/components/ui/tabs";
```

- [ ] **Step 6: Convert `admin/categories/index.tsx`**

This one maps over a `TABS` constant with `{ label, value }` entries, which survives the conversion:

```tsx
      <Tabs
        onValueChange={(next) => navigate({ search: { tab: next } })}
        value={tab}
      >
        <TabsList>
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value={tab}>{/* existing body */}</TabsContent>
      </Tabs>
```

`onValueChange` receives a `string`; if `navigate`'s search schema wants a narrower union, cast at that boundary the same way `my/items.tsx` does. The single `TabsContent value={tab}` is deliberate: this page renders one body driven by a server query rather than three static panels, so one panel that always matches the active tab is correct and keeps `aria-controls` valid.

- [ ] **Step 7: Verify both pages in the browser**

Run: `npm run dev`. Visit `/my/items` and `/admin/categories`.

Check all four, since they are the reason for the task:
1. Tab, once. Focus lands on the tab strip and one tab only.
2. Arrow right and left move between tabs and change the panel.
3. The active tab still shows the orange underline, in light and dark.
4. The URL search param still updates on change, and a reload restores the tab.

- [ ] **Step 8: Full run**

Run: `npm test && npm run check && npm run typecheck`
Expected: all clean.

- [ ] **Step 9: Commit**

```bash
git add src/components/ui/tabs.tsx src/test/tabs.test.tsx src/routes/_authed/my/items.tsx src/routes/_authed/admin/categories/index.tsx
git commit -m "feat(ui): make the status tab strips real tablists"
```

### Task 6: The Pagination primitive, and the three pagers

The spec's finding 3 has a correction worth carrying into the code: the three sites are **two** implementations. `projects/index.tsx` and `admin/users/index.tsx` use a TanStack `<Link>` neutralized by `pointer-events-none`, which leaves it in the tab order, announced as a link, and activatable by Enter. `inventory/index.tsx` uses `<button disabled>`, which is correct. So this task fixes a real defect at two sites and a consistency problem at all three.

**Files:**
- Create: `src/components/ui/pagination.tsx`
- Modify: `src/routes/projects/index.tsx:85-113`
- Modify: `src/routes/_authed/admin/users/index.tsx:353-384`
- Modify: `src/routes/inventory/index.tsx:139-173`
- Test: `src/test/pagination.test.tsx`

**Interfaces:**
- Consumes: `cn`, `buttonVariants`.
- Produces: from `#/components/ui/pagination.tsx`:
  ```ts
  function Pagination(props: React.ComponentProps<"nav">): React.JSX.Element
  function PaginationStatus(props: { page: number; totalPages: number }): React.JSX.Element
  function PaginationLink(props: React.ComponentProps<"a"> & { disabled?: boolean }): React.JSX.Element
  function PaginationButton(props: React.ComponentProps<"button">): React.JSX.Element
  ```

- [ ] **Step 1: Write the failing test**

Create `src/test/pagination.test.tsx`:

```tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  Pagination,
  PaginationLink,
  PaginationStatus,
} from "#/components/ui/pagination";

afterEach(cleanup);

describe("Pagination", () => {
  it("labels itself as pagination navigation", () => {
    render(
      <Pagination>
        <PaginationStatus page={1} totalPages={3} />
      </Pagination>
    );
    expect(
      screen.getByRole("navigation", { name: "Pagination" })
    ).toBeTruthy();
  });

  it("takes a disabled link out of the tab order and marks it disabled", () => {
    // The actual bug: pointer-events-none stops the mouse and nothing else, so
    // a keyboard user could still focus and activate "Previous" on page 1.
    render(
      <Pagination>
        <PaginationLink disabled href="/projects?page=0">
          Previous
        </PaginationLink>
      </Pagination>
    );
    const previous = screen.getByText("Previous");
    expect(previous.getAttribute("aria-disabled")).toBe("true");
    expect(previous.getAttribute("tabindex")).toBe("-1");
    expect(previous.hasAttribute("href")).toBe(false);
  });

  it("leaves an enabled link fully operable", () => {
    render(
      <Pagination>
        <PaginationLink href="/projects?page=2">Next</PaginationLink>
      </Pagination>
    );
    const next = screen.getByRole("link", { name: "Next" });
    expect(next.getAttribute("aria-disabled")).toBeNull();
    expect(next.getAttribute("tabindex")).toBeNull();
  });

  it("announces the position politely", () => {
    render(<PaginationStatus page={2} totalPages={5} />);
    const status = screen.getByText("Page 2 of 5");
    expect(status.getAttribute("aria-live")).toBe("polite");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- src/test/pagination.test.tsx`
Expected: FAIL, module does not resolve.

- [ ] **Step 3: Write the primitive**

Create `src/components/ui/pagination.tsx`. This departs from the upstream registry component, which renders a numbered page list and expresses "disabled" with a class. Two of the three call sites here have Previous/Next only, and the class-only disabled state is the exact defect being fixed.

```tsx
import type * as React from "react";
import { cn } from "#/lib/utils.ts";

/**
 * Previous/Next pagination.
 *
 * Two of the three pagers this replaced disabled their controls with
 * `pointer-events-none` alone. That suppresses mouse events and nothing else:
 * the anchor stays in the tab order, still announces as a link, and Enter still
 * activates it, so a keyboard user on page 1 could focus a control that looks
 * disabled, activate it, and get no feedback. Dropping `href` is what actually
 * removes an anchor from the tab order; `aria-disabled` is what tells a screen
 * reader why.
 */
function Pagination({ className, ...props }: React.ComponentProps<"nav">) {
  return (
    <nav
      aria-label="Pagination"
      className={cn(
        "mt-6 flex items-center justify-between text-sm",
        className
      )}
      data-slot="pagination"
      {...props}
    />
  );
}

/**
 * `aria-live="polite"` because the page number is the only confirmation a
 * screen-reader user gets that activating Next did anything: the surrounding
 * list swaps its rows without moving focus.
 */
function PaginationStatus({
  page,
  totalPages,
}: {
  page: number;
  totalPages: number;
}) {
  return (
    <span aria-live="polite" className="text-muted-foreground">
      Page {page} of {totalPages}
    </span>
  );
}

const CONTROL_CLASS =
  "rounded-md px-2 py-1 hover:underline focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2";
const DISABLED_CLASS = "cursor-default text-muted-foreground/40 no-underline hover:no-underline";

function PaginationLink({
  children,
  className,
  disabled,
  href,
  ...props
}: React.ComponentProps<"a"> & { disabled?: boolean }) {
  return (
    <a
      aria-disabled={disabled ? "true" : undefined}
      className={cn(CONTROL_CLASS, disabled && DISABLED_CLASS, className)}
      data-slot="pagination-link"
      // No href when disabled: that is what takes it out of the tab order.
      href={disabled ? undefined : href}
      tabIndex={disabled ? -1 : undefined}
      {...props}
    >
      {children}
    </a>
  );
}

function PaginationButton({
  className,
  disabled,
  ...props
}: React.ComponentProps<"button">) {
  return (
    <button
      className={cn(CONTROL_CLASS, disabled && DISABLED_CLASS, className)}
      data-slot="pagination-button"
      disabled={disabled}
      type="button"
      {...props}
    />
  );
}

export { Pagination, PaginationButton, PaginationLink, PaginationStatus };
```

- [ ] **Step 4: Run the test**

Run: `npm test -- src/test/pagination.test.tsx`
Expected: PASS, 4 tests.

- [ ] **Step 5: Convert `projects/index.tsx`**

TanStack's `<Link>` renders an `<a>` and accepts `disabled`, but it does not drop `href`, so `PaginationLink` is used with `asChild`-style composition instead. The simplest correct form here is to render `PaginationLink` directly and let TanStack build the href through its `Link` only when enabled. Use the two-branch form:

```tsx
      <Pagination className="mx-auto max-w-4xl">
        {page <= 1 ? (
          <PaginationLink disabled>Previous</PaginationLink>
        ) : (
          <PaginationLink asChild>
            <Link
              from="/projects/"
              search={(prev) => ({ ...prev, page: page - 1 })}
              to="/projects"
            >
              Previous
            </Link>
          </PaginationLink>
        )}
        <PaginationStatus page={page} totalPages={totalPages} />
        {page >= totalPages ? (
          <PaginationLink disabled>Next</PaginationLink>
        ) : (
          <PaginationLink asChild>
            <Link
              from="/projects/"
              search={(prev) => ({ ...prev, page: page + 1 })}
              to="/projects"
            >
              Next
            </Link>
          </PaginationLink>
        )}
      </Pagination>
```

This needs `asChild` on `PaginationLink`, which the Step 3 code does not have. Add it using the same `Slot` import the `Button` component uses:

```tsx
import { Slot } from "radix-ui";
```

and in `PaginationLink`:

```tsx
function PaginationLink({
  asChild,
  children,
  className,
  disabled,
  href,
  ...props
}: React.ComponentProps<"a"> & { asChild?: boolean; disabled?: boolean }) {
  const Comp = asChild && !disabled ? Slot.Root : "a";
  return (
    <Comp
      aria-disabled={disabled ? "true" : undefined}
      className={cn(CONTROL_CLASS, disabled && DISABLED_CLASS, className)}
      data-slot="pagination-link"
      href={disabled || asChild ? undefined : href}
      tabIndex={disabled ? -1 : undefined}
      {...props}
    >
      {children}
    </Comp>
  );
}
```

`asChild && !disabled` matters: when disabled there is no child `Link` to merge onto, so it must fall back to a plain `<a>` with no `href`. `Slot.Root` is the correct form for this Radix version, matching `src/components/ui/button.tsx:51`.

Since the Step 3 test does not cover `asChild`, add one more case to `src/test/pagination.test.tsx`:

```tsx
  it("merges onto a child link when enabled", () => {
    render(
      <Pagination>
        <PaginationLink asChild>
          <a href="/projects?page=2">Next</a>
        </PaginationLink>
      </Pagination>
    );
    // One element, not an anchor inside an anchor.
    expect(screen.getAllByRole("link", { name: "Next" })).toHaveLength(1);
  });
```

Also drop the now-redundant `Math.max(1, ...)` and `Math.min(totalPages, ...)` clamps: the branch already guarantees the bound, and leaving them implies the guard is not trusted.

- [ ] **Step 6: Convert `admin/users/index.tsx`**

The same shape on a different route. Repeated in full rather than referred back to, because you may be reading this task on its own. This pager has no `mx-auto max-w-4xl` wrapper today, so it passes no `className`:

```tsx
      <Pagination>
        {page <= 1 ? (
          <PaginationLink disabled>Previous</PaginationLink>
        ) : (
          <PaginationLink asChild>
            <Link
              from="/admin/users/"
              search={(prev) => ({ ...prev, page: page - 1 })}
              to="/admin/users"
            >
              Previous
            </Link>
          </PaginationLink>
        )}
        <PaginationStatus page={page} totalPages={totalPages} />
        {page >= totalPages ? (
          <PaginationLink disabled>Next</PaginationLink>
        ) : (
          <PaginationLink asChild>
            <Link
              from="/admin/users/"
              search={(prev) => ({ ...prev, page: page + 1 })}
              to="/admin/users"
            >
              Next
            </Link>
          </PaginationLink>
        )}
      </Pagination>
```

Add the import:

```tsx
import {
  Pagination,
  PaginationLink,
  PaginationStatus,
} from "#/components/ui/pagination";
```

As on `/projects`, the `Math.max` and `Math.min` clamps come out: the branch already guarantees the bound.

- [ ] **Step 7: Convert `inventory/index.tsx`**

This one is button-driven and already correct on the disabled semantics. It converts for consistency, and it keeps `PaginationButton` rather than `PaginationLink`:

```tsx
      <Pagination className="mx-auto max-w-4xl">
        <PaginationButton
          disabled={data.page <= 1}
          onClick={() =>
            navigate({ search: (s) => ({ ...s, page: s.page - 1 }) })
          }
        >
          Previous
        </PaginationButton>
        <PaginationStatus page={data.page} totalPages={totalPages} />
        <PaginationButton
          disabled={data.page >= totalPages}
          onClick={() =>
            navigate({ search: (s) => ({ ...s, page: s.page + 1 }) })
          }
        >
          Next
        </PaginationButton>
      </Pagination>
```

The `pointer-events-none` class is gone: `disabled` already does that job on a button, and keeping both was what made this pager look like the broken ones.

- [ ] **Step 8: Verify by keyboard, which is the whole point**

Run: `npm run dev`. On `/projects` at page 1:

1. Tab through the pager. Focus must **skip** "Previous" entirely and land on "Next".
2. Navigate to the last page. Focus must skip "Next".
3. With a screen reader or the browser's accessibility inspector, confirm the disabled control reports `aria-disabled: true`.
4. Confirm "Page 1 of N" still reads correctly and the mouse still works.

Repeat on `/admin/users` and `/inventory`.

- [ ] **Step 9: Full run**

Run: `npm test && npm run check && npm run typecheck`
Expected: all clean.

- [ ] **Step 10: Commit**

```bash
git add src/components/ui/pagination.tsx src/test/pagination.test.tsx src/routes/projects/index.tsx src/routes/_authed/admin/users/index.tsx src/routes/inventory/index.tsx
git commit -m "fix(ui): stop disabled pagination controls staying keyboard-reachable"
```

### Task 7: The first interaction-state accessibility assertions

`admin.a11y.test.ts` fires 33 interactions before scanning. `public.a11y.test.ts` and `user.a11y.test.ts` fire zero, so every page they cover is scanned only in its initial load state. Groups 1 and 2 just added three interactive components to exactly those pages.

**Files:**
- Modify: `src/test/a11y/user.a11y.test.ts`
- Modify: `src/test/a11y/public.a11y.test.ts`

**Interfaces:**
- Consumes: `checkA11y` and `waitForHydration` from `./helpers`, `ConfirmDialog` / `Tabs` / `Pagination` as rendered by Tasks 3, 5, and 6.
- Produces: nothing importable.

- [ ] **Step 1: Read the existing interactive pattern before writing a new one**

Open `src/test/a11y/admin.a11y.test.ts` and read how it opens the Columns menu, waits, scans, and closes with `closeMenu`. Match that shape. In particular, note that it calls `waitForHydration` before interacting: server-rendered buttons are clickable before React attaches listeners, and a click in that window silently does nothing.

- [ ] **Step 2: Add the tab-strip scan to `user.a11y.test.ts`**

```ts
test("my items, each tab panel", async ({ page }) => {
  await page.goto("/my/items");
  await waitForHydration(page);

  // The tab strip was three loose buttons until 2026-08-22 and this suite
  // could not tell, because a labelled button is valid markup on its own. The
  // scan that matters is of the selected state and each panel's content.
  for (const name of [/^Cart/, /^Active/, /^History/]) {
    await page.getByRole("tab", { name }).click();
    await expect(page.getByRole("tab", { name, selected: true })).toBeVisible();
    await checkA11y(page);
  }
});
```

Add `waitForHydration` to the file's import from `./helpers` if it is not already there.

- [ ] **Step 3: Add the confirmation-dialog scan to `user.a11y.test.ts`**

The project detail page for a draft owned by the fixture user carries the delete trigger. Confirm the fixture project's status before relying on this: read `createFixtures` in `src/test/a11y/global-setup.ts` and use a project the fixture user owns in `draft`. If none exists, extend the fixture to create one rather than skipping this test, because an unscanned dialog is the exact gap this task exists to close.

```ts
test("delete confirmation dialog", async ({ page }) => {
  await page.goto(`/projects/${draftProjectId}`);
  await waitForHydration(page);

  await page.getByRole("button", { name: /Delete/ }).first().click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();

  // A native confirm() could not be scanned at all: axe cannot reach a page
  // whose script is parked on a modal browser prompt.
  await checkA11y(page);

  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
});
```

`global-setup.ts` does **not** currently create a draft project: its `writeFileSync` at line 236 emits only `projectId` and `itemId`. So this step requires extending `createFixtures` to insert a draft owned by `user@example.com`, and adding `draftProjectId` to both the written JSON and the destructured read at the top of `user.a11y.test.ts`. Follow the shape of the existing fixture inserts, including their select-first idempotency.

- [ ] **Step 4: Add the pagination scan to `public.a11y.test.ts`**

```ts
test("projects list, paginated", async ({ page }) => {
  await page.goto("/projects");
  await waitForHydration(page);

  const pager = page.getByRole("navigation", { name: "Pagination" });
  await expect(pager).toBeVisible();

  // On page 1 the Previous control must be out of the tab order entirely.
  // pointer-events-none used to leave it focusable and activatable, which no
  // axe rule reports.
  await expect(pager.getByText("Previous")).toHaveAttribute(
    "aria-disabled",
    "true"
  );
  await expect(pager.getByText("Previous")).toHaveAttribute("tabindex", "-1");
  await checkA11y(page);
});
```

- [ ] **Step 5: Run the accessibility suite**

Run: `npm run test:accessibility`
Expected: PASS, including the new tests in both the `chromium-light` and `chromium-dark` projects.

If the seed has only one page of projects, the pager may not render at all. Either extend `global-setup.ts` the way it already creates `PAGINATION_USER_COUNT` extra users for the admin pagination test, or assert conditionally on the pager being present. Prefer extending the fixture: a conditional assertion silently passes when it stops covering anything.

- [ ] **Step 6: Commit**

```bash
git add src/test/a11y/user.a11y.test.ts src/test/a11y/public.a11y.test.ts src/test/a11y/global-setup.ts
git commit -m "test(a11y): scan tabs, dialogs, and pagination in their interactive states"
```

---

# Group 3: Shape consolidation

Cosmetic and mechanical, and the safest to defer. Nothing here changes behavior.

### Task 8: The Badge primitive

Four components render the same box, with two accidental divergences: `status-badge.tsx` uses `inline-block` where its siblings use `inline-flex`, and `category-chip.tsx` drops `font-medium`. Upstream `badge` has four fixed variants and no way to express a status-token mapping, so this adopts the box and keeps the maps.

**Files:**
- Create: `src/components/ui/badge.tsx`
- Modify: `src/components/status-badge.tsx`
- Modify: `src/components/inventory-status-badge.tsx`
- Modify: `src/components/overdue-badge.tsx`
- Modify: `src/components/category-chip.tsx`
- Test: `src/test/badge.test.tsx`

**Interfaces:**
- Consumes: `cn`, `class-variance-authority` (already a dependency).
- Produces:
  ```ts
  function Badge(props: React.ComponentProps<"span"> & {
    variant?: "default" | "outline" | "secondary" | "status";
  }): React.JSX.Element
  ```

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Badge } from "#/components/ui/badge";

afterEach(cleanup);

describe("Badge", () => {
  it("renders its content in a consistent box", () => {
    render(<Badge>Approved</Badge>);
    const badge = screen.getByText("Approved");
    expect(badge.className).toContain("inline-flex");
    expect(badge.className).toContain("rounded");
  });

  it("lets a status caller supply its own tokens", () => {
    // The reason this is not a plain cva adoption: the four badge components
    // map a domain status to a --status-* pair, which no fixed variant can say.
    render(
      <Badge
        style={{
          background: "var(--status-success-bg)",
          color: "var(--status-success)",
        }}
        variant="status"
      >
        Available
      </Badge>
    );
    const badge = screen.getByText("Available");
    expect(badge.style.color).toBe("var(--status-success)");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- src/test/badge.test.tsx`
Expected: FAIL, module does not resolve.

- [ ] **Step 3: Write the primitive**

```tsx
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "#/lib/utils.ts";

/**
 * The badge box, and only the box.
 *
 * Four components wrote this shape independently and two drifted: one used
 * `inline-block` instead of `inline-flex`, another dropped `font-medium`. The
 * upstream variants (default, secondary, destructive, outline) cannot express
 * what those four actually do, which is map a domain status to a `--status-*`
 * foreground and background pair. So `status` is a variant that paints nothing
 * and expects the caller to supply both through `style`.
 */
const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded px-2 py-0.5 font-medium text-xs",
  {
    defaultVariants: {
      variant: "default",
    },
    variants: {
      variant: {
        default: "bg-secondary text-secondary-foreground",
        outline: "border border-border text-foreground",
        secondary: "bg-secondary text-muted-foreground",
        // Painted by the caller's inline --status-* tokens.
        status: "",
      },
    },
  }
);

function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return (
    <span
      className={cn(badgeVariants({ variant }), className)}
      data-slot="badge"
      {...props}
    />
  );
}

export { Badge, badgeVariants };
```

- [ ] **Step 4: Run the test**

Run: `npm test -- src/test/badge.test.tsx`
Expected: PASS.

- [ ] **Step 5: Route the four components through it**

`status-badge.tsx`, replacing the `<span>` and dropping its hand-written class:

```tsx
  return (
    <Badge style={{ backgroundColor: bg, color: fg }} variant="status">
      {status.replace(/_/g, " ")}
    </Badge>
  );
```

`inventory-status-badge.tsx`:

```tsx
  return (
    <Badge style={style} variant="status">
      {LABEL[status]}
    </Badge>
  );
```

`overdue-badge.tsx`, in its internal wrapper component:

```tsx
  return (
    <Badge style={style} variant="status">
      {children}
    </Badge>
  );
```

`category-chip.tsx`, which is the one that gains `font-medium` it was accidentally missing:

```tsx
  return (
    <Badge
      style={{
        background: "var(--chip-bg)",
        border: "1px solid var(--chip-line)",
      }}
      variant="status"
    >
      {category.type && (
        <span style={{ color: "var(--text-secondary)" }}>{category.type}</span>
      )}
      <span style={{ color: "var(--text-primary)" }}>{category.name}</span>
    </Badge>
  );
```

Add `import { Badge } from "./ui/badge";` to each.

- [ ] **Step 6: Run the existing badge tests, which are the regression net**

Run: `npm test -- src/test/overdue-badge.test.tsx src/test/inventory-status-badge.test.tsx`
Expected: PASS, unchanged. These assert on text content, so they pass through the refactor and prove the labels and the null-render branches survived.

- [ ] **Step 7: Look at a page with badges on it**

Run: `npm run dev`, visit `/inventory` and `/admin/projects`. Confirm badges look unchanged in light and dark, and that category chips are now the same weight as status badges. That last one is a deliberate visual change, the divergence being corrected.

- [ ] **Step 8: Full run and commit**

Run: `npm test && npm run check && npm run typecheck`

```bash
git add src/components/ui/badge.tsx src/test/badge.test.tsx src/components/status-badge.tsx src/components/inventory-status-badge.tsx src/components/overdue-badge.tsx src/components/category-chip.tsx
git commit -m "refactor(ui): render every badge through one Badge component"
```

### Task 9: The Card primitive

`rounded-lg border border-border bg-card` is written inline in eight components. `panel.tsx`, `.island-shell`, and `.feature-card` are separate deliberate surfaces and are **not** touched.

**Files:**
- Create: `src/components/ui/card.tsx`
- Modify: `src/components/project-card.tsx`, `src/components/inventory-card.tsx`, `src/components/project-row.tsx`, `src/components/inventory-row.tsx`, `src/components/owner-project-actions.tsx`, `src/components/projects-filter-bar.tsx`, `src/components/inventory-filter-bar.tsx`, `src/routes/_authed/admin/index.tsx`
- Test: `src/test/card.test.tsx`

**Interfaces:**
- Consumes: `cn`.
- Produces: `Card`, `CardHeader`, `CardTitle`, `CardContent`, `CardFooter` from `#/components/ui/card.tsx`. `Card` accepts `interactive?: boolean` for the hover-border treatment the list items share.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Card } from "#/components/ui/card";

afterEach(cleanup);

describe("Card", () => {
  it("renders the shared surface", () => {
    render(<Card>body</Card>);
    const card = screen.getByText("body");
    expect(card.className).toContain("rounded-lg");
    expect(card.className).toContain("border-border");
    expect(card.className).toContain("bg-card");
  });

  it("adds the hover treatment only when interactive", () => {
    const { rerender } = render(<Card>plain</Card>);
    expect(screen.getByText("plain").className).not.toContain("hover:border-primary");
    rerender(<Card interactive>linked</Card>);
    expect(screen.getByText("linked").className).toContain("hover:border-primary");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- src/test/card.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Write the primitive**

```tsx
import type * as React from "react";
import { cn } from "#/lib/utils.ts";

/**
 * The repeated card surface, which eight components wrote inline.
 *
 * `panel.tsx`, `.island-shell` and `.feature-card` are deliberately not routed
 * through this. They are distinct surfaces with their own borders and tones,
 * not instances of this one, and collapsing them would lose the distinction
 * `panel.tsx` exists to draw.
 */
function Card({
  className,
  interactive,
  ...props
}: React.ComponentProps<"div"> & { interactive?: boolean }) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card",
        interactive && "transition-colors hover:border-primary",
        className
      )}
      data-slot="card"
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div className={cn("p-4 pb-0", className)} data-slot="card-header" {...props} />
  );
}

function CardTitle({ className, ...props }: React.ComponentProps<"h3">) {
  return (
    <h3
      className={cn("font-medium text-sm", className)}
      data-slot="card-title"
      {...props}
    />
  );
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("p-4", className)} data-slot="card-content" {...props} />;
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex items-center p-4 pt-0", className)}
      data-slot="card-footer"
      {...props}
    />
  );
}

export { Card, CardContent, CardFooter, CardHeader, CardTitle };
```

- [ ] **Step 4: Convert one component and check it renders identically**

Start with `project-card.tsx`. Its root is:

```tsx
"flex flex-col overflow-hidden rounded-lg border border-border bg-card transition-colors hover:border-primary"
```

becomes:

```tsx
<Card className="flex flex-col overflow-hidden" interactive>
```

Run: `npm test -- src/test/project-card.test.tsx`
Expected: PASS unchanged.

- [ ] **Step 5: Convert the remaining seven**

Apply the same transform: strip `rounded-lg border border-border bg-card` (and `transition-colors hover:border-primary` where present, replacing it with `interactive`) from the className, keep every other class, wrap in `<Card>`.

- `inventory-card.tsx`: `<Card className="flex flex-col overflow-hidden" interactive>`
- `inventory-row.tsx`: `<Card className="flex items-stretch gap-3 overflow-hidden" interactive>`
- `project-row.tsx`: `<Card className="flex items-center gap-3 overflow-hidden p-3" interactive>`
- `owner-project-actions.tsx`: its surface is `bg-secondary`, not `bg-card`, so pass `className="mt-6 bg-secondary p-4"` and let `cn` win the later class.
- `projects-filter-bar.tsx` and `inventory-filter-bar.tsx`: `<Card className="p-4">`. Note these two have **no** `bg-card` today, only the border. Passing `Card` gives them one. Check both in the browser before accepting that change; if the filter bar is meant to sit flush with the page, pass `className="bg-transparent p-4"`.
- `admin/index.tsx`: two surfaces, one plain and one interactive with `hover:bg-secondary` rather than `hover:border-primary`. Keep its distinct hover class in `className` and do not pass `interactive`.

- [ ] **Step 6: Look at every converted page**

Run: `npm run dev`. Visit `/projects` (card and row views), `/inventory` (both views), `/admin`, and a draft project page. Compare against `git stash` if anything looks off. The filter bars are the likeliest regression.

- [ ] **Step 7: Full run and commit**

Run: `npm test && npm run check && npm run typecheck`

```bash
git add src/components/ui/card.tsx src/test/card.test.tsx src/components/project-card.tsx src/components/inventory-card.tsx src/components/project-row.tsx src/components/inventory-row.tsx src/components/owner-project-actions.tsx src/components/projects-filter-bar.tsx src/components/inventory-filter-bar.tsx src/routes/_authed/admin/index.tsx
git commit -m "refactor(ui): route the repeated card surface through one Card component"
```

### Task 10: The Field primitive, and the six unlabelled inputs

`field` is the one form primitive this project can adopt: zero npm dependencies, no react-hook-form. It replaces both the documented `space-y-1.5` wrapper and `field-errors.tsx`.

**Files:**
- Create: `src/components/ui/field.tsx`
- Delete: `src/components/field-errors.tsx`
- Modify: every importer of `FieldErrors`
- Modify: `src/components/comment-thread.tsx`, `src/components/inventory-filter-bar.tsx`, `src/components/projects-filter-bar.tsx`, `src/components/inventory-lifecycle-panel.tsx`, `src/routes/_authed/my/items.tsx`
- Test: `src/test/field.test.tsx`, and update `src/test/field-errors.test.tsx`

**Interfaces:**
- Consumes: `Label` from `#/components/ui/label.tsx`, `cn`.
- Produces:
  ```ts
  function Field(props: React.ComponentProps<"div">): React.JSX.Element
  function FieldLabel(props: React.ComponentProps<typeof Label>): React.JSX.Element
  function FieldError(props: { errors: readonly unknown[] }): React.JSX.Element | null
  ```

- [ ] **Step 1: Find every importer before deleting anything**

Run: `grep -rn "field-errors\|FieldErrors" src --include='*.tsx' --include='*.ts'`

Write the list down. Every one of them is edited in Step 5.

- [ ] **Step 2: Write the failing test**

Create `src/test/field.test.tsx`. `FieldError` inherits `FieldErrors`' entire contract, so its tests are carried over from `src/test/field-errors.test.tsx` rather than reinvented. Open that file and port every case, then add:

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Field, FieldError, FieldLabel } from "#/components/ui/field";
import { Input } from "#/components/ui/input";

afterEach(cleanup);

describe("Field", () => {
  it("associates the label with the input", () => {
    render(
      <Field>
        <FieldLabel htmlFor="email">Email</FieldLabel>
        <Input id="email" name="email" />
      </Field>
    );
    // The pairing the 6 placeholder-only inputs are missing.
    expect(screen.getByLabelText("Email")).toBeTruthy();
  });

  it("renders nothing when there are no errors", () => {
    const { container } = render(<FieldError errors={[]} />);
    expect(container.textContent).toBe("");
  });

  it("renders a bare string error", () => {
    render(<FieldError errors={["Required"]} />);
    expect(screen.getByText("Required")).toBeTruthy();
  });

  it("renders a Standard Schema issue object", () => {
    render(<FieldError errors={[{ message: "Too short" }]} />);
    expect(screen.getByText("Too short")).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npm test -- src/test/field.test.tsx`
Expected: FAIL.

- [ ] **Step 4: Write the primitive**

Move the body of `field-errors.tsx` in verbatim, including its comment, which explains why the errors can be either shape. That comment is the reason the component exists and it must not be lost in the move.

```tsx
import type * as React from "react";
import { Label } from "#/components/ui/label.tsx";
import { cn } from "#/lib/utils.ts";

/**
 * The label/control/error triple, as one shape.
 *
 * Replaces the `space-y-1.5` div the design doc described, which every form
 * wrote by hand and six controls forgot: they shipped with a placeholder and no
 * label at all. A placeholder is not a label. It disappears the moment the user
 * types, and axe does not report it, because `placeholder` is a fallback in the
 * accessible-name computation, so the name is technically non-empty.
 *
 * This is `field`, not `form`. Upstream `form` hard-depends on react-hook-form
 * and this project uses TanStack Form; `field` has no npm dependencies at all.
 */
function Field({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div className={cn("space-y-1.5", className)} data-slot="field" {...props} />
  );
}

function FieldLabel({ ...props }: React.ComponentProps<typeof Label>) {
  return <Label data-slot="field-label" {...props} />;
}

/**
 * The one place that knows a form error can be a string or an object.
 *
 * Which one arrives depends on the validator. A Standard Schema, which is what
 * both forms now pass, produces `{ message }` issues; a hand-written validator
 * or a server error can produce a bare string. Rendering both is cheaper than
 * making every call site know which it has.
 *
 * Six `form.Field` render props displayed no errors at all before this existed,
 * so a failed validation greyed out the Save button and said nothing.
 */
function FieldError({ errors }: { errors: readonly unknown[] }) {
  if (errors.length === 0) {
    return null;
  }
  return (
    <p className="mt-1 text-destructive text-sm" data-slot="field-error">
      {errors
        .map((e: unknown) =>
          typeof e === "string"
            ? e
            : ((e as { message?: string })?.message ?? String(e))
        )
        .join(", ")}
    </p>
  );
}

export { Field, FieldError, FieldLabel };
```

- [ ] **Step 5: Swap every `FieldErrors` importer and delete the old file**

For each file from Step 1, change the import and the tag:

```tsx
import { FieldError } from "#/components/ui/field";
```

```tsx
<FieldError errors={field.state.meta.errors} />
```

Then:

```bash
git rm src/components/field-errors.tsx src/test/field-errors.test.tsx
```

The old test is removed, not kept alongside: its cases were ported into `field.test.tsx` in Step 2, and keeping both would be the parallel code path this repo's rules forbid. Confirm the port is complete before deleting, by diffing the case names.

- [ ] **Step 6: Give the six unlabelled controls an accessible name**

None of these have a visible label, and adding one would change the layout, so each gets an `aria-label`. `src/routes/_authed/admin/mentors/index.tsx` already does exactly this and is the pattern.

- `src/components/projects-filter-bar.tsx`, the search `Input`: `aria-label="Search projects"`
- `src/components/inventory-filter-bar.tsx`, the search `Input`: `aria-label="Search inventory"`
- `src/components/comment-thread.tsx`, both `Textarea`s: `aria-label="Comment"` on the top-level composer and `aria-label="Reply"` on the reply composer. Read the file to tell which is which.
- `src/components/inventory-lifecycle-panel.tsx`, the `Input`: name it after the field it sets. Read its surrounding markup and use that noun.
- `src/routes/_authed/my/items.tsx`, the `Textarea` with placeholder "Optional note for staff": `aria-label="Note for staff"`.

- [ ] **Step 7: Add a guard so the seventh does not appear**

Append to `src/test/field.test.tsx`:

```tsx
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return walk(full);
    }
    return full.endsWith(".tsx") ? [full] : [];
  });
}

describe("every Input and Textarea", () => {
  it("has an id or an aria-label", () => {
    const offenders: string[] = [];
    for (const file of walk("src")) {
      if (file.includes("components/ui/") || file.includes("src/test/")) {
        continue;
      }
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/<(Input|Textarea)\b([\s\S]*?)\/?>/g)) {
        if (!(/\bid=/.test(match[2]) || /aria-label/.test(match[2]))) {
          offenders.push(`${file}: <${match[1]}>`);
        }
      }
    }
    expect(
      offenders,
      `A placeholder is not a label: it disappears when the user types, and axe\n` +
        `will not report it. Give the control an id paired with a FieldLabel, or\n` +
        `an aria-label when there is no visible label.\n\n` +
        offenders.join("\n")
    ).toEqual([]);
  });
});
```

- [ ] **Step 8: Run everything**

Run: `npm test && npm run check && npm run typecheck`
Expected: all clean, including the new guard.

- [ ] **Step 9: Commit**

Stage by name. `git add -u` would sweep every modified tracked file in the repo, which is the same hazard the `git add -A` ban exists to prevent.

The three `FieldErrors` importers come from Step 1's grep. Substitute the paths it printed:

```bash
git add src/components/ui/field.tsx src/test/field.test.tsx
git add <importer-1> <importer-2> <importer-3>
git add src/components/comment-thread.tsx src/components/inventory-filter-bar.tsx \
        src/components/projects-filter-bar.tsx src/components/inventory-lifecycle-panel.tsx \
        src/routes/_authed/my/items.tsx
git commit -m "refactor(ui): adopt Field, and give every input an accessible name"
```

The `git rm` in Step 5 already staged the two deletions.

### Task 11: Delete the dead slider, and sweep the palette and emdash tails

**Files:**
- Delete: `src/components/ui/slider.tsx`
- Modify: the files holding raw palette classes and emdashes

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

- [ ] **Step 1: Confirm the slider is really dead**

Run: `grep -rn "slider\|Slider" src --include='*.tsx' --include='*.ts' | grep -v "src/components/ui/slider.tsx"`
Expected: no output.

If anything appears, stop and do not delete.

- [ ] **Step 2: Delete it**

```bash
git rm src/components/ui/slider.tsx
```

The `radix-ui` dependency stays: it is the unified package and nine other components import from it.

- [ ] **Step 3: Sweep the raw palette classes**

Run: `grep -rn 'text-neutral-\|border-neutral-\|bg-neutral-\|bg-white\|text-red-\|text-blue-' src --include='*.tsx' | grep -v 'src/components/ui/' | grep -v 'src/test/'`

Expected: 23 hits. Apply the mapping from `docs/UI-CONVENTIONS.md`:

| Raw | Token |
| --- | --- |
| `text-neutral-500` | `text-muted-foreground` |
| `border-neutral-200`, `border-neutral-300` | `border-border` |
| `bg-neutral-50`, `bg-neutral-100` | `bg-secondary` |
| `bg-white` | `bg-card` |
| `text-red-600`, `text-red-700` | `text-destructive` |
| `text-blue-700` on a link | drop it, the global `a` style handles link color |

Read each site before replacing: a `text-red-` inside a status map may want `var(--status-error)` rather than `text-destructive`.

- [ ] **Step 4: Remove the emdashes from `src/`**

The repo's hard rule bans them in comments and string literals, and 17 have accumulated across 11 files.

Run: `grep -rn '—' src --include='*.tsx' --include='*.ts'`

Rewrite each with a comma, colon, semicolon, parens, or a new sentence. `src/components/panel.tsx` has one in the comment explaining the four heading treatments; `src/lib/brand.ts`, `src/lib/is-uuid.ts`, `src/lib/use-has-mounted.ts`, `src/server/_internal/inventory.ts`, `src/components/staff-project-panel.tsx`, `src/components/category-filter-combobox.tsx`, and all four `src/test/a11y/` files have the rest. Do not change the meaning of any comment while fixing its punctuation.

- [ ] **Step 5: Verify both sweeps**

Run: `grep -rn '—' src --include='*.tsx' --include='*.ts' | wc -l`
Expected: `0`

Run: `grep -rn 'text-neutral-\|border-neutral-\|bg-neutral-\|bg-white\|text-red-\|text-blue-' src --include='*.tsx' | grep -v 'src/components/ui/' | grep -v 'src/test/' | wc -l`
Expected: `0`

- [ ] **Step 6: Check both themes**

Run: `npm run dev`. The palette swap is the only change here that can regress visually, and only in dark mode, which is the entire reason the tokens exist. Toggle your OS to dark and visit every page you touched.

- [ ] **Step 7: Full run and commit**

Run: `npm test && npm run check && npm run typecheck`

Stage by name, using the file lists the Step 3 and Step 4 greps printed. `git rm` in Step 2 already staged the slider deletion.

```bash
git status --short          # confirm nothing unrelated is modified
git add <palette-files...> <emdash-files...>
git commit -m "style(ui): drop the dead slider, raw palette classes, and stray emdashes"
```

The emdash set is 11 files: `src/components/panel.tsx`, `src/components/staff-project-panel.tsx`, `src/components/category-filter-combobox.tsx`, `src/lib/brand.ts`, `src/lib/is-uuid.ts`, `src/lib/use-has-mounted.ts`, `src/server/_internal/inventory.ts`, and the four under `src/test/a11y/`.

### Task 12: Rewrite the design system doc

The doc currently teaches two hand-rolled patterns that no longer exist. This is the task the issue's last line asks for: "updated where the audit settles something new."

**Files:**
- Modify: `docs/UI-CONVENTIONS.md`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing importable.

- [ ] **Step 1: Replace the "Status tabs" pattern**

Under "Component patterns", delete the `border-b-2` snippet entirely and write:

````markdown
### Status tabs

Use `<Tabs>` from `#/components/ui/tabs`. It supplies `role="tablist"`,
`aria-selected`, `aria-controls`, and arrow-key movement, none of which the raw
buttons this replaced had. The brand underline on the active tab lives in the
component, keyed off `data-state=active`, so no call site sets it.

When the active tab is a URL search param, drive it controlled:

```tsx
<Tabs onValueChange={(next) => navigate({ search: { tab: next } })} value={tab}>
  <TabsList>
    <TabsTrigger value="cart">Cart</TabsTrigger>
    <TabsTrigger value="active">Active</TabsTrigger>
  </TabsList>
  <TabsContent value="cart">...</TabsContent>
  <TabsContent value="active">...</TabsContent>
</Tabs>
```
````

- [ ] **Step 2: Replace the "Disabled pagination" pattern**

````markdown
### Pagination

Use `<Pagination>` from `#/components/ui/pagination`, with `PaginationLink` for
route links and `PaginationButton` for in-place navigation.

Never disable a pagination control with `pointer-events-none` alone. That
suppresses mouse events and nothing else: the anchor stays in the tab order, is
still announced as a link, and Enter still activates it, so a keyboard user on
page 1 could focus a control that looks disabled and activate it to no effect.
Two of the three pagers in this app shipped that way, and no axe rule reports
it. `PaginationLink` drops `href` and sets `aria-disabled` and `tabIndex={-1}`
when disabled, which is what actually removes it from the tab order.

```tsx
<Pagination>
  {page <= 1 ? (
    <PaginationLink disabled>Previous</PaginationLink>
  ) : (
    <PaginationLink asChild>
      <Link search={(prev) => ({ ...prev, page: page - 1 })} to="/projects">
        Previous
      </Link>
    </PaginationLink>
  )}
  <PaginationStatus page={page} totalPages={totalPages} />
  ...
</Pagination>
```
````

- [ ] **Step 3: Add the "Destructive actions" section**

````markdown
## Destructive actions

Anything irreversible confirms through `<ConfirmDialog>` from
`#/components/confirm-dialog`. Pass the question as `title` and the consequence
as `description`; the title is what gives the dialog its accessible name.

```tsx
<ConfirmDialog
  description="This cannot be undone."
  onConfirm={runDelete}
  title="Permanently delete this draft?"
>
  <Button variant="destructive">Delete draft</Button>
</ConfirmDialog>
```

Results that need no acknowledgement use a toast: `import { toast } from "sonner"`.

**Native `confirm()` and `alert()` are banned.** They are unstyled, ignore the
brand and the dark palette, block the main thread, and cannot be scanned by the
accessibility suite, because axe cannot reach a page whose script is parked on a
modal browser prompt. `src/test/no-native-modals.test.ts` enforces this.
````

- [ ] **Step 4: Extend "Form inputs"**

Append to that section:

````markdown
Wrap the triple in `<Field>` from `#/components/ui/field`, which carries the
`space-y-1.5` rhythm and pairs with `FieldLabel` and `FieldError`:

```tsx
<Field>
  <FieldLabel htmlFor="email">Email</FieldLabel>
  <Input id="email" name="email" type="email" required />
  <FieldError errors={field.state.meta.errors} />
</Field>
```

**A placeholder is not a label.** Every `Input` and `Textarea` needs an `id`
matched by a `FieldLabel htmlFor`, or an `aria-label` when there is no visible
label. A placeholder disappears the moment the user types, and axe will not
report its absence, because `placeholder` is a fallback in the accessible-name
computation, so the name reads as non-empty. Six controls shipped this way.
`src/test/field.test.tsx` enforces it.

### Why not shadcn `form`

The upstream `form` component hard-depends on `react-hook-form` and
`@hookform/resolvers`. This project uses TanStack Form, so adopting it would put
a second form library in the tree. `field` is the form-library-agnostic half of
that family and has no npm dependencies at all. Do not re-propose `form`.
````

- [ ] **Step 5: Correct the two stale conventions**

In "Page wrapper padding", replace the claim that `max-w-4xl` is the standard:

````markdown
Page width is chosen by content, not fixed. Counting route roots: `max-w-2xl` on
form and detail pages (7), `max-w-4xl` on list pages that hold a grid (3),
`max-w-3xl` on the one long-form page, and `max-w-md` / `max-w-sm` on the auth
cards. Pick the narrowest that fits the content; a form at `max-w-4xl` has an
uncomfortably long measure.
````

In "Mobile-first layout", sanction the card grid:

````markdown
The one sanctioned exception is the responsive card grid, which needs more tiers
because column count should track available width continuously. All four grids
use the same ladder, and a new one must match it rather than invent a variant:

```tsx
<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
```

Everything else stays two-tier.
````

- [ ] **Step 6: Add the badge and surface rules**

Under "Component patterns":

````markdown
### Badges

Every badge renders through `<Badge>` from `#/components/ui/badge`. A badge that
carries a domain status uses `variant="status"` and supplies its own
`--status-*` foreground and background through `style`, because the upstream
variants cannot express a status mapping. Four components wrote this box
independently before this rule and two had drifted apart.

### Surfaces are not all cards

`<Card>` is the repeated `rounded-lg border border-border bg-card` surface used
by list items, filter bars, and admin tiles. Three other surfaces are
deliberately separate and must not be folded into it:

- `panel.tsx` for the audience-gated panels, which carry their own tone variants
- `.island-shell` for the auth cards
- `.feature-card` for the landing page tiles
````

- [ ] **Step 7: Update the table of contents**

The doc opens with a 9-item numbered list. Add "Destructive actions" and confirm every anchor still resolves to a heading that exists.

- [ ] **Step 8: Check the doc against its own rules**

Run: `grep -n '—\|–' docs/UI-CONVENTIONS.md`
Expected: no output.

Read the whole file once, top to bottom. Every code sample must reflect a component that now exists.

- [ ] **Step 9: Commit**

```bash
git add docs/UI-CONVENTIONS.md
git commit -m "docs(ui): teach the primitives instead of the hand-rolled patterns"
```

---

## Self-Review

**Spec coverage.** Every finding maps to a task:

| Spec finding | Task |
|---|---|
| 1. Destructive confirmation has no component | 2, 3, 4 |
| 2. Hand-rolled tabs are not a tablist | 5 |
| 3. Pagination keyboard-reachable, two implementations | 6 |
| 4. Suite ungated; zero interaction assertions | 1, 7 |
| 5. Four badge components, two divergences | 8 |
| 6. Four card idioms | 9 |
| 7. `field` yes, `form` never | 10, and 12 records the reason |
| 8. Dead `slider.tsx` | 11 |
| 9. Two stale doc conventions | 12 |
| 10. Raw `<button>` inventory | Partly. See the gap below. |
| Proposed doc deltas, all 9 | 12 |

**Known gap, stated rather than hidden.** Spec finding 10 lists eight raw `<button>` sites that are neither the tabs nor the pagination: `notification-bell.tsx` (2), `staff-project-panel.tsx:260`, `projects-filter-bar.tsx:248`, `image-uploader.tsx` (4), and `integrations/better-auth/header-user.tsx:24`. The spec called these "not a single architectural decision," and that holds: each needs a judgment call against the `Button` variant table, and batching eight unrelated judgment calls into one task would produce a task no reviewer could meaningfully reject in part. They are left for a follow-up issue. `ViewToggle` is deliberately excluded too, per the spec's keep verdict.

**Type consistency.** `ConfirmDialog`'s prop names (`title`, `description`, `onConfirm`, `confirmLabel`, `children`) are identical in Task 2's definition and all four Task 3 call sites. `PaginationLink` gains `asChild` in Task 6 Step 5, which Step 3 does not define; the step says so explicitly and supplies the amended signature rather than leaving the reader to notice. `FieldError` takes `errors: readonly unknown[]`, matching the `FieldErrors` signature it replaces, so no call site changes shape. `Badge`'s `variant="status"` is the same string in the primitive and all four consumers.

**Sequencing.** Group 0 gates the suite before groups 1 and 2 change what it covers. Every task ends with a green `npm test`: Task 3's guard covers `confirm(` only, and Task 4 widens it to `alert(` once the last one is gone, so neither task leaves a known failure behind for the next reviewer to wave through. Groups 2 and 3 are independent of each other; group 3 depends on nothing but is ordered last because it is the least valuable.

**Tooling the plan adds.** Two devDependencies, both in Task 2 Step 1: `@testing-library/user-event` (Radix opens on `pointerdown`, which `fireEvent.click` does not send) and `@testing-library/jest-dom` (for `toHaveAccessibleName`, `toHaveFocus`, `toHaveAttribute`). No existing test uses either, and there is no `test` block in `vite.config.ts`, so each new test file imports the matchers itself rather than the plan introducing global setup config. One runtime dependency, `sonner`, in Task 4 Step 1. Nothing else. Every Radix primitive this plan adds already ships in the installed `radix-ui@1.4.3`.

**One trap worth restating.** The `no-native-modals` guard must skip `__tests__` and `.test.` paths, not just `src/test/`. `src/lib/email/__tests__/templates.test.ts` asserts on the XSS fixture string `onerror=alert(1)`, which any regex hunting native modals will match forever. Task 3's test body has the exclusion and Task 4 Step 5 says not to remove it.
