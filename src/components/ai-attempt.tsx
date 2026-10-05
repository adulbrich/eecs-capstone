import type { ReactNode } from "react";
import type { AiRefreshTrigger } from "#/lib/ai-refresh";

/**
 * How an attempt started, as the end of a sentence: "failed automatically",
 * "failed from Recompute". `staffAction` names the button, so the reader can
 * find it.
 */
export function triggerPhrase(
  trigger: AiRefreshTrigger,
  staffAction: string
): string {
  return trigger === "automatic" ? "automatically" : `from ${staffAction}`;
}

/**
 * The last AI attempt failed and the stored output is missing or out of date
 * (#631). A state the project is in, not an action that just failed, so it
 * is the tinted status box `ban-form.tsx` uses rather than `FieldError`, whose
 * `role="alert"` would interrupt on every panel load.
 */
export function AttemptFailed({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-sm">
      {children}
    </p>
  );
}

/** Any other status line about the last attempt. */
export function AttemptNote({ children }: { children: ReactNode }) {
  return <p className="text-muted-foreground text-xs">{children}</p>;
}
