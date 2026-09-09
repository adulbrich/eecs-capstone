import type { ReactNode } from "react";
import type { TimelineEvent } from "#/lib/inventory-timeline";
import { LineTimeline } from "./line-timeline";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "./ui/sheet";

export interface LineSheetField {
  label: string;
  value: ReactNode;
}

/**
 * One line, read and acted on: its fields, its timeline and its actions.
 *
 * A sibling of the table rather than a row detail, so `AdminDataTable` grows
 * no expansion mode, and the roomier actions have somewhere to live that is
 * not a seventh column. The first use of `Sheet` outside the mobile nav.
 * Both the staff queue and `/my/items` render one; what differs between them
 * is what the caller puts in `fields`, whether the events name anyone, and
 * which actions it passes.
 */
export function LineSheet({
  actions,
  description,
  events,
  fields,
  onOpenChange,
  open,
  title,
}: {
  actions?: ReactNode;
  description?: string;
  events: TimelineEvent[];
  fields: LineSheetField[];
  onOpenChange: (open: boolean) => void;
  open: boolean;
  title: string;
}) {
  return (
    <Sheet onOpenChange={onOpenChange} open={open}>
      {/*
        Radix requires a description or an explicit opt-out. One is always
        rendered here: a caller with nothing to say gets the title repeated
        for screen readers only, so the sheet never opens undescribed.
      */}
      <SheetContent className="overflow-y-auto sm:max-w-md" side="right">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          {description ? (
            <SheetDescription>{description}</SheetDescription>
          ) : (
            <SheetDescription className="sr-only">{title}</SheetDescription>
          )}
        </SheetHeader>
        <div className="space-y-6 px-4">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            {fields.map((field) => (
              <div className="contents" key={field.label}>
                <dt className="text-muted-foreground">{field.label}</dt>
                <dd className="min-w-0">{field.value}</dd>
              </div>
            ))}
          </dl>
          <section aria-labelledby="line-sheet-timeline-heading">
            <h3
              className="mb-2 font-medium text-sm"
              id="line-sheet-timeline-heading"
            >
              History
            </h3>
            <LineTimeline events={events} />
          </section>
        </div>
        {actions && <SheetFooter>{actions}</SheetFooter>}
      </SheetContent>
    </Sheet>
  );
}
