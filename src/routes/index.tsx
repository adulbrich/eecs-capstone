import { createFileRoute, Link } from "@tanstack/react-router";
import { BookOpen, CheckCircle, Package, Users } from "lucide-react";
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
        <p className="mx-auto mt-5 max-w-2xl text-lg text-muted-foreground">
          One home for capstone projects: propose one from anywhere, manage it
          through review to publication, browse the catalog, and borrow the
          equipment your team needs.
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
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <FeatureCard
            body="Search and filter the published catalog by category, technology, and program."
            icon={<BookOpen className="h-5 w-5" />}
            title="Browse Projects"
          />
          <FeatureCard
            body="Anyone can propose a project: industry partners, faculty, staff, and students alike."
            icon={<Users className="h-5 w-5" />}
            title="Propose a Project"
          />
          <FeatureCard
            body="Manage your proposal from draft through review to publication, with feedback in one thread."
            icon={<CheckCircle className="h-5 w-5" />}
            title="Manage Review"
          />
          <FeatureCard
            body="Reserve and check out hardware from the shared equipment inventory."
            icon={<Package className="h-5 w-5" />}
            title="Borrow Equipment"
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
