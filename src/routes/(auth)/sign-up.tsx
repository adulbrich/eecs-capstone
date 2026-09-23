import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";

/**
 * Kept as a redirect because the app is in production: bookmarks, old messages
 * and outside links still point here (#586). `/sign-in` is the one page for
 * signing in and creating an account, so this forwards to it, carrying
 * `?redirect=` so a signed-out visitor following a link that meant "come back
 * here afterwards" still comes back.
 *
 * No session check of its own. `/sign-in` sends a signed-in visitor to
 * `/profile`, ignoring `?redirect=` as it always has; a check here would only
 * do the same one hop sooner, at the cost of a second `getSession` for every
 * signed-out visitor.
 * The default 307 rather than a 301: browsers cache a 301 indefinitely, so the
 * path could never be given back to a page for anyone who had followed it.
 */
export const Route = createFileRoute("/(auth)/sign-up")({
  validateSearch: z.object({ redirect: z.string().optional() }),
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/sign-in", search: { redirect: search.redirect } });
  },
});
