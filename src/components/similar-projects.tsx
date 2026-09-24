import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Layers, Minus } from "lucide-react";
import type * as React from "react";
import { useId, useState } from "react";
import { cn } from "#/lib/utils.ts";
import {
  getSimilarProjects,
  type SimilarProject,
} from "#/server/projects-queries";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "./ui/sheet";

interface Props {
  children: React.ReactNode;
  projectId: string;
}

const HEADING = "Similar projects";

/**
 * Where a collapse of the floating card is remembered. Per viewer and per
 * browser, a convenience only: a storage that throws or comes back empty
 * leaves the card open, which is the default anyway.
 */
const COLLAPSED_STORAGE_KEY = "cs-capstone:similar-projects-collapsed";

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSED_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function writeCollapsed(collapsed: boolean): void {
  try {
    if (collapsed) {
      window.localStorage.setItem(COLLAPSED_STORAGE_KEY, "true");
    } else {
      window.localStorage.removeItem(COLLAPSED_STORAGE_KEY);
    }
  } catch {
    // Storage may be full or disabled (private mode); the state still holds
    // for this page.
  }
}

/**
 * The project page's frame, with the similar-projects list beside it (#614).
 *
 * Three forms, one per width tier (ADR-0054): from `xl` a sticky aside in a
 * second column; between `md` and `xl` a card floating at the bottom right
 * that collapses to a pill; below `md` an icon button that opens the list in
 * a bottom sheet. The `xl:` classes live here, not in the route, the way
 * `ListingLayout` keeps its own.
 *
 * The second column is there at `xl` whether or not the list is, so the text
 * does not jump sideways when the list arrives after the page.
 */
export function SimilarProjectsLayout({ children, projectId }: Props) {
  const { data: rows = [] } = useQuery({
    queryKey: ["similar-projects", projectId],
    queryFn: () => getSimilarProjects({ data: { projectId } }),
  });
  const hasRows = rows.length > 0;
  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:p-8 xl:grid xl:max-w-6xl xl:grid-cols-[minmax(0,1fr)_18rem] xl:gap-8">
      {/*
        Room at the bottom below `xl`, so the floating control never sits
        over the last line of the page.
      */}
      <div className={hasRows ? "min-w-0 pb-16 xl:pb-0" : "min-w-0"}>
        {children}
      </div>
      {hasRows && (
        <>
          <aside
            aria-label={HEADING}
            className="hidden xl:sticky xl:top-8 xl:block xl:max-h-[calc(100vh-4rem)] xl:self-start xl:overflow-y-auto"
          >
            <Card className="p-4">
              <h2 className="font-semibold text-sm">{HEADING}</h2>
              <SimilarProjectsList rows={rows} />
            </Card>
          </aside>
          <FloatingCard rows={rows} />
          <PhoneSheet rows={rows} />
        </>
      )}
    </div>
  );
}

/**
 * The `md` to `xl` form. It mounts only once the list has arrived, which is
 * on the client, so reading storage in the initializer cannot disagree with
 * a server render.
 */
function FloatingCard({ rows }: { rows: SimilarProject[] }) {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const listId = useId();

  function toggle(next: boolean) {
    setCollapsed(next);
    writeCollapsed(next);
  }

  return (
    <div className="fixed right-4 bottom-4 z-40 hidden md:block xl:hidden">
      {collapsed ? (
        <Button
          aria-expanded={false}
          className="shadow-md"
          onClick={() => toggle(false)}
          type="button"
          variant="outline"
        >
          <Layers aria-hidden="true" />
          {HEADING}
        </Button>
      ) : (
        <aside aria-label={HEADING} id={listId}>
          <Card className="w-80 p-4 shadow-lg">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-semibold text-sm">{HEADING}</h2>
              <Button
                aria-controls={listId}
                aria-expanded={true}
                aria-label="Hide similar projects"
                onClick={() => toggle(true)}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <Minus aria-hidden="true" />
              </Button>
            </div>
            <SimilarProjectsList rows={rows} />
          </Card>
        </aside>
      )}
    </div>
  );
}

/**
 * The phone form: an icon button at the bottom right, collapsed by default,
 * opening the list in a bottom sheet. A link closes the sheet, because the
 * route component is reused across project ids and the open state would
 * otherwise carry over to the next page.
 */
function PhoneSheet({ rows }: { rows: SimilarProject[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="fixed right-4 bottom-4 z-40 md:hidden">
      <Sheet onOpenChange={setOpen} open={open}>
        <SheetTrigger asChild>
          <Button
            aria-label="Open similar projects"
            className="shadow-md"
            size="icon-lg"
            type="button"
            variant="outline"
          >
            <Layers aria-hidden="true" />
          </Button>
        </SheetTrigger>
        <SheetContent className="max-h-[80vh] overflow-y-auto" side="bottom">
          <SheetHeader className="pb-0">
            <SheetTitle>{HEADING}</SheetTitle>
            <SheetDescription>
              Projects accepting applicants in the same program, closest to this
              one first.
            </SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-6">
            {/* The sheet header already spaces it; no top margin here. */}
            <SimilarProjectsList
              className=""
              onNavigate={() => setOpen(false)}
              rows={rows}
            />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function SimilarProjectsList({
  className = "mt-3",
  onNavigate,
  rows,
}: {
  className?: string;
  onNavigate?: () => void;
  rows: SimilarProject[];
}) {
  return (
    <ul className={cn("space-y-3", className)}>
      {rows.map((row) => (
        <li key={row.id}>
          <Link
            className="font-medium text-sm"
            onClick={onNavigate}
            params={{ projectId: row.id }}
            to="/projects/$projectId"
          >
            {row.title}
          </Link>
          {row.excerpt && (
            <p className="mt-0.5 line-clamp-2 text-muted-foreground text-xs">
              {row.excerpt}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
