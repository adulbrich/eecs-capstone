import { useCallback, useRef, useState } from "react";
import { errorMessage } from "./error-message";

/**
 * One user-triggered mutation: its flight, its refusal, and the guard that
 * stops a second one starting.
 *
 * About twenty-eight handlers wrote this by hand and agreed with each other;
 * the rest diverged, and two files grew a local `run(action)` wrapper that did
 * exactly this (#410). What they mostly got wrong was the guard: a `disabled`
 * prop alone does not stop a second call, because a keyboard activation or a
 * dropdown item can arrive before React has re-rendered the button. The guard
 * here is a ref, read and set synchronously, so the second call returns before
 * it reaches the server.
 *
 * `error` is held rather than thrown, for the caller to render through
 * `FieldError`. A caller with no panel to write into passes `onError` instead
 * and shows a toast, which is the choice UI-CONVENTIONS makes by where the
 * control sits: inline in a form or a panel, a toast on a table row or a
 * header control.
 *
 * `run` answers whether the action succeeded, so a caller can navigate or
 * close a dialog on the true branch without a second try/catch of its own.
 * It takes a fallback of its own for a panel whose several actions fail
 * differently ("Update failed", "Reject failed") but share one error slot.
 *
 * `setError` comes back out for the client-side refusals that never reach a
 * server: `custom-line-actions.tsx` writes "Reason required" into the same
 * paragraph a server rejection would land in.
 */
export function useAction(options?: {
  /** Shown when the rejection carries no message of its own. */
  fallback?: string;
  /** Called instead of holding the message, for a toast. */
  onError?: (message: string) => void;
}) {
  const fallback =
    options?.fallback ?? "Something went wrong. Please try again.";
  const onError = options?.onError;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A ref as well as the state: the state drives the disabled prop and the
  // label, the ref is what a second call within the same tick actually hits.
  const inFlight = useRef<boolean>(false);

  const run = useCallback(
    async (
      action: () => void | Promise<void>,
      /** Overrides the hook's fallback for this one action. */
      actionFallback?: string
    ): Promise<boolean> => {
      if (inFlight.current) {
        return false;
      }
      inFlight.current = true;
      setBusy(true);
      setError(null);
      try {
        await action();
        return true;
      } catch (err) {
        const message = errorMessage(err, actionFallback ?? fallback);
        if (onError) {
          onError(message);
        } else {
          setError(message);
        }
        return false;
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [fallback, onError]
  );

  return { busy, error, run, setError };
}
