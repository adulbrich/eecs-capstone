import logoInstitution from "#/assets/logo-institution.svg?url";

export const brand = {
  institutionName: "Oregon State University",
  institutionShort: "OSU",
  programName: "EECS Capstone",
  // Imported rather than referenced by path so Vite hashes it into /assets/,
  // where the CloudFront behavior added in infra/cloudfront.tf caches it.
  // Files left in public/ are copied verbatim and ship with no cache-control.
  logoUrl: logoInstitution,
  logoAlt: "Oregon State University",
  // Optional explicit white/light logo for dark mode.
  // When undefined, InstitutionLogo uses CSS filter inversion instead.
  logoUrlLight: undefined as string | undefined,
  faviconUrl: "/favicon.ico",
  // A display address, not the SES sender: that is EMAIL_FROM, on a
  // different subdomain, so changing this cannot affect outbound mail.
  supportEmail: "eecs-capstone@oregonstate.edu",
  institutionUrl: "https://oregonstate.edu",
  // The header's source link. Here rather than in the component because it
  // is one of the values a fork changes, like every other field in this file.
  repositoryUrl: "https://github.com/adulbrich/eecs-capstone",

  // Color tokens: must match the :root defaults in styles.css exactly.
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
  repositoryUrl: string;
  supportEmail: string;
}
