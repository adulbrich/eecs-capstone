import { createFileRoute, Link } from "@tanstack/react-router";
import { pageTitle } from "#/lib/page-title";

export const Route = createFileRoute("/(auth)/verify-email")({
  head: () => ({ meta: [{ title: pageTitle("Verify Email") }] }),
  component: VerifyEmail,
});

function VerifyEmail() {
  return (
    <div className="mx-auto max-w-sm px-4 py-6 md:p-8">
      <h1 className="font-semibold text-2xl">Email verified</h1>
      <p className="mt-4 text-sm">
        Your account is active.{" "}
        <Link className="underline" to="/">
          Continue
        </Link>
        .
      </p>
    </div>
  );
}
