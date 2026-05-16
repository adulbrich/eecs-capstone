import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/(auth)/verify-email")({
  component: VerifyEmail,
});

function VerifyEmail() {
  return (
    <div className="mx-auto max-w-sm p-8">
      <h1 className="text-2xl font-semibold">Email verified</h1>
      <p className="mt-4 text-sm">
        Your account is active.{" "}
        <Link to="/" className="underline">
          Continue
        </Link>
        .
      </p>
    </div>
  );
}
