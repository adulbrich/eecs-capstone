import { SlidersHorizontal } from "lucide-react";
import { type ReactNode, useState } from "react";
import { cn } from "#/lib/utils.ts";
import { CountBadge } from "./count-badge";
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
  /**
   * How many narrowing filters are on, shown on the Filters button so a
   * reader below `xl` knows the list is narrowed without opening the sheet.
   * Search and sort are not filters: they live beside the button.
   */
  activeFilterCount: number;
  /** The results, and the pager or count under them. */
  children: ReactNode;
  /**
   * The outer container. A public listing passes its width pair
   * (`mx-auto max-w-4xl xl:max-w-7xl`); an admin listing passes nothing and
   * runs the full width, the way its table always has.
   */
  className?: string;
  /**
   * The narrowing controls. Rendered twice, in the aside from `xl` and in
   * the sheet below it, so pass the same element; only one copy is ever
   * displayed. Both copies are mounted while the sheet is open, so every
   * id inside must come from `useId`: a literal id is duplicated and its
   * label resolves to the hidden aside copy, leaving the sheet's control
   * unnamed.
   */
  filters: ReactNode;
  /** The search input and whatever orders or displays the results. */
  search: ReactNode;
  /** The heading row: h1, breadcrumb, page-scoped buttons. */
  title: ReactNode;
}

/**
 * The shell of a listing page: search on top at every width, the narrowing
 * filters in a left aside from `xl` and in a left `Sheet` below it.
 *
 * This is the one component that carries `xl:` layout classes; a route
 * passes at most its width pair through `className` (UI-CONVENTIONS,
 * "Mobile-first layout"). The aside is 18rem because 288 + 32 gap + 896 card column + 64
 * page padding is exactly 1280, so the sidebar tier starts where the card
 * list no longer has to shrink to make room for it.
 */
export function ListingLayout({
  activeFilterCount,
  children,
  className,
  filters,
  search,
  title,
}: Props) {
  const [open, setOpen] = useState(false);
  return (
    <div className={cn("px-4 py-6 md:p-8", className)}>
      {title}
      <div className="mt-4 xl:grid xl:grid-cols-[18rem_minmax(0,1fr)] xl:gap-8">
        <aside
          aria-label="Filters"
          className="hidden xl:sticky xl:top-8 xl:block xl:max-h-[calc(100vh-4rem)] xl:self-start xl:overflow-y-auto"
        >
          <Card className="bg-transparent p-4">{filters}</Card>
        </aside>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            {search}
            <Sheet onOpenChange={setOpen} open={open}>
              <SheetTrigger asChild>
                <Button
                  className="xl:hidden"
                  size="default"
                  type="button"
                  variant="outline"
                >
                  <SlidersHorizontal aria-hidden="true" />
                  Filters <CountBadge count={activeFilterCount} />
                </Button>
              </SheetTrigger>
              <SheetContent className="w-80 overflow-y-auto" side="left">
                <SheetHeader>
                  <SheetTitle>Filters</SheetTitle>
                  <SheetDescription>
                    The list updates as you change a filter.
                  </SheetDescription>
                </SheetHeader>
                <div className="px-4 pb-4">{filters}</div>
              </SheetContent>
            </Sheet>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
