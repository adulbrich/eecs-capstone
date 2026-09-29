import { Link } from "@tanstack/react-router";
import { Button } from "#/components/ui/button";
import type { AccessDenied as Refusal } from "#/lib/access-denied";

const ROLE_PHRASE = {
  staff: "a staff role",
  admin: "an admin role",
} as const satisfies Record<Refusal["requires"], string>;

/**
 * What a signed-in viewer sees on a page their role does not open (#606).
 *
 * Rendered at the URL they asked for rather than after a redirect, so the
 * address stays in the bar for them to report, and it names the account in
 * use: somebody signed in with the wrong address is the likeliest reader.
 */
export function AccessDeniedPage({ refusal }: { refusal: Refusal }) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-6 md:p-8">
      <h1 className="font-semibold text-2xl">You do not have access</h1>
      <p className="mt-3 text-muted-foreground">
        You are signed in as{" "}
        <span className="wrap-anywhere font-medium text-foreground">
          {refusal.email}
        </span>
        . This page needs {ROLE_PHRASE[refusal.requires]}.
      </p>
      <Button asChild className="mt-6">
        <Link to="/projects">Browse projects</Link>
      </Button>
    </div>
  );
}
