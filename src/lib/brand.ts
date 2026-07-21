export const brand = {
  institutionName: "Oregon State University",
  institutionShort: "OSU",
  programName: "EECS Capstone",
  logoUrl: "/logo-institution.svg",
  logoAlt: "Oregon State University",
  // Optional explicit white/light logo for dark mode.
  // When undefined, InstitutionLogo uses CSS filter inversion instead.
  logoUrlLight: undefined as string | undefined,
  faviconUrl: "/favicon.ico",
  supportEmail: "capstone@oregonstate.edu",
  institutionUrl: "https://oregonstate.edu",

  // Color tokens — must match the :root defaults in styles.css exactly.
  // BrandProvider writes these to :root at runtime via element.style.setProperty().
  colorPrimary: "#D73F09", // Beaver Orange
  colorPrimaryDark: "#B83207", // hover / pressed
  colorPrimaryLight: "#F5987A", // tints, illustrations
  colorPrimaryTint: "rgba(215, 63, 9, 0.08)",
  colorOnPrimary: "#FFFFFF",
  colorBlack: "#000000", // Paddletail Black
  colorWhite: "#FFFFFF", // Bucktooth White
} as const satisfies Brand;

export interface Brand {
  colorBlack: string;
  colorOnPrimary: string;
  colorPrimary: string;
  colorPrimaryDark: string;
  colorPrimaryLight: string;
  colorPrimaryTint: string;
  colorWhite: string;
  faviconUrl: string;
  institutionName: string;
  institutionShort: string;
  institutionUrl: string;
  logoAlt: string;
  logoUrl: string;
  logoUrlLight: string | undefined;
  programName: string;
  supportEmail: string;
}
