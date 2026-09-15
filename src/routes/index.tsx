import { createFileRoute, Link } from "@tanstack/react-router";
import { BookOpen, Package } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "#/components/ui/button";
import { brand } from "#/lib/brand";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [{ title: `${brand.institutionName} ${brand.programName}` }],
  }),
  component: Home,
});

// The status names and their one-line meanings come from CONTEXT.md, Status.
const PROPOSAL_PATH = [
  {
    status: "Draft",
    note: "Written, not yet handed to staff. Only you and staff can see it.",
  },
  {
    status: "Submitted",
    note: "Handed to staff for review. This is what lands in the staff inbox.",
  },
  {
    status: "Changes requested",
    note: "Staff sent it back with a note in the comment thread. Edit and resubmit.",
  },
  {
    status: "Approved",
    note: "Accepted by staff, waiting to be published.",
  },
  {
    status: "Published",
    note: "In the public catalog for students to find.",
  },
];

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
                  {step.status}
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
