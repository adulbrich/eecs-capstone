import type * as React from "react";

import { cn } from "#/lib/utils";

/**
 * shadcn's table, with five local edits. The component is copy-owned, so
 * these divergences are permanent and deliberate:
 *
 * 1. The wrapper scrolls (and caps its height) only at `md` and up, because
 *    below that `src/styles.css` restacks `.admin-table` into cards and a
 *    scroll container would fight it.
 * 2. Cells wrap below `md` and stay on one line above it, for the same reason.
 * 3. The table is `border-separate`, which sticky headers require.
 * 4. The row rule lives on the cells, not on `TableRow`, because a `tr`
 *    cannot paint a border once the table is `border-separate`.
 * 5. The wrapper takes its own `containerClassName`. Upstream hardcodes the
 *    wrapper's classes and routes `className` to the inner `table`, which
 *    leaves callers unable to give the container a surface or a border. That
 *    is exactly what an admin table needs: without a background of its own it
 *    sits directly on the page gradient, which is lightest and orange-tinted
 *    near the top of the page, and orange links on it lose contrast.
 */
function Table({
  className,
  containerClassName,
  ...props
}: React.ComponentProps<"table"> & { containerClassName?: string }) {
  return (
    <div
      className={cn(
        "relative w-full md:max-h-[calc(100vh-14rem)] md:overflow-auto",
        containerClassName
      )}
      data-slot="table-container"
    >
      <table
        className={cn(
          "w-full caption-bottom border-separate border-spacing-0 text-sm",
          className
        )}
        data-slot="table"
        {...props}
      />
    </div>
  );
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead className={cn(className)} data-slot="table-header" {...props} />
  );
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return <tbody className={cn(className)} data-slot="table-body" {...props} />;
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      className={cn("border-t bg-muted/50 font-medium", className)}
      data-slot="table-footer"
      {...props}
    />
  );
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      className={cn(
        "transition-colors hover:bg-muted/50 has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted",
        className
      )}
      data-slot="table-row"
      {...props}
    />
  );
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      className={cn(
        "h-10 whitespace-normal border-b px-2 text-left align-middle font-medium text-foreground md:whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        className
      )}
      data-slot="table-head"
      {...props}
    />
  );
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      className={cn(
        "whitespace-normal border-b p-2 align-middle md:whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        className
      )}
      data-slot="table-cell"
      {...props}
    />
  );
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      className={cn("mt-4 text-muted-foreground text-sm", className)}
      data-slot="table-caption"
      {...props}
    />
  );
}

export {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
};
