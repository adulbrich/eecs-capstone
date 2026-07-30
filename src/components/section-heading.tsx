/**
 * The single h2 treatment for the project detail page. The fields on that page
 * are markdown and can contain bold runs at body size, so a section heading has
 * to outrank them visually or the page reads as if the bold text were the
 * structure. Sits one step below the page h1 (`text-2xl`) and above the panel
 * h3s (`text-sm`).
 *
 * Anything rendering an h2 onto that page should come through here rather than
 * styling its own, which is how "Your actions" ended up three sizes smaller
 * than the headings around it.
 */
export function SectionHeading({ children }: { children: string }) {
  return <h2 className="font-semibold text-xl tracking-tight">{children}</h2>;
}
