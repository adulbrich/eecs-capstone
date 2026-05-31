import { createFileRoute, Link } from "@tanstack/react-router";
import { BookOpen, CheckCircle, Users } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "#/components/ui/button";
import { authClient } from "#/lib/auth-client";
import { brand } from "#/lib/brand";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [{ title: `${brand.institutionName} ${brand.programName}` }],
  }),
  component: Home,
});

function Home() {
  const { data: session } = authClient.useSession();
  const isSignedIn = !!session?.user;

  return (
    <main>
      <section className="page-wrap py-20 text-center">
        <p className="island-kicker">{brand.institutionName}</p>
        <h1 className="display-title mt-4">{brand.programName}</h1>
        <p className="mx-auto mt-5 max-w-xl text-lg text-muted-foreground">
          Browse student capstone proposals, submit your own idea, and follow
          projects through the review workflow.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Button asChild size="lg">
            <Link to="/projects">Browse Projects</Link>
          </Button>
          {isSignedIn ? (
            <Button asChild size="lg" variant="outline">
              <Link to="/projects/new">Propose a Project</Link>
            </Button>
          ) : (
            <Button asChild size="lg" variant="outline">
              <Link to="/sign-up">Create Account</Link>
            </Button>
          )}
        </div>
      </section>

      <section className="page-wrap pb-24">
        <div className="grid gap-4 sm:grid-cols-3">
          <FeatureCard
            body="Search and filter capstone proposals by category, technology, and program."
            icon={<BookOpen className="h-5 w-5" />}
            title="Browse Projects"
          />
          <FeatureCard
            body="Industry partners and faculty submit proposals for student teams to work on."
            icon={<Users className="h-5 w-5" />}
            title="Propose Ideas"
          />
          <FeatureCard
            body="Follow your project through the review workflow from draft to published."
            icon={<CheckCircle className="h-5 w-5" />}
            title="Track Progress"
          />
        </div>
      </section>
    </main>
  );
}

function FeatureCard({
  icon,
  title,
  body,
}: {
  icon: ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="feature-card rounded-xl border border-[var(--line)] p-6">
      <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--brand-primary-tint)] text-brand">
        {icon}
      </div>
      <h3 className="font-semibold">{title}</h3>
      <p className="mt-2 text-muted-foreground text-sm">{body}</p>
    </div>
  );
}
