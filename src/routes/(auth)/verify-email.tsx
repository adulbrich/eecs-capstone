import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";
import { pageTitle } from "#/lib/page-title";

// Better Auth lands here after checking the token. On failure it appends
// `?error=<code>` to the same URL, where the code is one of TOKEN_EXPIRED,
// INVALID_TOKEN, USER_NOT_FOUND or INVALID_USER, so the page has to read it
// before claiming anything was verified.
const searchSchema = z.object({ error: z.string().optional() });

export const Route = createFileRoute("/(auth)/verify-email")({
  validateSearch: searchSchema,
  head: () => ({ meta: [{ title: pageTitle("Verify Email") }] }),
  component: VerifyEmail,
});

function VerifyEmail() {
  const { error } = Route.useSearch();
  if (error) {
    return (
      <div className="mx-auto max-w-sm px-4 py-6 md:p-8">
        <h1 className="font-semibold text-2xl">Link not valid</h1>
        <p className="mt-4 text-sm">
          {error === "TOKEN_EXPIRED"
            ? "This verification link has expired."
            : "This verification link is not valid."}{" "}
          <Link className="underline" to="/sign-in">
            Sign in
          </Link>{" "}
          to continue.
        </p>
      </div>
    );
  }
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
