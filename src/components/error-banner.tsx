import type { ReactNode } from "react";
import { cn } from "#/lib/utils.ts";

/**
 * A failure that belongs to a whole form or panel rather than to one field.
 *
 * Three copies of this box existed before it, on two different opacity pairs:
 * `project-form.tsx` and `inventory-form.tsx` at `border-destructive/30` and
 * `bg-destructive/5`, `oauth-error-banner.tsx` at `/50` and `/10` (#411). The
 * lighter pair is the one kept: the text inside is already `text-destructive`
 * and carries the meaning, so the box is a tint rather than a second signal.
 *
 * `role="alert"` for the reason `FieldError` gives: this appears in response to
 * something the reader just did. A caller renders it only when it has a message,
 * so there is never an empty alert sitting in the DOM waiting to announce.
 *
 * Not for a status panel that happens to be tinted the same way. The ban notice
 * in `ban-form.tsx` describes a state the account is in, not an action that
 * failed, and keeps its own heading and markup.
 */
export function ErrorBanner({
  children,
  className,
}: {
  children: ReactNode;
  /** Positioning only, as UI-CONVENTIONS requires of any shared component. */
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-md border border-destructive/30 bg-destructive/5 p-3 text-destructive text-sm",
        className
      )}
      data-slot="error-banner"
      role="alert"
    >
      {children}
    </div>
  );
}
