import { Slot } from "radix-ui";
import type * as React from "react";
import { cn } from "#/lib/utils.ts";

/**
 * The repeated card surface, which eight components wrote inline.
 *
 * `panel.tsx`, `.island-shell` and `.feature-card` are deliberately not routed
 * through this. They are distinct surfaces with their own borders and tones,
 * not instances of this one, and collapsing them would lose the distinction
 * `panel.tsx` exists to draw.
 */
function Card({
  className,
  interactive,
  asChild = false,
  ...props
}: React.ComponentProps<"div"> & {
  interactive?: boolean;
  asChild?: boolean;
}) {
  const Comp = asChild ? Slot.Root : "div";

  return (
    <Comp
      className={cn(
        "rounded-lg border border-border bg-card",
        interactive && "transition-colors hover:border-primary",
        className
      )}
      data-slot="card"
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("p-4 pb-0", className)}
      data-slot="card-header"
      {...props}
    />
  );
}

function CardTitle({ className, ...props }: React.ComponentProps<"h3">) {
  return (
    <h3
      className={cn("font-medium text-sm", className)}
      data-slot="card-title"
      {...props}
    />
  );
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div className={cn("p-4", className)} data-slot="card-content" {...props} />
  );
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex items-center p-4 pt-0", className)}
      data-slot="card-footer"
      {...props}
    />
  );
}

export { Card, CardContent, CardFooter, CardHeader, CardTitle };
