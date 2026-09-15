import { createFileRoute, Link } from "@tanstack/react-router";
import { BookOpen, Package } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "#/components/ui/button";
import { brand } from "#/lib/brand";
import {
  PROJECT_STATUS_DESCRIPTION,
  PROJECT_STATUS_LABEL,
  PROJECT_STATUSES_IN_DISPLAY_ORDER,
} from "#/lib/project-workflow";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [{ title: `${brand.institutionName} ${brand.programName}` }],
  }),
  component: Home,
});

// The proposal's path, in display order, minus the archive: a landing page
// says where a proposal goes, not where it ends up years later. Label and
// meaning are the shared records, so the strip cannot drift from the badge
// and the stepper.
const PROPOSAL_PATH = PROJECT_STATUSES_IN_DISPLAY_ORDER.filter(
  (status) => status !== "archived"
).map((status) => ({
  status,
  label: PROJECT_STATUS_LABEL[status],
  note: PROJECT_STATUS_DESCRIPTION[status],
}));

function Home() {
  return (
    <main>
      <section className="page-wrap pt-16 pb-10 text-center md:pt-20 md:pb-12">
        <p className="island-kicker">{brand.institutionName}</p>
        <h1 className="display-title mt-4">{brand.programName}</h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg text-muted-foreground">
          Propose a capstone project, follow it through staff review into the
          public catalog, and borrow the equipment your team needs.
        </p>
      </section>

      {/* The two destinations the header nav names, and nothing that looks
          pressable without being a link (#393). */}
      <section className="page-wrap pb-12 md:pb-16">
        <div className="grid gap-4 md:grid-cols-2 md:gap-6">
          <Panel icon={<BookOpen className="h-5 w-5" />} title="Projects">
            <p className="mt-4 text-muted-foreground">
              Every published project, filterable by program, category and
              technology. Anyone can propose one: faculty, staff, students and
              industry partners submit the same way.
            </p>
            <div className="mt-auto flex flex-wrap items-center gap-3 pt-6">
              <Button asChild size="lg">
                <Link to="/projects">Browse the catalog</Link>
              </Button>
              {/* Signed out, /projects/new goes through sign-in and back. */}
              <Button asChild size="lg" variant="outline">
                <Link to="/projects/new">Propose a project</Link>
              </Button>
            </div>
          </Panel>
          <Panel icon={<Package className="h-5 w-5" />} title="Inventory">
            <p className="mt-4 text-muted-foreground">
              Shared equipment for capstone teams. Put items on a borrow list,
              send the request, and pick them up once staff approve it.
            </p>
            <div className="mt-auto flex flex-wrap items-center gap-3 pt-6">
              <Button asChild size="lg">
                <Link to="/inventory">See what you can borrow</Link>
              </Button>
            </div>
          </Panel>
        </div>
      </section>

      <section className="page-wrap pb-24">
        <h2 className="island-kicker mb-5 md:mb-6">How a proposal moves</h2>
        <ol className="flex flex-col md:flex-row md:gap-4">
          {PROPOSAL_PATH.map((step, index) => (
            <li
              className="relative flex gap-3 pb-6 before:absolute before:top-9 before:bottom-0 before:left-[13px] before:w-px before:bg-[var(--line)] last:pb-0 last:before:hidden md:flex-1 md:flex-col md:gap-2 md:pb-0 md:before:hidden"
              key={step.status}
            >
              <div className="flex items-center gap-3">
                <span
                  aria-hidden="true"
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary font-bold text-primary-foreground text-xs"
                >
                  {index + 1}
                </span>
                <span className="hidden h-px flex-1 bg-[var(--line)] md:block" />
              </div>
              <div className="pt-0.5 md:pt-0">
                <h3 className="font-semibold text-[15px] leading-[22px]">
                  {step.label}
                </h3>
                <p className="mt-1 text-muted-foreground text-sm md:pr-6">
                  {step.note}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}

function Panel({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="feature-card flex flex-col rounded-xl border border-[var(--line)] p-6 md:p-8">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--brand-primary-tint)] text-brand">
          {icon}
        </div>
        <h2 className="font-bold text-2xl">{title}</h2>
      </div>
      {children}
    </div>
  );
}
