import { useEffect } from "react";
import { brand } from "#/lib/brand";

/**
 * Tokens the dark-mode block in `styles.css` deliberately re-tunes for dark
 * surfaces, and which BrandProvider must therefore leave alone there.
 *
 * An inline style on the root element beats a stylesheet rule no matter what
 * media query guards it, so writing the light-mode brand values here would
 * silently undo that tuning after hydration. It is not cosmetic:
 * `colorPrimaryDark` is #B83207, which every link on the page uses, and on the
 * dark card surface (#1C1C1C) that is 2.8:1. The dark block's #FF8C5A is
 * 7.4:1. Removing the property instead of setting it lets the stylesheet win.
 */
const DARK_TUNED_TOKENS = new Set([
  "--brand-primary",
  "--brand-primary-dark",
  "--brand-primary-tint",
]);

const BRAND_TOKENS: [string, string][] = [
  ["--brand-primary", brand.colorPrimary],
  ["--brand-primary-dark", brand.colorPrimaryDark],
  ["--brand-primary-light", brand.colorPrimaryLight],
  ["--brand-primary-tint", brand.colorPrimaryTint],
  ["--brand-on-primary", brand.colorOnPrimary],
];

// Writes brand color tokens to :root at runtime via element.style.setProperty().
// Safe: all values come from a static TypeScript constant, not user input.
// Runs client-only; styles.css :root defaults are identical so there is no FOUC.
export function BrandProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const root = document.documentElement;
    const darkMedia = window.matchMedia("(prefers-color-scheme: dark)");

    const apply = () => {
      for (const [name, value] of BRAND_TOKENS) {
        if (darkMedia.matches && DARK_TUNED_TOKENS.has(name)) {
          root.style.removeProperty(name);
        } else {
          root.style.setProperty(name, value);
        }
      }
    };

    apply();
    // Re-apply on a live scheme switch: the inline styles written for light
    // mode would otherwise persist into dark mode and reintroduce the same
    // contrast failure without a reload.
    darkMedia.addEventListener("change", apply);
    return () => darkMedia.removeEventListener("change", apply);
  }, []);
  return <>{children}</>;
}
