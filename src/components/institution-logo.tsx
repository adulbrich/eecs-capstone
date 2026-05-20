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
        src={brand.logoUrl}
        alt={brand.logoAlt}
        className={[
          "h-8 w-auto",
          hasLightVariant ? "dark:hidden" : "dark:brightness-0 dark:invert",
        ].join(" ")}
      />
      {hasLightVariant && (
        <img
          src={brand.logoUrlLight}
          alt={brand.logoAlt}
          className="hidden h-8 w-auto dark:block"
        />
      )}
      {brand.programName && (
        <>
          <span className="h-5 w-px bg-[var(--line)]" aria-hidden="true" />
          <span className="hidden text-xs font-medium text-[var(--text-secondary)] sm:inline">
            {brand.programName}
          </span>
        </>
      )}
    </div>
  );
}
