import { createFileRoute } from "@tanstack/react-router";
import { PrivacyPolicy } from "#/components/privacy-policy";
import { pageTitle } from "#/lib/page-title";

/** Public, outside `_authed`; docs/QUIRKS.md says why and what proves it. */
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
