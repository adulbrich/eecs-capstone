import { webLinkHref } from "#/lib/web-link";

/**
 * A user's LinkedIn URL on the admin user page, as a link only when it passes
 * the one-link rule. A value stored before #778 can hold another scheme,
 * several links or a bare domain, and shows as text instead.
 */
export function LinkedinLine({ stored }: { stored: string }) {
  const href = webLinkHref(stored);
  return (
    <p className="break-all text-sm">
      <span className="text-muted-foreground">LinkedIn: </span>
      {href ? (
        <a className="text-brand-dark underline" href={href}>
          {href}
        </a>
      ) : (
        stored
      )}
    </p>
  );
}
