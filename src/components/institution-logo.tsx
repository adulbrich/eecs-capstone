import { brand } from "#/lib/brand";

// Renders the institution logo + program name for the site header.
//
// Logo color strategy:
//   - Light mode: logo renders as-is (assumed monochrome dark/black).
//   - Dark mode: if brand.logoUrlLight is set, swaps to that image.
//     Otherwise applies CSS filter (brightness(0) invert(1)) to flip the
//     dark logo to white. This works correctly for monochrome SVGs.
//
// Intrinsic dimensions:
//   width/height are declared so the mark reserves 101x32 before anything
//   loads. Without them the browser lays the image out at its 581.88x184.47
//   viewBox until CSS arrives, twice, since site-header.tsx renders the logo
//   for both the desktop and mobile bars. They also give `w-auto` an aspect
//   ratio to resolve against, so the nav does not shift when the SVG lands.
//   101 = 581.88 / 184.46667 * 32. Keep it in step with the viewBox.
export function InstitutionLogo() {
  const hasLightVariant = Boolean(brand.logoUrlLight);

  return (
    <div className="flex items-center gap-2.5">
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
      {hasLightVariant && (
        <img
          alt={brand.logoAlt}
          className="hidden h-8 w-auto dark:block"
          height={32}
          src={brand.logoUrlLight}
          width={101}
        />
      )}
      {brand.programName && (
        <>
          <span aria-hidden="true" className="h-5 w-px bg-[var(--line)]" />
          <span className="hidden font-medium text-[var(--text-secondary)] text-xs sm:inline">
            {brand.programName}
          </span>
        </>
      )}
    </div>
  );
}
