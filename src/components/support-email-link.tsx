import { brand } from "#/lib/brand";

/**
 * The capstone office's address as a `mailto:` link, wherever a page tells the
 * reader to get in touch. `brand.supportEmail` is a published university
 * address, so it may sit in the client bundle; one component renders it so
 * "who shows the support address" is a grep for this name rather than a
 * sentence in QUIRKS to keep true.
 *
 * Underlined at rest, because one of its homes is the destructive prose of
 * the OAuth error banner, where the brand color is about 1.07:1 against the
 * words around it (UI-CONVENTIONS, "A link inside colored prose").
 */
export function SupportEmailLink() {
  return (
    <a
      className="text-brand-dark underline"
      href={`mailto:${brand.supportEmail}`}
    >
      {brand.supportEmail}
    </a>
  );
}
