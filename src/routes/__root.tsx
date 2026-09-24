import { TanStackDevtools } from "@tanstack/react-devtools";
import type { QueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { BrandProvider } from "../components/brand-provider";
import { SiteHeader } from "../components/site-header";
import { Toaster } from "../components/ui/sonner";
import TanStackQueryDevtools from "../integrations/tanstack-query/devtools";
import { brand } from "../lib/brand";
import { absoluteUrl } from "../lib/site-url";
import {
  SITE_DESCRIPTION,
  SOCIAL_CARD_ALT,
  SOCIAL_CARD_PATH,
} from "../lib/social-meta";
import appCss from "../styles.css?url";

interface MyRouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<MyRouterContext>()({
  head: () => ({
    // Brand-level defaults, so every page unfurls as something even when it
    // has nothing of its own to say. A child route's entry replaces the one
    // here when its `name` or `property` matches, so `/projects/$projectId`
    // overrides the title, description and type without coordinating with
    // this list, and inherits the rest.
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        title: `${brand.institutionName} ${brand.programName}`,
      },
      {
        name: "description",
        content: SITE_DESCRIPTION,
      },
      {
        property: "og:site_name",
        content: `${brand.institutionName} ${brand.programName}`,
      },
      {
        property: "og:type",
        content: "website",
      },
      {
        property: "og:title",
        content: `${brand.institutionName} ${brand.programName}`,
      },
      {
        property: "og:description",
        content: SITE_DESCRIPTION,
      },
      // Absolute on purpose: a scraper has no base to resolve a relative
      // image against, and drops the tag rather than guessing.
      {
        property: "og:image",
        content: absoluteUrl(SOCIAL_CARD_PATH),
      },
      {
        property: "og:image:alt",
        content: SOCIAL_CARD_ALT,
      },
      {
        name: "twitter:card",
        content: "summary_large_image",
      },
      {
        name: "twitter:title",
        content: `${brand.institutionName} ${brand.programName}`,
      },
      {
        name: "twitter:description",
        content: SITE_DESCRIPTION,
      },
      {
        name: "twitter:image",
        content: absoluteUrl(SOCIAL_CARD_PATH),
      },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <BrandProvider>
          <SiteHeader />
          {children}
          <Toaster />
          {/*
            Bottom left, because the bottom right is the project page's
            similar-projects control (#614), and a dev-only trigger over it
            intercepts the click in the accessibility suite.
          */}
          <TanStackDevtools
            config={{
              position: "bottom-left",
            }}
            plugins={[
              {
                name: "Tanstack Router",
                render: <TanStackRouterDevtoolsPanel />,
              },
              TanStackQueryDevtools,
            ]}
          />
          <Scripts />
        </BrandProvider>
      </body>
    </html>
  );
}
