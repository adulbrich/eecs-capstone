import { Slot } from "radix-ui";
import type * as React from "react";
import { cn } from "#/lib/utils.ts";

/**
 * Previous/Next pagination.
 *
 * Two of the three pagers this replaced disabled their controls with
 * `pointer-events-none` alone. That suppresses mouse events and nothing else:
 * the anchor stays in the tab order, still announces as a link, and Enter still
 * activates it, so a keyboard user on page 1 could focus a control that looks
 * disabled, activate it, and get no feedback. Dropping `href` is what actually
 * removes an anchor from the tab order; `aria-disabled` is what tells a screen
 * reader why.
 */
function Pagination({ className, ...props }: React.ComponentProps<"nav">) {
  return (
    <nav
      aria-label="Pagination"
      className={cn(
        "mt-6 flex items-center justify-between text-sm",
        className
      )}
      data-slot="pagination"
      {...props}
    />
  );
}

/**
 * `aria-live="polite"` because the page number is the only confirmation a
 * screen-reader user gets that activating Next did anything: the surrounding
 * list swaps its rows without moving focus.
 */
function PaginationStatus({
  page,
  totalPages,
}: {
  page: number;
  totalPages: number;
}) {
  return (
    <span aria-live="polite" className="text-muted-foreground">
      Page {page} of {totalPages}
    </span>
  );
}

const CONTROL_CLASS =
  "rounded-md px-2 py-1 outline-none hover:underline focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";
const DISABLED_CLASS =
  "cursor-default text-muted-foreground/40 no-underline hover:no-underline";

function PaginationLink({
  asChild,
  children,
  className,
  disabled,
  href,
  ...props
}: React.ComponentProps<"a"> & { asChild?: boolean; disabled?: boolean }) {
  const Comp = asChild && !disabled ? Slot.Root : "a";
  return (
    <Comp
      aria-disabled={disabled ? "true" : undefined}
      className={cn(CONTROL_CLASS, disabled && DISABLED_CLASS, className)}
      data-slot="pagination-link"
      // No href when disabled: that is what takes it out of the tab order.
      href={disabled || asChild ? undefined : href}
      tabIndex={disabled ? -1 : undefined}
      {...props}
    >
      {children}
    </Comp>
  );
}

function PaginationButton({
  className,
  disabled,
  ...props
}: React.ComponentProps<"button">) {
  return (
    <button
      className={cn(CONTROL_CLASS, disabled && DISABLED_CLASS, className)}
      data-slot="pagination-button"
      disabled={disabled}
      type="button"
      {...props}
    />
  );
}

export { Pagination, PaginationButton, PaginationLink, PaginationStatus };
