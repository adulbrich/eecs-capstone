import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "#/lib/utils.ts";

/**
 * The badge box, and only the box.
 *
 * Four components wrote this shape independently and two drifted: one used
 * `inline-block` instead of `inline-flex`, another dropped `font-medium`. The
 * upstream variants (default, secondary, destructive, outline) cannot express
 * what those four actually do, which is map a domain status to a `--status-*`
 * foreground and background pair. So `status` is a variant that paints nothing
 * and expects the caller to supply both through `style`.
 */
const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded px-2 py-0.5 font-medium text-xs",
  {
    defaultVariants: {
      variant: "default",
    },
    variants: {
      variant: {
        default: "bg-secondary text-secondary-foreground",
        outline: "border border-border text-foreground",
        secondary: "bg-secondary text-muted-foreground",
        // Painted by the caller's inline --status-* tokens.
        status: "",
      },
    },
  }
);

function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return (
    <span
      className={cn(badgeVariants({ variant }), className)}
      data-slot="badge"
      {...props}
    />
  );
}

export { Badge, badgeVariants };
