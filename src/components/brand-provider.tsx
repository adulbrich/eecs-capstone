import { useEffect } from "react";
import { brand } from "#/lib/brand";

// Writes brand color tokens to :root at runtime via element.style.setProperty().
// Safe: all values come from a static TypeScript constant, not user input.
// Runs client-only; styles.css :root defaults are identical so there is no FOUC.
export function BrandProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--brand-primary", brand.colorPrimary);
    root.style.setProperty("--brand-primary-dark", brand.colorPrimaryDark);
    root.style.setProperty("--brand-primary-light", brand.colorPrimaryLight);
    root.style.setProperty("--brand-primary-tint", brand.colorPrimaryTint);
    root.style.setProperty("--brand-on-primary", brand.colorOnPrimary);
  }, []);
  return <>{children}</>;
}
