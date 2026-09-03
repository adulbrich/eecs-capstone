import { brand } from "#/lib/brand";

/**
 * The capstone office's address as a `mailto:` link, wherever a page tells the
 * reader to get in touch. `brand.supportEmail` is a published university
 * address, so it may sit in the client bundle; one component renders it so
 * "who shows the support address" is a grep for this name rather than a
 * sentence in QUIRKS to keep true.
 */
export function SupportEmailLink() {
  return (
    <a
      className="text-brand hover:underline"
      href={`mailto:${brand.supportEmail}`}
    >
      {brand.supportEmail}
    </a>
  );
}
