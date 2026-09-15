import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type * as React from "react";

import { cn } from "#/lib/utils.ts";

/**
 * `aria-pressed:` is Tailwind's `&[aria-pressed="true"]`, so a toggle's pressed
 * fill comes from the same attribute a screen reader reads. The two toggles
 * (`ViewToggle`, and Edit/Preview in `markdown-field.tsx`) each set the
 * attribute and conditionally applied `bg-secondary` themselves, which let the
 * two disagree and put a colour in a call site's `className` (#392).
 */
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium text-sm outline-none transition-all focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-pressed:bg-secondary aria-pressed:hover:bg-secondary aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        // The foreground token rather than upstream's text-white, and no
        // dark:bg-destructive/60: white on the dark coral fails AA, and the 60%
        // blend upstream uses to rescue it drops the dark ink the token now
        // carries to 3.6:1. Solid coral with dark ink measures 7.62.
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40",
        // text-foreground, not inherited: a rendered <button> inherits the
        // body colour while an `asChild` anchor inherits the global `a` rule,
        // brand orange, so without it the same variant was two different
        // buttons depending on the element underneath (#392).
        outline:
          "border bg-background text-foreground shadow-xs hover:bg-accent hover:text-accent-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost:
          "text-foreground hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
        // The colour the global `a` rule uses, not `text-primary`: the dark
        // palette overrides --primary so white text passes on a filled button,
        // which leaves it at 3.6:1 as text on the page surface.
        link: "text-brand-dark underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        xs: "h-6 gap-1 rounded-md px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        // No box at all, for a `link` Button that sits in a panel as a line of
        // text. Five call sites wrote `h-auto p-0` by hand before this (#392);
        // a size is what owns a height and a padding, so it lives here.
        inline: "h-auto gap-1 p-0",
        icon: "size-9",
        "icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

type ButtonBaseProps = Omit<React.ComponentProps<"button">, "type"> &
  VariantProps<typeof buttonVariants>;

/**
 * `type` is required on a rendered button and forbidden on an `asChild` one.
 *
 * The HTML default for a typeless button is `submit`, so a `Button` inside a
 * form saved it on click wherever a call site forgot the attribute (#305). A
 * default of "button" here would hide the mirror-image bug, a form whose
 * submit button relied on the implicit type and now does nothing, so the call
 * site says which it is. `asChild` renders the child (a `Link`), which has no
 * `type`.
 */
type ButtonProps =
  | (ButtonBaseProps & {
      asChild?: false;
      type: "button" | "submit" | "reset";
    })
  | (ButtonBaseProps & { asChild: true; type?: never });

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      className={cn(buttonVariants({ variant, size, className }))}
      data-size={size}
      data-slot="button"
      data-variant={variant}
      {...props}
    />
  );
}

export { Button, buttonVariants };
