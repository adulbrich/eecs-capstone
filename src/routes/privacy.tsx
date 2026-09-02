import { createFileRoute } from "@tanstack/react-router";
import { PrivacyPolicy } from "#/components/privacy-policy";
import { pageTitle } from "#/lib/page-title";

/**
 * Public on purpose, and not under `_authed`: someone deciding whether to
 * sign up reads this with no session, and it is the one route the account
 * deletion flow in #84 points at as a promise. See #91.
 */
export const Route = createFileRoute("/privacy")({
  head: () => ({ meta: [{ title: pageTitle("Privacy") }] }),
  component: Privacy,
});

function Privacy() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-6 md:p-8">
      <PrivacyPolicy />
    </div>
  );
}
