# First-Paint Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the app painting unstyled content on a cold production load, by compressing and edge-caching the render-blocking critical path and by making every element that occupies layout space declare its size before its payload arrives.

**Architecture:** Compression lands at the origin first (Nitro `compressPublicAssets`) and the edge second (a CloudFront `/assets/*` cache behavior). That ordering is load-bearing: once the origin returns `Content-Encoding`, CloudFront never makes a compression decision, which sidesteps its documented best-effort skip caching an uncompressed object for a full TTL. Layout stability is separate and independent: the logo declares intrinsic dimensions, and the header's session slot reserves a fixed width across all three of its states.

**Tech Stack:** TanStack Start + TanStack Router, Nitro (nitro-nightly) on the node-server preset, Vite 8, React 19, Tailwind v4, Vitest + Testing Library, Terraform (CloudFront, ALB, Fargate), Node 24.

**Design spec:** `docs/superpowers/specs/2026-08-01-first-paint-delivery-design.md`. Read it before starting; it explains *why* for most of what follows, including two rejected alternatives you might otherwise re-propose.

**Branch:** `perf/first-paint-delivery`, already created, spec already committed there.

## Global Constraints

- **Prose contains no emdashes.** Applies to comments, docs, commit messages, and UI copy. Use other punctuation.
- **No back-compatibility shims.** The app is pre-production. Delete and restructure rather than adding aliases, redirects, or parallel code paths.
- **Run tests with the sandbox disabled** (`dangerouslyDisableSandbox: true` on the Bash call) and raise the fd limit in the same command, or Vitest fails with `EPERM listen` and `EMFILE`.
  - Unit: `ulimit -n 8192; CI=true npm test`
  - Single unit file: `ulimit -n 8192; CI=true npx vitest run <path>`
- **Before every commit run the full `npm run check` and `npm run typecheck`**, not a per-file `ultracite check`. CI runs `npm run check` across the whole repo and it includes the formatter, so a line that grew past the width limit fails CI even though a per-file check passed.
- **jsdom component tests declare their environment per file** with `// @vitest-environment jsdom` on line 1.
- **Ultracite/Biome standards apply**: no nested ternaries, `for...of` over `.forEach`, explicit `type="button"` on non-submit buttons, no `any`, arrow callbacks, early returns.
- **`scripts/` is excluded from Biome** (`biome.json` `files.includes` carries `"!**/scripts"`). Scripts are plain `.mjs` with a block-comment header explaining why they exist; follow `scripts/migrate.mjs` for tone.
- **Never widen the `/assets/*` cache behavior.** `Managed-CachingOptimized` has a one-second minimum TTL, which caches even when the origin sends `no-cache`, `no-store`, or `private`. Harmless for content-hashed files, a signed-in-response leak on any auth-dependent path.
- **Do not touch the app distribution's `default_cache_behavior`.** It carries every authenticated request. HTML compression is an explicit non-goal for exactly this reason.

---

## File Structure

**Created**

| File | Responsibility |
| --- | --- |
| `scripts/check-compression.mjs` | Build assertion: every `/assets` bundle at or above 1 KB has a `.br` sibling. The only guard against Task 1 silently regressing. |
| `src/test/institution-logo.test.tsx` | Asserts the logo declares intrinsic dimensions matching the source viewBox ratio. |
| `src/test/site-header.test.tsx` | Asserts the header session slot reserves identical width in pending, signed-out, and signed-in states. |
| `svgo.config.mjs` | Keeps the logo minification reproducible for a future brand swap, and pins `removeViewBox: false`. |
| `src/assets/logo-institution.svg` | The minified mark, moved out of `public/` so Vite hashes it. |

**Modified**

| File | Change |
| --- | --- |
| `vite.config.ts` | Add `compressPublicAssets: true` to the existing `nitro()` call. |
| `package.json` | Add the `check:compression` script. |
| `.github/workflows/ci.yml` | Run the compression check after `npm run build`. |
| `biome.json` | Re-enable `correctness.useImageSize` for `institution-logo.tsx` only. |
| `src/components/institution-logo.tsx` | Declare `width`/`height` on both `<img>` elements. |
| `src/lib/brand.ts` | `logoUrl` becomes a `?url` import instead of a literal path. |
| `src/components/site-header.tsx` | Reserve a fixed width on the desktop and mobile session slots. |
| `infra/cloudfront.tf` | Add the `/assets/*` `ordered_cache_behavior`. |

**Deleted**

| File | Reason |
| --- | --- |
| `public/logo-institution.svg` | Moved to `src/assets/` in Task 4 so it lands in `/assets/` hashed. Nothing else references it; verified that `brand.logoUrl` is its only consumer, with no references from email templates, `public/manifest.json`, or any script. |

**Untouched on purpose:** `src/styles.css` (Feature D ships nothing unless Task 6's measurement demands it), the other ten `<img>` elements in `src/` (see Task 2 Step 5), `public/favicon.ico`, `public/project-placeholder.webp`, `public/manifest.json`, `public/robots.txt` (unhashed, so a one-year edge TTL would be wrong, and small enough not to matter).

---

## Task 1: Origin compression, with a build assertion that keeps it

The compression flag and the check that guards it ship together. The check is written first and must fail on the current build; that failure is the proof that the flag is what fixes it. Nothing downstream depends on this task, but the spec gates the whole design on it: if Step 4 does not pass, stop and read Step 4's fallback note before continuing.

**Files:**
- Create: `scripts/check-compression.mjs`
- Modify: `vite.config.ts`, `package.json`, `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: nothing.
- Produces: `npm run check:compression`, a non-zero exit when any `/assets` bundle at or above 1024 bytes lacks a `.br` sibling. Later tasks do not import from this; Task 4 re-runs it after moving the logo.

- [ ] **Step 1: Write the failing check**

Create `scripts/check-compression.mjs`:

```js
/**
 * Build assertion: the client bundle must ship precompressed.
 *
 * `compressPublicAssets` in vite.config.ts is a build-time flag with no
 * runtime signature. If a dependency bump changes its behavior, nothing
 * fails, nothing looks different in local development, and production
 * quietly returns to serving ~98 KB of raw CSS on the render-blocking
 * path. CI runs this after `npm run build` so that regression is loud.
 *
 * Nitro skips files below 1 KB and skips .map files, so this only asserts
 * on bundles at or above that floor.
 */
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

const ASSET_DIR = ".output/public/assets";
const MIN_COMPRESSED_BYTES = 1024;

const entries = await readdir(ASSET_DIR).catch(() => {
  throw new Error(`${ASSET_DIR} not found. Run \`npm run build\` first.`);
});

const candidates = entries.filter(
  (name) => name.endsWith(".css") || name.endsWith(".js")
);

if (candidates.length === 0) {
  throw new Error(`No .css or .js bundles found in ${ASSET_DIR}.`);
}

const missing = [];
let checked = 0;

for (const name of candidates) {
  const { size } = await stat(join(ASSET_DIR, name));
  if (size < MIN_COMPRESSED_BYTES) {
    continue;
  }
  checked += 1;
  if (!entries.includes(`${name}.br`)) {
    missing.push(name);
  }
}

if (missing.length > 0) {
  throw new Error(
    `${missing.length} of ${checked} bundles have no .br sibling ` +
      `(first: ${missing[0]}). Check compressPublicAssets in vite.config.ts.`
  );
}

console.log(`OK: ${checked} bundles ship precompressed.`);
```

- [ ] **Step 2: Run it against the current build to verify it fails**

```bash
npm run build && node scripts/check-compression.mjs
```

Expected: FAIL, with a message of the form `N of N bundles have no .br sibling (first: styles-<hash>.css)`. If it passes here, compression is already on somehow, and this whole task is void. Stop and report that.

- [ ] **Step 3: Turn on origin compression**

In `vite.config.ts`, the `nitro()` call currently reads:

```ts
    nitro({ rollupConfig: { external: [/^@sentry\//] } }),
```

Change it to:

```ts
    nitro({
      compressPublicAssets: true,
      rollupConfig: { external: [/^@sentry\//] },
    }),
```

The plugin accepts a full `NitroConfig`, and `compressPublicAssets` is typed `boolean | CompressOptions` in the pinned `nitro-nightly`. `true` enables gzip, brotli, and zstd.

- [ ] **Step 4: Rebuild and verify the check passes**

```bash
npm run build && node scripts/check-compression.mjs
```

Expected: PASS, `OK: N bundles ship precompressed.`

**If it still fails**, `compressPublicAssets` is reaching only `public/` and not Vite's client output. Do not work around it and do not continue to Task 2's dependencies on it. Stop, report, and the fallback is a Vite-side compression plugin instead of the Nitro option. This is the spec's one identified unknown.

- [ ] **Step 5: Confirm the served response actually negotiates**

The build artifact existing is not the same as the server using it. Start the production server with the env loaded and check the header:

```bash
set -a; . ./.env.local; set +a
PORT=3999 node .output/server/index.mjs &
sleep 6
curl -sI -H 'Accept-Encoding: br' "http://127.0.0.1:3999/assets/$(ls .output/public/assets | grep '\.css$' | head -1)"
kill %1
```

Expected: the response carries `content-encoding: br` and a `content-length` near 14,200 rather than 98,008.

- [ ] **Step 6: Wire it into the build scripts and CI**

In `package.json`, add to `"scripts"`, directly after the `"build"` entry:

```json
    "check:compression": "node scripts/check-compression.mjs",
```

In `.github/workflows/ci.yml`, the final step is currently `- run: npm run build`. Add one line after it so the job becomes:

```yaml
      - run: npm test
      - run: npm run build
      - run: npm run check:compression
```

- [ ] **Step 7: Verify the repo still passes its own gates**

```bash
npm run check && npm run typecheck
```

Expected: both clean. (`scripts/` is Biome-excluded, so the new script is not linted; `vite.config.ts` and `package.json` are.)

- [ ] **Step 8: Commit**

```bash
git add scripts/check-compression.mjs vite.config.ts package.json .github/workflows/ci.yml
git commit -m "perf(build): precompress public assets and assert it in CI

The render-blocking stylesheet shipped as 98,008 raw bytes because Nitro's
compressPublicAssets was off and CloudFront cannot compensate: its only cache
behavior uses Managed-CachingDisabled, which documents compression support as
disabled. Brotli takes the same file to 14,200 bytes and the critical-path JS
from 634,413 to 165,672.

The flag has no runtime signature, so a dependency bump could silently undo it.
scripts/check-compression.mjs fails the build if any bundle at or above Nitro's
1 KB floor loses its .br sibling."
```

---

## Task 2: Declare the logo's intrinsic dimensions

**Files:**
- Create: `src/test/institution-logo.test.tsx`
- Modify: `src/components/institution-logo.tsx`, `biome.json`

**Interfaces:**
- Consumes: nothing.
- Produces: an `InstitutionLogo` whose every `<img>` carries `width={101} height={32}`. Task 3 preserves the viewBox this depends on; Task 4 changes the `src` and must not break this test, which is why the test deliberately asserts nothing about `src`.

- [ ] **Step 1: Write the failing test**

Create `src/test/institution-logo.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { InstitutionLogo } from "#/components/institution-logo";
import { brand } from "#/lib/brand";

// The source viewBox is 581.88 x 184.46667. The header renders the mark at
// 32px tall, so the declared width is 581.88 / 184.46667 * 32 = 100.94.
const EXPECTED_WIDTH = "101";
const EXPECTED_HEIGHT = "32";
const VIEWBOX_RATIO = 581.88 / 184.46667;
const RATIO_TOLERANCE = 0.01;

afterEach(cleanup);

describe("InstitutionLogo", () => {
  it("declares intrinsic dimensions on every rendered mark", () => {
    render(<InstitutionLogo />);
    const marks = screen.getAllByAltText(brand.logoAlt);

    expect(marks.length).toBeGreaterThan(0);
    for (const mark of marks) {
      expect(mark.getAttribute("width")).toBe(EXPECTED_WIDTH);
      expect(mark.getAttribute("height")).toBe(EXPECTED_HEIGHT);
    }
  });

  it("declares a width matching the source viewBox ratio", () => {
    render(<InstitutionLogo />);
    const [mark] = screen.getAllByAltText(brand.logoAlt);
    const declared =
      Number(mark.getAttribute("width")) / Number(mark.getAttribute("height"));

    expect(Math.abs(declared - VIEWBOX_RATIO)).toBeLessThan(RATIO_TOLERANCE);
  });
});
```

The first test uses `getAllByAltText` and loops rather than asserting on one element. That is deliberate: it enforces the spec's requirement that the `logoUrlLight` variant gets identical treatment, and it keeps passing if a future brand config turns that variant on.

- [ ] **Step 2: Run it to verify it fails**

```bash
ulimit -n 8192; CI=true npx vitest run src/test/institution-logo.test.tsx
```

Expected: FAIL. Both cases fail, the first with `expected null to be "101"`.

- [ ] **Step 3: Add the attributes**

In `src/components/institution-logo.tsx`, the first `<img>` (line 15) becomes:

```tsx
      <img
        alt={brand.logoAlt}
        className={[
          "h-8 w-auto",
          hasLightVariant ? "dark:hidden" : "dark:brightness-0 dark:invert",
        ].join(" ")}
        height={32}
        src={brand.logoUrl}
        width={101}
      />
```

And the light variant (line 24) becomes:

```tsx
        <img
          alt={brand.logoAlt}
          className="hidden h-8 w-auto dark:block"
          height={32}
          src={brand.logoUrlLight}
          width={101}
        />
```

Then update the component's header comment, adding this paragraph below the existing "Logo color strategy" block:

```
// Intrinsic dimensions:
//   width/height are declared so the mark reserves 101x32 before anything
//   loads. Without them the browser lays the image out at its 581.88x184.47
//   viewBox until CSS arrives, twice, since site-header.tsx renders the logo
//   for both the desktop and mobile bars. They also give `w-auto` an aspect
//   ratio to resolve against, so the nav does not shift when the SVG lands.
//   101 = 581.88 / 184.46667 * 32. Keep it in step with the viewBox.
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
ulimit -n 8192; CI=true npx vitest run src/test/institution-logo.test.tsx
```

Expected: PASS, 2 tests.

- [ ] **Step 5: Close the door that let this in**

`biome.json` currently disables the rule that would have caught this:

```json
      "correctness": {
        "useImageSize": "off"
      },
```

There are eleven `<img>` elements in `src/`, and re-enabling the rule globally would mean sizing all of them, which is outside this spec's scope. Instead scope it to the file this spec owns. Leave the global `"off"` in place and add an override to the `overrides` array in `biome.json`:

```json
    {
      "includes": ["**/src/components/institution-logo.tsx"],
      "linter": {
        "rules": {
          "correctness": {
            "useImageSize": "on"
          }
        }
      }
    }
```

The other ten `<img>` elements stay unsized and stay out of scope. Note that as a follow-up in the commit body, not as work.

- [ ] **Step 6: Verify the gates**

```bash
npm run check && npm run typecheck
```

Expected: both clean. If `npm run check` now flags `institution-logo.tsx`, the override is working and the attributes are wrong; fix the attributes rather than the override.

- [ ] **Step 7: Commit**

```bash
git add src/test/institution-logo.test.tsx src/components/institution-logo.tsx biome.json
git commit -m "fix(header): declare intrinsic dimensions on the institution logo

The mark had no width/height, so before CSS applied it laid out at its full
581.88x184.47 viewBox, twice, since the header renders it for both the desktop
and mobile bars. That is what made the unstyled paint conspicuous. It also
meant h-8 w-auto resolved to width 0 until the SVG loaded, shifting the nav.

biome's correctness.useImageSize, which would have caught this, is disabled
repo-wide. Re-enabled for this file only. The other ten img elements in src/
remain unsized and are a separate follow-up."
```

---

## Task 3: Minify the logo

**Files:**
- Create: `svgo.config.mjs`
- Modify: `public/logo-institution.svg`

**Interfaces:**
- Consumes: Task 2's test, which must still pass afterwards.
- Produces: the same mark at roughly 3 KB to 5 KB with its `viewBox` intact. Task 4 moves the resulting file.

- [ ] **Step 1: Record the baseline**

```bash
wc -c < public/logo-institution.svg
grep -o 'viewBox="[^"]*"' public/logo-institution.svg
```

Expected: `35440`, and `viewBox="0 0 581.88 184.46667"`. Write both down; Step 4 compares against them.

- [ ] **Step 2: Write the SVGO config**

Create `svgo.config.mjs` at the repo root:

```js
/**
 * SVGO config for the institution mark.
 *
 * Kept in the repo rather than run as a one-off so a future brand swap can
 * re-minify identically. The one override that matters is removeViewBox:
 * it is part of preset-default and it fires whenever the root svg carries
 * width/height, which ours does. Losing the viewBox would break both the
 * mark's scaling and the 101x32 derivation in institution-logo.tsx.
 */
export default {
  multipass: true,
  plugins: [
    {
      name: "preset-default",
      params: { overrides: { removeViewBox: false } },
    },
  ],
};
```

- [ ] **Step 3: Minify in place**

```bash
npx --yes svgo --config svgo.config.mjs -i public/logo-institution.svg -o public/logo-institution.svg
```

- [ ] **Step 4: Verify size dropped and the viewBox survived**

```bash
wc -c < public/logo-institution.svg
grep -o 'viewBox="[^"]*"' public/logo-institution.svg
```

Expected: a size in the low thousands, and the viewBox still present and numerically unchanged. If the viewBox is gone, the config did not apply; do not proceed, because Task 2's ratio test is now asserting against a number the file no longer carries.

- [ ] **Step 5: Verify the mark still renders identically**

Automated tests cannot catch a visual regression here, and SVGO is not always lossless on Inkscape-authored paths. Run the dev server and compare by eye:

```bash
npm run dev
```

Open `http://localhost:3000`, and check the header logo in both light and dark mode (toggle the OS appearance, since `styles.css` keys dark mode off `prefers-color-scheme`). Dark mode matters specifically: it routes the mark through `brightness(0) invert(1)`, which exposes fill-rule changes that light mode hides.

Expected: no visible difference from the pre-minification mark in either mode.

- [ ] **Step 6: Re-run the logo test**

```bash
ulimit -n 8192; CI=true npx vitest run src/test/institution-logo.test.tsx
```

Expected: PASS, 2 tests. Unchanged by minification, which is the point.

- [ ] **Step 7: Verify the gates and commit**

```bash
npm run check && npm run typecheck
git add svgo.config.mjs public/logo-institution.svg
git commit -m "perf(assets): minify the institution mark

35,440 bytes of raw Inkscape output, including 42 generated ids and the
sodipodi namespace, for a mark that renders at 101x32.

The SVGO config is committed rather than run as a one-off so a future brand
swap re-minifies identically, and because removeViewBox needs an explicit
override: it is in preset-default and fires on any root svg carrying
width/height. The viewBox is what institution-logo.tsx derives 101x32 from."
```

---

## Task 4: Move the logo into the hashed asset pipeline

**Files:**
- Create: `src/assets/logo-institution.svg` (moved, via `git mv`)
- Modify: `src/lib/brand.ts`
- Delete: `public/logo-institution.svg`

**Interfaces:**
- Consumes: Task 3's minified file; Task 1's `check:compression`.
- Produces: `brand.logoUrl` as a Vite-emitted hashed URL string rather than the literal `"/logo-institution.svg"`. The `Brand` interface is unchanged, since it already declares `logoUrl: string`.

- [ ] **Step 1: Move the file**

```bash
mkdir -p src/assets
git mv public/logo-institution.svg src/assets/logo-institution.svg
```

Files in `public/` are copied verbatim without hashing, which is why the current file comes back with no `cache-control` header at all. Only assets imported through the graph get hashed into `/assets/`.

- [ ] **Step 2: Import it in the brand config**

In `src/lib/brand.ts`, add the import above the existing `export const brand`:

```ts
import logoInstitution from "#/assets/logo-institution.svg?url";
```

and change line 5 from:

```ts
  logoUrl: "/logo-institution.svg",
```

to:

```ts
  logoUrl: logoInstitution,
```

Then update the comment above `colorPrimary` region if needed, and add this note directly above `logoUrl`:

```ts
  // Imported rather than referenced by path so Vite hashes it into /assets/,
  // where the CloudFront behavior added in infra/cloudfront.tf caches it.
  // Files left in public/ are copied verbatim and ship with no cache-control.
```

`#/*` maps to `./src/*` in both `tsconfig.json` and Vite (`resolve: { tsconfigPaths: true }`), and `vite/client` is already in `tsconfig.json`'s `types`, which declares `*?url`. This combination was verified to typecheck before this plan was written.

- [ ] **Step 3: Verify types**

```bash
npm run typecheck
```

Expected: clean. `as const satisfies Brand` still holds because `Brand` declares `logoUrl: string`, not a literal type.

- [ ] **Step 4: Verify the logo test still passes**

```bash
ulimit -n 8192; CI=true npx vitest run src/test/institution-logo.test.tsx
```

Expected: PASS, 2 tests. The test asserts nothing about `src`, so changing the URL must not affect it. If it fails here, the test was written too tightly; fix the test, not the import.

- [ ] **Step 5: Verify the build hashes and compresses it**

```bash
npm run build
ls .output/public/assets | grep logo
node scripts/check-compression.mjs
ls .output/public | grep logo || echo "correctly absent from public root"
```

Expected: a hashed `logo-institution-<hash>.svg` under `.output/public/assets`, the compression check still passing, and nothing named `logo-institution.svg` at the public root.

Note that the SVG itself may or may not get a `.br` sibling depending on its post-minification size against Nitro's 1 KB floor. `check-compression.mjs` only asserts on `.css` and `.js`, so either outcome passes.

- [ ] **Step 6: Verify it renders**

```bash
npm run dev
```

Open `http://localhost:3000` and confirm the header mark still appears. This catches a resolution failure that typecheck cannot.

- [ ] **Step 7: Verify the gates and commit**

```bash
npm run check && npm run typecheck
git add src/assets/logo-institution.svg src/lib/brand.ts
git commit -m "perf(assets): hash the institution mark through the Vite pipeline

Files in public/ are copied verbatim, so the mark shipped with no
cache-control header at all and sat outside the /assets/* CloudFront behavior.
Importing it with ?url hashes it into /assets/, where it inherits both the
immutable cache-control the app already sets and the edge caching added in
infra/cloudfront.tf.

brand.logoUrl stays a string and the Brand interface is unchanged, so the
logoUrlLight branch in institution-logo.tsx still works for a brand swap."
```

---

## Task 5: Reserve width in the header session slot

**Files:**
- Create: `src/test/site-header.test.tsx`
- Modify: `src/components/site-header.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: a desktop session container and a mobile action container that each carry `data-testid="header-session-slot"` / `"header-actions-slot"` and a stable `min-w-*` class in every session state.

Read the spec's Feature C before starting. It explicitly rejects server-rendering the signed-out state, which is the obvious fix and the wrong one here; do not re-derive it.

- [ ] **Step 1: Write the failing test**

Create `src/test/site-header.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import type * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const useSession = vi.fn();

vi.mock("#/lib/auth-client", () => ({
  authClient: { useSession: () => useSession() },
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    ...rest
  }: { children: React.ReactNode } & Record<string, unknown>) => (
    <a {...rest}>{children}</a>
  ),
}));

vi.mock("#/components/notification-bell", () => ({
  NotificationBell: () => <div data-testid="bell" />,
}));

vi.mock("#/components/cart-button", () => ({
  CartButton: () => <div data-testid="cart" />,
}));

vi.mock("#/components/user-menu", () => ({
  UserMenu: () => <div data-testid="user-menu" />,
}));

import { SiteHeader } from "#/components/site-header";

const SIGNED_IN = {
  data: {
    user: { name: "Ada", email: "ada@example.edu", image: null, role: null },
  },
  isPending: false,
};
const SIGNED_OUT = { data: null, isPending: false };
const PENDING = { data: null, isPending: true };

function slotClassName() {
  return screen.getByTestId("header-session-slot").className;
}

afterEach(cleanup);

describe("SiteHeader session slot", () => {
  it("reserves the same width while the session is pending", () => {
    useSession.mockReturnValue(PENDING);
    render(<SiteHeader />);
    expect(slotClassName()).toContain("min-w-36");
  });

  it("reserves the same width when signed out", () => {
    useSession.mockReturnValue(SIGNED_OUT);
    render(<SiteHeader />);
    expect(slotClassName()).toContain("min-w-36");
  });

  it("reserves the same width when signed in", () => {
    useSession.mockReturnValue(SIGNED_IN);
    render(<SiteHeader />);
    expect(slotClassName()).toContain("min-w-36");
  });

  it("keeps the pending placeholder inside the reserved slot", () => {
    useSession.mockReturnValue(PENDING);
    render(<SiteHeader />);
    const slot = screen.getByTestId("header-session-slot");
    expect(slot.querySelector(".animate-pulse")).not.toBeNull();
  });
});
```

The tests assert a shared class rather than a pixel value. That is what makes them meaningful: the point is that all three states occupy *identical* space, and the specific number is a measurement, not a contract.

- [ ] **Step 2: Run it to verify it fails**

```bash
ulimit -n 8192; CI=true npx vitest run src/test/site-header.test.tsx
```

Expected: FAIL, all four cases, with `Unable to find an element by: [data-testid="header-session-slot"]`.

- [ ] **Step 3: Reserve the space**

In `src/components/site-header.tsx`, the desktop session container (line 52) currently reads:

```tsx
        <div className="flex items-center gap-3 text-sm">
```

Change it to:

```tsx
        <div
          className="flex min-w-36 items-center justify-end gap-3 text-sm"
          data-testid="header-session-slot"
        >
```

`min-w-36` is 9rem, 144px. It is a starting value derived from the wider of the two resolved states: signed-out is a "Sign in" link plus a `size="sm"` "Sign up" button, which is wider than the signed-in row of three icon-sized controls. Step 5 measures and confirms it.

`justify-end` is added so the content pins to the right edge of the reserved box rather than sliding within it as the states swap.

Then the mobile action container (line 78) currently reads:

```tsx
        <div className="flex items-center gap-2">
```

Change it to:

```tsx
        <div
          className="flex min-w-36 items-center justify-end gap-2"
          data-testid="header-actions-slot"
        >
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
ulimit -n 8192; CI=true npx vitest run src/test/site-header.test.tsx
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Measure and confirm the reserved width**

The class must be at least as wide as the widest state, or the reservation does not prevent reflow. Measure both:

```bash
npm run dev
```

At `http://localhost:3000`, signed out, open DevTools and read the rendered width of `[data-testid="header-session-slot"]`'s contents. Then sign in and read it again.

- If both are at or below 144px, `min-w-36` is correct and nothing changes.
- If either exceeds 144px, raise the class to the next Tailwind step that clears it (`min-w-40` is 160px, `min-w-44` is 176px) in **both** the component and all four assertions in the test.

Record the two measured widths in the commit body.

- [ ] **Step 6: Confirm no reflow**

Still on `http://localhost:3000`, hard-reload signed in and watch the nav to the left of the slot. The links must not move when the pending placeholder resolves. Repeat signed out.

- [ ] **Step 7: Verify the gates and commit**

```bash
ulimit -n 8192; CI=true npm test
npm run check && npm run typecheck
git add src/test/site-header.test.tsx src/components/site-header.tsx
git commit -m "fix(header): reserve width for the session slot

authClient.useSession is pending during SSR, so the server ships an
animate-pulse placeholder that the client swaps for wider content, reflowing
the nav beside it. Reserving a fixed width makes all three states occupy the
same space.

Deliberately not the useHasMounted pattern that routes/index.tsx uses. That
works there because the swapping element is a CTA below the fold; in the
header it would flash 'Sign in' at every returning signed-in user, trading a
neutral wrong state for a confident one. See the design spec, Feature C."
```

---

## Task 6: Measure paint cost, and only then decide

This task ships no code unless a measurement demands it. Its deliverable is a recorded number and a decision. Do not skip it and do not pre-emptively trim: the spec is explicit that these layers were never a cause.

**Files:**
- Modify: `src/styles.css`, **only if** Step 2's threshold is exceeded.

**Interfaces:**
- Consumes: Tasks 1 through 4 must be complete, or the measurement is contaminated by the delivery problem this whole plan fixes.

- [ ] **Step 1: Build and serve production**

```bash
npm run build
set -a; . ./.env.local; set +a
PORT=3999 node .output/server/index.mjs
```

- [ ] **Step 2: Profile the initial load**

In Chrome DevTools, Performance panel: enable 4x CPU throttling, check "Disable cache", record, load `http://127.0.0.1:3999/`, stop. Read the summary's **Painting** plus **Rendering** time for the initial load.

**Threshold: 16ms**, one frame at 60fps.

- **Under 16ms:** record the number, change nothing, and mark this task complete. This is the expected outcome and it is a real result, not a skipped step.
- **Over 16ms:** continue to Step 3.

- [ ] **Step 3: Trim in order, re-measuring after each**

Only if Step 2 exceeded the threshold. Stop at the first measurement that comes in under it.

1. Remove `body::after` (`src/styles.css:282`) and its dark-mode override (`:185`). This is the fixed 28px grid at 0.14 opacity in light and 0.05 in dark, behind a `mask-image`: the least visible layer for the most compositing work.
2. Remove `body::before` (`:269`) and its dark-mode override (`:176`).
3. Remove `backdrop-filter: blur(8px)` from the header's inline style in `src/components/site-header.tsx`.

Do not touch the `body` gradients (`:254`, `:168`). They are the last resort and are outside this plan.

- [ ] **Step 4: Record the outcome**

Whether or not anything changed, append the measured numbers to the design spec under Feature D, so the next person does not re-run this from scratch:

```bash
git add docs/superpowers/specs/2026-08-01-first-paint-delivery-design.md
```

- [ ] **Step 5: Commit**

If nothing was trimmed:

```bash
git commit -m "docs(perf): record the first-paint profiling result

Painting plus rendering measured at <N>ms under 4x CPU throttling, below the
16ms threshold, so the body gradient layers stay as designed. Recorded so this
is not re-litigated."
```

If a layer was trimmed, commit `src/styles.css` alongside and say which layer and what the before and after numbers were.

---

## Task 7: Add the CloudFront `/assets/*` cache behavior

**Files:**
- Modify: `infra/cloudfront.tf`

**Interfaces:**
- Consumes: Task 1 must be deployed first, or the edge caches uncompressed objects for up to 24 hours. This is the origin-first ordering the spec's Feature A argues for; it is not optional sequencing.

`terraform apply` is a human action outside this plan. This task produces a reviewed, validated change and stops.

- [ ] **Step 1: Add the behavior**

In `infra/cloudfront.tf`, inside `resource "aws_cloudfront_distribution" "app"`, directly after the closing brace of the existing `default_cache_behavior` block (which ends at line 76), add:

```hcl
  # Hashed build output only. Managed-CachingOptimized enables gzip and brotli
  # in the cache key, which Managed-CachingDisabled on the default behavior
  # does not, so `compress` is a no-op there. In practice the origin already
  # returns Content-Encoding (see compressPublicAssets in vite.config.ts) and
  # CloudFront forwards that untouched; `compress` here is the fallback.
  #
  # Deliberately no origin_request_policy_id. CloudFront then forwards the
  # minimum and rewrites Host to the origin domain, which is safe because the
  # ALB listener (infra/ecs.tf:30) forwards unconditionally to one target group
  # with no host-header conditions and Nitro's static handler never reads Host.
  # Do not copy Managed-AllViewer from the default behavior: forwarding every
  # cookie on a behavior whose purpose is to avoid the origin is pure overhead.
  #
  # Never widen this path_pattern. CachingOptimized has a 1s minimum TTL, which
  # caches even when the origin sends no-cache, no-store, or private. Harmless
  # for content-hashed files, a signed-in-response leak on any auth-dependent
  # path.
  ordered_cache_behavior {
    path_pattern           = "/assets/*"
    target_origin_id       = "alb"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    cache_policy_id        = data.aws_cloudfront_cache_policy.caching_optimized.id
    compress               = true
  }
```

The `caching_optimized` data source already exists at `infra/cloudfront.tf:44`, declared for the assets distribution. Reuse it; do not add a second one.

- [ ] **Step 2: Format and validate**

```bash
terraform -chdir=infra fmt
terraform -chdir=infra validate
```

Expected: `fmt` reports no changes or reformats only the new block; `validate` reports success. If `terraform` is not installed locally, stop here and report that Steps 2 and 3 need running by someone with the toolchain.

- [ ] **Step 3: Review the plan output**

```bash
terraform -chdir=infra plan
```

Expected: exactly one in-place update to `aws_cloudfront_distribution.app`, adding one `ordered_cache_behavior`. If the plan proposes to replace the distribution, or touches `aws_cloudfront_vpc_origin`, stop: a VPC origin takes 15 to 30+ minutes to recreate and would mean an outage. Report rather than applying.

- [ ] **Step 4: Commit**

```bash
git add infra/cloudfront.tf
git commit -m "perf(infra): cache and compress /assets/* at the edge

The app distribution had a single default_cache_behavior on
Managed-CachingDisabled, so the immutable cache-control the app already sets
on hashed bundles was discarded and every cold viewer pulled the full
critical path from the single Fargate task.

CachingOptimized is scoped to /assets/* because its 1s minimum TTL caches even
when the origin sends no-cache. The default behavior, which carries every
authenticated request, is untouched."
```

- [ ] **Step 5: Post-deploy verification (after a human applies)**

Once `terraform apply` and a container deploy have both landed:

```bash
# 1. Compression is negotiated end to end.
curl -sI -H 'Accept-Encoding: br' https://<domain>/assets/<css-hash>.css | grep -i 'content-encoding\|content-length'
# Expect: content-encoding: br, content-length near 14200.

# 2. The edge is caching. Run twice.
curl -sI https://<domain>/assets/<css-hash>.css | grep -i x-cache
# Expect: "Miss from cloudfront" then "Hit from cloudfront".

# 3. The moved logo carries cache-control.
curl -sI https://<domain>/assets/<logo-hash>.svg | grep -i cache-control
# Expect: public, max-age=31536000, immutable.

# 4. The default behavior is still uncached, so auth still works.
curl -sI https://<domain>/ | grep -i x-cache
# Expect: a Miss, every time. A Hit here is a security problem: stop and revert.
```

Then, in a browser with cache disabled and the network throttled to Slow 4G, hard-reload and confirm no paint lands before the stylesheet completes. Finally run Lighthouse on a cold load and compare CLS against a baseline captured before Task 2.

Check 4 is the important one. If the root document ever reports a CloudFront hit, an authenticated response is being shared between viewers.

---

## Self-review notes

**Spec coverage.** Feature A1 is Task 1, A2 is Task 7. Feature B1 is Task 2, B2 is Task 3, B3 is Task 4. Feature C is Task 5. Feature D is Task 6. The spec's three testing rows map to Tasks 2, 5, and 1 respectively. The spec's verification checklist is Task 7 Step 5, with the addition of check 4, which the spec implied through its non-goal on the default behavior but did not state as a test.

**Ordering constraint.** Task 7 must deploy after Task 1, per the spec's origin-first argument. Tasks 2 through 5 are independent of both and of each other, except that Task 3 and Task 4 both operate on the logo file and must run in that order.

**Deliberate divergence from the spec.** Task 2 Step 5 adds the scoped `useImageSize` Biome override, which the spec does not mention. It was found while writing this plan: `biome.json` disables repo-wide the exact rule that would have prevented this defect. Scoping it to one file rather than fixing all eleven `<img>` elements keeps it inside the spec's scope.
