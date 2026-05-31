import { brand } from "#/lib/brand";

// Renders the institution logo + program name for the site header.
//
// Logo color strategy:
//   - Light mode: logo renders as-is (assumed monochrome dark/black).
//   - Dark mode: if brand.logoUrlLight is set, swaps to that image.
//     Otherwise applies CSS filter (brightness(0) invert(1)) to flip the
//     dark logo to white. This works correctly for monochrome SVGs.
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
        src={brand.logoUrl}
      />
      {hasLightVariant && (
        <img
          alt={brand.logoAlt}
          className="hidden h-8 w-auto dark:block"
          src={brand.logoUrlLight}
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
