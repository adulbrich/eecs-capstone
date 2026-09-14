import { brand } from "#/lib/brand";

/**
 * The capstone office's address as a `mailto:` link, wherever a page tells the
 * reader to get in touch. `brand.supportEmail` is a published university
 * address, so it may sit in the client bundle; one component renders it so
 * "who shows the support address" is a grep for this name rather than a
 * sentence in QUIRKS to keep true.
 *
 * Underlined at rest, because both of its homes are running text: the
 * destructive prose of the OAuth error banner, where the brand color is about
 * 1.07:1 against the words around it, and a privacy policy paragraph
 * (UI-CONVENTIONS, "A link inside running text").
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
