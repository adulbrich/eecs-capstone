# Accessibility Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all WCAG 2.1 AA violations surfaced by `npm run test:accessibility` so every page passes the axe scan in both light and dark color schemes.

**Architecture:** Four categories of violations: (1) CSS token `--status-warning` is too light to meet 4.5:1 contrast ratio as text on its tint background in light mode; (2) `--brand-primary` used as text in two badge components fails 4.5:1 on the brand tint — fixed by switching to the existing `--brand-primary-dark` token; (3) `--text-tertiary` (#9A9490) yields only ~2.8:1 contrast on near-white surfaces and must not be used for content text; (4) two form controls in `BanForm` lack associated `<label>` elements. Each task targets exactly one category.

**Tech Stack:** React 19, Tailwind CSS v4, CSS custom properties (design tokens), shadcn/ui (`Label`, `Input`, `Textarea`), Playwright + @axe-core/playwright for verification.

---

## Files

| File | Change |
|------|--------|
| `src/styles.css` | Darken `--status-warning` token in light mode `:root` |
| `src/components/status-badge.tsx` | `published` fg: `brand-primary` → `brand-primary-dark` |
| `src/components/inventory-status-badge.tsx` | `requested` color: `brand-primary` → `brand-primary-dark` |
| `src/components/category-chip.tsx` | Type label: `text-tertiary` → `text-secondary` |
| `src/components/project-card.tsx` | Published date: `text-tertiary` → `text-secondary` |
| `src/components/project-row.tsx` | Published date: `text-tertiary` → `text-secondary` |
| `src/components/ban-form.tsx` | Add `<Label>` for ban-reason textarea and ban-expires datetime input |

No new files are created.

---

## Task 1: Darken `--status-warning` token in light mode

**Why:** `--status-warning: #E65100` yields only ~3.3:1 contrast when used as text on `--status-warning-bg` (rgba(230,81,0,0.10) on white ≈ #FDEEE6). WCAG AA requires 4.5:1 for text at 12px. `#B84000` gives ~4.9:1 on the same background. The dark-mode override (`#FFA726`) is already correct and is not changed here.

All uses of `--status-warning` as *text or icon fill* automatically get the fix: `StatusBadge` (changes_requested), `InventoryStatusBadge` (reserved), the "internal" badge in `CommentThread`, the bookmark star fill, and the notification dot. Border and left-accent uses are decorative and pass the UI-component 3:1 threshold at the old value anyway.

**Files:**
- Modify: `src/styles.css:46-48` (`:root` status tokens)

---

- [ ] **Step 1: Verify the test currently fails**

Run one representative failing test to confirm:

```bash
npx playwright test --config playwright.a11y.config.ts --grep "project detail" --project chromium-light 2>&1 | tail -30
```

Expected: FAIL with an axe violation mentioning `color-contrast` and a selector involving the status badge.

- [ ] **Step 2: Change the `--status-warning` token value**

Open `src/styles.css`. In the `:root` block (around line 49), change this line:

```css
/* before */
--status-warning:       #E65100;
```

to:

```css
/* after */
--status-warning:       #B84000;
```

The full `:root` status block should now read:

```css
  /* Status */
  --status-success:       #2E7D32;
  --status-success-bg:    rgba(46, 125, 50, 0.10);
  --status-warning:       #B84000;
  --status-warning-bg:    rgba(230, 81, 0, 0.10);
  --status-error:         #C62828;
  --status-error-bg:      rgba(198, 40, 40, 0.10);
  --status-info:          #1565C0;
  --status-info-bg:       rgba(21, 101, 192, 0.10);
  --status-neutral:       #5C5550;
  --status-neutral-bg:    rgba(92, 85, 80, 0.10);
```

Dark-mode overrides (`@media (prefers-color-scheme: dark)`) are untouched — `#FFA726` already passes on dark surfaces.

- [ ] **Step 3: Commit**

```bash
git add src/styles.css
git commit -m "fix(a11y): darken status-warning token to pass 4.5:1 contrast in light mode"
```

---

## Task 2: Fix brand-primary-as-text badge contrast

**Why:** `StatusBadge` ("published") and `InventoryStatusBadge` ("requested") use `var(--brand-primary)` (#D73F09) as text color on `var(--brand-primary-tint)` (rgba(215,63,9,0.08) on white ≈ #FCEFEB). That yields ~4.1:1. The existing token `--brand-primary-dark` (#B83207) gives ~5.3:1 on the same tint background and is purpose-built for text/emphasis use in light mode. In dark mode, `--brand-primary-dark` resolves to #FF8C5A (the accessible link color), which gives >7:1 on dark surfaces.

**Files:**
- Modify: `src/components/status-badge.tsx:9`
- Modify: `src/components/inventory-status-badge.tsx:43-44`

---

- [ ] **Step 1: Update `StatusBadge` — "published" foreground token**

Open `src/components/status-badge.tsx`. The `STATUS_STYLES` object has a `published` entry. Change its `fg` value:

```tsx
// before
published: { fg: "var(--brand-primary)", bg: "var(--brand-primary-tint)" },

// after
published: { fg: "var(--brand-primary-dark)", bg: "var(--brand-primary-tint)" },
```

The full `STATUS_STYLES` constant after the change:

```tsx
const STATUS_STYLES: Record<string, { fg: string; bg: string }> = {
  draft: { fg: "var(--status-neutral)", bg: "var(--status-neutral-bg)" },
  submitted: { fg: "var(--status-info)", bg: "var(--status-info-bg)" },
  approved: { fg: "var(--status-success)", bg: "var(--status-success-bg)" },
  changes_requested: {
    fg: "var(--status-warning)",
    bg: "var(--status-warning-bg)",
  },
  published: { fg: "var(--brand-primary-dark)", bg: "var(--brand-primary-tint)" },
  archived: { fg: "var(--status-neutral)", bg: "var(--status-neutral-bg)" },
  deleted: { fg: "var(--status-error)", bg: "var(--status-error-bg)" },
};
```

- [ ] **Step 2: Update `InventoryStatusBadge` — "requested" color token**

Open `src/components/inventory-status-badge.tsx`. In the `STYLES` constant, change the `requested` entry's `color` property:

```tsx
// before
requested: {
  background: "var(--brand-primary-tint)",
  color: "var(--brand-primary)",
},

// after
requested: {
  background: "var(--brand-primary-tint)",
  color: "var(--brand-primary-dark)",
},
```

- [ ] **Step 3: Commit**

```bash
git add src/components/status-badge.tsx src/components/inventory-status-badge.tsx
git commit -m "fix(a11y): use brand-primary-dark for badge text to meet 4.5:1 contrast on tint"
```

---

## Task 3: Replace `--text-tertiary` in content text

**Why:** `--text-tertiary: #9A9490` gives only ~2.8:1 contrast on near-white surfaces, failing even the 3:1 minimum for large text. It is used in three places where the text conveys real information (category type label, published date on cards and rows). Switching to `--text-secondary` (#6B6560, ~5.2:1 on white) fixes all three without touching the design token itself. The token can remain for future purely-decorative use.

**Files:**
- Modify: `src/components/category-chip.tsx:16`
- Modify: `src/components/project-card.tsx:70`
- Modify: `src/components/project-row.tsx:36`

---

- [ ] **Step 1: Fix `CategoryChip` type label**

Open `src/components/category-chip.tsx`. The `CategoryChip` function renders two spans. Change the type span's color:

```tsx
// before
<span style={{ color: "var(--text-tertiary)" }}>{category.type}</span>

// after
<span style={{ color: "var(--text-secondary)" }}>{category.type}</span>
```

Full component after change:

```tsx
type Category = {
  id: string;
  name: string;
  type: string;
};

export function CategoryChip({ category }: { category: Category }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs"
      style={{
        background: "var(--chip-bg)",
        border: "1px solid var(--chip-line)",
      }}
    >
      <span style={{ color: "var(--text-secondary)" }}>{category.type}</span>
      <span style={{ color: "var(--text-primary)" }}>{category.name}</span>
    </span>
  );
}
```

- [ ] **Step 2: Fix `ProjectCard` published date**

Open `src/components/project-card.tsx`. Find the `publishedAt` paragraph (near line 70) and change its color:

```tsx
// before
<p className="mt-2 text-xs" style={{ color: "var(--text-tertiary)" }}>
  Published {new Date(project.publishedAt).toLocaleDateString()}
</p>

// after
<p className="mt-2 text-xs" style={{ color: "var(--text-secondary)" }}>
  Published {new Date(project.publishedAt).toLocaleDateString()}
</p>
```

- [ ] **Step 3: Fix `ProjectRow` published date**

Open `src/components/project-row.tsx`. Find the `publishedAt` paragraph (near line 36) and change its color:

```tsx
// before
<p className="mt-1 text-xs" style={{ color: "var(--text-tertiary)" }}>
  {new Date(project.publishedAt).toLocaleDateString()}
</p>

// after
<p className="mt-1 text-xs" style={{ color: "var(--text-secondary)" }}>
  {new Date(project.publishedAt).toLocaleDateString()}
</p>
```

- [ ] **Step 4: Commit**

```bash
git add src/components/category-chip.tsx src/components/project-card.tsx src/components/project-row.tsx
git commit -m "fix(a11y): replace text-tertiary with text-secondary in content text"
```

---

## Task 4: Add labels to `BanForm` form controls

**Why:** When an admin visits `/admin/users/:userId` for a non-banned user, two form controls are rendered without associated labels: a textarea for the ban reason (has only `placeholder`) and a datetime-local input for the expiry (has only a `<p>` description below it). axe rule `label` requires every form control to have a programmatically associated label.

The fix wraps each control in a `<div>` with a `<Label htmlFor="...">` above it. The existing `<p>` description for the expiry input is folded into the label text so the label itself conveys the full context. The shadcn `Label` component generates a standard `<label>` element and is already used throughout the codebase.

**Files:**
- Modify: `src/components/ban-form.tsx` (add `Label` import, wrap two controls)

---

- [ ] **Step 1: Add `Label` import**

Open `src/components/ban-form.tsx`. The imports currently read:

```tsx
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
```

Add the `Label` import:

```tsx
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
```

- [ ] **Step 2: Add labels to the ban form controls**

In `BanForm`, the `return` block for the "not banned" state renders a `<div className="mt-2 space-y-2">`. Replace its contents:

```tsx
// before
<div className="mt-2 space-y-2">
  <Textarea
    value={reason}
    onChange={(e) => setReason(e.target.value)}
    placeholder="Reason (required)"
    required
    rows={3}
  />
  <Input
    type="datetime-local"
    value={expiresAt}
    onChange={(e) => setExpiresAt(e.target.value)}
    className="w-auto"
  />
  <p className="text-xs text-muted-foreground">
    Leave expiry blank for permanent.
  </p>
  <Button
    type="button"
    variant="destructive"
    size="sm"
    onClick={() => void onBan()}
    disabled={busy || reason.trim().length === 0}
  >
    {busy ? "Working..." : "Ban"}
  </Button>
  {error && <p className="text-sm text-destructive">{error}</p>}
</div>

// after
<div className="mt-2 space-y-2">
  <div>
    <Label htmlFor="ban-reason">Reason</Label>
    <Textarea
      id="ban-reason"
      value={reason}
      onChange={(e) => setReason(e.target.value)}
      placeholder="Reason (required)"
      required
      rows={3}
      className="mt-1"
    />
  </div>
  <div>
    <Label htmlFor="ban-expires">Expires at (leave blank for permanent)</Label>
    <Input
      id="ban-expires"
      type="datetime-local"
      value={expiresAt}
      onChange={(e) => setExpiresAt(e.target.value)}
      className="mt-1 w-auto"
    />
  </div>
  <Button
    type="button"
    variant="destructive"
    size="sm"
    onClick={() => void onBan()}
    disabled={busy || reason.trim().length === 0}
  >
    {busy ? "Working..." : "Ban"}
  </Button>
  {error && <p className="text-sm text-destructive">{error}</p>}
</div>
```

- [ ] **Step 3: Commit**

```bash
git add src/components/ban-form.tsx
git commit -m "fix(a11y): add labels to ban-form textarea and datetime-local inputs"
```

---

## Task 5: Run the full accessibility suite and verify all tests pass

**Why:** Runs all 58 axe scans (29 pages × light + dark) against the dev server to confirm every violation is resolved.

**Files:** None modified.

---

- [ ] **Step 1: Start the dev server (if not already running)**

The accessibility test suite will start it automatically, but running it separately lets you watch output:

```bash
npm run dev
```

Leave it running in a separate terminal.

- [ ] **Step 2: Run the accessibility suite**

In a second terminal:

```bash
npm run test:accessibility 2>&1 | tail -40
```

Expected: All 58 tests pass across both `chromium-light` and `chromium-dark` projects. Output ends with something like:

```
  58 passed (NNs)
```

- [ ] **Step 3: If any test still fails, read the violation detail**

If failures remain, the violation summary includes the exact rule ID and failing element HTML. For example:

```json
[{ "rule": "color-contrast", "impact": "serious", "elements": ["<span class=\"...\">..."] }]
```

Use the rule ID and element HTML to identify which component or token still needs adjustment, fix it, and re-run.

- [ ] **Step 4: Commit if step 3 required additional fixes**

Only commit if step 3 produced changes. The commit from step 3's fix is enough — no separate "verify" commit needed.

- [ ] **Step 5: Run the Vitest unit test suite to confirm no regressions**

```bash
npm test
```

Expected: All tests pass. Output ends with something like:

```
 ✓ N tests passed
```

The accessibility CSS and label changes are purely presentational and do not affect component behavior, so no unit test failures are expected.
