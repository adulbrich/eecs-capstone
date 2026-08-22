import type * as React from "react";
import { Toaster as Sonner } from "sonner";

/**
 * The app's only non-blocking feedback channel.
 *
 * The upstream registry entry reads the active theme from `next-themes`. This
 * app has no JS theme state to read: dark mode is a `prefers-color-scheme`
 * media query in `styles.css` with no class and no toggle. `theme="system"` is
 * sonner's own media-query mode, so it tracks exactly what the CSS tracks and
 * the Next.js dependency is not needed.
 */
function Toaster({ ...props }: React.ComponentProps<typeof Sonner>) {
  return (
    <Sonner
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--card)",
          "--normal-border": "var(--border)",
          "--normal-text": "var(--card-foreground)",
        } as React.CSSProperties
      }
      theme="system"
      {...props}
    />
  );
}

export { Toaster };
