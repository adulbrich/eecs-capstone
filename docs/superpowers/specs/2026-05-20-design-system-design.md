# Design System (Spec 6)

## Summary

Replace the existing teal/sea color palette with an Oregon State University brand system built around Beaver Orange (#D73F09). Introduce a portable `brand.ts` institution config so the entire visual identity can be adopted by another university with one file edit. Enforce a fully sans-serif type scale using system fonts. Deliver mobile-first, with a dark mode that maps cleanly to the same token set.

This is a big-bang swap (no staged migration). The app has not yet been deployed to production.

---

## Scope

This spec covers Spec 6 of the capstone project. The broader project is decomposed as:

- **Spec 6 (this):** Design system — tokens, typography, brand config, component rebrand
- **Spec 7 (next):** Persona-driven IA and navigation (proposer / browser / instructor / admin)
- **Spec 8:** Inventory management
- **Ongoing:** Improvement / UX backlog (living doc)

---

## Design Principles

1. **Brand-portable:** One file edit (`src/lib/brand.ts`) + logo swap = new institution.
2. **No external font dependencies:** System font stack only. No Google Fonts, no WOFF2 downloads.
3. **Mobile-first:** All token values and layout rules start at small viewport and scale up.
4. **Warm neutrals, not clinical grays:** Surfaces and text carry a subtle warm cast inherited from the orange brand color.
5. **Accessible:** All text/background pairs target WCAG AA minimum (4.5:1 body, 3:1 large text).

---

## Brand Config

### File: `src/lib/brand.ts`

The single source of truth for institution identity. Every component that shows institution-specific content reads from this object. CSS custom property values are duplicated here in TypeScript so that the `BrandProvider` can update them at runtime without a build step.

```typescript
export const brand = {
  institutionName: "Oregon State University",
  institutionShort: "OSU",
  programName: "Engineering Capstone",
  logoUrl: "/logo-institution.svg",
  logoAlt: "Oregon State University",
  faviconUrl: "/favicon.ico",
  supportEmail: "capstone@oregonstate.edu",
  institutionUrl: "https://oregonstate.edu",

  // Color tokens — match the :root defaults in styles.css exactly.
  // BrandProvider writes these to :root at runtime so no build step is needed.
  colorPrimary: "#D73F09",        // Beaver Orange
  colorPrimaryDark: "#B83207",    // hover / pressed (~15% darker)
  colorPrimaryLight: "#F5987A",   // tints, illustrations
  colorPrimaryTint: "rgba(215, 63, 9, 0.08)",
  colorOnPrimary: "#FFFFFF",      // text/icons on orange
  colorBlack: "#000000",          // Paddletail Black
  colorWhite: "#FFFFFF",          // Bucktooth White
} as const;

export type Brand = typeof brand;
```

**To adopt this for another institution:** fork the repo, update every field above (and the matching `:root` defaults in `styles.css`), and replace `src/assets/logo-institution.svg`. `src/lib/brand.ts` imports the mark from `#/assets/logo-institution.svg?url`, which is what resolves that path into the built bundle; a file dropped at the old `/public/logo-institution.svg` location is silently ignored and the previous mark keeps rendering. Nothing else requires changes.

---

## BrandProvider

### File: `src/components/brand-provider.tsx`

Sets CSS custom properties on `:root` from `brand` using `element.style.setProperty()`. This approach has no XSS risk (values come from a static TypeScript constant, not user input; `setProperty` does not parse HTML). It runs after hydration, but since the `styles.css` defaults are identical to the `brand.ts` values, there is no flash of wrong color.

```tsx
import { useEffect } from 'react';
import { brand } from '~/lib/brand';

export function BrandProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--brand-primary',       brand.colorPrimary);
    root.style.setProperty('--brand-primary-dark',  brand.colorPrimaryDark);
    root.style.setProperty('--brand-primary-light', brand.colorPrimaryLight);
    root.style.setProperty('--brand-primary-tint',  brand.colorPrimaryTint);
    root.style.setProperty('--brand-on-primary',    brand.colorOnPrimary);
  }, []);
  return <>{children}</>;
}
```

---

## Color Tokens

### Light Mode

All existing teal tokens (`--sea-ink`, `--lagoon`, `--lagoon-deep`, `--palm`, `--sand`, `--foam`, `--surface`, `--surface-strong`, `--line`, `--inset-glint`, `--kicker`, `--bg-base`, `--header-bg`, `--chip-bg`, `--chip-line`, `--link-bg-hover`, `--hero-a`, `--hero-b`) are **deleted**.

Replacement token set in `styles.css`:

```css
:root {
  /* Brand defaults — must match brand.ts values exactly */
  --brand-primary:        #D73F09;
  --brand-primary-dark:   #B83207;
  --brand-primary-light:  #F5987A;
  --brand-primary-tint:   rgba(215, 63, 9, 0.08);
  --brand-on-primary:     #FFFFFF;

  /* Surfaces */
  --surface-base:         #F9F7F5;
  --surface-raised:       #FFFFFF;
  --surface-sunken:       #EFEDEB;

  /* Text */
  --text-primary:         #1A1100;
  --text-secondary:       #6B6560;
  --text-tertiary:        #9A9490;

  /* Chrome */
  --border:               rgba(26, 17, 0, 0.12);
  --line:                 rgba(26, 17, 0, 0.10);
  --focus-ring:           rgba(215, 63, 9, 0.40);
  --inset-glint:          rgba(255, 255, 255, 0.82);

  /* Header / nav */
  --header-bg:            rgba(249, 247, 245, 0.88);

  /* Chips */
  --chip-bg:              rgba(255, 255, 255, 0.85);
  --chip-line:            rgba(215, 63, 9, 0.18);

  /* Hero gradient anchors */
  --hero-a:               rgba(215, 63, 9, 0.18);
  --hero-b:               rgba(26, 17, 0, 0.08);

  /* Status */
  --status-success:       #2E7D32;
  --status-success-bg:    rgba(46, 125, 50, 0.10);
  --status-warning:       #E65100;
  --status-warning-bg:    rgba(230, 81, 0, 0.10);
  --status-error:         #C62828;
  --status-error-bg:      rgba(198, 40, 40, 0.10);
  --status-info:          #1565C0;
  --status-info-bg:       rgba(21, 101, 192, 0.10);
  --status-neutral:       #5C5550;
  --status-neutral-bg:    rgba(92, 85, 80, 0.10);

  /* shadcn token remapping */
  --primary:              var(--brand-primary);
  --primary-foreground:   var(--brand-on-primary);
  --background:           var(--surface-base);
  --foreground:           var(--text-primary);
  --destructive:          var(--status-error);
  --ring:                 var(--focus-ring);
}
```

### Dark Mode

Orange lightens to `#EF5713` against dark backgrounds to maintain contrast. The `.dark` class block:

```css
.dark {
  --brand-primary:        #EF5713;
  --brand-primary-dark:   #D73F09;
  --brand-primary-tint:   rgba(239, 87, 19, 0.12);

  --surface-base:         #131313;
  --surface-raised:       #1E1E1E;
  --surface-sunken:       #252525;

  --text-primary:         #F5F1EE;
  --text-secondary:       #9A9490;
  --text-tertiary:        #635E5A;

  --border:               rgba(245, 241, 238, 0.12);
  --line:                 rgba(245, 241, 238, 0.10);
  --header-bg:            rgba(19, 19, 19, 0.88);
  --chip-bg:              rgba(30, 30, 30, 0.90);
  --chip-line:            rgba(239, 87, 19, 0.22);
  --hero-a:               rgba(239, 87, 19, 0.14);
  --hero-b:               rgba(26, 17, 0, 0.40);
}
```

---

## Typography

No external font dependencies. System font stack for all text.

**Remove** the `@import url('https://fonts.googleapis.com/...')` line from `styles.css`.

```css
@theme inline {
  --font-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto,
               "Helvetica Neue", Arial, sans-serif;
  --font-mono: ui-monospace, "JetBrains Mono", "Fira Code", "Cascadia Code",
               Menlo, Consolas, monospace;
}
```

### Type Scale

| Usage | Weight | Size | Line-height | Notes |
|---|---|---|---|---|
| `.display-title` | 800 | `clamp(2rem, 5vw, 3.5rem)` | 1.08 | Hero text |
| `h1` | 700 | `2rem` | 1.2 | |
| `h2` | 700 | `1.5rem` | 1.3 | |
| `h3` | 600 | `1.125rem` | 1.4 | |
| Body | 400 | `1rem` | 1.65 | |
| `.island-kicker` | 700 | `0.6875rem` | — | `letter-spacing: 0.14em; text-transform: uppercase` |
| Caption | 500 | `0.8125rem` | 1.5 | |

`.display-title` loses its serif rule. New: `font-weight: 800; letter-spacing: -0.01em`.

---

## Component Updates

### `src/styles.css`

- Delete all teal custom property declarations listed above
- Remove Google Fonts `@import`
- Remove `@import url('https://fonts.googleapis.com/...')`
- Update `.display-title`: remove `font-family: 'Fraunces', Georgia, serif`; add `font-weight: 800; letter-spacing: -0.01em`
- Update `.island-kicker` color: `var(--brand-primary)`
- Update `.nav-link::after` gradient: `linear-gradient(90deg, var(--brand-primary), color-mix(in oklab, var(--brand-primary) 70%, white))`
- Update `body` background radial gradients: replace teal rgba values with `--hero-a` / `--hero-b` token references
- Update `a` link color: `var(--brand-primary-dark)` / hover `var(--brand-primary)`
- Update `.feature-card:hover` border: `color-mix(in oklab, var(--brand-primary) 35%, var(--line))`
- Update `.island-shell` box-shadow: replace `rgba(30, 90, 72, ...)` and `rgba(23, 58, 64, ...)` tints with `rgba(26, 17, 0, ...)` warm neutrals

### `src/routes/__root.tsx`

- Import and mount `<BrandProvider>` wrapping body content
- Import and mount `<InstitutionLogo>` in the header

### `src/components/site-header.tsx`

- Replace hardcoded logo / title text with `<InstitutionLogo>`

### `src/components/status-badge.tsx`

Status-to-token mapping:

| Status | Foreground | Background |
|---|---|---|
| `draft` | `--status-neutral` | `--status-neutral-bg` |
| `submitted` | `--status-info` | `--status-info-bg` |
| `approved` | `--status-success` | `--status-success-bg` |
| `changes-requested` | `--status-warning` | `--status-warning-bg` |
| `published` | `--brand-primary` | `--brand-primary-tint` |
| `archived` | `--status-neutral` | `--status-neutral-bg` |
| `deleted` | `--status-error` | `--status-error-bg` |

### `src/components/category-chip.tsx`

Background `--chip-bg`, border `--chip-line`. Token values now carry orange-tinted values; no code change needed beyond removing any hardcoded teal references.

### All other components

No structural changes. Inherit correct colors from updated tokens.

---

## New Files

### `src/lib/brand.ts`

Institution config object (full content above).

### `src/components/brand-provider.tsx`

Applies brand CSS custom properties to `:root` via `element.style.setProperty()` in `useEffect`. Safe — values are from a static constant, not user input.

### `src/components/institution-logo.tsx`

Header logo lockup. Renders `<img src={brand.logoUrl} alt={brand.logoAlt}>` at `32px` height, a `1px` vertical divider, and `brand.programName` in caption weight. Falls back to `brand.institutionShort` in bold if `brand.logoUrl` is falsy or empty.

### `src/assets/logo-institution.svg`

OSU logo asset. Must be supplied by the developer. `src/lib/brand.ts` imports it via `#/assets/logo-institution.svg?url`, which is what resolves the file into the built, hashed bundle. The repo ships a text placeholder SVG (`INSTITUTION`) so the app renders on a fresh clone without the real logo file.

---

## Mobile-First Constraints

- All layout rules use Tailwind mobile-first (no `max-width` media queries in component classes)
- `.display-title` uses `clamp()` to scale between mobile and desktop without breakpoint overrides
- `.page-wrap` stays `width: min(1080px, calc(100% - 2rem))`
- Header: institution logo hides `programName` text below `sm` breakpoint (logo icon only on mobile)

Breakpoints (Tailwind defaults, unchanged):

| Name | Min-width |
|---|---|
| `sm` | 640px |
| `md` | 768px |
| `lg` | 1024px |
| `xl` | 1280px |

---

## Testing

No new integration tests. Visual QA checklist:

- [ ] All workflow status chips render with correct semantic colors
- [ ] `<InstitutionLogo>` renders in header; text-only fallback works with empty `logoUrl`
- [ ] Primary (orange), ghost (outline), and destructive (red) buttons render correctly
- [ ] Project cards show orange hover border
- [ ] Category chips show orange-tinted border and background
- [ ] Focus rings are visible and orange on all interactive elements
- [ ] Dark mode: `.dark` class applies; orange lightens; surfaces invert
- [ ] Mobile (375px): header, page, and cards lay out without horizontal overflow
- [ ] `brand.ts` institution name and logo appear in the header

---

## Out of Scope

- `/design` showcase route (living style guide page) — can be added as a follow-on story
- Dark mode toggle UI — `.dark` class is defined but the mechanism to apply it is left to a future spec
- Per-user theme preference persistence
- AI-assisted category suggestions
